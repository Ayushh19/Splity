# Splity — Data Model (v1 draft)

PostgreSQL (PGlite locally). Implemented in `apps/api/src/db/schema.ts`; cross-row rules in
`apps/api/drizzle/0001_expense_integrity.sql`.

Conventions:
- IDs are UUIDs. Timestamps are `timestamptz` (UTC). Calendar dates are `date`.
- Money is `bigint` in **minor units** of the stated currency (paise for INR, satang for THB).
  Minor-unit exponent comes from ISO 4217 (INR 2, THB 2, JPY 0, …).
- "Soft delete" = `deleted_at` set; row stays.

---

## Core principle

**Members, not users, are the unit of money.** Every expense, split, payer and settlement points
at a `group_members` row, never at a `users` row. That is what makes placeholders, claiming,
removal, merging and account deletion work without rewriting financial history:

| Event | What changes |
|---|---|
| Placeholder created | New `group_members` row with `user_id = NULL` |
| Placeholder claimed | That row's `user_id` is set. No money rows touched |
| Member removed | `status = 'removed'`. Money rows untouched |
| Placeholder merged into real member | Money rows re-pointed to the real member in one transaction, placeholder `status = 'merged'` |
| Account deleted | `users` row anonymised. Member rows stay; UI shows "Deleted user" |

**A member always belongs to the row's own group.** Every column pointing at a member from a
table that has `group_id` (settlements, reminders, expense creator, …) is a composite foreign key
`(group_id, member_id) → group_members(group_id, id)`. Payers and splits are checked by the
deferred integrity trigger, which also enforces that they sum to the expense total.

**Balances are never stored.** They are derived from `expense_payers`, `expense_splits` and
`settlements` (excluding soft-deleted rows). See §4.

---

## 1. Users & auth

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | text, unique, not null | Replaced with a tombstone address on account deletion (auth library requires non-null) |
| email_verified | bool | Required by the auth library |
| display_name | text | Replaced with "Deleted user" on deletion |
| photo_url | text, nullable | |
| upi_id | text, nullable | For "Pay via UPI" deep link |
| default_currency | char(3), default 'INR' | Currency for new direct groups |
| created_at | timestamptz | |
| deleted_at | timestamptz, nullable | Account deleted (anonymised) |

Linked Google accounts, sessions and magic-link tokens live in Better Auth's own tables, added
with the auth work.

### `push_subscriptions`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | One user, many devices |
| endpoint | text, unique | Web Push endpoint |
| p256dh, auth | text | Web Push keys |
| created_at | timestamptz | |

---

## 2. Groups & membership

### `groups`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | Ignored/hidden for direct groups |
| currency | char(3) | ISO 4217. Immutable after first expense |
| simplify_debts | bool, default true | View-only toggle |
| is_direct | bool | Hidden 1-on-1 group |
| direct_key | text, unique, nullable | `"<smaller user id>:<larger user id>"` — guarantees **one direct group per pair** |
| invite_token | text, unique, nullable | Random, ≥128 bits. Reset = replace value. NULL for direct groups |
| created_by | uuid FK → users | |
| created_at | timestamptz | |
| archived_at | timestamptz, nullable | Set only when all balances are 0 |
| archived_by | uuid FK → group_members, nullable | |

### `group_members`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | **This is the id money rows reference** |
| group_id | uuid FK → groups | |
| user_id | uuid FK → users, nullable | NULL = placeholder |
| display_name | text | Placeholder name; for real users, UI shows `users.display_name` |
| role | enum `admin` \| `member` | |
| status | enum `active` \| `removed` \| `merged` | |
| merged_into | uuid FK → group_members, nullable | Set when status = merged |
| sort_key | bigint, identity | Monotonic creation order — **the fixed order for rounding** |
| joined_at | timestamptz | When the row was created |
| user_since | timestamptz, nullable | When a real user joined or claimed it — **used for "longest-standing" admin promotion** |
| claimed_at | timestamptz, nullable | Set when a user claimed this row as a placeholder; needed for "undo claim" |
| muted | bool, default false | Per-member group mute |
| removed_at | timestamptz, nullable | |

Constraints:
- `UNIQUE (group_id, user_id) WHERE user_id IS NOT NULL` — a user is in a group at most once
  (this also enforces "already a member can't claim a placeholder").
