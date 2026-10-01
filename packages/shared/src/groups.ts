import * as z from 'zod';
import type { Minor } from './money';
import { currencyCode, displayName } from './schemas';

export const MAX_GROUP_MEMBERS = 50;

export const groupName = z.string().trim().min(1, 'Name the group').max(60, 'Keep it under 60 characters');

export const createGroup = z
  .object({
    name: groupName,
    currency: currencyCode,
    placeholders: z
      .array(displayName)
      .max(MAX_GROUP_MEMBERS - 1, `A group can have at most ${MAX_GROUP_MEMBERS} members`)
      .default([]),
  })
  .strict();
export type CreateGroup = z.input<typeof createGroup>;

export const updateGroup = z
  .object({
    name: groupName,
    simplifyDebts: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateGroup = z.infer<typeof updateGroup>;

export const addPlaceholder = z.object({ displayName }).strict();
export type AddPlaceholder = z.infer<typeof addPlaceholder>;

export const mergeMember = z.object({ intoMemberId: z.uuid() }).strict();
export type MergeMember = z.infer<typeof mergeMember>;

export const joinInvite = z
  .object({
    /** Claim this placeholder; omit to join as a new member. */
    claimMemberId: z.uuid().optional(),
  })
  .strict();
export type JoinInvite = z.infer<typeof joinInvite>;

export type MemberRole = 'admin' | 'member';
export type MemberStatus = 'active' | 'removed' | 'merged';

export interface MemberView {
  id: string;
  displayName: string;
  photoUrl: string | null;
  role: MemberRole;
  status: MemberStatus;
  /** No account linked yet. */
  isPlaceholder: boolean;
  /** For the "Pay via UPI" button; null for placeholders and people who haven't set one. */
  upiId: string | null;
  /** A user claimed this placeholder (an admin can undo it). */
  claimed: boolean;
  isYou: boolean;
  /** Net balance in the group currency: positive = owed money, negative = owes. */
  netMinor: Minor;
  /** Appears in at least one expense or settlement (affects whether it can be deleted). */
  hasHistory: boolean;
  sortKey: number;
}

export interface GroupSummary {
  id: string;
  /** For 1-on-1 groups: the other person's name. */
  name: string;
  currency: string;
  archived: boolean;
  /** Hidden 1-on-1 group: counted in totals, not listed with groups. */
  isDirect: boolean;
  /** Your net balance in this group. */
  yourNetMinor: Minor;
  memberCount: number;
  /** Your membership was removed but you still have a balance here. */
  youAreRemoved: boolean;
}

export interface GroupDetail {
  id: string;
  /** For 1-on-1 groups: the other person's name. */
  name: string;
  isDirect: boolean;
  currency: string;
  simplifyDebts: boolean;
  archived: boolean;
  /** Full invite URL, or null for direct (1-on-1) groups. */
  inviteUrl: string | null;
  you: { memberId: string; role: MemberRole; status: MemberStatus; muted: boolean };
  members: MemberView[];
}

export interface InvitePreview {
  groupId: string;
  groupName: string;
  memberCount: number;
  /** Placeholders that can still be claimed. */
  unclaimed: { id: string; displayName: string }[];
  /** Set when the viewer is signed in and already a member. */
  alreadyMember: boolean;
}

export type ApiErrorCode =
  | 'unauthenticated'
  | 'invalid'
  | 'not_found'
  | 'forbidden'
  | 'archived'
  | 'group_full'
  | 'duplicate_name'
  | 'already_member'
  | 'already_claimed'
  | 'nonzero_balance'
  | 'last_member'
  | 'conflict'
  | 'rate_limited';

export interface ApiErrorBody {
  error: ApiErrorCode;
  message?: string;
}
