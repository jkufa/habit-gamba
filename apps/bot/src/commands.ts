import {
  ApplicationCommandOptionType,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from "discord.js";

export const commandData = [
  new SlashCommandBuilder()
    .setName("account")
    .setDescription("Manage your Habit Gamba account")
    .addSubcommand((command) =>
      command.setName("register").setDescription("Register your Discord account"),
    )
    .addSubcommand((command) => command.setName("me").setDescription("Show your account")),
  new SlashCommandBuilder()
    .setName("position")
    .setDescription("View your market positions")
    .addSubcommand((command) => command.setName("list").setDescription("List your positions")),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the global REP leaderboard")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Number of entries to show")
        .setMinValue(1)
        .setMaxValue(25),
    )
    .addBooleanOption((option) => option.setName("private").setDescription("Reply privately")),
  new SlashCommandBuilder()
    .setName("market")
    .setDescription("Create, view, trade, and resolve markets")
    .addSubcommand(createMarketCommand)
    .addSubcommand(openMarketCommand)
    .addSubcommand(viewMarketCommand)
    .addSubcommand(buyMarketCommand)
    .addSubcommand(sellMarketCommand)
    .addSubcommand(closeMarketCommand)
    .addSubcommand(refreshMarketCommand)
    .addSubcommand(resolveMarketCommand)
    .addSubcommand(cancelMarketCommand),
].map((command) => command.toJSON());

function createMarketCommand(
  command: SlashCommandSubcommandBuilder,
): SlashCommandSubcommandBuilder {
  return command
    .setName("create")
    .setDescription("Create a YES/NO market")
    .addStringOption((option) => option.setName("title").setDescription("Market question"))
    .addStringOption((option) => option.setName("description").setDescription("Market details"))
    .addBooleanOption((option) => option.setName("open").setDescription("Open immediately"));
}

function openMarketCommand(command: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return command
    .setName("open")
    .setDescription("Open a draft market")
    .addStringOption((option) =>
      option.setName("market").setDescription("Market").setAutocomplete(true).setRequired(false),
    )
    .addStringOption((option) =>
      option.setName("closes_at").setDescription("Close date (MM/DD/YYYY)"),
    );
}

function viewMarketCommand(command: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return command
    .setName("view")
    .setDescription("View a market")
    .addStringOption((option) =>
      option.setName("market").setDescription("Market").setAutocomplete(true).setRequired(false),
    )
    .addBooleanOption((option) => option.setName("private").setDescription("Reply privately"));
}

function buyMarketCommand(command: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return command
    .setName("buy")
    .setDescription("Buy YES or NO contracts")
    .addStringOption((option) =>
      option.setName("market").setDescription("Market").setAutocomplete(true).setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("outcome")
        .setDescription("Outcome")
        .addChoices({ name: "YES", value: "YES" }, { name: "NO", value: "NO" }),
    )
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Amount mode")
        .addChoices(
          { name: "Spend REP", value: "spend_rep" },
          { name: "Target shares", value: "target_shares" },
        ),
    )
    .addStringOption((option) =>
      option.setName("spend_rep").setDescription("REP budget, up to 2 decimals"),
    )
    .addStringOption((option) =>
      option.setName("target_shares").setDescription("Target contracts, up to 2 decimals"),
    );
}

function sellMarketCommand(command: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return command
    .setName("sell")
    .setDescription("Sell contracts")
    .addStringOption((option) =>
      option.setName("market").setDescription("Market").setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("outcome")
        .setDescription("Outcome")
        .addChoices({ name: "YES", value: "YES" }, { name: "NO", value: "NO" }),
    )
    .addStringOption((option) => option.setName("amount").setDescription("Contracts to sell"));
}

function closeMarketCommand(command: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return command
    .setName("close")
    .setDescription("Close a market")
    .addStringOption((option) =>
      option.setName("market").setDescription("Market").setAutocomplete(true),
    );
}

function refreshMarketCommand(
  command: SlashCommandSubcommandBuilder,
): SlashCommandSubcommandBuilder {
  return command
    .setName("refresh")
    .setDescription("Refresh market thread from API trades")
    .addStringOption((option) =>
      option.setName("market").setDescription("Market").setAutocomplete(true).setRequired(true),
    );
}

function resolveMarketCommand(
  command: SlashCommandSubcommandBuilder,
): SlashCommandSubcommandBuilder {
  return command
    .setName("resolve")
    .setDescription("Resolve a market")
    .addStringOption((option) =>
      option.setName("market").setDescription("Market").setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("outcome")
        .setDescription("Winning outcome")
        .addChoices({ name: "YES", value: "YES" }, { name: "NO", value: "NO" }),
    )
    .addAttachmentOption((option) => option.setName("proof").setDescription("Creator proof image"))
    .addStringOption((option) =>
      option.setName("note").setDescription("Proof note or admin reason"),
    );
}

function cancelMarketCommand(
  command: SlashCommandSubcommandBuilder,
): SlashCommandSubcommandBuilder {
  return command
    .setName("cancel")
    .setDescription("Cancel a market")
    .addStringOption((option) =>
      option.setName("market").setDescription("Market").setAutocomplete(true),
    )
    .addStringOption((option) => option.setName("reason").setDescription("Cancellation reason"));
}

export function getAutocompleteOption(
  options: { type: number; name: string; focused?: boolean }[],
) {
  return options.find(
    (option) => option.type === ApplicationCommandOptionType.String && option.focused,
  );
}
