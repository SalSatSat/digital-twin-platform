# ADR-029: Editor/Runtime Camera Context Selection

## Status
Accepted

## Date
2026-08-29

## Context
`CameraBundle::perspective`/`orthographic` already tagged cameras with a
context (`"Editor"`, `"Runtime"`, `"Universal"`) via `EntityInfo.contexts`,
and `DEFAULT_SCENE` already spawned one of each — but nothing in the
renderer used context for anything. `SceneManager` selected exactly one
active camera globally via a single `isActive` boolean (client-side, set
once at scene load), used for both controls attachment and what got
rendered — so entering and exiting edit mode always showed the same
camera, with no way to see the Runtime Camera's actual viewpoint.
Separately, `CameraControls` wrote the Three.js camera's current transform
back to the ECS unconditionally every frame, so an Inspector edit to a
camera's position/rotation would be overwritten by the controller's own
stale-value writeback on the very next frame — the same race shape as the
pre-Phase-14 velocity-overwrite bug, direction-reversed.

## Decision
Replace `isActive`-only camera selection with context-based selection.
`SpawnedCamera` now carries its `context`. `Renderer.editMode` (ADR-028)
decides whether the `"Editor"` or `"Runtime"` context is requested;
`SceneManager.getActiveCamera(context)` resolves that to a specific
camera, falling back to a `"Universal"`-context camera if no exact match
exists. `isActive` is retained, but rescoped as the tie-breaker among
multiple cameras sharing the same context, rather than a single global
selector. Separately, `CameraControls` no longer writes back to the ECS
unconditionally each frame — a dirty flag, set only when user input
(look/pan/orbit/zoom/fly) actually mutates the camera, gates the
writeback.

## Reasoning
Context-based selection was chosen over inventing a new mechanism because
the context data already existed in `EntityInfo` and was already spawned
correctly — the gap was purely that nothing downstream read it. Falling
back to `"Universal"` mirrors `EntityInfo.contexts`'s own doc comment
(`"Universal — active in both contexts"`), so the renderer matches what
the data model already promises. Keeping `isActive` as a same-context
tie-breaker, rather than removing it, gives it a real forward-looking
purpose: a future scene with multiple Runtime cameras can use it to pick
which one renders, without a second mechanism needing to be invented.

The writeback race fix uses a dirty flag rather than, e.g., suppressing
writeback while any Inspector field is focused — an alternative
considered and rejected because it would require `CameraControls` to know
about Inspector UI state, crossing a layer boundary the project has
otherwise kept strict (Renderer/SceneManager have no knowledge of React
component state). A dirty flag confined entirely to `CameraControls`'s own
input-handling logic needed no new cross-layer awareness.

## Consequences
Enables toggling between Editor and Runtime viewpoints to actually show
different, correct cameras, and enables Inspector edits to a camera's
transform to actually stick rather than being raced by the controller.
Establishes context as the mechanism any future multi-camera or
multi-context feature (e.g. Preview mode, split-screen) should extend,
rather than adding parallel ad hoc flags.

Constrains: `EntityHierarchyNode` gained a `contexts` field (previously
`handle`/`parent_handle`/`name` only) so the Hierarchy panel could filter
Editor-context entities out of the tree. Any future entity classification
that needs to reach the Inspector/Hierarchy will likely need the same
explicit "surface it through the WASM boundary" treatment — nothing is
exposed there by default.
