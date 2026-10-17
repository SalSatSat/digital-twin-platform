# ADR-037: Component Add/Remove at the Engine Boundary

## Status
Accepted

## Date
2026-10-11

## Context
An entity's component set is fixed when it spawns: its bundle decides.
Reflection can only overwrite a component that is already present
(`velocity_from_json` returns `ComponentNotPresent` otherwise), and
`World::add_component` / `remove_component` are not reachable from the WASM
boundary.

Phase 20b adds `Mesh` and `Material`, which an entity may or may not have (an
entity without a `Mesh` is not drawn, like a Unity empty), and the bundles
will not spawn with a default `Mesh`. Phase 20a also adds an Inspector "Add
Component" and remove action. Both need the component set to change after
spawn.

Two things currently assume it cannot:

- ADR-036's consumer contract. `affectsEntity` reacts to a spawn, despawn or
  resync of a handle, which is the only way the set could change today.
- `SceneManager` fixes an entity's `dynamic` flag at spawn. `respawnInPlace`
  writes `Velocity` and throws `ReflectionError` if the entity has none, and
  `SceneManager.update` runs inside the render loop, whose `try/catch` stops
  rendering on any throw (ADR-036 decision 6). A removable `Velocity` would
  turn a stale flag into a stopped viewport.

`MovementSystem` already treats an entity without `Velocity` as stationary, so
removing it is well defined.

## Decision
Expose component add and remove at the `EngineWorld` boundary, restricted to
components that are optional by design, and report both through the event bus.

1. **Optional components.** `ComponentDescriptor` gets an `optional` flag.
   Only optional components can be added or removed. Initially that is
   `Velocity`. `LocalTransform`, `Camera` and `EntityInfo` are mandatory:
   bundle invariants and systems rely on them, and `HierarchyNode` and
   `WorldTransform` are not reflectable at all. `Mesh` and `Material` will be
   registered as optional in Phase 20b.

2. **Boundary calls.** `add_component_json(handle, kind, json)` and
   `remove_component(handle, kind)`, both returning `Option<String>` (`None`
   on success, a message otherwise), the same convention as
   `set_component_json`. The semantics are strict: adding a component the
   entity already has fails ("already present"), removing one it lacks fails,
   and a mandatory kind fails ("cannot be added" / "cannot be removed").
   Unknown handle, unknown kind and invalid JSON report the same messages as
   `set_component_json`. A rejected call records no event.

3. **Defaults.** `add_component_json` takes the component's full wire JSON, the
   same shape `get_component_json` returns. A static
   `default_component_json(kind)` returns the default wire JSON for an
   optional kind (or nothing for others), so the Inspector asks the engine for
   defaults and keeps no client-side copy.

4. **Events.** Two new record kinds, `ComponentAdded = 5` and
   `ComponentRemoved = 6`, with the component id in `a` and `b` unused
   (ADR-036 decision 3). They are recorded only on success. An add does not
   also record `ComponentChanged` for the initial value: the consumer reads
   the component after `ComponentAdded`.

5. **Dedupe.** Both kinds are barriers for their handle exactly as structural
   events are: a queued `ComponentChanged(h, c)` is never collapsed with one
   recorded after an add or remove for `h`. The queue's existing scan already
   behaves this way (it stops at any record for the handle that is not a
   `ComponentChanged`), so no queue logic changes; tests pin it.

6. **Client.** `decodeEvents` produces `componentAdded` and `componentRemoved`
   with `handle` and `component`. They are not hierarchy events:
   `affectsHierarchy` and `affectsEntityListing` are unchanged. `affectsEntity`
   is true for them on the same handle, and so is `affectsComponent`. An
   unknown component id still decodes to `resync`.

7. **Consumer contract.** After `componentRemoved(h, c)` a consumer must not
   read `c` for `h` until a `componentAdded(h, c)` arrives. `SceneManager`
   stops fixing `dynamic` at spawn and derives it from whether the entity has
   `Velocity`, kept current by these events, so the respawn path can never
   write a `Velocity` the entity lacks.

## Reasoning
Unity's object-change stream reports a component being added or removed as a
single coarse structure-change event (from memory, not doc-verified here). Two
kinds with a component id were chosen instead because the Phase 20b mesh
manager must know which component changed without re-listing the entity, and
the wire format already has a free word for it.

