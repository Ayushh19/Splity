/**
 * Database schema — mirrors docs/DATA_MODEL.md. Money columns are integer minor units.
 * Rules that span several rows (payers/splits summing to the total, members
 * belonging to the expense's group) live in a deferred constraint trigger in
 * the hand-written migration `drizzle/*_expense_integrity.sql`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const currency = (name: string) => char(name, { length: 3 });
const minor = (name: string) => bigint(name, { mode: 'number' });

export const memberRole = pgEnum('member_role', ['admin', 'member']);
export const memberStatus = pgEnum('member_status', ['active', 'removed', 'merged']);
export const splitMethod = pgEnum('split_method', ['equal', 'exact', 'shares']);
export const settlementMethod = pgEnum('settlement_method', ['upi', 'cash', 'other']);
export const recurringFrequency = pgEnum('recurring_frequency', ['weekly', 'monthly']);
export const recurringStatus = pgEnum('recurring_status', ['active', 'paused', 'stopped']);
export const pausedReason = pgEnum('paused_reason', ['manual', 'removed_participant', 'removed_payer']);
export const revisionEntity = pgEnum('revision_entity', ['expense', 'settlement']);
export const revisionAction = pgEnum('revision_action', [
  'create',
  'update',
  'delete',
  'restore',
  'dispute',
  'merge_repoint',
]);

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Never NULL (the auth library requires it); replaced with a tombstone address on account deletion.
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    displayName: text('display_name').notNull(),
    photoUrl: text('photo_url'),
    upiId: text('upi_id'),
    defaultCurrency: currency('default_currency').notNull().default('INR'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [check('users_default_currency_format', sql`${t.defaultCurrency} ~ '^[A-Z]{3}$'`)],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
);

// Better Auth tables (sessions, linked Google accounts, magic-link tokens).
// Shapes follow Better Auth 1.7 with `usePlural` and UUID ids; see src/auth.ts.

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Provider's account id (Google `sub`) and provider name ('google').
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('accounts_user_idx').on(t.userId),
    unique('accounts_provider_account').on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

// ─── Groups & membership ────────────────────────────────────────────────────

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    currency: currency('currency').notNull(),
    simplifyDebts: boolean('simplify_debts').notNull().default(true),
    isDirect: boolean('is_direct').notNull().default(false),
    // "<smaller user id>:<larger user id>" — one direct group per pair.
    directKey: text('direct_key').unique(),
    inviteToken: text('invite_token').unique(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references((): AnyPgColumn => groupMembers.id),
  },
  (t) => [
    check('groups_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('groups_direct_key', sql`${t.isDirect} = (${t.directKey} IS NOT NULL)`),
    check('groups_direct_no_invite', sql`NOT ${t.isDirect} OR ${t.inviteToken} IS NULL`),
    check('groups_direct_not_archived', sql`NOT ${t.isDirect} OR ${t.archivedAt} IS NULL`),
  ],
);

export const groupMembers = pgTable(
  'group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    // NULL = placeholder member.
    userId: uuid('user_id').references(() => users.id),
    displayName: text('display_name').notNull(),
    role: memberRole('role').notNull().default('member'),
    status: memberStatus('status').notNull().default('active'),
    mergedInto: uuid('merged_into').references((): AnyPgColumn => groupMembers.id),
    // Monotonic creation order: the fixed order for rounding and tie-breaks.
    sortKey: bigint('sort_key', { mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    // When a real user joined or claimed this row — used for "longest-standing" admin promotion.
    userSince: timestamp('user_since', { withTimezone: true }),
    // Set when a user claimed this row as a placeholder (vs. joining as a new member); undo-claim needs it.
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    muted: boolean('muted').notNull().default(false),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    // Target for composite FKs that guarantee a member belongs to the same group.
    unique('group_members_group_id_id').on(t.groupId, t.id),
    uniqueIndex('group_members_one_per_user')
      .on(t.groupId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    index('group_members_user_idx').on(t.userId),
    check('group_members_admin_is_user', sql`${t.role} <> 'admin' OR ${t.userId} IS NOT NULL`),
    check('group_members_user_since', sql`(${t.userId} IS NULL) = (${t.userSince} IS NULL)`),
    check('group_members_claimed_at', sql`${t.claimedAt} IS NULL OR ${t.userId} IS NOT NULL`),
    check('group_members_merged', sql`(${t.status} = 'merged') = (${t.mergedInto} IS NOT NULL)`),
    check('group_members_removed_at', sql`(${t.status} = 'removed') = (${t.removedAt} IS NOT NULL)`),
  ],
);

/** Composite FK: `memberId` must be a member of the row's own group. Not checked while `memberId` is NULL. */
const memberOfGroup = (name: string, groupId: AnyPgColumn, memberId: AnyPgColumn) =>
  foreignKey({ name, columns: [groupId, memberId], foreignColumns: [groupMembers.groupId, groupMembers.id] });

