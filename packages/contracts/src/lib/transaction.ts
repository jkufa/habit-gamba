import type { DbTransaction, MarketDbInput } from "./types";

export async function withTransaction<T>(
  input: MarketDbInput,
  operation: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  if (input.tx) {
    return operation(input.tx);
  }

  return input.db.transaction(operation);
}
