# Domain Package Architecture

Domain packages own business rules. Bot and API adapters should call domain packages instead of duplicating logic.

## `packages/users`

Maps Discord users to app users.

Owns:

- Discord user ID to internal user ID mapping.
- First-time user creation.
- Display names.
- User lookup.
- Leaderboard identity.

## `packages/contracts`

Owns contract creation and lifecycle.

A contract represents the question users are betting on.

Owns:

- Creating contracts.
- Validating contract details.
- Contract status transitions.
- Close times.
- Resolution deadlines.
- Resolver authorization.

Useful statuses:

```text
OPEN
CLOSED
RESOLVED
CANCELLED
```

Important timestamps:

```text
closes_at
resolution_due_at
resolved_at
```

## `packages/exchange`

Owns market pricing and share purchases.

For the POC, use **LMSR only**. No order book and no selling initially.

Owns:

- Current YES/NO prices.
- LMSR quote calculation.
- Buying YES/NO shares.
- Average fill price.
- Market state updates.
- Trade records.
- Position updates.

Example flow:

```text
User buys 10 rep of YES
  ↓
Exchange checks contract is open
  ↓
Exchange calculates LMSR quote
  ↓
Wallet debits user
  ↓
Exchange records trade
  ↓
Exchange updates user position
  ↓
Exchange updates market state
```

This whole flow should happen inside one database transaction.

## `packages/wallet`

Owns rep accounting.

Rep is the only POC currency. Users can buy with rep; negative rep may be allowed up to a limit for fun.

Owns:

- Current balances.
- Ledger entries.
- Debits.
- Credits.
- Refunds.
- Penalties.
- Negative balance limits.

Core rule:

```text
Every balance change must have a ledger entry.
```

Example ledger entries:

```text
+100 starting grant
-10 bought YES shares
+15.72 payout
+10 refund
-5 failed-resolution penalty
```

## `packages/resolution`

Owns resolving or cancelling contracts.

For the POC, the contract creator resolves. If they miss the deadline, the contract is cancelled, users are refunded, and the creator is penalized.

Owns:

- Resolving YES/NO.
- Cancelling unresolved contracts.
- Refunding users.
- Applying creator penalties.
- Orchestrating payouts.
- Closing positions.

Example resolution flow:

```text
Creator resolves contract YES
  ↓
Resolution service loads all positions
  ↓
Winning YES shares pay out 1 rep per share
  ↓
Wallet credits winners
  ↓
Positions are closed
  ↓
Contract is marked RESOLVED
  ↓
Notification is sent
```

## `packages/notification`

Owns user-facing messages, not developer logging.

Owns:

- Contract-created messages.
- Trade confirmation messages.
- Market closing reminders.
- Resolution reminders.
- Resolution result messages.
- Payout/loss summaries.

For the POC, notifications can be Discord messages. Keeping this separate avoids leaking Discord-specific code into resolution/exchange logic.
