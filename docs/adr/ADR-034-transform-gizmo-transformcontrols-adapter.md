# ADR-034: Transform Gizmo — Adopt Three.js TransformControls Behind an Adapter

## Status
Accepted

## Date
2026-10-03

## Context
Phase 18 adds a draggable gizmo for direct position/rotation manipulation of
the selected entity in the viewport. ADR-033 already designates
`selection.primary` as the gizmo's attach target and defers multi-drag, so the
gizmo acts on one entity at a time. Two options were considered: building a
custom gizmo, or adopting `TransformControls` from `three/addons`.

Four properties of this codebase shape the choice. The ECS is the source of
truth, so a gizmo that mutates a Three.js object directly cannot be the
authority. `LocalTransform` holds position and rotation only — there is no
scale — so only translate and rotate apply. Entity meshes are added directly
under the scene root, and `SceneManager.update` rewrites each mesh's position
and rotation from the ECS `WorldTransform` every frame, including in edit mode.
And ADR-031 requires any custom-shaded material to be written twice (GLSL and
TSL), which a gizmo made of stock materials avoids entirely.

## Decision
Use `TransformControls` from `three/addons/controls/TransformControls.js`,
wrapped in a `TransformGizmo` adapter class (`client/renderer/src/gizmo/
transform-gizmo.ts`) owned by `Renderer`, alongside the grid and view gizmo.
`SceneManager` exposes the mesh for a given entity handle.

The adapter attaches the controls to the mesh of `selection.primary` in edit
mode only, resolving the mesh by handle each frame and detaching if it no
longer exists. It assigns the active Editor camera to the controls every frame,
so a projection change that rebuilds the Three.js camera (ADR-032) is picked up.
Only translate and rotate modes are exposed, in world space.

The ECS stays authoritative. On the controls' `objectChange` event the adapter
converts the mesh's world transform into a `LocalTransform` and writes it
through `Engine.setComponentJson`, the same path the Inspector uses. For child
entities it composes the inverse of the parent's world transform, captured once
at drag start. The next frame's `SceneManager.update` then renders the written
value. No Rust or WASM change is needed.

Input arbitration is the adapter's responsibility: a pointer-down while Alt is
held must not start a gizmo drag (Alt+left orbits the camera); a pointer-down on
a handle must not arm a viewport pick; and mode hotkeys must be ignored while
the camera's right-mouse fly mode is active.

## Reasoning
`TransformControls` is a scene object built from stock `MeshBasicMaterial` and
`LineBasicMaterial` with `depthTest: false`, so it needs no custom shader and
no second implementation per backend. Unlike `ViewHelper`, which ADR-032
rejected for lacking required features and forcing a shared-viewport render
path, it does the whole job and needs no change to `RenderBackend`. It also
supplies the parts that dominate a custom build: axis and plane handles,
rotation rings, screen-constant sizing for both perspective and orthographic
cameras, and pointer capture during drags.

A spike attached it to one entity's mesh without any ECS wiring. On both the
WebGPU path and the classic WebGL path (`/editor?webgl`) the handles rendered
on top of scene geometry, highlighted on hover, entered and left the dragging
state, switched to rotate mode, kept a constant screen size while orbiting and
zooming, and kept working after toggling to an orthographic camera, with no
console errors or warnings. Dragging produced no visible movement, which is the
expected result: the per-frame ECS sync overwrites the mesh before rendering,
and the library computes translation from values captured at drag start rather
than from the mesh's current position, so that overwrite does not corrupt the
drag. Alt+left-drag on a handle orbited the camera, which confirms the Alt
arbitration above is required.

A custom gizmo was not chosen because it would need the same adapter to the ECS
and the same world-to-local conversion, plus the handle geometry, hit-testing,
drag math, and screen-space scaling, for no capability this phase needs.

## Consequences
Keeps gizmo visuals and drag math in a maintained library at the cost of
coupling to the r177 addon's API and having limited control over its look; a
Three.js upgrade may require adapter changes. The mesh is never authoritative,
so any other transform-editing surface must write through the same
`setComponentJson` path.

Several points follow from reading the code and were not observed, so the
implementation must verify them in the browser: that a plain click on a handle
over empty space does not clear the selection once pick arming is suppressed;
that the Alt-held disable works given the order in which listeners fire on the
canvas; that the Euler conversion matches the engine's intrinsic XYZ order
(`LocalTransformView`, `EulerRot::XYZ`) so a rotation drag round-trips against
the Inspector's values; and that the parent handle needed for the child-entity
conversion is available from the engine's hierarchy export.

The gizmo is independent of Phase 21's selection outline. Phase 19's Event Bus
may later emit transform-change events from the adapter's write path.
