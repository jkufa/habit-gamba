import { EmbedBuilder } from "discord.js";

import { APP_CONFIG } from "./app-config";

export type HelpTopic = {
  adminOnly?: boolean;
  aliases?: string[];
  id: string;
  lines: readonly string[];
  title: string;
};

export type GlossaryTerm = {
  aliases?: string[];
  detail: string[];
  id: string;
  summary: string;
  title: string;
};

type ExampleMarket = {
  description: string;
  slug: string;
  title: string;
};

export const EXAMPLE_MARKETS = [
  {
    title: "Will Mark make it to game night before 8pm?",
    description: "Resolves YES if Mark joins voice or arrives in person before 8:00pm local time.",
    slug: "mark-game-night",
  },
  {
    title: "Will Logan finish Elden Ring before June?",
    description: "Resolves YES if Logan beats the final boss before June 1.",
    slug: "logan-elden-ring",
  },
  {
    title: "Will Grayson touch grass this weekend?",
    description: "Resolves YES if Grayson posts proof of being outside before Sunday at 11:59pm.",
    slug: "grayson-touch-grass",
  },
  {
    title: "Will the group actually start the movie before 10pm?",
    description: "Resolves YES if the movie starts playing before 10:00pm local time.",
    slug: "movie-before-10",
  },
  {
    title: 'Will Sam\'s "one quick ranked game" take under 45 minutes?',
    description: "Timer starts when queue pops. Resolves YES if the match ends before 45:00.",
    slug: "sam-ranked-under-45",
  },
  {
    title: "Will Chris beat the S&P 500 this month?",
    description:
      "Resolves YES if Chris's tracked portfolio return beats SPY for the calendar month.",
    slug: "chris-beats-spy",
  },
] as const;

export const EXAMPLE_RECURRING_MARKETS = [
  {
    title: "Will Grayson go to the gym today?",
    description: "Resolves YES if Grayson checks in or posts proof before 11:59pm.",
    slug: "grayson-gym-today",
  },
  {
    title: "Will Mark finish a ranked match before midnight?",
    description: "Resolves YES if Mark completes at least one ranked match before midnight.",
    slug: "mark-ranked-before-midnight",
  },
  {
    title: "Will Logan make market open today?",
    description: "Resolves YES if Logan is online before the first regular trading session opens.",
    slug: "logan-market-open",
  },
  {
    title: "Will the group start the movie before 10pm?",
    description: "Resolves YES if the movie starts playing before 10:00pm local time.",
    slug: "movie-before-10-daily",
  },
] as const;

