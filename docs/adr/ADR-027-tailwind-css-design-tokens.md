# ADR-027: Tailwind CSS Adoption and Design Token Strategy

## Status
Accepted

## Date
2026-08-22

## Context
Phase 13's Runtime Editor UI (Inspector panel, Entity Hierarchy panel) was
built with ad hoc inline `style={{}}` objects across each React component.
As the UI grew — four Inspector field renderers, the Inspector shell, the
Hierarchy panel — this produced duplicated, inconsistent styling (e.g. two
different hardcoded panel background grays, `#1e1e1e` and `#252525`, with
no shared source of truth) and no scalable way to apply a consistent visual
convention across components.

A styling approach was needed that: (1) scales to many small field
components without duplicating style values, (2) supports a coherent
editor-tool visual identity (ultimately modeled on Unity's Inspector/
Hierarchy panels, given the project's Unity-to-web migration context), and
(3) leaves room for a future design system, since a dedicated UI/UX
designer producing Figma-based tokens is a plausible future addition to
the project.

## Decision
Adopt Tailwind CSS v4 via its official Vite plugin (`@tailwindcss/vite`),
replacing all inline `style={{}}` usage in Inspector and Hierarchy panel
components with Tailwind utility classes. Define a small set of
semantic, role-based design tokens via Tailwind's `@theme` directive in
`client/app/src/index.css` (`--color-surface`, `--color-surface-raised`,
`--color-border`, `--color-text-primary`, `--color-text-muted`,
`--color-text-error`, `--color-accent`), rather than referencing
Tailwind's default palette (`zinc-800`, etc.) directly in components.

## Reasoning
**Tailwind v4 over v3:** the project's Vite version (`^8.0.12`) postdates
the v3-era PostCSS/`tailwind.config.js` setup path; v4's Vite plugin
integrates directly with no separate PostCSS config, config file, or
`content` glob to maintain, and is the framework's current default
recommendation. No compatibility reason favored v3 on this stack.

**Role-based token names over component-specific names:** an earlier
draft used component-specific token names (e.g. `panel-bg`). This was
changed to role-based names (`surface`, `border`, `text-muted`, etc.)
in anticipation of a future Figma-driven design system — tools like
Tokens Studio typically export role-based token names, not
component-specific ones. Matching that shape now means a future palette
swap only requires updating the `@theme` block's values, not renaming
usages across every component.

**Deferred shadcn/ui:** considered and explicitly deferred rather than
adopted alongside Tailwind. The Inspector's form-like fields (labeled
numeric inputs, selects) are a natural fit for shadcn's pre-built
components, but the added surface area (a `components.json` config, an
owned `components/ui/` directory, path aliases) wasn't justified for a
first styling pass on a solo project. Candidate for later adoption,
component-by-component, once specific widgets prove annoying to hand-
build in raw Tailwind.

## Consequences
Enables a consistent visual language across all Inspector field
components and the Hierarchy panel with a single point of change (the
`@theme` block) for future palette adjustments. Establishes a Unity-
inspired convention (colored X/Y/Z axis labels for 3-tuple fields,
fixed-width label columns, foldout/collapsible component sections,
borderless flat panels) as the project's editor-tool visual identity
going forward — new Inspector field renderers should follow this
convention rather than introducing new patterns.

Constrains: numeric-precision display (e.g. `f32`→`f64` round-trip
noise showing as long decimal tails in Camera's Near/Far fields) was
identified during this work but explicitly deferred, since a real fix
requires a stateful `NumberField`-style component (local state while
focused, format-on-blur), not a styling-only change. Tracked as an
open Phase 13 follow-up.

Two further follow-ups were identified but out of scope for this ADR's
styling work, since both require Rust/WASM changes: a real per-entity
icon in the Hierarchy panel (currently a placeholder square), and a
"visible" eye-icon toggle in the Hierarchy panel (blocked on
`EntityHierarchyNode` not currently including a `visible` field —
would require both a Rust struct change and a new WASM-exposed setter,
mirroring `setParent`/`removeParent`).
