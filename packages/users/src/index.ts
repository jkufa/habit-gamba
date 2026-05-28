export { UserConflictError, UserGrantConflictError, UserNotFoundError } from "./lib/errors";
export {
  ensureCommunityMembership,
  getCommunityByProvider,
  getCommunityMembership,
  upsertCommunity,
} from "./lib/communities";
export { createUser, deactivateUser, updateUserProfile, upsertUser } from "./lib/lifecycle";
export { ensureSeedRepGrant } from "./lib/grants";
export { getUserById, getUserByProviderIdentity, listUsers } from "./lib/reads";
export { grantUserRole, hasUserPermission, listUserRoles, roleHasPermission } from "./lib/roles";
export type {
  Community,
  CommunityMembership,
  CreateUserInput,
  EnsureCommunityMembershipInput,
  EnsureSeedRepGrantInput,
  GetCommunityByProviderInput,
  GrantUserRoleInput,
  HasUserPermissionInput,
  ListUserRolesInput,
  EnsureSeedRepGrantResult,
  ListUsersInput,
  ListUsersResult,
  UpdateUserProfileInput,
  UpsertCommunityInput,
  UpsertUserInput,
  User,
  UserDbInput,
  UserListCursor,
  UserPermission,
  UserRole,
  UserRoleName,
  UserStatus,
} from "./lib/types";
