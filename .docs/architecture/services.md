# Domain Package Architecture

Domain packages own business rules; apps should validate/adapt requests and call packages rather than duplicate logic.

`users` owns provider identity and profile behavior. `contracts` owns YES/NO instruments under markets. `exchange` owns LMSR-only quotes, trades, positions, and market state changes.

`wallet` owns REP ledger and balance projection mutations. `resolution` owns manual/oracle-ready market resolution, refunds, and payouts. `notification` owns user-facing messages without leaking provider-specific delivery into domain logic.