- `role = 'admin'` requires `user_id IS NOT NULL` (placeholders can't be admins).
- At most 50 rows with `status = 'active'` per group (enforced in the app, in the same transaction).

### Direct (1-on-1) groups (decided, Q4)

- One per pair of **real users**, created from a friend's profile (friend = shares ≥1 group).
- Currency = the creating user's `default_currency`; foreign expenses use the manual FX rate.
- Exactly two members, both `admin`, both real users. No invite link, no placeholders.
- Cannot be left or archived. Account deletion still requires a zero balance here too.

---

## 3. Money

### `expenses`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK → groups | |
| description | text | |
| category | text | From a fixed list defined in code |
| notes | text, nullable | |
| expense_date | date | ≤ today + 1 day |
| amount_minor | bigint, > 0 | **Total in the group currency**. ≤ ₹10,00,00,000 equivalent |
| split_method | enum `equal` \| `exact` \| `shares` | |
| original_currency | char(3), nullable | Set only for foreign-currency entry |
| original_amount_minor | bigint, nullable | In `original_currency` minor units |
| fx_rate | numeric(20,10), nullable | Group-currency units per 1 original unit, as entered |
| receipt_key | text, nullable | Object-storage key, ≤10 MB |
| recurring_series_id | uuid FK → recurring_series, nullable | |
| occurrence_date | date, nullable | With series id: `UNIQUE (recurring_series_id, occurrence_date)` → no duplicate auto-creates |
| created_by | uuid FK → group_members, nullable | NULL only for recurring auto-created occurrences |
| created_at, updated_at | timestamptz | |
| deleted_at | timestamptz, nullable | Soft delete; restorable |
| deleted_by | uuid FK → group_members, nullable | |
| version | int | Optimistic lock — see "Concurrent edits" below |

FX conversion rule: `amount_minor = round_half_up(original_amount × fx_rate)` in the group
currency's minor units. Original values are kept for display; only `amount_minor` affects balances.

### `expense_payers`
| Column | Type | Notes |
|---|---|---|
| expense_id | uuid FK → expenses | PK part |
| member_id | uuid FK → group_members | PK part |
| paid_minor | bigint, > 0 | |

Invariant: `SUM(paid_minor) = expenses.amount_minor`.

### `expense_splits`
| Column | Type | Notes |
|---|---|---|
| expense_id | uuid FK → expenses | PK part |
| member_id | uuid FK → group_members | PK part |
| shares | int, nullable | Input for `shares` method (weight ≥ 1) |
| exact_minor | bigint, nullable | Input for `exact` method |
| owed_minor | bigint, ≥ 0 | **Computed result, stored.** This is what balances use |

Invariant: `SUM(owed_minor) = expenses.amount_minor`.

Why store `owed_minor` instead of recomputing: the rounding result is part of the record people
saw and agreed to. Recomputing later (e.g. after a member is merged and `sort_key` order differs)
must never silently move a paisa.

Split algorithm (all methods): compute each participant's exact share as a fraction, floor it to
minor units, then hand out the leftover units **one each to participants in ascending `sort_key`
order**.

Both invariants are checked in the application inside the write transaction, plus a deferred
constraint trigger in the database as a safety net.

### `settlements`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK → groups | |
| from_member | uuid FK → group_members | Payer |
| to_member | uuid FK → group_members | Receiver; `CHECK (from_member <> to_member)` |
| amount_minor | bigint, > 0 | Group currency only |
| settled_on | date | |
| method | enum `upi` \| `cash` \| `other` | Informational |
| recorded_by | uuid FK → group_members | Either party |
| disputed_at | timestamptz, nullable | |
| disputed_by | uuid FK → group_members, nullable | Must be the *other* party |
| dispute_note | text, nullable | |
| created_at, updated_at | timestamptz | |
| deleted_at, deleted_by | | Soft delete |
| version | int | |

### `recurring_series`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK → groups | |
| frequency | enum `weekly` \| `monthly` | |
| anchor_day | smallint | ISO weekday 1–7 (weekly) or day of month 1–31 (monthly). Day 29–31 → last day of short months |
| next_due | date | Advanced after each auto-create |
| status | enum `active` \| `paused` \| `stopped` | |
| paused_reason | enum `manual` \| `removed_participant` \| `removed_payer`, nullable | |
| created_by | uuid FK → group_members | |
| created_at | timestamptz | |

The "template" is not stored separately: each new occurrence copies description, category,
amount, payers and split inputs from the **most recent non-deleted occurrence** in the series,
skipping removed members.

Recurring edge cases (decided, Q2):
- `equal` / `shares` split with a removed participant → skip them, split over the rest.
- `exact` split with a removed participant → **pause** the series (`status = 'paused'`,
  `paused_reason = 'removed_participant'`) and notify the series creator.
- Removed **payer** → **pause** (`paused_reason = 'removed_payer'`) and notify.
- Participant/payer was a placeholder that got **merged** → follow `merged_into`; no pause.
- On resume, the user must supply a valid split/payer; `next_due` jumps to the next future
  anchor date. **Missed occurrences are skipped**, never back-filled.

---

### Concurrent edits (decided, Q3)

`expenses` and `settlements` use **optimistic locking**. Every edit, delete, restore or dispute
sends the `version` the client last saw; the write is
`UPDATE … SET …, version = version + 1 WHERE id = $id AND version = $seen`.
Zero rows updated → reject with a conflict response containing the current state and the diff
since `$seen` (from `revisions`). The client shows "<name> changed this while you were editing"
and asks the user to reapply. Nothing is ever silently overwritten.

---

## 4. Derived balances (no table)

For one group, per member:

```
net(m) = Σ paid_minor(m) − Σ owed_minor(m)
       + Σ settlements sent by m − Σ settlements received by m
```
(only non-deleted expenses/settlements). `Σ net = 0` always — a cheap integrity check.

- **Simplified view:** run the debt-simplification algorithm over the `net` values.
- **Raw pairwise view / "why?" breakdown** (decided, Q1): resolve **each expense on its own**
  with the fewest transfers. For each member `delta = paid − owed`. List debtors (`delta < 0`)
  and creditors (`delta > 0`), each in ascending `sort_key`; walk both lists greedily, matching
  `min(|debt|, credit)` until both are exhausted. Members with `delta = 0` owe nothing.
  Pairwise balance = net of those per-expense transfers across all expenses, adjusted by
  settlements between the pair. No extra rounding is needed — only whole minor units move.
  Example: ₹3,000 dinner, equal 3-way, Priya paid ₹2,000, Arjun ₹1,000 → you → Priya ₹1,000.
- **Friend view:** sum of pairwise balances with that friend across shared groups, per currency.
- **Home screen:** sum of the user's `net` across all their memberships, grouped by currency.
- **Archive check / leave check / account-deletion check:** "is `net` exactly 0".

Performance: friend group scale (≤50 members, hundreds to low thousands of expenses per group)
means computing on read is fine. If it ever isn't, add a cache table rebuilt from these rows —
never the source of truth.

---

## 5. History, activity, reminders

### `revisions` — per-entity edit history (powers "who changed what" and restore)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| entity_type | enum `expense` \| `settlement` | |
| entity_id | uuid | |
| version | int | Matches entity's version after this change; `UNIQUE (entity_type, entity_id, version)` |
| action | enum `create` \| `update` \| `delete` \| `restore` \| `dispute` \| `merge_repoint` | |
| actor_member | uuid FK → group_members, nullable | NULL = system (recurring auto-create) |
| snapshot | jsonb | **Full state after the change**, including payers and splits |
| created_at | timestamptz | |

Diffs ("Amount ₹3,000 → ₹2,400") are computed by comparing consecutive snapshots. Written in
the same transaction as the change itself.

### `activity_events` — group feed + notification source
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK → groups | |
| actor_member | uuid FK → group_members, nullable | |
| type | text | e.g. `expense.created`, `settlement.disputed`, `member.claimed`, `member.merged`, `group.archived`, `invite.reset`, `admin.auto_promoted` |
| entity_type, entity_id | nullable | Link to the expense/settlement/member |
| revision_id | uuid FK → revisions, nullable | |
| payload | jsonb | Display data (names/amounts at the time) |
| seq | bigint identity | Insertion order; the feed sorts by this (timestamps can tie within a microsecond) |
| created_at | timestamptz | Default `clock_timestamp()` (not `now()`), so events in one transaction get distinct real times |

Push fan-out reads the event, works out recipients (involved members, minus actor, minus muted,
minus placeholders) and sends.

### `reminders`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK → groups | |
| from_member, to_member | uuid FK → group_members | |
| sent_at | timestamptz | |

Rate limit: reject if a row exists for the same (group, from, to) with `sent_at > now() − 24h`.

---

## 6. Relationships at a glance

```
users 1─* group_members *─1 groups
users 1─* push_subscriptions

groups 1─* expenses 1─* expense_payers *─1 group_members
                    1─* expense_splits *─1 group_members
groups 1─* settlements (from/to/recorded_by → group_members)
groups 1─* recurring_series 1─* expenses
groups 1─* activity_events ─? revisions
groups 1─* reminders
```

---

## Open questions (need decisions)

- ~~Q1. Who owes whom with multiple payers?~~ **Decided:** per-expense minimal transfers (§4).
- ~~Q2. Recurring edge cases~~ **Decided:** pause + notify; skip missed occurrences (§3).
- ~~Q3. Concurrent edits~~ **Decided:** optimistic locking, reject the second save (§3).
- ~~Q4. Direct groups and currency~~ **Decided:** one per pair, creator's default currency (§2).
