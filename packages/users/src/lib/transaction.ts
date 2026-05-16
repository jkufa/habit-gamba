import type { DbTransaction, UserDbInput } from "./types";

export async function withTransaction<T>(
  input: UserDbInput,
  operation: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  if (input.tx) {
    return operation(input.tx);
  }

  return input.db.transaction(operation);
}
