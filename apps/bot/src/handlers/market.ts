import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  TextInputStyle,
  type Attachment,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ThreadChannel,
} from "discord.js";

import {
  buyMarketCommand,
  cancelMarketCommand,
  closeMarketCommand,
  createMarketCommand,
  formatMarketRefreshTradeSummary,
  formatTradeSummary,
  listMarketRefreshTrades,
  openMarketCommand,
  parseLastTradeRefresh,
  previewCancelMarketCommand,
  refreshMarketCommand,
  resolveMarketCommand,
  serializeLastTradeRefresh,
  viewMarketCommand,
  writeMarketDiscordMetadata,
} from "../service";
import {
  ensureMarketThread,
  field,
  getDiscordMetadata,
  marketEmbed,
  modal,
  parseCloseDate,
  parseMode,
  parseOutcome,
  requireActor,
  requiredField,
  requireValue,
  resolveMarketId,
  textInput,
} from "./utils";
import { formatMicro } from "../money";
import type { BotHandlerContext } from "./context";

export async function handleMarket(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "create") {
    await handleMarketCreate(context, interaction);
  } else if (subcommand === "open") {
    await handleMarketOpen(context, interaction);
  } else if (subcommand === "view") {
    await handleMarketView(context, interaction);
  } else if (subcommand === "buy") {
    await handleMarketBuy(context, interaction);
  } else if (subcommand === "sell") {
    await interaction.reply({
      content: "Sell command is registered, but exchange sell API is not implemented yet.",
      flags: MessageFlags.Ephemeral,
    });
  } else if (subcommand === "close") {
    await handleMarketClose(context, interaction);
  } else if (subcommand === "refresh") {
    await handleMarketRefresh(context, interaction);
  } else if (subcommand === "resolve") {
    await handleMarketResolve(context, interaction);
  } else if (subcommand === "cancel") {
    await handleMarketCancel(context, interaction);
  }
}

