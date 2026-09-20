# ADR-032: Editor Camera Orthographic Support and View Gizmo

## Status
Accepted

## Date
2026-09-20

## Context
Phase 16 had two coupled requirements: (1) `SceneManager` only ever
constructed `THREE.PerspectiveCamera`, even though the ECS's
`CameraComponent` already modeled a full `ProjectionType::Orthographic`
variant and the Inspector's `CameraField.tsx` already let you edit it
— flipping that dropdown had zero visual effect; and (2) a Unity-style
view-orientation gizmo to snap the Editor camera to axis-aligned
presets and toggle its projection, per this phase's roadmap entry.

Three.js ships a built-in equivalent, `ViewHelper`
(`three/addons/helpers/ViewHelper.js`), which was evaluated before
building custom (see Reasoning). It was rejected: it has no center
cube, no Perspective/Orthographic toggle, and no bottom-center
Persp/Ortho/Iso label — all required by this project's spec — and it
renders into the *same* canvas/renderer as the main scene via a
viewport/scissor rectangle, which would mean unwinding the
separate-canvas architecture below just to get a component that still
needed all three features bolted on anyway.

## Decision
**Orthographic wiring:** `SceneManager` now reads a camera's full
`projection` (via `Engine.getComponentJson(handle, "Camera")` — the
same reflection endpoint the Inspector already writes through, no new
Rust/WASM surface) instead of just `getCameraFov()`, and constructs
either a `THREE.PerspectiveCamera` or `THREE.OrthographicCamera` to
match, using the ECS's actual `near`/`far` rather than the previous
hardcoded `0.1`/`1000`. This JSON is re-read every frame (a cheap
string compare against the last-seen value) so an Inspector edit
switching projection mid-session rebuilds the Three.js camera live,
copying over position/quaternion so there's no visible jump, and
re-pointing `CameraControls` at the new object if it was the one being
driven. `onResize()` branches per camera type — perspective updates
`aspect`; orthographic recomputes `left`/`right` from the current
half-height (`top`) times aspect.

**View gizmo:** A second, fully independent `<canvas>` (created by
`EngineView.tsx`, matching how the main canvas is already owned by
React rather than synthesized by `Renderer`) with its own
`ViewGizmo` class — a small scene with a center cube (click to flip
Perspective/Orthographic) and six axis pins (click to tween the
Editor camera to that preset), plus a bottom-center label showing
`Persp` / a matched preset name / `Iso`. The tween itself is a
separate, reusable `CameraTween` class (pure position/quaternion
interpolation, no Three.js scene or ECS coupling) — `SceneManager`
drives it each frame, writing the interpolated transform back through
`Engine.setCameraTransform` the same way `CameraControls` does.

Toggling projection reuses the Inspector's exact write path
(`Engine.setComponentJson(handle, "Camera", json)`); since
`CameraComponent`'s only field is `projection` (see `camera.rs`), this
JSON is always the complete component, and the live per-frame
projection-poll already added for the Inspector case picks up the
gizmo's write with no additional wiring.

## Reasoning
**Separate canvas over shared-viewport (ADR-031's Option A vs. B, from
this phase's scoping discussion):** `ViewHelper` proves the
shared-viewport approach works, but it would mean extending
`RenderBackend`'s interface with a windowed-render method, implemented
in both `WebGLBackend` and `WebGPUBackend`. A second canvas needed no
`RenderBackend` change at all, at the cost of managing a second
renderer instance. Given the gizmo's materials are flat/unlit and
don't need custom shaders, isolation was judged the lower-risk,
smaller-footprint choice — and, notably, this sidesteps ADR-031's
dual-material (GLSL+TSL) requirement entirely, despite that ADR's own
Consequences section predicting Phase 16 would need it.

**Look-at target is the world origin, not a real focus point:**
`CameraControls`'s own Alt-orbit already hardcodes `orbitTarget` to
`(0, 0, 0)` with nothing currently moving it, and there's no
selection/focus-point concept anywhere else in the project yet — so
the gizmo's presets stay consistent with existing orbit behavior
rather than inventing a second convention. `computePresetTransform`
takes the target as an implicit constant rather than a parameter
threaded through, specifically so wiring in a real focus point later
(once selection exists) is a small, localized change.

**Aligned-view label is decoupled from projection mode:** Unity only
shows an aligned view's name while in Orthographic mode, falling back
to generic "Persp" text at any Perspective orientation. This project
deliberately diverges: `matchPreset()` reports an exact axis match
regardless of projection, so clicking a pin always updates the label
to that view's name immediately, whether or not the camera happens to
be in Perspective — a explicit product decision, not an oversight.

**Pin visibility during an aligned view:** once the camera exactly
matches a preset, the two pins along the axis now being looked
straight down are hidden (they'd otherwise foreshorten to a point
behind the cube anyway), leaving only the four pins in the
perpendicular plane. `AXIS_PAIR` in `view-gizmo.ts` maps each preset to
the pair sharing its axis for this purpose.

**Exact-match epsilon, not perceptual tolerance:** `matchPreset`'s
`EXACT_MATCH_EPSILON` (`1e-4`) exists purely to absorb floating-point
noise from a quaternion's round-trip through the ECS (stored as f32),
not to forgive a genuinely off-axis camera — "Iso" is meant to trigger
on any real rotation away from an axis-aligned view, however small.

## Consequences
Any future feature needing a "snap the camera to a computed transform,
smoothly" behavior (not just the gizmo) can reuse `CameraTween`
directly — it has no dependency on the gizmo or on axis presets.

The gizmo's own renderer was changed during implementation from a
plain `THREE.WebGLRenderer` to `THREE.WebGPURenderer` (from the same
`three/webgpu` entry point already used everywhere else in this
codebase, which auto-falls-back to WebGL2 when WebGPU isn't
available). `WebGPURenderer` requires an awaited `.init()` before its
first `render()`. The initial implementation omitted this and relied
on Three.js's internal fallback (r177: `render()` before init logs
`THREE.Renderer: .render() called before the backend is initialized`
and defers to `renderAsync()`), which rendered correctly but warned in
the console. Resolved: `ViewGizmo.initialize()` awaits
`renderer.init()`, and `Renderer.initialize()` awaits it alongside
`backend.initialize()`, so the render loop never starts before the
gizmo is ready — the same contract `WebGPUBackend` already follows.
`ViewGizmo.dispose()` skips `renderer.dispose()` if init never
completed, also mirroring `WebGPUBackend`.

The gizmo's positive X and Z pin colors are read directly from
`GRID_CONFIG.xAxisColor`/`zAxisColor` (`grid-config.ts`), so they
cannot drift from the grid's origin-axis lines. Only the Y pin color
(`Y_AXIS_COLOR` in `view-gizmo.ts`) is gizmo-local, since the
ground-plane grid has no vertical axis line to share it with; the
achromatic negative-pin and cube colors are likewise gizmo-only by
design. If the grid ever gains a Y axis line, or an editor theme
system is introduced, `Y_AXIS_COLOR` is the one constant to move into
shared config.
