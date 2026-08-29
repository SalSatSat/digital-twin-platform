# ADR-028: Edit-Mode Simulation Pause

## Status
Accepted

## Date
2026-08-29

## Context
Phase 13 established the Inspector, but its edits didn't visibly affect the
running simulation. `MovementSystem` runs every tick unconditionally,
applying `Velocity` to `LocalTransform` regardless of whether the editor is
open, so any position edit the Inspector makes gets overwritten on the very
next simulation tick. Phase 14 needed a way to pause simulation while
editing, without also freezing camera navigation — Unity's Edit mode keeps
the scene camera live while paused, and that's the explicit UX reference
point for this project's editor.

## Decision
Add a client-side edit-mode flag on `Renderer` (`setEditMode`). While true,
the render loop's simulation `delta_time` is forced to `0`
(`this.engine.tick(0)`), while `SceneManager.update()` (mesh sync, camera
controls) continues to receive the real per-frame `delta_time`. No changes
were made on the Rust/WASM side — freezing is achieved entirely by not
advancing simulation time, not by adding a pause concept inside the ECS.

## Reasoning
Freezing at the JS boundary rather than inside Rust means `MovementSystem`/
`HierarchySystem`'s logic and existing tests are untouched — "pause" isn't
a new system state, it's just "the world was ticked with zero elapsed
time," a value the systems already handle correctly. Scoping the freeze to
only the `engine.tick()` call, not the whole render loop, was chosen
specifically to preserve Unity parity: the scene camera should fly freely
while the simulation is paused.

An alternative considered: a boolean `paused` field inside `EngineWorld`
itself, checked at the top of `tick()`. Rejected because it would require
a getter/setter across the WASM boundary for a concept that's purely about
the JS render loop's timing input — the ECS doesn't need to know it's
"paused," it only ever sees `delta_time`, and zero `delta_time` is already
a meaningful value for any reason (e.g. a genuinely stalled frame).

## Consequences
Enables the entire Phase 14 feature set — no rotation, velocity, or
hierarchy edit could persist without this. Establishes the edit-mode
boolean on `Renderer` as the mechanism any future pause-dependent feature
should read from, rather than reintroducing a separate pause concept
elsewhere.

Constrains: any future system added to `World` that should also respect
edit-mode pausing must be invoked from inside the same `delta_time`-gated
`tick()` path — a system invoked from anywhere else (e.g. directly from a
UI event handler) would need its own explicit check, since the pause is
purely a function of what `delta_time` value reaches `engine.tick()`, not
a globally observable flag.