export async function handleMarketButton(
  context: BotHandlerContext,
  interaction: ButtonInteraction,
) {
  if (interaction.customId.startsWith("market-open-now:")) {
    const [, marketId, actorUserId] = interaction.customId.split(":");

    if (!marketId || !actorUserId || actorUserId !== interaction.user.id) {
      await interaction.reply({
        content: "Open confirmation expired or belongs to another user.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(openMarketDateModal(marketId));
    return;
  }

  if (!interaction.customId.startsWith("market-cancel-confirm:")) {
    return;
  }

  const [, marketId, actorUserId, reason] = interaction.customId.split(":");

  if (!marketId || !actorUserId || !reason || actorUserId !== interaction.user.id) {
    await interaction.reply({
      content: "Cancel confirmation expired or belongs to another user.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const actor = await requireActor(context, interaction);
  const result = await cancelMarketCommand({
    ...context.services,
    actor,
    marketId,
    reason: decodeURIComponent(reason),
  });
  await interaction.update({
    components: [],
    embeds: [marketEmbed(result.market, "Market cancelled")],
  });
}

export async function handleMarketModal(
  context: BotHandlerContext,
  interaction: ModalSubmitInteraction,
) {
  if (interaction.customId === "market-create") {
    await createMarketFromValues(context, interaction, {
      description: field(interaction, "description"),
      openNow: false,
      title: field(interaction, "title"),
    });
  } else if (
    interaction.customId === "market-open" ||
    interaction.customId.startsWith("market-open:")
  ) {
    const marketId = interaction.customId.startsWith("market-open:")
      ? requireValue(interaction.customId.split(":")[1] ?? null, "market")
      : requiredField(interaction, "market");
    await openMarketFromValues(context, interaction, {
      closesAt: requiredField(interaction, "closes_at"),
      market: marketId,
    });
  } else if (interaction.customId === "market-view") {
    const market = await viewMarketCommand({
      ...context.services,
      marketId: await resolveMarketId(context, requiredField(interaction, "market")),
    });
    await interaction.reply({
      embeds: [marketEmbed(market, "Market")],
      flags: MessageFlags.Ephemeral,
    });
  } else if (interaction.customId === "market-buy") {
    await buyMarketFromValues(context, interaction, {
      amount: requiredField(interaction, "amount"),
      market: requiredField(interaction, "market"),
      mode: requiredField(interaction, "mode"),
      outcome: requiredField(interaction, "outcome"),
    });
  } else if (interaction.customId === "market-close") {
    const actor = await requireActor(context, interaction);
    const market = await closeMarketCommand({
      ...context.services,
      actor,
      marketId: await resolveMarketId(context, requiredField(interaction, "market")),
    });
    await interaction.reply({ embeds: [marketEmbed(market, "Market closed")] });
  } else if (interaction.customId === "market-resolve") {
    await resolveMarketFromValues(context, interaction, {
      market: requiredField(interaction, "market"),
      note: field(interaction, "note"),
      outcome: requiredField(interaction, "outcome"),
      proof: null,
    });
  } else if (interaction.customId === "market-cancel") {
    await cancelMarketFromValues(context, interaction, {
      market: requiredField(interaction, "market"),
      reason: requiredField(interaction, "reason"),
    });
  }
}

async function handleMarketCreate(
  interactionContext: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const title = interaction.options.getString("title");
  const openNow = interaction.options.getBoolean("open") ?? false;

  if (!title) {
    await interaction.showModal(
      modal("market-create", "Create market", [
        textInput("title", "Market question", TextInputStyle.Short, true),
        textInput("description", "Description", TextInputStyle.Paragraph, false),
      ]),
    );
    return;
  }

  await createMarketFromValues(interactionContext, interaction, {
    description: interaction.options.getString("description"),
    openNow,
    title,
  });
}

async function handleMarketOpen(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const marketId = interaction.options.getString("market");
  const closesAt = interaction.options.getString("closes_at");

  if (!marketId || !closesAt) {
    await interaction.showModal(
      modal("market-open", "Open market", [
        textInput("market", "Market ID or slug", TextInputStyle.Short, true, marketId ?? ""),
        textInput(
          "closes_at",
          "Close date (MM/DD/YYYY)",
          TextInputStyle.Short,
          true,
          closesAt ?? "",
        ),
      ]),
    );
    return;
  }

  await openMarketFromValues(context, interaction, { closesAt, market: marketId });
}

async function handleMarketView(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const marketId = interaction.options.getString("market");

  if (!marketId) {
    await interaction.showModal(
      modal("market-view", "View market", [
        textInput("market", "Market ID or slug", TextInputStyle.Short, true),
      ]),
    );
    return;
  }

  const market = await viewMarketCommand({
    ...context.services,
    marketId: await resolveMarketId(context, marketId),
  });
  await interaction.reply({
    embeds: [marketEmbed(market, "Market")],
    flags: interaction.options.getBoolean("private") ? MessageFlags.Ephemeral : undefined,
  });
}

async function handleMarketBuy(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const market = interaction.options.getString("market");
  const outcome = interaction.options.getString("outcome");
  const mode = interaction.options.getString("mode");
  const spendRep = interaction.options.getString("spend_rep");
  const targetShares = interaction.options.getString("target_shares");
  const value = mode === "target_shares" ? targetShares : spendRep;

  if (!market || !outcome || !mode || !value) {
    await interaction.showModal(
      modal("market-buy", "Buy contracts", [
        textInput("market", "Market ID or slug", TextInputStyle.Short, true, market ?? ""),
        textInput("outcome", "YES or NO", TextInputStyle.Short, true, outcome ?? ""),
        textInput(
          "mode",
          "spend_rep or target_shares",
          TextInputStyle.Short,
          true,
          mode ?? "spend_rep",
        ),
        textInput("amount", "Amount", TextInputStyle.Short, true, value ?? ""),
      ]),
    );
    return;
  }

  await buyMarketFromValues(context, interaction, { amount: value, market, mode, outcome });
}

async function handleMarketClose(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const marketId = interaction.options.getString("market");

  if (!marketId) {
    await interaction.showModal(
      modal("market-close", "Close market", [
        textInput("market", "Market ID or slug", TextInputStyle.Short, true),
      ]),
    );
    return;
  }

  const actor = await requireActor(context, interaction);
  const market = await closeMarketCommand({
    ...context.services,
    actor,
    marketId: await resolveMarketId(context, marketId),
  });
  await interaction.reply({ embeds: [marketEmbed(market, "Market closed")] });
}

async function handleMarketRefresh(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const marketId = requireValue(interaction.options.getString("market"), "market");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await refreshMarketThread(context, interaction, marketId);
}

async function handleMarketResolve(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const marketId = interaction.options.getString("market");
  const outcome = interaction.options.getString("outcome");
  const proof = interaction.options.getAttachment("proof");
  const note = interaction.options.getString("note");

  if (!marketId || !outcome) {
    await interaction.showModal(
      modal("market-resolve", "Resolve market", [
        textInput("market", "Market ID or slug", TextInputStyle.Short, true, marketId ?? ""),
        textInput("outcome", "YES or NO", TextInputStyle.Short, true, outcome ?? ""),
        textInput("note", "Note or admin reason", TextInputStyle.Paragraph, false, note ?? ""),
      ]),
    );
    return;
  }

  await resolveMarketFromValues(context, interaction, { market: marketId, note, outcome, proof });
}

async function handleMarketCancel(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const marketId = interaction.options.getString("market");
  const reason = interaction.options.getString("reason");

  if (!marketId || !reason) {
    await interaction.showModal(
      modal("market-cancel", "Cancel market", [
        textInput("market", "Market ID or slug", TextInputStyle.Short, true, marketId ?? ""),
        textInput("reason", "Cancellation reason", TextInputStyle.Paragraph, true, reason ?? ""),
      ]),
    );
    return;
  }

  await cancelMarketFromValues(context, interaction, { market: marketId, reason });
}

async function createMarketFromValues(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  values: {
    description: string | null;
    openNow: boolean;
    title: string | null;
  },
) {
  const actor = await requireActor(context, interaction);
  const createInput = {
    ...context.services,
    actor,
    description: values.description,
    title: requireValue(values.title, "title"),
  };
  const result = await createMarketCommand(createInput);

  if (values.openNow && interaction.isChatInputCommand()) {
    await interaction.showModal(openMarketDateModal(result.market.id));
    return;
  }

  await interaction.reply({
    components: [openNowActionRow(result.market.id, interaction.user.id)],
    content:
      "Market created as a draft. Use Open now to set close date. Markets close at 11:59:59pm ET.",
    embeds: [marketEmbed(result.market, "Market created")],
    flags: MessageFlags.Ephemeral,
  });
}

async function openMarketFromValues(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  values: { closesAt: string; market: string },
) {
  const actor = await requireActor(context, interaction);
  const market = await openMarketCommand({
    ...context.services,
    actor,
    closesAt: parseCloseDate(values.closesAt),
    marketId: await resolveMarketId(context, values.market),
  });
  const thread = await ensureAndPersistMarketThread(context, interaction, market);

  await interaction.reply({ embeds: [marketEmbed(market, "Market opened")] });
  await postOrUpdateMarketSummary(context, market, thread);
}

async function buyMarketFromValues(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  values: { amount: string; market: string; mode: string; outcome: string },
) {
  const actor = await requireActor(context, interaction);
  const mode = parseMode(values.mode);
  const outcome = parseOutcome(values.outcome);
  const result = await buyMarketCommand({
    ...context.services,
    actor,
    marketId: await resolveMarketId(context, values.market),
    mode,
    outcome,
    value: values.amount,
  });
  const summary = formatTradeSummary({
    costMicro: result.quote.costMicro,
    outcome,
    sharesMicro: result.quote.sharesMicro,
    title: result.market.title,
  });

  await interaction.reply({
    content: summary,
    embeds: [marketEmbed(result.market, "Trade executed")],
    flags: MessageFlags.Ephemeral,
  });
  await postToMarketThread(context, interaction, result.market, summary);
}

async function resolveMarketFromValues(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  values: {
    market: string;
    note: string | null;
    outcome: string;
    proof: Attachment | null;
  },
) {
  const actor = await requireActor(context, interaction);
  const marketId = await resolveMarketId(context, values.market);

  const outcome = parseOutcome(values.outcome);
  const result = await resolveMarketCommand({
    ...context.services,
    actor,
    evidence: {
      note: values.note ?? null,
      proof: values.proof
        ? {
            contentType: values.proof.contentType,
            name: values.proof.name,
            url: values.proof.url,
          }
        : null,
    },
    marketId,
    outcome,
  });
  await interaction.reply({
    embeds: [resolvedMarketEmbed(result.market, "Market resolved", outcome, values.proof)],
  });
  await postResolutionToMarketThread(context, interaction, result.market, outcome, values.proof);
}

async function cancelMarketFromValues(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  values: { market: string; reason: string },
) {
  const actor = await requireActor(context, interaction);
  const marketId = await resolveMarketId(context, values.market);
  const market = await viewMarketCommand({ ...context.services, marketId });

  if (actor.userId === market.creatorUserId) {
    const preview = await previewCancelMarketCommand({ ...context.services, actor, marketId });
    const customId = `market-cancel-confirm:${marketId}:${interaction.user.id}:${encodeURIComponent(values.reason.slice(0, 40))}`;
    await interaction.reply({
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(customId)
            .setLabel("Confirm 10% creator penalty")
            .setStyle(ButtonStyle.Danger),
        ),
      ],
      content: `Cancelling refunds ${formatMicro(preview.refundTotalMicro)} total and applies a ${formatMicro(preview.creatorPenaltyMicro)} creator penalty. Creator net effect: ${formatMicro(preview.creatorNetMicro)}. Confirm?`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await cancelMarketCommand({
    ...context.services,
    actor,
    marketId,
    reason: values.reason,
  });
  await interaction.reply({ embeds: [marketEmbed(result.market, "Market cancelled")] });
}

async function ensureAndPersistMarketThread(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  market: { id: string; metadata: Record<string, unknown>; title: string },
) {
  const thread = await ensureMarketThread(context, interaction, market);

  if (thread) {
    await writeMarketDiscordMetadata({
      ...context.services,
      marketId: market.id,
      metadata: {
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        threadId: thread.id,
      },
    });
  }

  return thread;
}

async function postToMarketThread(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  market: {
    id: string;
    metadata: Record<string, unknown>;
    title: string;
    closesAt: Date | null;
    description?: string | null;
    prices?: { no: number; yes: number };
    slug: string;
    status: string;
  },
  content: string,
) {
  const thread = await ensureAndPersistMarketThread(context, interaction, market);
  await postOrUpdateMarketSummary(context, market, thread);
  await thread?.send({ content });
}

async function refreshMarketThread(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
  marketValue: string,
) {
  const actor = await requireActor(context, interaction);
  const marketId = await resolveMarketId(context, marketValue);
  const market = await refreshMarketCommand({
    ...context.services,
    actor,
    marketId,
  });
  const thread = await ensureAndPersistMarketThread(context, interaction, market);
  const discordMetadata = getDiscordMetadata(market.metadata);

  if (!thread) {
    await interaction.editReply({
      content: "Market refreshed, but no market thread was available. Posted 0 trades.",
      embeds: [marketEmbed(market, "Market refreshed")],
    });
    return;
  }

  const trades = await listMarketRefreshTrades({
    ...context.services,
    lastTradeRefresh: parseLastTradeRefresh(discordMetadata.lastTradeRefresh),
    marketId,
  });

  await postOrUpdateMarketSummary(context, market, thread);

  for (const trade of trades) {
    await thread.send({
      content: formatMarketRefreshTradeSummary({
        title: market.title,
        trade,
      }),
    });
  }

  if (trades.length > 0) {
    const lastTrade = trades[trades.length - 1];

    if (!lastTrade) {
      throw new Error("Missing last refreshed trade");
    }

    await writeMarketDiscordMetadata({
      ...context.services,
      marketId,
      metadata: {
        lastTradeRefresh: serializeLastTradeRefresh(lastTrade),
      },
    });
  }

  await interaction.editReply({
    content: `Market refreshed. Posted ${trades.length} trade${trades.length === 1 ? "" : "s"}.`,
    embeds: [marketEmbed(market, "Market refreshed")],
  });
}

async function postResolutionToMarketThread(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  market: {
    id: string;
    metadata: Record<string, unknown>;
    title: string;
    closesAt: Date | null;
    description?: string | null;
    prices?: { no: number; yes: number };
    slug: string;
    status: string;
  },
  outcome: "NO" | "YES",
  proof: Attachment | null,
) {
  const thread = await ensureAndPersistMarketThread(context, interaction, market);
  await postOrUpdateMarketSummary(context, market, thread, {
    proof,
    title: "Market resolved",
    outcome,
  });
  await thread?.send({
    content: `Market resolved: ${outcome} won.${proof ? ` Proof: ${proof.url}` : ""}`,
    embeds: [resolvedMarketEmbed(market, "Market resolved", outcome, proof)],
  });
}

async function postOrUpdateMarketSummary(
  context: BotHandlerContext,
  market: {
    id: string;
    metadata: Record<string, unknown>;
    title: string;
    closesAt: Date | null;
    description?: string | null;
    prices?: { no: number; yes: number };
    slug: string;
    status: string;
  },
  thread: ThreadChannel | null,
  options: { outcome?: "NO" | "YES"; proof?: Attachment | null; title?: string } = {},
) {
  if (!thread) {
    return;
  }

  const summaryMessageId = getDiscordMetadata(market.metadata).summaryMessageId;

  if (summaryMessageId) {
    const summary = await thread.messages.fetch(String(summaryMessageId)).catch(() => null);

    if (summary) {
      await summary.edit({
        embeds: [
          resolvedMarketEmbed(market, options.title ?? "Market", options.outcome, options.proof),
        ],
      });
      return;
    }
  }

  const summary = await thread.send({
    embeds: [
      resolvedMarketEmbed(market, options.title ?? "Market", options.outcome, options.proof),
    ],
  });

  await summary.pin().catch((error: unknown) => {
    context.services.logger?.error("discord_market_summary_pin_failed", {
      error,
      market_id: market.id,
    });
  });
  await writeMarketDiscordMetadata({
    ...context.services,
    marketId: market.id,
    metadata: {
      summaryMessageId: summary.id,
      threadId: thread.id,
    },
  });
}

function resolvedMarketEmbed(
  market: Parameters<typeof marketEmbed>[0],
  title: string,
  outcome?: "NO" | "YES",
  proof?: Attachment | null,
) {
  const embed = marketEmbed(market, title);

  if (outcome) {
    embed.addFields({ name: "Resolution", value: `${outcome} won`, inline: true });
  }

  if (proof) {
    embed.addFields({ name: "Proof", value: proof.url, inline: false }).setImage(proof.url);
  }

  return embed;
}

function openMarketDateModal(marketId: string) {
  return modal(`market-open:${marketId}`, "Open market", [
    textInput("closes_at", "Close date (MM/DD/YYYY)", TextInputStyle.Short, true),
  ]);
}

function openNowActionRow(marketId: string, actorUserId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`market-open-now:${marketId}:${actorUserId}`)
      .setLabel("Open now")
      .setStyle(ButtonStyle.Primary),
  );
}
