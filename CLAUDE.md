# Splity

Planning docs live in `docs/`: SPEC (behavior), DATA_MODEL, TECH_STACK, SCREENS, DESIGN.

## UI work

All UI in `apps/web` must follow `docs/DESIGN.md` (Cassette Futurism, dark only): use its
tokens, components, motion and copy rules. If something isn't covered, extend DESIGN.md first,
then build it. Never put money amounts in VT323 (except the balance readout), never use red for
"you owe", no emojis in the UI.

## Money

All money logic lives in `packages/shared` and is shared by web and api. Amounts are integer
minor units; format with `formatAmount()`, never by hand.
