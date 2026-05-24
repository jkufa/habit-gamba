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
  createRecurringMarketSeriesCommand,
  endRecurringMarketSeriesCommand,
  formatCloseDate,
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
  formatTodayEasternDate,
  getDiscordMetadata,
  marketEmbed,
  modal,
  parseCloseDate,
  parseEasternDateKey,
  parseMode,
  parseOutcome,
  requireActor,
  requiredField,
  requireValue,
  resolveDefaultMarketValue,
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
  const group = interaction.options.getSubcommandGroup(false);

  if (group === "recurring") {
    await handleRecurringMarket(context, interaction, subcommand);
  } else if (subcommand === "create") {
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
  if (interaction.customId.startsWith("market-recurring-start:")) {
    const [, marketId, actorUserId] = interaction.customId.split(":");

    if (!marketId || !actorUserId || actorUserId !== interaction.user.id) {
      await interaction.reply({
        content: "Recurring setup expired or belongs to another user.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await replyWithRecurringSchedule(context, interaction, marketId);
    return;
  }

  if (interaction.customId.startsWith("market-recurring:")) {
    await handleRecurringButton(context, interaction);
    return;
  }

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
      : requireValue(
          await resolveDefaultMarketValue(context, interaction, field(interaction, "market")),
          "market",
        );
    const recurring = parseOptionalBooleanField(optionalField(interaction, "recurring"));

    if (recurring === null) {
      await interaction.reply({
        content: "Recurring must be yes or no.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (recurring) {
      await replyWithRecurringSchedule(context, interaction, marketId);
      return;
    }

    const closesAt = field(interaction, "closes_at");

    if (!closesAt) {
      await interaction.reply({
        content: "Close date is required unless recurring is yes.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await openMarketFromValues(context, interaction, {
      closesAt,
      market: marketId,
    });
  } else if (interaction.customId === "market-view") {
    const marketValue = requireValue(
      await resolveDefaultMarketValue(context, interaction, field(interaction, "market")),
      "market",
    );
    const market = await viewMarketCommand({
      ...context.services,
      marketId: await resolveMarketId(context, marketValue),
    });
    await interaction.reply({
      embeds: [marketEmbed(market, "Market")],
      flags: MessageFlags.Ephemeral,
    });
  } else if (interaction.customId === "market-buy") {
    const market = requireValue(
      await resolveDefaultMarketValue(context, interaction, field(interaction, "market")),
      "market",
    );
    await buyMarketFromValues(context, interaction, {
      amount: requiredField(interaction, "amount"),
      market,
      mode: requiredField(interaction, "mode"),
      outcome: requiredField(interaction, "outcome"),
    });
  } else if (interaction.customId === "market-close") {
    const marketValue = requireValue(
      await resolveDefaultMarketValue(context, interaction, field(interaction, "market")),
      "market",
    );
    const actor = await requireActor(context, interaction);
    const market = await closeMarketCommand({
      ...context.services,
      actor,
      marketId: await resolveMarketId(context, marketValue),
    });
    await interaction.reply({ embeds: [marketEmbed(market, "Market closed")] });
  } else if (interaction.customId === "market-resolve") {
    const market = requireValue(
      await resolveDefaultMarketValue(context, interaction, field(interaction, "market")),
      "market",
    );
    await resolveMarketFromValues(context, interaction, {
      market,
      note: field(interaction, "note"),
      outcome: requiredField(interaction, "outcome"),
      proof: null,
    });
  } else if (interaction.customId === "market-cancel") {
    const market = requireValue(
      await resolveDefaultMarketValue(context, interaction, field(interaction, "market")),
      "market",
    );
    await cancelMarketFromValues(context, interaction, {
      market,
      reason: requiredField(interaction, "reason"),
    });
  } else if (interaction.customId.startsWith("market-recurring-end:")) {
    const [, marketId, actorUserId, maskValue] = interaction.customId.split(":");

    if (!marketId || !actorUserId || actorUserId !== interaction.user.id) {
      throw new RangeError("Recurring setup expired or belongs to another user.");
    }

    const endsOnInput = field(interaction, "ends_on");
    await createRecurringMarketFromValues(context, interaction, {
      daysOfWeekMask: Number(maskValue),
      endsOn: endsOnInput ? parseEasternDateKey(endsOnInput) : null,
      marketId,
    });
  }
}

async function handleRecurringMarket(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
  subcommand: string,
) {
  if (subcommand === "schedule") {
    await handleRecurringSchedule(context, interaction);
  } else if (subcommand === "end") {
    await handleRecurringEnd(context, interaction);
  } else if (subcommand === "manage") {
    await interaction.reply({
      content: "`/market recurring manage` is reserved for a later management view.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleRecurringSchedule(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const marketId = await resolveDefaultMarketValue(
    context,
    interaction,
    interaction.options.getString("market"),
  );

  if (!marketId) {
    await interaction.reply({
      content: "Choose a draft market to schedule as recurring.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await replyWithRecurringSchedule(context, interaction, marketId);
}

async function replyWithRecurringSchedule(
  context: BotHandlerContext,
  interaction: ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction,
  marketId: string,
) {
  const actor = await requireActor(context, interaction);
  await interaction.reply({
    components: recurringScheduleRows({
      actorUserId: interaction.user.id,
      marketId: await resolveMarketId(context, marketId),
      mask: 0,
      selectedPreset: null,
    }),
    content: "Select repeat days.",
    flags: MessageFlags.Ephemeral,
  });
  void actor;
}

async function handleRecurringEnd(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const marketValue = requireValue(
    await resolveDefaultMarketValue(context, interaction, interaction.options.getString("market")),
    "market",
  );
  const actor = await requireActor(context, interaction);
  const market = await viewMarketCommand({
    ...context.services,
    marketId: await resolveMarketId(context, marketValue),
  });

  if (!market.recurringSeriesId) {
    throw new RangeError("This market is not part of a recurring series.");
  }

  const result = await endRecurringMarketSeriesCommand({
    ...context.services,
    actor,
    reason: interaction.options.getString("reason"),
    seriesId: market.recurringSeriesId,
  });

  await interaction.reply({
    content: `Recurring market series ended. Future markets will not be created for "${result.series.title}".`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRecurringButton(context: BotHandlerContext, interaction: ButtonInteraction) {
  const parsed = parseRecurringButtonCustomId(interaction.customId);

  if (!parsed || parsed.actorUserId !== interaction.user.id) {
    await interaction.reply({
      content: "Recurring setup expired or belongs to another user.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsed.action === "next") {
    if (parsed.mask === 0) {
      await interaction.reply({
        content: "Select at least one repeat day.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(
      modal(
        `market-recurring-end:${parsed.marketId}:${parsed.actorUserId}:${parsed.mask}`,
        "Recurring schedule",
        [textInput("ends_on", "End date (MM/DD/YYYY)", TextInputStyle.Short, false)],
      ),
    );
    return;
  }

  const nextMask = parsed.action === "preset" ? parsed.value : parsed.mask ^ (1 << parsed.value);

  await interaction.update({
    components: recurringScheduleRows({
      actorUserId: parsed.actorUserId,
      marketId: parsed.marketId,
      mask: nextMask,
      selectedPreset: parsed.action === "preset" ? parsed.preset : null,
    }),
    content: "Select repeat days.",
  });

  void context;
}

const DAY_BUTTONS = [
  { bit: 1, label: "Mon" },
  { bit: 2, label: "Tue" },
  { bit: 3, label: "Wed" },
  { bit: 4, label: "Thu" },
  { bit: 5, label: "Fri" },
  { bit: 6, label: "Sat" },
  { bit: 0, label: "Sun" },
] as const;

const DAILY_MASK = 0b1111111;
const WEEKDAYS_MASK = 0b0111110;

type RecurringPreset = "daily" | "weekdays" | "weekly";

type RecurringScheduleState = {
  actorUserId: string;
  marketId: string;
  mask: number;
  selectedPreset: RecurringPreset | null;
};

function recurringScheduleRows(
  input: RecurringScheduleState,
  weeklyMask = currentEasternWeekdayMask(),
) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...DAY_BUTTONS.slice(0, 4).map((day) => recurringDayButton(input, day)),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...DAY_BUTTONS.slice(4).map((day) => recurringDayButton(input, day)),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(recurringPresetCustomId(input, "daily", DAILY_MASK))
        .setLabel("Daily")
        .setStyle(input.selectedPreset === "daily" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(recurringPresetCustomId(input, "weekdays", WEEKDAYS_MASK))
        .setLabel("Weekdays")
        .setStyle(
          input.selectedPreset === "weekdays" ? ButtonStyle.Primary : ButtonStyle.Secondary,
        ),
      new ButtonBuilder()
        .setCustomId(recurringPresetCustomId(input, "weekly", weeklyMask))
        .setLabel("Weekly")
        .setStyle(input.selectedPreset === "weekly" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`market-recurring:next:${input.marketId}:${input.actorUserId}:${input.mask}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

function currentEasternWeekdayMask(now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  const bit = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);

  return 1 << Math.max(bit, 0);
}

function recurringDayButton(input: RecurringScheduleState, day: (typeof DAY_BUTTONS)[number]) {
  const selected = (input.mask & (1 << day.bit)) !== 0;

  return new ButtonBuilder()
    .setCustomId(
      `market-recurring:day:${input.marketId}:${input.actorUserId}:${input.mask}:${day.bit}`,
    )
    .setLabel(day.label)
    .setStyle(selected ? ButtonStyle.Primary : ButtonStyle.Secondary);
}

function recurringPresetCustomId(
  input: RecurringScheduleState,
  preset: RecurringPreset,
  mask: number,
) {
  return `market-recurring:preset:${input.marketId}:${input.actorUserId}:${input.mask}:${preset}:${mask}`;
}

function parseRecurringButtonCustomId(customId: string):
  | {
      action: "day";
      actorUserId: string;
      marketId: string;
      mask: number;
      value: number;
    }
  | {
      action: "preset";
      actorUserId: string;
      marketId: string;
      mask: number;
      preset: RecurringPreset;
      value: number;
    }
  | {
      action: "next";
      actorUserId: string;
      marketId: string;
      mask: number;
    }
  | null {
  const [, action, marketId, actorUserId, maskValue, presetOrValue, presetMaskValue] =
    customId.split(":");

  if (
    (action !== "day" && action !== "preset" && action !== "next") ||
    !marketId ||
    !actorUserId ||
    !maskValue
  ) {
    return null;
  }

  const mask = Number(maskValue);

  if (!Number.isInteger(mask) || mask < 0 || mask > DAILY_MASK) {
    return null;
  }

  if (action === "next") {
    return { action, actorUserId, marketId, mask };
  }

  const preset = parseRecurringPreset(presetOrValue);
  const parsedValue = Number(presetMaskValue ?? presetOrValue);

  if (!Number.isInteger(parsedValue)) {
    return null;
  }

  if (action === "day") {
    if (parsedValue < 0 || parsedValue > 6) {
      return null;
    }

    return {
      action,
      actorUserId,
      marketId,
      mask,
      value: parsedValue,
    };
  }

  const parsedPreset = preset ?? inferRecurringPreset(parsedValue);

  if (!parsedPreset || parsedValue < 1 || parsedValue > DAILY_MASK) {
    return null;
  }

  return {
    action,
    actorUserId,
    marketId,
    mask,
    preset: parsedPreset,
    value: parsedValue,
  };
}

function parseRecurringPreset(value: string | undefined): RecurringPreset | null {
  if (value === "daily" || value === "weekdays" || value === "weekly") {
    return value;
  }

  return null;
}

function inferRecurringPreset(mask: number): RecurringPreset | null {
  if (mask === DAILY_MASK) {
    return "daily";
  }

  if (mask === WEEKDAYS_MASK) {
    return "weekdays";
  }

  if (mask === currentEasternWeekdayMask()) {
    return "weekly";
  }

  return null;
}

function optionalField(interaction: ModalSubmitInteraction, customId: string) {
  try {
    return field(interaction, customId);
  } catch {
    return null;
  }
}

function parseOptionalBooleanField(value: string | null) {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (normalized === "yes" || normalized === "true" || normalized === "y" || normalized === "1") {
    return true;
  }

  if (normalized === "no" || normalized === "false" || normalized === "n" || normalized === "0") {
    return false;
  }

  return null;
}

export const recurringMarketHandlerTestUtils = {
  parseOptionalBooleanField,
  recurringScheduleRows,
};

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
  const marketId = await resolveDefaultMarketValue(
    context,
    interaction,
    interaction.options.getString("market"),
  );
  const closesAt = interaction.options.getString("closes_at");
  const recurring = interaction.options.getBoolean("recurring") ?? false;

  if (recurring) {
    if (!marketId) {
      await interaction.reply({
        content: "Choose a draft market to schedule as recurring.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await replyWithRecurringSchedule(context, interaction, marketId);
    return;
  }

  if (!marketId || !closesAt) {
    await interaction.showModal(
      modal("market-open", "Open market", [
        textInput("market", "Market ID or slug", TextInputStyle.Short, true, marketId ?? ""),
        textInput(
          "closes_at",
          "Close date (MM/DD/YYYY)",
          TextInputStyle.Short,
          false,
          closesAt ?? formatTodayEasternDate(),
        ),
        textInput("recurring", "Recurring? yes/no", TextInputStyle.Short, false),
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
  const marketId = await resolveDefaultMarketValue(
    context,
    interaction,
    interaction.options.getString("market"),
  );

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
  const market = await resolveDefaultMarketValue(
    context,
    interaction,
    interaction.options.getString("market"),
  );
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
  const marketId = await resolveDefaultMarketValue(
    context,
    interaction,
    interaction.options.getString("market"),
  );

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
  const marketId = requireValue(
    await resolveDefaultMarketValue(context, interaction, interaction.options.getString("market")),
    "market",
  );
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await refreshMarketThread(context, interaction, marketId);
}

async function handleMarketResolve(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const marketId = await resolveDefaultMarketValue(
    context,
    interaction,
    interaction.options.getString("market"),
  );
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
  const marketId = await resolveDefaultMarketValue(
    context,
    interaction,
    interaction.options.getString("market"),
  );
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
    components: [draftMarketActionRow(result.market.id, interaction.user.id)],
    content:
      "Market created as a draft. Use Open now to set close date. Markets close at 11:59:59pm ET.",
    embeds: [marketEmbed(result.market, "Market created")],
    flags: MessageFlags.Ephemeral,
  });
}

async function createRecurringMarketFromValues(
  context: BotHandlerContext,
  interaction: ModalSubmitInteraction,
  values: {
    daysOfWeekMask: number;
    endsOn: string | null;
    marketId: string;
  },
) {
  const actor = await requireActor(context, interaction);
  const result = await createRecurringMarketSeriesCommand({
    ...context.services,
    actor,
    daysOfWeekMask: values.daysOfWeekMask,
    endsOn: values.endsOn,
    marketId: values.marketId,
    metadata: {
      discord: {
        channelId: interaction.channelId,
        guildId: interaction.guildId,
      },
    },
  });

  if (result.firstMarket) {
    const thread = await ensureAndPersistMarketThread(context, interaction, result.firstMarket);

    await interaction.reply({
      content: "Recurring series scheduled. First market opened.",
      embeds: [marketEmbed(result.firstMarket, "Market opened")],
      flags: MessageFlags.Ephemeral,
    });
    await postOrUpdateMarketSummary(context, result.firstMarket, thread);
    return;
  }

  await interaction.reply({
    content: `Recurring series scheduled. Next market opens ${
      result.series.nextOpenAt
        ? formatCloseDate(result.series.nextOpenAt)
        : "on the next selected day"
    }.`,
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
    textInput(
      "closes_at",
      "Close date (MM/DD/YYYY)",
      TextInputStyle.Short,
      false,
      formatTodayEasternDate(),
    ),
    textInput("recurring", "Recurring? yes/no", TextInputStyle.Short, false),
  ]);
}

function draftMarketActionRow(marketId: string, actorUserId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`market-open-now:${marketId}:${actorUserId}`)
      .setLabel("Open now")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`market-recurring-start:${marketId}:${actorUserId}`)
      .setLabel("Schedule recurring")
      .setStyle(ButtonStyle.Secondary),
  );
}
