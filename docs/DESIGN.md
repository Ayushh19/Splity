---
version: "1.0"
name: "Splity — Cassette Futurism"
description: "Cassette-futurist design system for Splity, a mobile-first PWA for splitting expenses with friends. Dark only."
colors:
  # Core palette
  crt-green: "#33FF00"
  phosphor-amber: "#FFB000"
  tape-red: "#CC0000"
  warm-beige: "#D2B48C"
  off-white: "#E8E0D0"
  static-grey: "#A6A6A6"
  charcoal: "#333333"
  deep-navy: "#1B2838"
  off-black: "#1A1A1A"
  # Roles
  background: "{colors.off-black}"
  surface: "#242424"
  surface-raised: "{colors.charcoal}"
  border: "#4A4A4A"
  text: "{colors.off-white}"
  text-secondary: "{colors.warm-beige}"
  text-muted: "{colors.static-grey}"
  primary: "{colors.crt-green}"
  on-primary: "{colors.off-black}"
  owed-to-you: "{colors.crt-green}"
  you-owe: "{colors.phosphor-amber}"
  settled: "{colors.static-grey}"
  warning: "{colors.phosphor-amber}"
  danger: "{colors.tape-red}"
  danger-text: "#FF6B6B"
  on-danger: "#F4EFE6"
  focus: "{colors.crt-green}"
typography:
  display:
    fontFamily: VT323
    fontSize: "clamp(2.75rem, 12vw, 4rem)"
    fontWeight: 400
    lineHeight: 1
  h1:
    fontFamily: VT323
    fontSize: 2.25rem
    fontWeight: 400
    lineHeight: 1.1
  h2:
    fontFamily: VT323
    fontSize: 1.75rem
    fontWeight: 400
    lineHeight: 1.15
  label:
    fontFamily: VT323
    fontSize: 1.25rem
    fontWeight: 400
    letterSpacing: 0.06em
    textTransform: uppercase
  body-md:
    fontFamily: JetBrains Mono
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.5
  amount:
    fontFamily: JetBrains Mono
    fontWeight: 600
    fontVariantNumeric: tabular-nums
  amount-input:
    fontFamily: JetBrains Mono
    fontSize: 2.5rem
    fontWeight: 600
    fontVariantNumeric: tabular-nums
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  gutter: 16px
rounded:
  sm: 4px
  md: 8px
  pill: 999px
borders:
  hairline: 1px
  chunky: 2px
elevation:
  key: "0 3px 0 #0D0D0D"
  key-pressed: "0 1px 0 #0D0D0D"
  bevel: "inset 0 1px 0 rgba(255, 255, 255, 0.06)"
  sheet: "0 -8px 24px rgba(0, 0, 0, 0.5)"
  glow-green: "0 0 6px rgba(51, 255, 0, 0.45)"
  glow-amber: "0 0 6px rgba(255, 176, 0, 0.45)"
motion:
  fast: 120ms
  base: 200ms
  slow: 320ms
  ease-out: "cubic-bezier(0.2, 0.8, 0.2, 1)"
  spring: { stiffness: 380, damping: 32 }
  stagger: 40ms
z-index:
  base: 0
  sticky: 100
  overlay: 200
  modal: 300
  scanlines: 400
  toast: 500
layout:
  max-content-width: 560px
  tab-bar-height: 64px
  min-touch-target: 44px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    font: "{typography.label}"
    height: 48px
    paddingX: 20px
    rounded: "{rounded.md}"
    shadow: "{elevation.key}"
  button-secondary:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    border: "1.5px solid {colors.static-grey}"
    height: 48px
    rounded: "{rounded.md}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
    height: 48px
    rounded: "{rounded.md}"
    shadow: "{elevation.key}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    border: "1px solid {colors.border}"
    height: 48px
    rounded: "{rounded.sm}"
    caretColor: "{colors.primary}"
  card:
    backgroundColor: "{colors.surface}"
    border: "2px solid {colors.charcoal}"
    rounded: "{rounded.md}"
    shadow: "{elevation.bevel}"
  readout:
    backgroundColor: "{colors.off-black}"
    border: "2px solid {colors.charcoal}"
    rounded: "{rounded.sm}"
    font: "{typography.display}"
