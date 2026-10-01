# Splity — Product Specification (v1)

Expense-sharing app for a small circle of real friends. Real money, so correctness
and transparency beat feature breadth. No growth/monetization goals.

---

## 1. Platform & Access

- **Platform:** Progressive Web App (installable via "Add to Home Screen"). The invite link opens directly in the app.
- **Sign-in:** Google sign-in; email magic link as fallback. No phone OTP.
- **Offline:** Not supported in v1. App shows an "offline" state; no writes while offline.
- **Profile:** name, photo, email, optional **UPI ID**, **default currency** (INR).

## 2. Groups & Members

### Membership
- A group member is either a **real user** or a **placeholder** (name only, no account).
- Anyone can add placeholders to a group.
- Each group has **one invite link**:
  - Opening it lets a person **claim an unclaimed placeholder** or **join as a new member**.
  - A claim **locks** the placeholder; only an admin can undo a wrong claim.
  - Claims appear in the activity feed ("Rahul joined and claimed 'Rahul'").
  - Link **never expires**; an admin can **reset** it (old link stops working).
  - A user who is already a member cannot claim a placeholder in that group.
- **Merge:** an admin can merge a duplicate placeholder into a real member; all expenses and
  settlements move over, and the merge is logged.

### Roles
| Role | Can do |
|---|---|
| **Admin** (creator + anyone promoted) | Everything a member can, plus: remove members, undo claims, reset invite link, merge members, archive/unarchive group, promote admins |
| **Member** | Add/edit/delete/restore expenses, record/dispute settlements, add placeholders, send reminders |

### Leaving / removal
- **Leaving voluntarily** is **blocked** unless the member's balance in that group is exactly 0.
- **Admin removal** is allowed with a non-zero balance: member stays visible as **"removed"** (grayed),
  balance remains, they can still settle up. Their past expenses keep their name.
- **Last admin leaving** (balance 0): the **longest-standing remaining real member** is
  automatically promoted to admin. Logged in the activity feed.
- **Placeholders** can be **hard-deleted only if they appear in no expenses** (e.g. typo).
  Otherwise they can only be marked removed.

### Membership details (decided while building, 2026-10-01)
- **Names:** a new placeholder can't reuse the name of an active member (case-insensitive).
- **Invite preview is public:** anyone with the link sees the group name, member count and
  unclaimed placeholder names before signing in (the token is the secret). Joining needs sign-in;
  after signing in (or picking a name as a new user) the person returns to the invite.
- **Rejoining:** a removed member who opens the invite link is reactivated on the same member
  row, so their history stays theirs. They can't claim a placeholder instead.
- **Removed members** can still open the group read-only (to see history and settle up) and see
  it on Home while their balance is non-zero; they can't change anything.
- **Undo claim:** only for members who claimed a placeholder (not new joiners), not for admins
  (demote first) and not on yourself. The row becomes a placeholder again; the person loses access.
- **Leaving** sets the member to "removed". The last member with an account can't leave.
- **Who can do what:** any active member can rename the group, toggle simplify and add
  placeholders; admins promote, undo claims, remove members and reset the invite link.

### Lifecycle
- Groups are **never deleted**.
- An **admin** can **archive** a group **for everyone**, only when **all balances are 0**.
- Archived groups move to a **History** section and are **read-only**. An admin can unarchive.

### 1-on-1 expenses
- "Add expense with <friend>" creates or reuses a **hidden 2-person group**. All group rules apply.
- One per pair of real users (friend = someone you share a group with), in the creator's
  **default currency** (profile setting, default INR); foreign expenses use the manual FX rate.
- Both people are admins. No invite link, no placeholders, cannot be left or archived.

### Visibility
- Every member of a group sees **every** expense, settlement and activity in that group.

