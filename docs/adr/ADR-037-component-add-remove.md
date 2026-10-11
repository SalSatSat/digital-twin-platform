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