---

# Splity Design System

Every screen, component and style in `apps/web` follows this file. If a design need is not
covered here, extend this file first, then build it.

## Overview

Splity looks like a piece of 1980s equipment for keeping accounts: a dark panel with a glowing
phosphor readout, chunky keys you press, and a log printing out what happened. That is cassette
futurism — the future as it was imagined before touchscreens flattened everything, where
technology is something you *operate*.

It is also an app people use to track real money with friends, several times a week, on a
phone. So the aesthetic carries the brand, and readability carries the money:

- **Effects decorate; numbers stay clean.** Glow, scanlines and the pixel font belong to
  headings, labels and balance readouts. Amounts in forms and lists are always crisp,
  monospaced, tabular figures.
- **Every color has one meaning.** Green = owed to you / go. Amber = you owe / attention.
  Red = destructive or error. Never reuse them decoratively.
- **Tactile, not theatrical.** Keys press down, switches click, sheets slide like tape
  drawers. Motion is short, and it never blocks entering an expense.

Character: Density 6/10 (an app, not a landing page) · Variance 4/10 (consistent screen
patterns) · Motion 4/10 (purposeful).

- **Style:** Retro-futuristic, analog-digital, cassette futurism
- **Keywords:** CRT, phosphor readout, scanlines, tape deck keys, terminal log, LED indicators
- **Theme:** Dark only. `<meta name="theme-color" content="#1A1A1A">`; no light mode in v1.

## Colors

| Token | Hex | Use |
|---|---|---|
| **CRT Green** `primary` | `#33FF00` | Primary actions, focus ring, active tab, **money owed to you** |
| **Phosphor Amber** `you-owe` / `warning` | `#FFB000` | **Money you owe**, attention states, disputes, paused series, conflicts |
| **Tape Red** `danger` | `#CC0000` | Destructive button fills only |
| **Error red** `danger-text` | `#FF6B6B` | Error messages, error borders, destructive text links (Tape Red is too dark on the background for text or borders) |
| **Off-White** `text` | `#E8E0D0` | Body text |
| **Warm Beige** `text-secondary` | `#D2B48C` | Secondary headings, section labels, names in log lines |
| **Static Grey** `text-muted` | `#A6A6A6` | Metadata, timestamps, placeholders, settled balances |
| **Off-Black** `background` | `#1A1A1A` | App background, readout panels |
| **Surface** | `#242424` | Cards, inputs, sheets |
| **Charcoal** `surface-raised` | `#333333` | Raised panels, tab bar, card borders |
| **Border** | `#4A4A4A` | Input borders, dividers |
| **Deep Navy** | `#1B2838` | Decorative only: the readout panel's inner glass tint, illustrations |

Rules:

- **Money colors always come with words or a sign.** "Priya owes you ₹500" (green),
  "You owe Arjun ₹500" (amber), "Settled up" (grey). Color is never the only signal.
- **Owing money is amber, not red.** Owing a friend is normal, not an error. Red is reserved
  for destroying data and for errors.
- **Contrast:** text ≥ 4.5:1, borders/icons that carry meaning ≥ 3:1, against the actual
  background. Verified (WCAG 2.x):

  | Text color | on `background` #1A1A1A | on `surface` #242424 | on Charcoal #333333 |
  |---|---|---|---|
  | CRT Green | 12.8 | 11.4 | 9.3 |
  | Phosphor Amber | 9.5 | 8.5 | 6.9 |
  | Error red #FF6B6B | 6.3 | 5.6 | 4.55 |
  | Off-White | 13.3 | 11.8 | 9.6 |
  | Warm Beige | 8.8 | 7.9 | 6.4 |
  | Static Grey #A6A6A6 | 7.2 | 6.4 | 5.2 |

  Off-Black on CRT Green (primary key) 12.8 · `on-danger` on Tape Red 5.1. Tape Red against the
  background is only 3.0 — never use it for text or borders.
- No pure black `#000000` and no pure white `#FFFFFF`.

## Typography

