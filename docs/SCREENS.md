# Splity — Screens (v1 draft)

Mobile-first PWA. Every screen must work at 360 px wide; desktop is the same layout, centred.
Visual design (colors, type, components, motion) is defined in [DESIGN.md](DESIGN.md). Mockups
here show structure only; emoji in them stand in for Lucide icons.

## Navigation (decided, Q1)

- **Bottom tab bar** on all main screens: **Home · Friends · (+) · Activity · Account**.
- The centre **(+)** opens Add Expense:
  - from a main tab → first step is "Which group or friend?" (recent first, searchable);
  - inside a group (G2) or friend (F1) → that group/friend is pre-selected, step skipped.
- Group and expense screens are pushed on top with a back button; the tab bar stays visible on
  G2/F1 but hides on forms (X1, S1, G1).

## Add expense form (decided, Q2)

Single screen (X1):
- Top: group/friend name; **description** (category icon beside it) and **amount**, large.
- Summary line: **"Paid by [you] · split [equally among all N]"** with live per-person result
  ("₹750 each", or "₹333.34 / ₹333.33 / ₹333.33" when rounding applies). Tapping opens:
  - **Payer sheet:** pick one member, or "Multiple people" with an amount per payer and a live
    "₹X left to assign" counter.
  - **Split sheet:** segmented control **Equally · Exact · Shares**; checkbox per member; live
    per-person `owed` from `packages/shared`; "₹X left" counter for Exact.
- Chip row: **date** (default today), **category** (default General), **receipt** 📎,
  **repeat** 🔁; then **note**.
- Defaults are always the same: **paid by you, equal split among all active members, today,
  General**. Never "remember last split".
- Foreign currency: tapping the currency symbol next to the amount switches currency and reveals
  an **exchange rate** field showing the converted group-currency amount.
- **Save** is disabled until payers and split both sum to the total; the reason is shown inline.
- Editing (from X2) opens the same form pre-filled, carrying the `version` for conflict checks.

## Group Balances tab (decided, Q3)

Inside G2 → **Balances**:
- Header row: **Simplify** toggle (current state always visible; changing it affects everyone in
  the group, so it is logged in the activity feed).
- **Your balance** section first: one row per person you owe / who owes you, in the current mode.
  - Rows where you owe → **[Settle]** (opens S1 pre-filled with that person and amount).
  - Rows where you're owed → **[Remind]** (disabled with "reminded 3h ago" inside the 24 h window;
    hidden for placeholders, who can't receive push) and **[Record payment]**.
  - Every row has **why? ›** → S3 breakdown.
  - All settled → "You're all settled up 🎉".
- **Everyone** section: each member's **net** (+ owed / − owes), removed members greyed.
  Collapsed **"Show all payments (n)"** lists every transfer between other members.

## Screen inventory

### Entry
| # | Screen | Purpose |
|---|---|---|
| E1 | **Sign in** | "Continue with Google", "Email me a link" |
| E2 | Magic link sent | "Check your inbox", resend (rate-limited) |
| E3 | **Invite landing** (`/join/<token>`) | Group name + members. Pick an unclaimed placeholder ("I'm Rahul") or "Join as new member". Signs in first if needed |

### Main (logged in)
| # | Screen | Purpose |
|---|---|---|
| M1 | **Home** | Overall owe/owed per currency; list of active groups with my balance in each |
| M2 | **Friends** | Everyone I share a group with; net per currency |
| M3 | **Activity** | Feed across all my groups (from `activity_events`) |
| M4 | **Account** | Profile, UPI ID, default currency, notifications, History link, sign out, delete account |

### Group
| # | Screen | Purpose |
|---|---|---|
| G1 | Create group | Name, currency, add members (placeholders by name) |
| G2 | **Group detail** | Header: my balance + "Settle up". Tabs: **Expenses** · **Balances** · **Activity** |
| G3 | Group settings | Name, simplify toggle, members list, invite link (copy/share/reset), archive, mute |
| G4 | Member detail (admin) | Role, remove, undo claim, merge into… |
| G5 | Search & filter | Text, member, category, date range; CSV export button |

### Expense
| # | Screen | Purpose |
|---|---|---|
| X1 | **Add / edit expense** | Description, amount, currency/FX, date, category, payers, split, notes, receipt, repeat |
| X2 | **Expense detail** | Who paid, who owes what (incl. rounding), receipt, notes, **edit history**, delete/restore |
| X3 | Recurring series | Frequency, next due, status (+ paused reason), pause/resume/stop |

### Settle
| # | Screen | Purpose |
|---|---|---|
| S1 | **Settle up** | Pick who → whom (pre-filled from balances), amount (pre-filled, editable), method, "Pay via UPI" |
| S2 | Settlement detail | Amount, who recorded it, dispute / edit / delete, history |
| S3 | "Why?" breakdown | For a simplified debt: the raw debts it replaces |

### Friend & history
| # | Screen | Purpose |
|---|---|---|
| F1 | **Friend detail** | Net with this friend per currency, broken down by group; "Add expense" (1-on-1), "Remind" |
| H1 | History | Archived groups (read-only G2) |

## Open questions
- ~~Q1. Navigation~~ **Decided:** bottom tabs + centre (+) button
- ~~Q2. Add-expense form~~ **Decided:** single screen, summary line, fixed defaults
- ~~Q3. Balances tab~~ **Decided:** your debts first, then everyone's net + all payments
