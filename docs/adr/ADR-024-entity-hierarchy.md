# ADR-024: Entity Hierarchy — Transform Propagation and Parent/Child Relationships

## Status
Accepted

## Date
2026-08-02

## Context
Entities needed the ability to be positioned relative to one another —
a scene graph where moving or rotating a parent entity also moves and
rotates its children. Without this, every entity's position had to be
specified in absolute world coordinates, making it impossible to model
composite objects (a turret on a vehicle, a light fixture on a ceiling)
whose parts should move together.

This required deciding: how world position is computed and cached, who
owns keeping parent/child references consistent when relationships
change, and whether cameras participate in this hierarchy.

## Decision
We split entity position into two components — `LocalTransform`
(position/rotation relative to parent) and `WorldTransform` (absolute
position/rotation) — computed once per tick by a new `HierarchySystem`
that walks the tree depth-first from roots to leaves.

`World::set_parent()` and `World::remove_parent()` own full consistency
of the hierarchy: they update both the child's `parent` field and the
old/new parent's `children` list in a single call, and reject operations
that would create a cycle.

Cameras are not currently parentable. `EngineWorld::get_camera_transform()`
continues to read `LocalTransform` directly rather than `WorldTransform`.

## Reasoning
**LocalTransform/WorldTransform split.** The alternative was a single
`Transform` component with world position computed on demand by walking
the parent chain. That approach avoids storing redundant state but
becomes expensive at scale — world position is needed every frame for
rendering, and every physics or distance query, so recomputing it via
chain-walking on every read multiplies that cost by however many times
it's read per tick. Computing it once per tick in `HierarchySystem` and
caching it in `WorldTransform` means every downstream reader (renderer,
WASM boundary, future systems) pays a single fixed cost regardless of
tree depth or how many times position is read that tick.

**set_parent/remove_parent own consistency.** The alternative was
leaving children-list maintenance to the caller — `HierarchyNode`'s own
doc comment originally described this as "the responsibility of the
code that modifies the hierarchy." We rejected that: unlike
`WorldTransform`, which self-heals every tick via `HierarchySystem`, a
`children` Vec has no recomputation step. If it drifts out of sync with
the `parent` field — an entity appearing in a parent's children without
that parent set as its own, or appearing in two parents' children at
once — nothing corrects it, and the resulting bug is silent until
something walks the tree and gets the wrong answer. Centralizing
consistency in `World` means there's exactly one place this invariant
can be violated, not every call site that ever reparents an entity.

**Cycle detection.** `set_parent` walks the ancestor chain upward from
the candidate parent, checking whether the entity being reparented
appears in it, before mutating anything. Without this, a caller could
construct a cycle (directly, or by reparenting an ancestor to its own
descendant), which would cause `HierarchySystem::propagate()`'s
recursion to loop forever. The check is bounded by tree depth, not
entity count, so it stays cheap even for large scenes. Validation runs
entirely before any mutation, so a rejected `set_parent` call leaves
the tree completely unchanged rather than partially updated.

**Cameras excluded from parenting.** Camera rigs (a camera mounted to a
moving vehicle or character) are a real future use case for this
platform, but nothing currently requires it, and adding it now would
mean deciding how camera controls' write-back path (ADR-022) interacts
with a parent transform — a design question with no immediate answer.
Leaving `get_camera_transform()` on `LocalTransform` for now is a
narrower, reversible decision than building that interaction
prematurely.

## Consequences
Entities can now be organized into parent/child trees, with world
position and rotation correctly composed through arbitrary depth.
`HierarchySystem` must run after `MovementSystem` each tick for
`WorldTransform` to reflect the current tick's movement rather than the
previous one — this ordering is a convention, not yet enforced by code
(tracked as existing technical debt, to be resolved by the future
Scheduler refactor referenced in `systems/mod.rs`).

Any future code that reads `WorldTransform` can trust it reflects the
current tick's state, without needing to know or care whether the
entity is a root or nested several levels deep.

`get_position()` in the WASM boundary now reads `WorldTransform`
instead of `LocalTransform`; `get_camera_transform()` intentionally
still reads `LocalTransform`. This asymmetry is deliberate (see
Reasoning above), not an oversight, and should be revisited if/when
camera parenting becomes a real requirement.

`set_parent`/`remove_parent` are exposed through the WASM boundary as
methods returning a `u8` status code (0 = success, 1 = entity not
found, 2 = would create a cycle) rather than a boolean, specifically so
the future Runtime Editor's Hierarchy panel (Phase 15) can give the
user a specific reason when a drag-and-drop reparent is rejected,
rather than only "it didn't work."