| Role | Font | Size | Notes |
|---|---|---|---|
| Display (balance readout) | VT323 | clamp(2.75rem, 12vw, 4rem) | Glow, line-height 1 |
| H1 (screen title) | VT323 | 2.25rem | |
| H2 (section title) | VT323 | 1.75rem | |
| Label | VT323 | 1.25rem, UPPERCASE, 0.06em tracking | Section labels, tab labels, button text |
| Body | JetBrains Mono | 0.9375rem / 1.6 | Descriptions, notes, form values |
| Small | JetBrains Mono | 0.8125rem / 1.5 | Metadata, timestamps, helper text |
| Amount | JetBrains Mono 600 | Inherits size | Always `font-variant-numeric: tabular-nums` |
| Amount input | JetBrains Mono 600 | 2.5rem | The big number on Add Expense |

- **VT323 has a single weight (400).** Create hierarchy with size, case, color and glow —
  never faux bold. Never use VT323 below 1.25rem; it is a pixel font and becomes illegible.
- **Amounts are never set in VT323** except the large balance readout (Display), where size
  makes it readable.
- Format money with `formatAmount()` from `@splity/shared` (Indian digit grouping for INR:
  ₹10,00,000.00). Never format in components by hand.
- Self-host fonts with `@fontsource/vt323` and `@fontsource-variable/jetbrains-mono` so the PWA
  works without Google Fonts and does not flash on load. Fallbacks: `VT323, ui-monospace,
  monospace` and `"JetBrains Mono", ui-monospace, monospace`.
- Max line length 60ch for prose (notes, empty-state text).

## Layout

- **Mobile first.** Designed at 360px; single column everywhere. On wider screens the app is
  a centered column, max 560px, on the `background` color — not a stretched desktop layout.
- **Gutters:** 16px left/right. Respect `env(safe-area-inset-*)` on all edges.
- **Spacing rhythm:** 4px base. Between related items 8px, between groups 16–24px, between
  sections 32px.
- **Bottom tab bar:** 64px + safe-area inset, fixed, z `sticky`. Content gets matching bottom
  padding so nothing hides behind it. Hidden on full-screen forms (Add Expense, Settle Up,
  Create Group), per `SCREENS.md`.
- **Heights:** use `min-height: 100dvh`; never `100vh` / `h-screen`.
- **Touch targets:** at least 44×44px, including icon buttons and list-row actions.
- **No horizontal scrolling** of the page at any width. Long names truncate with ellipsis;
  amounts never truncate.
- **z-index contract:** base 0 · sticky (tab bar, headers) 100 · overlay (sheet backdrop) 200 ·
  modal / bottom sheet 300 · scanlines 400 · toast 500.

## Elevation & Depth

Depth comes from hardware, not soft shadows:

- **Keys:** primary and danger buttons sit on a hard offset shadow (`0 3px 0 #0D0D0D`) with a
  1px top bevel highlight. Pressed: translate down 2px and shrink the shadow to 1px — the key
  physically goes down.
- **Panels:** cards are `surface` with a 2px Charcoal border and an inset bevel highlight.
  No blurred drop shadows on cards.
- **Readout panel:** the home balance and group balance headers are recessed "screens":
  off-black glass with a faint Deep Navy tint, 2px border, glowing VT323 numbers.
- **Bottom sheets:** the one place with a soft shadow (`0 -8px 24px rgba(0,0,0,.5)`) because
  they float above the page.

### Signature effects — where they are allowed

| Effect | Where | Where never |
|---|---|---|
| **Scanlines** | One fixed full-screen overlay: 2px repeating lines at 3% opacity, `pointer-events: none`, z 400, static (not animated) | Doubling up per component |
| **Phosphor glow** | Display/H1 text, balance readouts, the active tab indicator, LEDs | Body text, buttons, form inputs, amounts in lists |
| **Command-line text** | Activity feed (log lines), edit history (diff lines), empty states (typed-out once with a block cursor) | Form labels, error messages, anything that delays input |
| **LED indicators** | Simplify toggle, "disputed" and "paused" badges, sync/offline status | Decoration with no state behind it |
| **Tape reels** | Progress for long operations: receipt upload, CSV export | Normal page loads (use skeletons) |
| **VHS tracking distortion** | Once, ≤ 400ms: the "all settled up" moment and the offline screen | Anywhere money is being entered or read |
| **Chunky pixel borders** | Readout panels, empty-state illustration frames | Every card (keep cards calm) |

