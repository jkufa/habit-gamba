import type { WalletDbInput, WalletExecutor } from "./types";

export async function withTransaction<T>(
  input: WalletDbInput,
  operation: (tx: WalletExecutor) => Promise<T>,
): Promise<T> {
  if (input.tx) {
    return operation(input.tx);
  }

  return input.db.transaction(operation);
}
