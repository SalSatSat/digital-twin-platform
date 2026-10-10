# ADR-036: Engine Event Bus (Engine-Side Change Queue, Client Dispatcher)

## Status
Accepted

## Date
2026-10-09

## Context
Editor UI keeps itself in sync with the ECS by polling and by hand-wired
refresh counters:

- The Hierarchy panel re-reads `listEntityHierarchy()` on a 1 s interval
  (`EntityHierarchyPanel.tsx`), so a spawn, despawn or reparent is visible
  up to a second late and the full JSON is re-parsed when nothing changed.
- The transform gizmo re-reads the hierarchy on a 500 ms cadence
  (`transform-gizmo.ts`), so it can be stale after a reparent.
- The Inspector refreshes through a `transformRevision` counter bumped by
  `handleEntityTransformChanged` in `App.tsx`. That handler also fires for
  reparenting, so it carries two meanings.

The ECS is authoritative (the viewport renders snapshots only), so the
notification mechanism should come from the ECS and not from whichever
TypeScript wrapper happened to perform the call. The
README roadmap names `OnEntitySelected` as the headline event, but selection
is client state by design (ADR-033) and has no consumer outside React and the
renderer, which already receive it through props.

Unity's `ObjectChangeEvents` is the reference point. It delivers a stream of
change events recorded since the last frame (create/destroy hierarchy, change
parent, change object or component properties), identified by instance id,
and a destroyed object can no longer be resolved from its id. Consumers
re-read state rather than receive it in the event.

## Decision
Record API-driven entity changes in an engine-side queue, drain the queue
once per frame, and fan the events out through a typed client dispatcher.

1. **Where events are recorded.** In `EngineWorld` (the `engine/wasm` crate),
   not in `World`. Events carry `u32` handles, and the handle mapping
   (`entity_handles`) lives only in `EngineWorld`. Reflection writes also go
   through `get_component_mut` inside `reflection.rs`, which cannot be
   intercepted at `World` level; `EngineWorld::set_component_json` is their
   single choke point.

2. **What is recorded.** Only API-driven mutations that pass through
   `EngineWorld`:

   | Boundary call | Events |
   |---|---|
   | `spawn_dynamic_object`, `spawn_static_object`, `spawn_camera` | `EntitySpawned(h)` |
   | `despawn_entity` | `EntityDespawned(h)` for every despawned entity, children first (the list `World::despawn` returns; ADR-024 addendum) |
   | `set_parent`, `remove_parent` | `EntityReparented(h, old, new)` only if the parent actually changed; plus `ComponentChanged(h, LocalTransform)` when `world_position_stays` rewrote the local transform |
   | `set_world_transform` | `ComponentChanged(h, LocalTransform)` |
   | `set_camera_transform` | `ComponentChanged(h, LocalTransform)` (it bypasses the two paths above) |
   | `set_component_json` | `ComponentChanged(h, kind)` on success |

   System-driven writes are **not** recorded: `MovementSystem` (via
   `inner_mut`) and `HierarchySystem`'s `WorldTransform` write change every
   dynamic entity every tick, which would flood the queue. Continuous state
   stays snapshot-read. A future system that writes through `inner_mut` is
   invisible to the bus by the same rule. `set_active_camera` is not an ECS
   component change and has no consumer, so it is out of the initial set.

3. **Wire format.** `EngineWorld::drain_events()` returns a flat `Vec<u32>`
   (a `Uint32Array` in JavaScript) of fixed four-word records
   `[kind, handle, a, b]`, with `u32::MAX` meaning "none". Kinds:
   `EntitySpawned`, `EntityDespawned`, `EntityReparented` (a = old parent,
   b = new parent), `ComponentChanged` (a = component kind id), and
   `Resync`. Each `ComponentKind` gets a stable numeric id defined next to the
   enum, mirrored in TypeScript, and pinned by a WASM test, following the
   existing status-code convention at the boundary. Events carry ids only;
   consumers re-read state through the existing getters.

4. **Ordering and dedupe.** The stream is ordered. Handle slots are reused,
   so `EntityDespawned(h)` followed by `EntitySpawned(h)` within one frame is
   a real sequence and structural events are never coalesced. A
   `ComponentChanged(h, kind)` is dropped only if an identical record is
   already queued and no structural event for `h` has been queued since.

5. **Delivery.** `Engine.tick` drains once, after the WASM `tick`, copies the
   records out, then dispatches. A handler that mutates the engine therefore
   only enqueues events for the next frame; there is no re-entrancy into WASM
   during dispatch. Events recorded between frames (React handlers, gizmo
   writes, `SceneManager.update`) are delivered at the next `Engine.tick`.
   The engine records in both Editor and Runtime; consumers decide what to do
   with the events.

6. **Handler isolation.** `Engine.tick` runs inside the render loop's
   `try/catch`, which stops the loop on any throw. The dispatcher therefore
   catches and logs exceptions per handler, so a UI bug cannot stop rendering.

7. **Bounded queue.** The queue has a fixed capacity. On overflow it discards
   its contents and the next drain returns a single `Resync` record, which
   tells consumers to refetch a snapshot. Structural events are never silently
   dropped one by one, since that would corrupt consumers' view of handles.
   The same path covers a stopped render loop, which would otherwise let the
   queue grow without bound.