## Shapes

- Radius: `sm` 4px for inputs, badges, readouts; `md` 8px for buttons, cards, sheets
  (top corners only); `pill` for chips and the toggle track.
- Borders: 1px for inputs and dividers, 2px ("chunky") for cards, readouts and the (+) key.

## Components

### Buttons
- **Primary key:** CRT Green fill, Off-Black VT323 label (uppercase), 48px tall, key shadow,
  press = 2px travel. Hover (pointer devices): 8% darker. No glow.
- **Secondary:** transparent, 1.5px Static Grey border, CRT Green label. Hover: 6% green fill.
- **Danger:** Tape Red fill, `on-danger` label, key shadow. Always behind a confirmation for
  irreversible-feeling actions (remove member, delete expense — even though it's restorable,
  confirm once).
- **Icon button:** 44px square hit area, Lucide icon 22px in Off-White, muted when disabled.
- **Disabled:** 40% opacity, no shadow, no press travel; the reason is shown as helper text
  nearby (e.g. "Payers add up to ₹2,500 — ₹500 left").

### The (+) key
The centre of the bottom tab bar: a 56px square key with `md` radius, CRT Green, 2px Off-Black
border, key shadow, Lucide `Plus` icon. It rises 12px above the tab bar like a raised button
on a deck.

### Bottom tab bar
Charcoal panel, 2px top border Off-Black. Each tab: Lucide icon + VT323 label. Active: CRT Green
icon and label with glow, plus a 3px green LED bar above the icon. Inactive: Static Grey.

### Balance readout
Recessed panel at the top of Home and Group Detail:
```
┌ NET BALANCE // INR ─────────────┐
│  YOU ARE OWED                   │
│  ₹2,100.00          ▮ (glowing) │
└─────────────────────────────────┘
```
Label in VT323 beige; the figure in Display VT323 with green or amber glow; one readout row per
currency (never converted). Settled: grey "ALL SQUARE", no glow.

### Balance row
Avatar (initials on Charcoal square, `sm` radius) · name and relationship text
("owes you" / "you owe") · amount right-aligned (Amount style, money color) · action key
(**Settle** / **Remind**) · "why? ›" text link below in muted. Removed/placeholder members show a
badge.

### Expense row
Left: a cassette-label date stub (VT323 day number over 3-letter month, Charcoal box).
Middle: description (Body), "Priya paid ₹3,000" (Small, muted), category icon.
Right: your share in money color with "you owe" / "you lent", or "not involved" in muted.

### Amount input
Huge JetBrains Mono 600 figure, currency symbol button to its left (tap to switch currency and
reveal the exchange-rate field). Green block caret. Numeric keypad (`inputmode="decimal"`).

### Summary line (Add Expense)
"Paid by [you] · split [equally among all 4]" — bracketed parts are tappable chips (pill,
Charcoal, 1px border) that open bottom sheets. Live result under it in Small muted
("₹750.00 each" / "₹333.34 · ₹333.33 · ₹333.33").

### Segmented control (Equally · Exact · Shares)
Tape-deck buttons in a row sharing borders. Selected stays physically down (pressed shadow,
green label, green LED dot). Unselected raised, grey label.

### Toggle (Simplify debts)
A physical switch: pill track, square thumb, plus an LED dot that glows green when on and is
dark grey when off. Label to the left, current state text ("ON"/"OFF") to the right.

### Inputs
Label above (VT323 label style), 48px field, `surface` fill, 1px border, `sm` radius.
Focus: 2px CRT Green ring, 2px offset. Error: border and message below in `danger-text`
(Small). No floating labels. Helper text in muted Small.

### Badges
Small VT323 uppercase in a 1px bordered box with an LED dot:
`ADMIN` (beige) · `PLACEHOLDER` (grey) · `REMOVED` (grey, strikethrough name) ·
`DISPUTED` (amber LED) · `PAUSED` (amber LED) · `ARCHIVED` (grey).

### Bottom sheets
Slide up from the bottom (spring), top corners `md`, Off-Black backdrop at 60%. Drag handle:
a 32×4 Charcoal bar. Primary action pinned at the bottom of the sheet.