// ─── Money ──────────────────────────────────────────────────────────────────

export const recurringSeries = pgTable(
  'recurring_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    frequency: recurringFrequency('frequency').notNull(),
    // Weekly: ISO weekday 1 (Mon)–7 (Sun). Monthly: day 1–31, clamped to the month's last day.
    anchorDay: smallint('anchor_day').notNull(),
    nextDue: date('next_due', { mode: 'string' }).notNull(),
    status: recurringStatus('status').notNull().default('active'),
    pausedReason: pausedReason('paused_reason'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    memberOfGroup('recurring_series_created_by_member', t.groupId, t.createdBy),
    check(
      'recurring_series_anchor_day',
      sql`(${t.frequency} = 'weekly' AND ${t.anchorDay} BETWEEN 1 AND 7)
       OR (${t.frequency} = 'monthly' AND ${t.anchorDay} BETWEEN 1 AND 31)`,
    ),
    check('recurring_series_paused_reason', sql`(${t.status} = 'paused') = (${t.pausedReason} IS NOT NULL)`),
    index('recurring_series_due_idx')
      .on(t.nextDue)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    description: text('description').notNull(),
    category: text('category').notNull().default('general'),
    notes: text('notes'),
    expenseDate: date('expense_date', { mode: 'string' }).notNull(),
    // Total in the group currency.
    amountMinor: minor('amount_minor').notNull(),
    splitMethod: splitMethod('split_method').notNull(),
    // Foreign-currency entry: all three set, or none.
    originalCurrency: currency('original_currency'),
    originalAmountMinor: minor('original_amount_minor'),
    fxRate: numeric('fx_rate', { precision: 20, scale: 10 }),
    receiptKey: text('receipt_key'),
    recurringSeriesId: uuid('recurring_series_id').references(() => recurringSeries.id),
    occurrenceDate: date('occurrence_date', { mode: 'string' }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    // created_by is NULL only for occurrences auto-created by the recurring job.
    memberOfGroup('expenses_created_by_member', t.groupId, t.createdBy),
    memberOfGroup('expenses_deleted_by_member', t.groupId, t.deletedBy),
    unique('expenses_one_per_occurrence').on(t.recurringSeriesId, t.occurrenceDate),
    index('expenses_group_date_idx').on(t.groupId, t.expenseDate),
    check('expenses_amount_positive', sql`${t.amountMinor} > 0`),
    check(
      'expenses_fx_all_or_none',
      sql`(${t.originalCurrency} IS NULL) = (${t.originalAmountMinor} IS NULL)
      AND (${t.originalCurrency} IS NULL) = (${t.fxRate} IS NULL)`,
    ),
    check('expenses_fx_rate_positive', sql`${t.fxRate} IS NULL OR ${t.fxRate} > 0`),
    check('expenses_original_amount_positive', sql`${t.originalAmountMinor} IS NULL OR ${t.originalAmountMinor} > 0`),
    check('expenses_occurrence', sql`(${t.recurringSeriesId} IS NULL) = (${t.occurrenceDate} IS NULL)`),
    check('expenses_created_by', sql`${t.createdBy} IS NOT NULL OR ${t.recurringSeriesId} IS NOT NULL`),
    check('expenses_deleted', sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`),
    check('expenses_version_positive', sql`${t.version} >= 1`),
  ],
);

export const expensePayers = pgTable(
  'expense_payers',
  {
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => groupMembers.id),
    paidMinor: minor('paid_minor').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.memberId] }),
    index('expense_payers_member_idx').on(t.memberId),
    check('expense_payers_positive', sql`${t.paidMinor} > 0`),
  ],
);

export const expenseSplits = pgTable(
  'expense_splits',
  {
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => groupMembers.id),
    // Inputs, kept so the form can be re-opened as entered.
    shares: integer('shares'),
    exactMinor: minor('exact_minor'),
    // Computed result (packages/shared computeSplit). Balances use only this.
    owedMinor: minor('owed_minor').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.memberId] }),
    index('expense_splits_member_idx').on(t.memberId),
    check('expense_splits_owed_non_negative', sql`${t.owedMinor} >= 0`),
    check('expense_splits_shares_positive', sql`${t.shares} IS NULL OR ${t.shares} >= 1`),
    check('expense_splits_exact_non_negative', sql`${t.exactMinor} IS NULL OR ${t.exactMinor} >= 0`),
  ],
);

export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    fromMember: uuid('from_member').notNull(),
    toMember: uuid('to_member').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    settledOn: date('settled_on', { mode: 'string' }).notNull(),
    method: settlementMethod('method').notNull().default('other'),
    recordedBy: uuid('recorded_by').notNull(),
    disputedAt: timestamp('disputed_at', { withTimezone: true }),
    disputedBy: uuid('disputed_by'),
    disputeNote: text('dispute_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    memberOfGroup('settlements_from_member', t.groupId, t.fromMember),
    memberOfGroup('settlements_to_member', t.groupId, t.toMember),
    memberOfGroup('settlements_recorded_by_member', t.groupId, t.recordedBy),
    memberOfGroup('settlements_disputed_by_member', t.groupId, t.disputedBy),
    memberOfGroup('settlements_deleted_by_member', t.groupId, t.deletedBy),
    index('settlements_group_idx').on(t.groupId),
    check('settlements_distinct_members', sql`${t.fromMember} <> ${t.toMember}`),
    check('settlements_amount_positive', sql`${t.amountMinor} > 0`),
    check('settlements_recorded_by_party', sql`${t.recordedBy} IN (${t.fromMember}, ${t.toMember})`),
    check(
      'settlements_disputed',
      sql`(${t.disputedAt} IS NULL) = (${t.disputedBy} IS NULL)
      AND (${t.disputedBy} IS NULL OR (${t.disputedBy} IN (${t.fromMember}, ${t.toMember}) AND ${t.disputedBy} <> ${t.recordedBy}))`,
    ),
    check('settlements_deleted', sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`),
    check('settlements_version_positive', sql`${t.version} >= 1`),
  ],
);

// ─── History, activity, reminders ───────────────────────────────────────────

export const revisions = pgTable(
  'revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: revisionEntity('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    version: integer('version').notNull(),
    action: revisionAction('action').notNull(),
    // NULL = system (recurring auto-create).
    actorMember: uuid('actor_member').references(() => groupMembers.id),
    // Full state after the change, including payers and splits.
    snapshot: jsonb('snapshot').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('revisions_entity_version').on(t.entityType, t.entityId, t.version)],
);

export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    actorMember: uuid('actor_member').references(() => groupMembers.id),
    type: text('type').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    revisionId: uuid('revision_id').references(() => revisions.id),
    payload: jsonb('payload').notNull().default({}),
    // Insertion order. Timestamps can tie (same microsecond), so the feed sorts by this.
    seq: bigint('seq', { mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    // clock_timestamp(), not now(): events in one transaction get distinct, real times.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [index('activity_events_group_seq_idx').on(t.groupId, t.seq.desc())],
);

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    fromMember: uuid('from_member').notNull(),
    toMember: uuid('to_member').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    memberOfGroup('reminders_from_member', t.groupId, t.fromMember),
    memberOfGroup('reminders_to_member', t.groupId, t.toMember),
    index('reminders_pair_time_idx').on(t.groupId, t.fromMember, t.toMember, t.sentAt),
    check('reminders_distinct_members', sql`${t.fromMember} <> ${t.toMember}`),
  ],
);