const CREATE_EXAMPLE_MARKET = EXAMPLE_MARKETS[4]!;
const OPEN_EXAMPLE_MARKET = EXAMPLE_MARKETS[0]!;
const BUY_EXAMPLE_MARKET = EXAMPLE_MARKETS[5]!;
const RECURRING_EXAMPLE_MARKET = EXAMPLE_RECURRING_MARKETS[0]!;

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "all",
    title: `${APP_CONFIG.name} help`,
    lines: [
      `${APP_CONFIG.name} lets this server create markets, trade YES/NO contracts with REP, and settle outcomes when results are known.`,
      "",
      "Start here:",
      "- `/account register` - Create your account",
      "- `/market create` - Create a draft market",
      "- `/market open` - Open a market for trading",
      "- `/market buy` - Buy YES or NO contracts",
      "- `/position list` - See your open positions",
      "- `/glossary` - Learn key terms",
      "",
      "Use `/help topic:<topic>` for command details.",
    ],
  },
  {
    id: "account",
    title: "/account",
    lines: [
      "Use account commands to register and check your REP balance.",
      "",
      "Commands:",
      "- `/account register` - Create your account",
      "- `/account me` - Show your current balance",
    ],
  },
  {
    id: "account register",
    aliases: ["register"],
    title: "/account register",
    lines: [
      "Create your REP account for this Discord server.",
      "",
      "Run this before trading, creating markets, or checking positions.",
      "",
      "Example:",
      "- `/account register`",
    ],
  },
  {
    id: "account me",
    title: "/account me",
    lines: ["Show your available REP balance.", "", "Example:", "- `/account me`"],
  },
  {
    id: "market",
    title: "/market",
    lines: [
      "Use market commands to create, open, view, trade, refresh, settle, and cancel markets.",
      "",
      "Common commands:",
      "- `/market create` - Create a draft market",
      "- `/market open` - Open a market for trading",
      "- `/market view` - View market details",
      "- `/market buy` - Buy YES or NO contracts",
      "- `/market resolve` - Settle a market",
      "- `/market cancel` - Cancel a market",
      "- `/market recurring schedule` - Schedule repeat markets",
      "",
      "Example markets:",
      ...EXAMPLE_MARKETS.map(formatExampleMarket),
    ],
  },
  {
    id: "market create",
    aliases: ["create"],
    title: "/market create",
    lines: [
      "Create a YES/NO market question.",
      "",
      "Options:",
      "- `title` - The market question",
      "- `description` - Settlement rules or context",
      "- `open` - Open it immediately after creation",
      "",
      "Example:",
      `- \`/market create title:"${CREATE_EXAMPLE_MARKET.title}" description:"${CREATE_EXAMPLE_MARKET.description}"\``,
      "",
      "Tip: write settlement rules clearly so participants can agree on the final outcome.",
    ],
  },
  {
    id: "market open",
    aliases: ["open"],
    title: "/market open",
    lines: [
      "Open a draft market for trading.",
      "",
      "Options:",
      "- `market` - Draft market to open",
      "- `closes_at` - Close date in `MM/DD/YYYY`",
      "- `recurring` - Schedule this draft as a recurring market",
      "",
      "Example:",
      `- \`/market open market:${OPEN_EXAMPLE_MARKET.slug} closes_at:06/30/2026\``,
      "",
      "Markets close at 11:59:59pm ET on the selected date.",
    ],
  },
  {
    id: "market view",
    aliases: ["view"],
    title: "/market view",
    lines: [
      "View market details, prices, status, and close time.",
      "",
      "Options:",
      "- `market` - Market to view. Defaults to this thread when used inside a market thread.",
      "- `private` - Reply only to you",
      "",
      "Example:",
      "- `/market view private:true`",
    ],
  },
  {
    id: "market buy",
    aliases: ["buy"],
    title: "/market buy",
    lines: [
      "Buy YES or NO contracts in an open market.",
      "",
      "Options:",
      "- `market` - Market to trade. Defaults to this thread when used inside a market thread.",
      "- `outcome` - YES if you think the market resolves YES, NO if you think it resolves NO.",
      "- `mode` - Choose how to size the trade.",
      "- `spend_rep` - REP budget to spend.",
      "- `target_shares` - Exact number of contracts to buy.",
      "",
      "Examples:",
      "- `/market buy outcome:YES mode:Spend REP spend_rep:10`",
      `- \`/market buy market:${BUY_EXAMPLE_MARKET.slug} outcome:NO mode:Target shares target_shares:5\``,
      "",
      "Note: prices can move as trades execute. Your final contracts depend on current market price.",
    ],
  },
  {
    id: "market sell",
    aliases: ["sell"],
    title: "/market sell",
    lines: [
      "Sell contracts back into a market.",
      "",
      "Status: command is registered, but sell execution is not implemented yet.",
    ],
  },
  {
    id: "market refresh",
    aliases: ["refresh"],
    title: "/market refresh",
    lines: [
      "Refresh the market thread summary from the latest API state.",
      "",
      "Options:",
      "- `market` - Market to refresh. Defaults to this thread when used inside a market thread.",
      "",
      "Example:",
      "- `/market refresh`",
    ],
  },
  {
    id: "market resolve",
    aliases: ["resolve"],
    title: "/market resolve",
    lines: [
      "Settle a market with the winning outcome.",
      "",
      "Options:",
      "- `market` - Market to resolve.",
      "- `outcome` - Winning outcome: YES or NO.",
      "- `proof` - Optional proof image.",
      "- `note` - Settlement note or admin reason.",
      "",
      "Example:",
      '- `/market resolve outcome:YES note:"Result confirmed in chat."`',
    ],
  },
  {
    id: "market cancel",
    aliases: ["cancel"],
    title: "/market cancel",
    lines: [
      "Cancel a market that should not settle.",
      "",
      "Options:",
      "- `market` - Market to cancel.",
      "- `reason` - Why the market is being cancelled.",
      "",
      "Example:",
      '- `/market cancel reason:"Settlement rules were unclear."`',
    ],
  },
  {
    id: "market recurring",
    aliases: ["recurring"],
    title: "/market recurring",
    lines: [
      "Schedule repeat markets from a draft market.",
      "",
      "Commands:",
      "- `/market recurring schedule` - Pick repeat days for a draft market",
      "- `/market recurring end` - Stop future markets in a recurring series",
      "- `/market recurring manage` - Reserved for a later management view",
      "",
      "Use it when the same question should reopen on a schedule.",
      "",
      "Examples:",
      ...EXAMPLE_RECURRING_MARKETS.map(formatExampleMarket),
    ],
  },
  {
    id: "market recurring schedule",
    aliases: ["schedule recurring", "recurring schedule"],
    title: "/market recurring schedule",
    lines: [
      "Schedule a draft market to repeat on selected days.",
      "",
      "Options:",
      "- `market` - Draft market to use as the recurring template.",
      "",
      "After running the command, choose the days with the buttons. The bot opens future markets from the same title and settlement rules.",
      "",
      "Example:",
      `- Create a draft titled "${RECURRING_EXAMPLE_MARKET.title}", then run \`/market recurring schedule\` and choose weekdays.`,
    ],
  },
  {
    id: "market recurring end",
    aliases: ["end recurring", "recurring end"],
    title: "/market recurring end",
    lines: [
      "Stop future markets in a recurring series.",
      "",
      "Options:",
      "- `market` - Any market in the recurring series.",
      "- `reason` - Why future markets should stop.",
      "",
      "Already-created markets are not rewritten by this command.",
    ],
  },
  {
    id: "position",
    title: "/position",
    lines: [
      "Use position commands to see contracts you currently hold.",
      "",
      "Commands:",
      "- `/position list` - See your open positions",
    ],
  },
  {
    id: "position list",
    aliases: ["positions"],
    title: "/position list",
    lines: ["Show your open market positions.", "", "Example:", "- `/position list`"],
  },
  {
    id: "leaderboard",
    title: "/leaderboard",
    lines: [
      "Show the global REP leaderboard.",
      "",
      "Options:",
      "- `limit` - Number of entries to show, from 1 to 25",
      "- `private` - Reply only to you",
      "",
      "Example:",
      "- `/leaderboard limit:10 private:true`",
    ],
  },
  {
    id: "glossary",
    title: "/glossary",
    lines: [
      "Explain key market terms.",
      "",
      "Options:",
      "- `term` - Term to explain. Leave blank for the overview.",
      "",
      "Examples:",
      "- `/glossary`",
      "- `/glossary term:rep`",
    ],
  },
  {
    id: "admin",
    adminOnly: true,
    title: "/admin",
    lines: [
      "Use admin commands to adjust REP balances and manage markets.",
      "",
      "Commands:",
      "- `/admin credit` - Credit REP to a registered user",
      "- `/admin debit` - Debit REP from a registered user",
      "- `/admin market close` - Close a market",
    ],
  },
  {
    id: "admin credit",
    adminOnly: true,
    title: "/admin credit",
    lines: [
      "Credit REP to a registered user.",
      "",
      "Options:",
      "- `user` - Registered Discord user",
      "- `amount` - REP amount, up to 2 decimals",
      "- `reason` - Audit reason",
    ],
  },
  {
    id: "admin debit",
    adminOnly: true,
    title: "/admin debit",
    lines: [
      "Debit REP from a registered user.",
      "",
      "Options:",
      "- `user` - Registered Discord user",
      "- `amount` - REP amount, up to 2 decimals",
      "- `reason` - Audit reason",
    ],
  },
  {
    id: "admin market close",
    adminOnly: true,
    title: "/admin market close",
    lines: ["Close a market without resolving it.", "", "Options:", "- `market` - Market to close"],
  },
] as const;