### Activity feed — log lines
Each event is a terminal log line:
```
14:02  PRIYA     added "Dinner at Toit"  ₹3,000.00
13:47  ARJUN     paid YOU                ₹500.00
09:15  SYSTEM    created "Rent" (Oct)    ₹30,000.00
```
Time in muted, actor in beige VT323, text in Body, amount right-aligned tabular. Day dividers:
`── TUE 01 OCT ──`.

### Edit history — diff lines
```
v3  ARJUN · 2h ago
-   amount   ₹3,000.00
+   amount   ₹2,400.00
```
`-` lines amber, `+` lines green, Body font.

### Conflict banner
Amber 2px left border, amber LED, "Priya changed this while you were editing", the diff, and a
**Reload** primary key.

### Toasts
Bottom, above the tab bar, z 500. Charcoal panel, 2px border in the semantic color, auto-dismiss
4s, with **Undo** where the action is undoable (delete expense).

### Skeletons
Charcoal blocks matching the content's shape with a slow left-to-right shimmer (1.2s). No
circular spinners anywhere.

### Empty states
Lucide icon (48px, muted) in a chunky pixel frame, one line typed out once with a blinking block
cursor, one sentence of help, one primary key. Example: `> NO EXPENSES YET_` /
"Add the first one and Splity will keep score." / **[ ADD EXPENSE ]**.

### Category icons (Lucide)
general `Receipt` · food `Utensils` · groceries `ShoppingCart` · travel `Plane` ·
transport `Car` · stay `BedDouble` · rent `House` · utilities `Zap` · entertainment `Clapperboard` ·
shopping `ShoppingBag` · health `HeartPulse` · other `Package`.

## Motion

- **Durations:** 120ms (press, toggle), 200ms (most transitions), 320ms (sheets, page).
  Nothing over 400ms.
- **Easing:** `cubic-bezier(0.2, 0.8, 0.2, 1)`; sheets use a spring (stiffness 380, damping 32).
- **Page transitions:** fade + 12px slide in the navigation direction, 200ms.
- **Lists:** first render staggers rows 40ms apart, max 8 rows; later updates don't animate.
- **Animate only `transform` and `opacity`.**
- **`prefers-reduced-motion: reduce`:** no slides, staggers, typing effects or VHS distortion;
  fades only (≤ 120ms). Scanlines stay (static).
- Never animate an amount while the user is reading or typing it.

## Copy

- Plain, short, friendly. Sentence case for body; VT323 labels are uppercase.
- Say who and what: "You owe Arjun ₹500", "Priya paid ₹3,000".
- Terminal flavour only in the places listed above (log lines, empty states, readout labels).
- No AI-cliché words: elevate, seamless, unleash, next-gen, supercharge.
- No emojis in the UI — Lucide icons only. (Emojis in `SCREENS.md` mockups stand in for icons.)
- No lorem ipsum anywhere, including demos: use realistic names and Indian amounts.

## Accessibility

- Contrast targets as in **Colors**; compute the ratio for every new color pair before using it.
- Visible focus ring on every interactive element (2px CRT Green, 2px offset).
- Touch targets ≥ 44px. Form fields have real `<label>`s.
- Money state is always in text, not only color.
- Amounts are read out fully by screen readers (`aria-label="You owe Arjun 500 rupees"` where
  the visual is abbreviated).
- Decorative effects (scanlines, glow, LEDs without state) are `aria-hidden`.
- Respect `prefers-reduced-motion` (see **Motion**).

## Do's and Don'ts

**Do**
- Use the static scanline overlay, phosphor glow on readouts, chunky borders on panels.
- Make keys and switches feel physical: press travel, LED states.
- Present history as terminal log and diff lines.
- Use tabular figures for every amount.

**Don't**
- Use VT323 for amounts in lists or forms, or below 1.25rem.
- Use red for "you owe".
- Glow buttons, body text or inputs.
- Animate anything during data entry, or exceed 400ms.
- Use pure black, pure white, emojis, `100vh`, or circular spinners.
- Build landing-page patterns (hero sections, feature grids) — this is an app.

## Use Case

Splity: a mobile-first PWA for small friend groups to split expenses, track balances and
settle up. See `SPEC.md` for behavior and `SCREENS.md` for screen structure.
