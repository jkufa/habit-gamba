import type { User } from "@habit-gamba/users";

export type LeaderboardResponse = {
  entries: LeaderboardEntryDto[];
};

export type LeaderboardEntryDto = {
  balance: {
    availableAmountMicro: bigint;
    creditLimitMicro: bigint;
    currency: string;
    lockedAmountMicro: bigint;
    userId: string;
  };
  rank: number;
  user: User;
};