8. **Client dispatcher.** A typed dispatcher owned by `Engine`, exposed as
   `engine.events`, with batch delivery in the style of Unity's
   `ObjectChangeEvents.changesPublished`: `subscribe(handler)` returns an
   unsubscribe function, and each subscriber is called at most once per
   frame with that frame's ordered, decoded events (never for an empty
   frame). The engine drain is its first and, for now, only source. The
   dispatcher is designed to also accept client-originated events published
   by TypeScript code (a `publish` method), which is deferred until a
   consumer needs it: Phase 20 (GLB loading) is expected to publish asset
   lifecycle events there, since loaders run in the client, and this is the
   reason Phase 20 depends on this phase. Subscribing and unsubscribing
   during a dispatch take effect from the next dispatch, and a handler is
   never called after it has unsubscribed.

9. **Consumer contract.** Snapshot plus deltas. A consumer subscribes first
   and then fetches its snapshot, so no event falls in the gap. After
   `EntityDespawned(h)` a consumer must not read state for `h` until an
   `EntitySpawned(h)` arrives. On `Resync` or on engine re-creation it
   refetches. A consumer marks itself dirty on events and refetches at most once per dispatch batch, so a burst of structural events costs at most one refetch per frame.

10. **Selection stays off the bus.** `OnEntitySelected` is deferred. Its three
    consumers (Hierarchy panel, Inspector, gizmo) already receive selection
    through props (ADR-033), so adding it now would build a mechanism with no
    consumer. The trigger to revisit is the first consumer outside React and
    the renderer, for example a Console panel (Phase 29) or sync presence
    (Phase 28). If that happens, a client-published `SelectionChanged` event
    carrying the existing `Selection` shape fits the dispatcher without moving
    ownership.

## Reasoning
Putting the queue in the ECS layer keeps the ECS authoritative: a future
loader or script that mutates through `EngineWorld` is observed without every
call site remembering to publish. Recording at the boundary and not in `World`
follows the handle constraint above, and the existing boundary tests already
exercise exactly that layer.

Excluding system-driven writes is a design decision, not something Unity's
documentation states, but it matches the project rule that the viewport
renders snapshots and keeps the queue's volume proportional to user actions
and not to entity count.

Id-only events with a per-frame drain mirror Unity's model, avoid JSON
allocation on empty frames, and let consumers reuse the getters they already
have. Draining by return value, not by pushing a callback out of WASM, avoids
re-entrancy hazards across the boundary.

A client-only bus was the cheaper alternative, with the TypeScript `Engine`
wrappers publishing after each call. It was rejected because it would miss any
mutation not routed through those wrappers and would put the authority for
"what changed" outside the ECS.

## Consequences
Hierarchy refresh, the gizmo's hierarchy re-read and `transformRevision`
become event-driven, removing both polls and the overloaded
`handleEntityTransformChanged`. Live Inspector updates during a gizmo drag
become possible (the fields currently remount on a key change), but are a
follow-up and not part of the first migration.

New obligations: the TypeScript and Rust kind constants must stay in step
(pinned by a test); every new `EngineWorld` mutator must record its event
(a missing one is a stale-UI bug, so each is covered by a boundary test); and
systems that write through `inner_mut` are intentionally unobserved.

Migration is one consumer per commit, each verified in the browser: (1) queue,
drain and dispatcher with tests and no consumers, (2) Hierarchy panel,
(3) transform gizmo, (4) Inspector and removal of `transformRevision`.

## Addendum: Implementation Notes (2026-10-10)
Phase 19 shipped as decided, in the migration order above. What the
implementation added or corrected:

- **Prerequisite found while tracing mutation paths.** `World::despawn` did
  not unlink an entity from its parent or cascade to its children, so it was
  made hierarchy-aware first (ADR-024 addendum). It returns the despawned
  entities children first, which is the order of the despawn events, and
  `EngineWorld` frees every one of their handles and clears the active
  camera if it was among them.
- **Recording.** `EntitySpawned` is recorded once, in
  `EngineWorld::allocate_handle`, the single path every spawn takes.
  `ComponentKind::id()` returns explicit values, and both the Rust values and
  the TypeScript mirror are pinned by tests.
- **Consumers.** `events.ts` holds the per-batch predicates
  (`affectsHierarchy`, `affectsEntityListing`, `affectsEntity`,
  `affectsComponent`). The gizmo keeps its ancestor map in `ParentMap`, which
  events mark dirty and which is no longer re-read when the selection
  changes. Inspector fields read through `useSyncExternalStore` and refresh
  in place. Remounting on `componentChanged` was rejected: a field's own
  debounced write echoes back as an event, and a remount would steal focus
  mid-typing. A queued local edit wins over external refreshes.
  `transformRevision`, `onReparented` and the gizmo's commit hook were
  removed.
- **Boundary respawn is now in place** (`respawn.ts`). The event stream
  exposed that despawn-then-spawn destroyed an entity's children through the
  cascade and left their meshes in the viewport. The entity now keeps its
  handle, id and children, and its world pose and velocity are written
  instead. Only entities spawned dynamic respawn, as the old doc comment
  claimed (a static entity past the boundary used to be recreated as a
  moving one). The reset velocity (1, 0, 0) is kept for parity and ignores
  the velocity the scene defined for the entity, a pre-existing quirk.
- **Measured in the browser.** An idle scene and Runtime movement emit no
  events. A gizmo drag or camera orbit emits at most one `componentChanged`
  per frame. The Hierarchy panel refetches on load, rename and reparent, and
  not on idle, gizmo drag or orbit.
- **Still deferred.** Client-published events (`publish`, Phase 20) and
  `OnEntitySelected`, per decisions 8 and 10. Selection is still pruned on
  engine-ready and mode toggle, not on `EntityDespawned`. `SceneManager`
  drops entities that vanish by polling `getPosition` and does not remove
  their meshes; that path is reachable only by a despawn it did not
  initiate, which no code does today. Use `EntityDespawned` there when a
  delete-entity UI or Phase 20 unloading needs it.