### Merge, archive, account deletion (decided 2026-10-01)
- **Merge:** admin only; a placeholder (active or removed) into a member with an account.
  Its expense lines and payments move over. If both were in the same expense their amounts
  are added; an **equal** split then becomes **exact** (so editing it later can't silently
  re-split), a shares split adds the shares. A payment between the two would be a
  self-payment, so it's deleted. Balances of everyone else don't change. Each touched expense
  and payment gets a `merge_repoint` history entry; the feed says "merged "Rahul" into Rahul K".
- **Archive:** admin only, refused with the list of unsettled members until every net is 0.
  Archived groups are read-only (reading still works), their invite link stops working, and
  they appear under Account › History. Admins can unarchive.
- **Account deletion** (Account › Delete account, type DELETE): refused with the list of groups
  that still have a balance. Otherwise: email replaced with a `.invalid` tombstone, name becomes
  "Deleted user", photo and UPI ID cleared, sign-ins, sessions and push devices deleted; active
  memberships become "removed" (muted), admin passes to the longest-standing member (a group
  with nobody else left simply has no admin). Signing up again with the same email creates a
  new, empty account.

## 3. Expenses

### Fields
- **Required:** description, amount, currency, date, payer(s), split.
- **Optional:** category (predefined, with icon), notes, one receipt photo, recurrence.

### Currency
- Each group has **one currency**; all balances in that group are in it.
- An expense may be entered in a **foreign currency with a manually entered exchange rate**
  (e.g. ฿2,000 @ 2.35 = ₹4,700). The original amount + rate stay visible on the expense.
- No automatic/live FX anywhere.

### Payers
- **One or more payers.** Amounts paid must sum to the expense total.

### Split methods (v1)
1. **Equal** among selected members
2. **Exact amounts** — must sum to total
3. **Shares** — weighted (e.g. 2:1:1)

(Percentages and itemized splitting are deferred to v2.)

### Money & rounding
- All amounts stored as **integer minor units** (paise). No floating point.
- Leftover minor units from a split are distributed **one each, in a fixed deterministic order**
  over the participants. The resulting per-person amounts are shown on the expense
  (e.g. ₹333.34 / ₹333.33 / ₹333.33).

### Editing & audit
- If two people edit the same expense or settlement at once, the **second save is rejected**
  with "<name> changed this while you were editing" and a diff; nothing is silently overwritten.
- **Any member** can edit or delete **any** expense in the group.
- Every change is recorded in a **per-expense edit history** (who, when, field old → new).
- Deleted expenses are **soft-deleted** and can be **restored**.
- Expenses already covered by a settlement **remain editable**; balances simply recalculate and
  the history explains the change.

### Expense details (decided while building, 2026-10-01)
- Delete and restore are separate actions that also check `version`; editing a deleted expense
  is refused until it's restored. Deleted expenses are listed under "Show deleted expenses".
- In a foreign-currency expense, multiple-payer and exact-split amounts are entered in the
  group currency (they must add up to the converted total).
- Expense rows show your position: "you lent ₹X" (green), "you owe ₹X" (amber),
  "not involved" or "no balance".
- "why? ›" on a simplified debt A → B lists the raw debts owed by A or owed to B.

### Recurring expenses
- An expense can repeat (e.g. monthly on the 1st).
- On the due date the occurrence is **auto-created** using the **most recent split** of the series;
  participants are notified.
- If an **exact** split loses a participant, or the **payer** is removed, the series **pauses**
  and the creator is notified. On resume, missed occurrences are **skipped**.
- Each occurrence is a normal, editable expense. The series can be **paused or stopped**.
- Members who have been **removed** from the group are **skipped** in new occurrences; the split
  is recalculated over the remaining participants (same method, same rounding rule).

### Limits
- Max **50 members** per group.
- Max expense **₹10,00,00,000** (or equivalent in group currency).
- Receipt photo ≤ **10 MB**.
- Expense date: any past date, at most **1 day in the future**.

## 4. Balances

