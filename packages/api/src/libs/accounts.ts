import type { schema } from "@habit-gamba/db";
import type { EnsureSeedRepGrantResult, User } from "@habit-gamba/users";
import type { RepBalance, WalletWriteResult } from "@habit-gamba/wallet";

export type RegisterAccountResponse = {
  balance: EnsureSeedRepGrantResult["balance"];
  grant: EnsureSeedRepGrantResult;
  user: User;
};

export type AccountResponse = {
  balance: RepBalance;
  positions: PortfolioPositionView[];
  user: User;
};

export type AccountAdjustmentResponse = {
  balance: RepBalance;
  idempotent: boolean;
  ledgerEntry: WalletWriteResult["ledgerEntry"];
  user: User;
};

export type PortfolioPositionView = {
  contract: typeof schema.contracts.$inferSelect;
  market: typeof schema.markets.$inferSelect;
  position: typeof schema.positions.$inferSelect;
};
