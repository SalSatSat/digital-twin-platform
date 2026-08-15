# ADR-026: Entity Hierarchy Panel — Flat List at the WASM Boundary

## Status
Accepted.

## Date
2026-08-08

## Context
Phase 13's Runtime Editor needed a real entity list/hierarchy panel to
replace the Inspector's temporary numeric handle input. The scene data
needed to build this already existed in the ECS — `HierarchyNode {
parent: Option<Entity>, children: Vec<Entity> }` — but nothing at the
WASM boundary exposed it. `EngineWorld` also only maintained a
handle→Entity map (`entity_handles`), never the reverse, so any handle-
facing hierarchy export needed new translation logic regardless of
shape chosen.

Two shapes were considered for what `EngineWorld` returns to JavaScript:

1. **Nested JSON tree** — directly renderable by the frontend with no
   client-side reconstruction.
2. **Flat list** — `{ handle, parent_handle, name }[]`, tree structure
   reconstructed client-side.

## Decision
Flat list. New method `EngineWorld::list_entity_hierarchy() -> String`
(JSON-encoded, matching the existing `list_categories`/`list_contexts`
convention of returning raw strings for the caller to `JSON.parse()`).

Placed directly in `lib.rs`'s `EngineWorld` impl block (a new "Entity
Hierarchy (list view)" section) rather than a new module, because the
core logic — building an `Entity -> handle` reverse map by iterating
`entity_handles` — depends on a field private to `EngineWorld`/`lib.rs`
itself. Unlike `reflection.rs` (a real multi-entry registry with shared
types and its own test surface, justifying its own file),
`list_entity_hierarchy` is a single function tightly coupled to
`lib.rs`-only state, with no shared structure to justify a module
boundary.

## Reasoning
- `HierarchySystem::propagate` already does recursive depth-first
  tree-walking, but for transform composition, not serialization.
  Reusing it for a nested-tree JSON builder would mean writing a
  second recursive-walk with different output, in the same file, for
  a different purpose — not a clean reuse.
- A flat list matches the WASM boundary's existing convention (`Entity`
  cannot cross the boundary at all; only `u32` handles can), and
  happens to be exactly the shape a drag-and-drop tree UI wants to
  reconcile against on the client side anyway — not a compromise
  either way.
- Every spawn bundle (`base`, `camera`, `dynamic_object`,
  `static_object`) was confirmed this session to attach `EntityInfo`
  unconditionally, so `name` lookup in `list_entity_hierarchy` uses
  `.expect("every spawned entity has EntityInfo")` rather than a
  fallback label — a deliberate "fail loud if this invariant is ever
  violated by a future bundle" choice over silently degrading to a
  placeholder label.

## Consequences
- `EngineWorld` now builds an `Entity -> handle` `HashMap` on every
  `list_entity_hierarchy()` call — O(n) per call, not maintained as
  persistent state. Fine at current entity counts (tens); would need
  reconsideration if entity counts grow into the hundreds+, alongside
  the frontend's own O(n²) `childrenOf` re-filter (see HANDOFF.md).
- Tree-building logic now exists in exactly one place — the React
  frontend (`EntityHierarchyPanel.tsx`) — not duplicated in Rust.
- No Rust-side signature for `set_parent`/`remove_parent` changed; this
  ADR only concerns the new read-side export. Cycle detection remains
  entirely `World::set_parent`'s responsibility, confirmed this
  session to already reject self-parenting and descendant-cycles via
  its ancestor-walk check — the frontend does not duplicate this logic
  client-side by design (see HANDOFF.md, Important Discoveries).

## Alternatives Considered
- **Nested JSON tree, built in Rust**: rejected — would duplicate
  `HierarchySystem`'s traversal shape for a different purpose, in the
  same file, for a single caller.
- **Separate `hierarchy_view.rs` module**: rejected — the function's
  core dependency (`entity_handles`) is private to `EngineWorld`
  already; splitting it out would require either weakening that
  encapsulation or passing the field in as a parameter for no benefit,
  since there's exactly one caller.
- **Persistent `Entity -> handle` reverse map maintained alongside
  `entity_handles`**: not pursued — adds a second source of truth that
  must stay in sync with every spawn/despawn, for a cost
  (`O(n)`-per-call HashMap build) that's currently negligible.