- Balances exist **per group** and are always derived from expenses + settlements.
- **Debt simplification** is **on by default**, with a **per-group toggle**.
  - With simplification **off**, debts are worked out **per expense**: people who paid less than
    their share pay people who paid more, using the fewest transfers (a payer who paid exactly
    their own share owes and is owed nothing).
  - The toggle is **view-only**: it changes how balances are presented, never any stored data.
  - Each member's **net position** in the group is always shown.
  - Tapping a simplified debt shows a **"why?"** breakdown of the raw debts it replaces.
- **Friend view (read-only):** total net with a given friend across all shared groups,
  **per currency**. Settling still happens per group.
- **Home screen:** overall "you owe / you are owed" **per currency**, never converted.

## 5. Settlements

- Either party (payer or receiver) can **record** a settlement within a group.
- It **applies immediately**; the other party is **notified** and can **dispute** it.
  A dispute flags the settlement; resolution is by editing/deleting it (logged).
- **Partial payments** and **overpayments** allowed (overpayment flips the balance).
- **"Pay via UPI"** button opens a UPI deep link pre-filled with the receiver's UPI ID and amount
  (if the receiver has set one). Payment is not verified; the user records/confirms it in-app.

### Settlement details (decided 2026-10-01)
- **Placeholders:** when either side of a payment is a placeholder, **any member** can record,
  edit or delete it on their behalf; it shows "recorded by <name>". Between two real users only
  those two can.
- **Disputes:** only a real party who didn't record it can dispute (with an optional note). A
  disputed payment still counts. **Editing it clears the dispute**; the disputer can also
  withdraw it. Payments can be deleted and restored like expenses, with `version` checks.
- **Removed members** can still record and change payments they're part of, nothing else.
- **UPI button** appears only when you are the payer, the group is in INR and the receiver has
  a UPI ID; payment isn't verified, so the user records it afterwards.
- **Reminders:** "Remind" appears on "owes you" rows for members with an account. A reminder is
  pushed even if they muted the group (it's direct and rate-limited). If they have no device with
  notifications on, nothing is recorded and the sender is told to message them directly, so the
  24 h window isn't used up.

### Push details (decided 2026-10-01)
- Push is per device: turned on from Account › Notifications. Signing out turns it off for that
  device; a device that signs into another account moves to that account.
- On iPhone, Account explains "Add to Home Screen" first (iOS only allows push for installed PWAs).
- Expense notifications include the recipient's own position ("You owe ₹1,000.00"); people taken
  off an expense by an edit are told. Notifications for the same expense/payment replace each other.
- Subscriptions the push service reports as expired are deleted automatically.

## 6. Activity & Notifications

- **Activity feed** per group logs every event: expense added/edited/deleted/restored,
  settlement recorded/disputed, member joined/claimed/removed/merged, group archived/unarchived,
  invite link reset.
- **Push notifications** (in addition to the feed):
  - Expense added/edited/deleted → **only people involved** in that expense, never the actor.
  - Settlement recorded/disputed → only the two parties.
  - Member and archive events → feed only, no push.
- Users can **mute** a group.
- **Reminders:** "Remind <friend>" sends a push about what they owe in that group.
  Rate-limited to **once per 24 hours per pair** (per group).
- No email or WhatsApp notifications.

## 7. History Tools

- **Search & filter** expenses by text, member, category, date range.
- **CSV export** of a group's expenses (and settlements).

## 8. Accounts

- **Account deletion** is blocked while the user has a non-zero balance in any group.
- On deletion: personal data (email, photo, UPI ID) is removed; in groups the user appears as
  **"Deleted user"**. Their expenses and settlements remain so others' history is intact.

---

## Deferred to v2+
- Percentage split, itemized/bill split
- Spending summaries / charts
- Comments on expenses
- Offline mode with sync
- Cross-group settlement in a single payment
- Automatic FX rates
- Payment verification / gateway integration
