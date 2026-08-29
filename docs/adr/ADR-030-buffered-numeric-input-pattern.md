# ADR-030: Buffered Numeric Input Pattern (NumberField)

## Status
Accepted

## Date
2026-08-29

## Context
Identified during Phase 14 manual testing (the underlying symptom was
already flagged as deferred technical debt in ADR-027's Consequences
section): every numeric Inspector field bound its `<input type="number">`
directly to `Number(e.target.value)` on each keystroke. This has two
failure modes. First, typing a negative number's leading `-` produces
`Number("-") === NaN`, which becomes the new controlled value and
visibly resets the field before the digits following the minus sign can
be typed — negative values were effectively impossible to type by hand.
Second, once a value round-trips through the ECS (`f32` storage, `f64` in
JS), the displayed value can show long, meaningless decimal tails (e.g.
`0.10000000149011612`).

## Decision
Extract a shared `NumberField` component
(`client/app/src/inspector/NumberField.tsx`), used by every numeric input
across `LocalTransformField`, `VelocityField`, and `CameraField`.
`NumberField` holds its own local text buffer while its input is focused,
committing to the parent's `onChange` only on keystrokes where the buffer
currently parses to a finite number — so an in-progress, momentarily
invalid string like `"-"` or `"1."` is never clobbered by a re-render. On
blur, it re-syncs its buffer from the canonical value, rounded to 6
decimal places to hide `f32`→`f64` noise without altering the underlying
stored value. The underlying input element changed from
`type="number"` to `type="text"` with `inputMode="decimal"`, to sidestep
further browser-specific native-number-input quirks; this also removes
the native spinner arrows, consistent with the project's existing
Unity-inspired Inspector convention, which doesn't use them elsewhere.

## Reasoning
A shared component was chosen over a scoped, per-file patch because the
same broken pattern was already duplicated across four Inspector field
renderers before this fix — ADR-027 had already flagged "extracting a
shared input component" as a natural next step once a fourth instance of
near-identical input styling appeared. Fixing this as a one-off patch in
a single file would have left the same bug latent in the others.
Rounding only at blur/display time, not at the point of writing to the
ECS, was deliberate — the actual `f32` value stored in the ECS is
untouched; only what's shown when the user isn't actively editing is
smoothed, so the Inspector never silently degrades precision the
simulation itself relies on.

## Consequences
Enables typing negative values and clean-looking numbers in every
Inspector numeric field, and retires Outstanding Technical Debt #1 from
the Phase 13 handoff. Establishes `NumberField` as the required component
for any future numeric Inspector field — a new field renderer using a raw
`<input type="number">` going forward should be treated as reintroducing
a known, already-fixed bug. `EntityInfoField` was not touched, since it
has no numeric inputs; it would adopt `NumberField` automatically if it
ever gains one.
