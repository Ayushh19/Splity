import type { Minor } from './money';

/** Someone with an account you share at least one group with. */
export interface FriendSummary {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  /** Your net with them across shared groups, per currency (never converted): + they owe you. */
  balances: { currency: string; netMinor: Minor }[];
}

export interface FriendGroupBalance {
  groupId: string;
  /** Group name, or "1-on-1" for your direct group. */
  name: string;
  isDirect: boolean;
  currency: string;
  /** + they owe you, − you owe them, in the group's current view (simplified or not). */
  netMinor: Minor;
  /** Their member id and yours in this group (for Settle / Remind links). */
  theirMemberId: string;
  yourMemberId: string;
  /** Whether you can still change things there (not archived, you're active). */
  writable: boolean;
}

export interface FriendDetail extends FriendSummary {
  upiId: string | null;
  groups: FriendGroupBalance[];
  /** Your 1-on-1 group with them, if it exists yet. */
  directGroupId: string | null;
}
