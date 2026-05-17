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
} from "discord.js";

import {
  buyMarketCommand,
  cancelMarketCommand,
  closeMarketCommand,
  createMarketCommand,
  formatTradeSummary,
  openMarketCommand,
  resolveMarketCommand,
  viewMarketCommand,
  writeMarketDiscordMetadata,
} from "../service";
import {
  ensureMarketThread,
  field,
  marketEmbed,
  modal,
  parseBoolean,
  parseDate,
  parseMode,
  parseOutcome,
  requireActor,
  requiredField,
  requireValue,
  resolveMarketId,
  textInput,
} from "./utils";
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
      closesAt: field(interaction, "closes_at"),
      description: field(interaction, "description"),
      open: field(interaction, "open"),
      slug: field(interaction, "slug"),
      title: field(interaction, "title"),
    });
  } else if (interaction.customId === "market-open") {
    await openMarketFromValues(context, interaction, {
      closesAt: requiredField(interaction, "closes_at"),
      market: requiredField(interaction, "market"),
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

  if (!title) {
    await interaction.showModal(
      modal("market-create", "Create market", [
        textInput("title", "Market question", TextInputStyle.Short, true),
        textInput("description", "Description", TextInputStyle.Paragraph, false),
        textInput("slug", "Slug", TextInputStyle.Short, false),
        textInput("open", "Open now? yes/no", TextInputStyle.Short, false),
        textInput("closes_at", "Closes at ISO date/time", TextInputStyle.Short, false),
      ]),
    );
    return;
  }

  await createMarketFromValues(interactionContext, interaction, {
    closesAt: interaction.options.getString("closes_at"),
    description: interaction.options.getString("description"),
    open: interaction.options.getBoolean("open") ? "yes" : "no",
    slug: interaction.options.getString("slug"),
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
          "Closes at ISO date/time",
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
    closesAt: string | null;
    description: string | null;
    open: string | null;
    slug: string | null;
    title: string | null;
  },
) {
  const actor = await requireActor(context, interaction);
  const openNow = parseBoolean(values.open);
  const createInput = {
    ...context.services,
    actor,
    description: values.description,
    openNow,
    slug: values.slug,
    title: requireValue(values.title, "title"),
  };
  const result = await createMarketCommand(
    values.closesAt ? { ...createInput, closesAt: parseDate(values.closesAt) } : createInput,
  );

  const thread = result.opened
    ? await ensureAndPersistMarketThread(context, interaction, result.market)
    : null;
  await interaction.reply({
    embeds: [marketEmbed(result.market, result.opened ? "Market opened" : "Market created")],
  });

  if (thread) {
    await thread.send({ embeds: [marketEmbed(result.market, "Market opened")] });
  }
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
    closesAt: parseDate(values.closesAt),
    marketId: await resolveMarketId(context, values.market),
  });
  const thread = await ensureAndPersistMarketThread(context, interaction, market);

  await interaction.reply({ embeds: [marketEmbed(market, "Market opened")] });
  await thread?.send({ embeds: [marketEmbed(market, "Market opened")] });
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
  const market = await viewMarketCommand({ ...context.services, marketId });

  if (!actor.isGuildAdmin && actor.userId === market.creatorUserId && !values.proof) {
    await interaction.reply({
      content: "Creator resolution requires proof attachment. Re-run `/market resolve` with proof.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await resolveMarketCommand({
    ...context.services,
    actor,
    evidence: {
      admin: actor.isGuildAdmin,
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
    outcome: parseOutcome(values.outcome),
  });
  await interaction.reply({ embeds: [marketEmbed(result.market, "Market resolved")] });
}

async function cancelMarketFromValues(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  values: { market: string; reason: string },
) {
  const actor = await requireActor(context, interaction);
  const marketId = await resolveMarketId(context, values.market);
  const market = await viewMarketCommand({ ...context.services, marketId });

  if (!actor.isGuildAdmin && actor.userId === market.creatorUserId) {
    const customId = `market-cancel-confirm:${marketId}:${interaction.user.id}:${encodeURIComponent(values.reason).slice(0, 40)}`;
    await interaction.reply({
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(customId)
            .setLabel("Confirm 10% creator penalty")
            .setStyle(ButtonStyle.Danger),
        ),
      ],
      content: "Cancelling refunds buyers and applies the default 10% creator penalty. Confirm?",
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
  market: { id: string; metadata: Record<string, unknown>; title: string },
  content: string,
) {
  const thread = await ensureAndPersistMarketThread(context, interaction, market);
  await thread?.send({ content });
}