const DEFAULT_HELP_TOPIC = HELP_TOPICS[0]!;

export const GLOSSARY_TERMS: readonly GlossaryTerm[] = [
  {
    id: "rep",
    title: "REP",
    summary: "Unit used for balances, trades, payouts, credits, and debits.",
    detail: [
      `REP is the unit used for balances, trades, payouts, credits, and debits in ${APP_CONFIG.name}.`,
      "",
      "You spend REP to buy contracts. Your balance changes when trades execute, markets settle, or an admin adjusts your account.",
      "",
      "Related commands: `/account me`, `/leaderboard`, `/market buy`",
    ],
  },
  {
    id: "market",
    title: "Market",
    summary: "A YES/NO question that participants can trade on.",
    detail: [
      "A market is a YES/NO question that participants can trade on.",
      "",
      "Markets start as drafts, then open for trading. After trading closes, the market can be resolved with a final winning outcome or cancelled if it should not settle.",
    ],
  },
  {
    id: "yes",
    title: "YES",
    summary: "Outcome for markets that resolve true.",
    detail: [
      "YES is one possible market outcome.",
      "",
      "Buy YES contracts when you think the market will resolve YES.",
    ],
  },
  {
    id: "no",
    title: "NO",
    summary: "Outcome for markets that resolve false.",
    detail: [
      "NO is one possible market outcome.",
      "",
      "Buy NO contracts when you think the market will resolve NO.",
    ],
  },
  {
    id: "contract",
    aliases: ["share", "shares", "contracts"],
    title: "Contract",
    summary: "A tradeable unit of one outcome in a market.",
    detail: [
      "A contract is a tradeable unit of one outcome in a market.",
      "",
      "If you buy YES, you hold YES contracts. If you buy NO, you hold NO contracts.",
    ],
  },
  {
    id: "position",
    aliases: ["positions"],
    title: "Position",
    summary: "Contracts you currently hold in a market.",
    detail: [
      "A position is the contracts you currently hold in a market.",
      "",
      "If you bought YES, your YES position grows. If you bought NO, your NO position grows.",
      "",
      "Related command: `/position list`",
    ],
  },
  {
    id: "draft",
    title: "Draft",
    summary: "A market created but not open for trading yet.",
    detail: [
      "A draft market has been created but is not open for trading yet.",
      "",
      "Open a draft with `/market open`.",
    ],
  },
  {
    id: "open",
    title: "Open",
    summary: "A market currently accepting trades.",
    detail: ["An open market is accepting trades.", "", "Trading stays open until the close time."],
  },
  {
    id: "closed",
    title: "Closed",
    summary: "A market no longer accepting trades.",
    detail: [
      "A closed market no longer accepts trades.",
      "",
      "Closed markets can still be resolved with a final outcome.",
    ],
  },
  {
    id: "resolved",
    aliases: ["settled", "settlement"],
    title: "Resolved",
    summary: "A market with a final winning outcome.",
    detail: [
      "A resolved market has a final winning outcome.",
      "",
      "Resolution determines payouts for YES or NO contracts.",
    ],
  },
  {
    id: "cancelled",
    aliases: ["canceled", "void"],
    title: "Cancelled",
    summary: "A market that should not settle.",
    detail: [
      "A cancelled market should not settle to YES or NO.",
      "",
      "Cancellation is used when a market cannot be judged reliably or should be voided.",
    ],
  },
  {
    id: "spend rep",
    aliases: ["spend_rep"],
    title: "Spend REP",
    summary: "Trade mode where you choose the REP budget.",
    detail: [
      "Spend REP is a trade mode where you choose how much REP to spend.",
      "",
      "The number of contracts depends on current market price.",
    ],
  },
  {
    id: "target shares",
    aliases: ["target_shares"],
    title: "Target shares",
    summary: "Trade mode where you choose the number of contracts.",
    detail: [
      "Target shares is a trade mode where you choose the exact number of contracts to buy.",
      "",
      "The REP cost depends on current market price.",
    ],
  },
  {
    id: "recurring market",
    aliases: ["recurring", "series"],
    title: "Recurring market",
    summary: "A market series that repeats on selected days.",
    detail: [
      "A recurring market repeats on selected days.",
      "",
      "Use recurring markets for repeatable questions with the same settlement rules.",
      "",
      'Example: "Will Grayson go to the gym today?" can repeat every weekday.',
      "",
      "Related command: `/market recurring schedule`",
    ],
  },
  {
    id: "proof",
    aliases: ["creator proof"],
    title: "Proof",
    summary: "Evidence or notes used when resolving a market.",
    detail: [
      "Proof is evidence or notes used when resolving a market.",
      "",
      "A proof image or note helps participants understand why the market resolved YES or NO.",
    ],
  },
  {
    id: "leaderboard",
    title: "Leaderboard",
    summary: "Global REP ranking.",
    detail: [
      "The leaderboard ranks users by available REP balance.",
      "",
      "Related command: `/leaderboard`",
    ],
  },
] as const;

