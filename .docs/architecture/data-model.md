# Data Model And Invariants

This doc contains core persisted concepts and consistency rules.

## Balances

Cached current rep state for a user.

```text
user_id
balance
```

Optional later:

```text
available_balance
total_balance
```

## Ledger Entries

History of all rep movements.

Ledger entries answer:

```text
Why is this user's balance what it is?
```

Examples:

```text
BUY
PAYOUT
REFUND
GRANT
PENALTY
```

For the POC, a single-sided ledger is acceptable. The system can mint/burn fake rep.

## Trades

History of executed market actions.

Trades answer:

```text
What did this user buy?
```

Example:

```text
user_id
contract_id
side: YES | NO
amount_spent
shares_received
avg_price
created_at
```

## Positions

Current user holdings per contract.

Positions answer:

```text
What does this user currently own?
```

Example:

```text
user_id
contract_id
yes_shares
no_shares
```

## Contracts

The market/question being bet on.

Example:

```text
id
creator_user_id
title
description
status
outcome
closes_at
resolution_due_at
resolved_at
created_at
```

## Important Invariants

Check these frequently in tests and QA scenarios.

```text
Every balance change has a ledger entry.
Cached balances equal ledger-derived balances.
Every trade references a valid user and contract.
Every position references a valid user and contract.
No user balance goes below the allowed negative limit.
OPEN contracts do not have outcomes.
RESOLVED contracts have exactly one outcome.
CANCELLED contracts refund buyers.
Resolved/cancelled contracts have no active positions.
YES price and NO price stay between 0 and 1.
YES price + NO price is approximately 1.
```