Strict semantics keep every call's outcome unambiguous and consistent with
`ComponentNotPresent`. An idempotent add would hide a caller that believes the
component is absent. One `optional` flag is enough until a component needs to
be add-only or remove-only.

Rejected alternatives:

- Reusing `ComponentChanged` for add and remove: consumers could not tell a
  value change from a set change, and the contract in decision 7 would have no
  event to hang on.
- Spawn variants per component combination (a bundle per visual): the spawn
  functions already need a clippy `too_many_arguments` allowance, and the set
  of combinations grows with every optional component.
- Letting reflection create a missing component on write: it would make every
  write path a possible structural change and hide it from the event record.

## Consequences
A new optional component needs a descriptor entry with `optional: true`, a
stable id (pinned by a test, as in ADR-036), and a default wire JSON. Every
new `EngineWorld` mutator must still record its event.

Removing `Velocity` makes an entity stationary through `MovementSystem`'s
query, and adding it makes the entity move again. The Inspector's Add and
Remove actions arrive in the same phase as this API, so it has a real consumer
and a browser check from the start.


## Addendum: Implementation Notes (2026-10-17)
Phase 20a shipped as decided, in this order: reflection, the `EngineWorld`
calls and events, the client decoder and wrappers, the respawn guard, then
the Inspector. What the implementation added or changed:

- **Decision 1: the flag is a type, not a bool.** The descriptor's `optional`
  field is an `Option<OptionalOps>` holding `add_from_json`, `remove` and
  `default_json`, with `is_optional()` on top. A mandatory descriptor cannot
  carry add or remove functions, and an optional one cannot lack them. The
  strict checks live once, in `reflection::add_component` and
  `remove_component`, in this order: the entity exists, the kind is optional,
  the entity does not already have the component (or does have it, for a
  remove), then the component converts the JSON. A mandatory kind reports
  "cannot be added" even when the entity has it.
- **The Inspector learns what is optional from the registry.** The ADR did
  not say how. `ComponentKindInfo`, the `list_component_kinds` payload,
  gained `optional`, and `parseComponentKinds` throws on a payload without
  it. That is what a stale WASM binding looks like, and a loud error beats
  an Inspector that silently lacks its Add button.
- **Decision 3: defaults.** `default_component_json` is a static on
  `EngineWorld`. The `Velocity` default is serialized by the same path as
  `get_component_json`, so it cannot drift from the wire shape. A test
  requires every optional kind's default to be accepted by its own add,
  which is the guard for Phase 20b.
- **Decision 6: predicates.** `affectsEntity` is true for an add or remove
  of any component on the handle, since the set changed. `affectsComponent`
  is true only for the exact handle and component, so an add or remove of
  another component does not refresh it. Neither kind affects
  `affectsHierarchy` or `affectsEntityListing`; tests pin both.
- **Decision 7 changed: there is no `dynamic` flag.** Deriving it from
  events would have needed a subscription, a re-derive on resync and
  cleanup on dispose, all to keep a cached copy of ECS state. Instead
  `respawnInPlace` asks the engine whether the entity has a `Velocity` at
  the point of the write, and returns false without writing when it has
  none. `SceneManager` respawns only when it returns true. The ECS stays
  the one source of truth however an entity got or lost its `Velocity`, and
  the guard is unit-tested in `respawn.ts`. This supersedes ADR-036's note
  that only entities spawned dynamic respawn: any entity with a `Velocity`
  does now. A static entity placed beyond the boundary costs one engine
  query per frame in Runtime; moving ones respawn on the first.
- **Inspector.** An Add Component button lists the optional kinds the
  entity lacks and adds the engine's default. Optional sections have a
  remove control and mandatory ones do not. There is no confirmation,
  because there is no undo yet and removing `Velocity` loses three numbers.
  The engine's rejection message shows inline, tied to the selected entity.
  The logic is in `component-edit.ts`, a WASM-free renderer module, because
  `client/app` has no test runner; `ReflectionError` moved to its own file
  for the same reason.
- **Checked in the browser.** Adding `Velocity` to a static entity, giving
  it a velocity and running it; removing it while running; re-adding it.
- **Still deferred.** Undo for removal. A UI test harness for `client/app`.
  Keeping an entity's velocity across a respawn: the reset to (1, 0, 0)
  predates this ADR, but any entity a user gives a `Velocity` now loses
  the velocity it was given at its first respawn. `Mesh` and `Material`
  (Phase 20b) register as optional, each with a default.