export function buildHelpEmbed(topicId: string | null, canViewAdmin: boolean): EmbedBuilder {
  const topic = findHelpTopic(topicId, canViewAdmin) ?? DEFAULT_HELP_TOPIC;

  return new EmbedBuilder()
    .setTitle(topic.title)
    .setDescription(topic.lines.join("\n"))
    .setColor(0x2f80ed);
}

export function buildGlossaryEmbed(termId: string | null): EmbedBuilder {
  const term = findGlossaryTerm(termId);

  if (term) {
    return new EmbedBuilder()
      .setTitle(term.title)
      .setDescription(term.detail.join("\n"))
      .setColor(0x2f80ed);
  }

  return new EmbedBuilder()
    .setTitle("Glossary")
    .setDescription(
      [
        ...GLOSSARY_TERMS.map((item) => `- **${item.title}** - ${item.summary}`),
        "",
        "Use `/glossary term:<term>` for details.",
      ].join("\n"),
    )
    .setColor(0x2f80ed);
}

export function helpTopicChoices(query: string, canViewAdmin: boolean) {
  return choicesFor(query, visibleHelpTopics(canViewAdmin));
}

export function glossaryTermChoices(query: string) {
  return choicesFor(query, GLOSSARY_TERMS);
}

export function findHelpTopic(value: string | null, canViewAdmin: boolean): HelpTopic | undefined {
  const normalized = normalizeLookupValue(value);

  if (!normalized) {
    return HELP_TOPICS[0];
  }

  return visibleHelpTopics(canViewAdmin).find((topic) => matchesLookup(topic, normalized));
}

export function findGlossaryTerm(value: string | null): GlossaryTerm | undefined {
  const normalized = normalizeLookupValue(value);

  if (!normalized) {
    return undefined;
  }

  return GLOSSARY_TERMS.find((term) => matchesLookup(term, normalized));
}

function visibleHelpTopics(canViewAdmin: boolean) {
  return HELP_TOPICS.filter((topic) => canViewAdmin || !topic.adminOnly);
}

function choicesFor(query: string, items: readonly { aliases?: readonly string[]; id: string }[]) {
  const normalized = normalizeLookupValue(query) ?? "";
  const matches = items.filter((item) => matchesLookup(item, normalized));

  return matches.slice(0, 25).map((item) => ({
    name: item.id,
    value: item.id,
  }));
}

function matchesLookup(item: { aliases?: readonly string[]; id: string }, value: string) {
  if (!value) {
    return true;
  }

  const values = [item.id, ...(item.aliases ?? [])].map(normalizeLookupValue);

  return values.some((candidate) => candidate?.includes(value));
}

function normalizeLookupValue(value: string | null) {
  const normalized = value?.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");

  return normalized || null;
}

function formatExampleMarket(market: ExampleMarket) {
  return `- ${market.title} - ${market.description}`;
}
