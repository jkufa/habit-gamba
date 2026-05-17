import { PermissionFlagsBits } from "discord.js";

export type Actor = {
  discordUserId: string;
  isGuildAdmin: boolean;
  userId: string;
};

export type OwnershipTarget = {
  creatorUserId: string;
};

export function canManageMarket(actor: Actor, market: OwnershipTarget): boolean {
  return actor.isGuildAdmin || actor.userId === market.creatorUserId;
}

export function isGuildAdminPermission(value: bigint | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  return (
    (value & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator ||
    (value & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild
  );
}
