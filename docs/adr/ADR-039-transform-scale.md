# ADR-039: Transform Scale

## Status
Accepted. Decisions 5 and 6 amended before implementation (rotation
formula, reparent atomicity, status codes).

## Date
2026-11-09

## Context
`LocalTransform` and `WorldTransform` are a position and a rotation. There is no
scale anywhere in the engine, so ADR-038 had to put each primitive's size in
`Mesh` (`Box { size }`, `Sphere { radius }`, ...), and the transform gizmo
offers only translate and rotate (ADR-034).

Phase 20c adds scale to the transform, so one mechanism sizes everything an
entity draws, as in Unity, and a scale mode to the gizmo. Phase 20d (GLB
models) builds on it, so the transform path has to be final before models
arrive.

Three things in the current code do not survive non-uniform scale:

- `WorldTransform::compose` and `relative_to` are exact inverses of each other
  only because a position and a rotation compose to a position and a rotation.
  A rotated child under a parent scaled `(2, 1, 1)` is sheared, and no
  position-rotation-scale triple represents a shear.
- `World::set_world_transform` builds a fresh `LocalTransform` from the
  requested pose. With a scale field, that would silently reset the scale.
- The renderer copies a world position and a world quaternion onto each
  visual (`MeshManager.syncTransforms`). A position and a quaternion cannot
  carry scale, let alone shear.

## Decision
`LocalTransform` gains a non-uniform `scale`. The engine's world transform
becomes an exact affine matrix, and the renderer draws from that matrix.
Primitives lose their size parameters. The gizmo gains a scale mode that writes
local scale only.

1. **The component.** `LocalTransform { position, rotation, scale: Vec3 }`.
   `scale` defaults to `Vec3::ONE`. `LocalTransform::new(position)` keeps
   giving a scale of one, and a `with_scale` builder joins `with_rotation`.

2. **Validation.** Every axis of `scale` must be finite and non-zero. Negative
   values are allowed and mirror the entity along that axis. The message names
   the axis: `LocalTransform scale.y must be a finite, non-zero number (got 0)`.
   A rejected value is never replaced with 1. The Inspector shows the error and
   the field goes back to the engine's value, as a rejected `Mesh` dimension
   did in Phase 20b. A gizmo drag that would produce a zero axis skips that
   frame's write.

3. **The world transform is an affine matrix.** `WorldTransform` holds a glam
   `Affine3A`. `compose` is `parent * local`. `HierarchySystem` and
   `computed_world_transform` keep their structure and compose matrices
   instead. Readers get the parts through accessors:
   - `position()` is exact (the translation column).
   - `rotation()` and `lossy_scale()` come from glam's decomposition. They are
     exact without shear and approximate under it, like Unity's `lossyScale`.
     `rotation()` is normalised, because under shear the decomposed
     quaternion is not unit length. With a negative determinant, glam puts
     the mirror on X: a scale of `(1, -1, 1)` decomposes as `(-1, 1, 1)` and
     a half turn about Z. A test pins this.

4. **The renderer reads one matrix.** A new `EngineWorld::get_world_matrix`
   returns 16 floats in column-major order, which is the order
   `THREE.Matrix4.fromArray` reads. `MeshManager` sets each visual's
   `matrix`, sets `matrixAutoUpdate = false` and sets
   `matrixWorldNeedsUpdate`. That is one WASM call per visual per frame
   instead of `getPosition` plus `getRotation`. `get_position` and
   `get_rotation` remain for the gizmo, respawn and cameras, and are derived
   from the matrix. Cameras ignore scale.

5. **World-pose writes keep the local scale.** `set_world_transform(position,
   rotation)`, used by the gizmo and respawn, changes only the local position
   and rotation:
   - local position = inverse parent matrix × position, which is exact;
   - local rotation = the rotation part of
     `P⁻¹ · R(rotation) · S_world · S_local⁻¹`, orthonormalised, where `P` is
     the parent's world matrix, `S_world` the entity's current lossy world
     scale and `S_local` its local scale. Writing back an unchanged pose is
     exact, even under a mirrored or negatively scaled parent. The result is
     approximate only when the requested pose is unreachable with the kept
     local scale (a rotated child under a non-uniformly scaled parent);
   - the local scale is left as it is.

   `WorldTransform::local_for` implements this, and replaces `relative_to`.

   If the result is not finite (a degenerate ancestor, for example scales that
   underflow), the write is rejected with a new
   `HierarchyError::DegenerateTransform` and nothing is written. At the WASM
   boundary that variant is status code 3 in every method that can return it
   (`set_world_transform`, and `set_parent` and `remove_parent` with world
   position kept), and `Engine` maps it to its own message.

6. **Reparenting keeps the world scale.** `set_parent_keep_world` and
   `remove_parent_keep_world` (Unity's `worldPositionStays`) also set the
   child's local scale to its lossy world scale divided by the new parent's
   lossy world scale, axis by axis. The rotation uses the formula in decision
   5 with that scale. This is exact for uniform scales of either sign and for
   mirrors, and approximate under rotation combined with non-uniform scale,
   as in Unity.

   Both stay atomic: existence, cycle and degeneracy are checked, and the new
   local is computed, before the hierarchy changes. A `DegenerateTransform`
   leaves both the hierarchy and the transform untouched.

7. **A local-scale write path.** `EngineWorld::set_local_scale(handle,
   &[f32])` returns a status code: 0 for success, 1 for entity not found, 2
   for a malformed or invalid scale (including zero). It records
   `ComponentChanged(LocalTransform)`, as `set_world_transform` does today.
   `EngineWorld::get_local_scale(handle)` reads it back. The gizmo uses these
   instead of `setComponentJson`, because a full `LocalTransform` write would
   round-trip the rotation through Euler degrees on every drag frame.

8. **Wire shape.** `LocalTransformView` gains a required `scale: [x, y, z]`.
   It is strict like every other field. The Inspector always writes the full
   view it read.

9. **The scale gizmo.**
   - TransformControls' `"scale"` mode on **R**, next to **W** (translate) and
     **E** (rotate).
   - TransformControls scales in local space only. In scale mode the proxy
     takes the world rotation of `selection.primary` (ADR-033), so a single
     selection's handles line up with its own axes.
   - Each target scales about its own origin. Positions do not change (Unity's
     Pivot mode).
   - For each target, local scale = local scale at drag start × the proxy's
     per-axis factor. Values come from the drag-start snapshot, so repeated
     writes never accumulate. In a multi-selection whose entities face
     different ways, each entity's own local axis gets the same factor.
   - This differs from rotate, which turns a multi-selection rigidly about a
     shared pivot. The difference is deliberate (see Reasoning).

10. **Primitives lose their parameters.** `MeshShape` becomes `Box {}`,
    `Sphere {}`, `Cylinder {}` and `Plane {}` with fixed geometry at the
    ADR-038 defaults: a cube of side 1, a sphere of diameter 1, a cylinder of
    diameter 1 and height 2 along local Y, and a 10 × 10 plane in local XZ
    facing +Y. These match Unity's primitives. On the wire they are
    `{"shape":{"Box":{}}}`. Empty struct variants keep the externally tagged
    object form, so `parseMesh` keeps one shape and Phase 20d's `Model { key }`
    fits beside them. Dimension validation goes, and so do the Inspector's size
    rows and their helpers. The variant mechanism (`component_variants_json`)
    stays for 20d.

11. **Scene definitions.** Entity definitions gain an optional typed `scale`
    beside `position`, defaulting to `[1, 1, 1]`. `SceneManager` writes it
    through `set_local_scale` after the spawn. The demo cubes use 0.8, so they
    keep their size. `LocalTransform` cannot go in `components`, because that
    map is applied with `addComponentJson` and `LocalTransform` is mandatory.

12. **The Inspector.** `LocalTransformField` gains a Scale row of three number
    fields. There is no proportional-lock toggle yet.

## Reasoning
**An affine world transform over a position-rotation-scale triple.** A
composed triple with component-wise scale is what Unity shows as `lossyScale`.
It is cheap, but it renders a non-uniformly scaled hierarchy wrongly, because
the shear is simply lost. An affine matrix is exact for drawing, and Bevy's
`GlobalTransform` does the same. The approximation moves to the places that
write back a world pose (decisions 5 and 6), which is where Unity has it too.
Rendering is never approximate.

**The world-write rotation solves against the full matrix.** The first
draft of decision 5 took the inverse of the parent's decomposed rotation
times the requested rotation. glam reports any mirror on X and folds the rest
into the rotation, so under a parent scaled `(-1, 1, 1)` that formula turned
a child 90° about Y by a further 180° on a no-op write. The translate gizmo
writes the pose every drag frame, so the child would spin. Solving
`P⁻¹ · R · S_world · S_local⁻¹` uses the same decomposition on both sides,
reduces to the first formula when nothing is scaled, and costs no extra
hierarchy walk.

**Scale is authored only locally.** A world-scale setter would have to invert a
possibly sheared parent, and the result has no exact answer. Unity exposes
`localScale` as writable and `lossyScale` as read-only for the same reason.

**Zero is rejected, not coerced to 1.** Validation at the reflection boundary
rejects and explains. It never rewrites input (ADR-038 decision 4). A typed 0
that silently became 1, or a gizmo drag that snapped to 1, would surprise more
than an error does. Zero makes the matrix singular, so every child's
world-to-local conversion would fail. Negative scale is allowed from the start,
because mirroring is ordinary in authored scenes. The rendering cost is that a
negative determinant flips triangle winding, which the renderer must handle on
both backends.

**Scaling about each entity's own origin.** Scaling a multi-selection about a
shared pivot would also move positions. Per-axis scale is ill-defined once the
selected entities face different ways, and it would write positions through
the approximate world-pose path under scaled parents. Per-entity scaling has
none of these problems and matches Unity's default Pivot mode. Rotation keeps
its rigid-group behaviour.

**Parameter-free primitives.** One mechanism sizes everything, as in Unity, and
models in 20d need transform scale anyway. The cost is the familiar Unity
trade-off: children inherit their parent's scale, so the usual practice of an
unscaled parent with a scaled visual child applies.

Rejected alternatives:

- Keep primitive parameters and add scale (Godot's `BoxMesh.size` plus node
  scale). Size would not propagate to children, but there would be two ways to
  size a box, and the Inspector would show both.
- Uniform scale only. That is simpler and exact as a triple, but it cannot make
  a 2 × 1 × 3 box once primitive parameters are gone.
- Writing scale through `setComponentJson`. It reuses an existing path, but it
  round-trips the rotation through Euler degrees on every drag frame and can
  flip the triple at the pitch limit.
- A minimum-magnitude threshold on scale. Any threshold is arbitrary.
  Rejecting zero, and rejecting world writes whose result is not finite
  (decision 5), covers the failure without one.
- Putting `LocalTransform` in a scene's `components` with set-not-add
  semantics. It is more general, but `position` would be described twice.
  Revisit in Phase 27 when the scene format is persisted.

## Consequences
- ADR-038 decision 3's primitive parameters, and its context sentence that the
  engine has no transform scale, are superseded. ADR-034's "only translate and
  rotate modes" is superseded by decision 9.
- Phase 20d's `Model` carries only `{ key }`. glTF's unit is the metre, so an
  asset in other units is an asset defect, and its fix belongs to the asset
  (the pipeline, or per-asset metadata later), not to each instance. Until
  then an entity's scale corrects it. ADR-040 records this.
- `Mesh` stays `Copy` in 20c. It stops being `Copy` when 20d adds the key
  string.
- `MeshManager` tests that assert `position` and `quaternion` move to matrix
  assertions. Raycasting already uses `matrixWorld`, so picking is unaffected.
- Browser checks this phase cannot automate:
  - a mirrored box lit and culled correctly on WebGPU and on WebGL;
  - a rotated child under a non-uniformly scaled parent drawn sheared;
  - reparenting under a scaled parent keeps the child's apparent size;
  - the R gizmo on single and multi-selections, including the Runtime Camera;
  - a rejected 0 in the Inspector;
  - the demo cubes unchanged at 0.8.
- `get_position`, `get_rotation` and `set_world_transform` keep their
  signatures. Respawn, the camera sync and the translate and rotate gizmo need
  no change beyond the new status code.

## Addendum: Implementation Notes (2026-11-14)
Phase 20c shipped with decisions 5 and 6 as amended before implementation, in
this order: the core transform, the WASM transform API, the renderer's matrix
sync and scene scale, parameter-free primitives, the scale gizmo, then the
Inspector. The renderer step moved ahead of the primitives so that every
commit ran with the demo cubes unchanged: the cubes switched from a Box size
of 0.8 to a scale of 0.8 in the same change that removed the size. What the
implementation added or changed:

- **Decisions 1 to 3: as decided.** `WorldTransform` wraps an `Affine3A` and
  exposes `position()`, `rotation()`, `lossy_scale()`, `affine()` and
  `local_for()`; `relative_to` and the unused `WorldTransform::new` are gone.
  glam puts a mirror on X: a scale of `(1, -1, 1)` decomposes as
  `(-1, 1, 1)` and a half turn about Z, which a test pins. `rotation()` is
  normalised, because under shear the decomposed quaternion is not unit
  length (0.985 in the test case).
- **Decisions 5 and 6: as amended.** `local_for` solves the rotation from
  `P⁻¹ · R · S_world · S_local⁻¹`. A no-op world write is exact under a
  mirrored or negatively scaled parent, and so is a keep-world reparent; the
  first draft's formula turned such a child by 180 degrees, and a test of
  each case fails against it. Both keep-world reparents compute the new local
  before touching the hierarchy, so a `DegenerateTransform` changes nothing.
  The new variant is status 3 in `set_world_transform`, `set_parent` and
  `remove_parent`, and `Engine` maps each to its own message.
- **Decision 2: validation, widened.** `-0` is rejected as zero. JSON such as
  `1e39` reaches the engine as infinity once narrowed to f32, so the finite
  checks are explicit. `LocalTransformView` now also checks `position` and
  `rotation_euler_deg` for finite values, which it did not before 20c: a
  non-finite position made the world matrix of the entity and its
  descendants non-finite. Messages name the field: `position.x`,
  `rotation_euler_deg.y`, `scale.z`. All three checks run before anything is
  written.
- **Decision 2: the Inspector does not snap back.** A rejected value is not
  replaced by the engine's value. `useComponentField` keeps the edit pending,
  so the typed value stays next to the error until a later write succeeds.
  That is the hook's documented behaviour and was already how Mesh dimensions
  behaved in 20b; this ADR's description of it was wrong. One consequence
  predates this phase: while a rejected edit is pending, external changes
  (for example a gizmo drag) are not shown in that field, and the next edit
  sends the pending value again. Logged as debt.
- **Decision 4: the matrix path.** Each visual has
  `matrixAutoUpdate = false`, takes the engine's matrix with `fromArray`, and
  sets `matrixWorldNeedsUpdate`. `moveTo` replaces only the translation, so a
  respawned entity keeps its rotation, scale and shear. A `Scene` that
  recomposes its own matrix forces every child's world matrix to refresh,
  which hides a missing flag, so the tests guarding both flags use a scene
  that holds still. Renderer tests assert `matrixWorld`, what Three draws and
  raycasts from, not how the manager got there.
- **Decision 7: as decided.** `set_local_scale` also returns 1 for an entity
  without a `LocalTransform`. `Engine.setLocalScale` throws `HierarchyError`
  for status 1 and `Error` for status 2, as `setWorldTransform` does.
- **Decision 9: the primary is passed explicitly,** from `App` through
  `EngineView`'s `gizmoPrimary`, `Renderer.setGizmoTargets(handles, primary)`
  and `TransformGizmo.update`. Every operation in `selection.ts` happens to
  leave the primary last, but nothing relies on that. Refinement: the scale
  handles follow the primary when it is a target, and otherwise the first
  target, because a primary moved by a selected ancestor would show axes the
  drag does not scale. The pure rules live in `gizmo/scale-drag.ts`. A
  frame's write is skipped when an axis is zero or not finite as the f32 the
  engine receives (a Float32Array), so `1e-20 × 1e-30` is skipped although
  it is not zero as a double. The proxy's scale is reset to 1 every frame
  outside a drag, so during a drag it is the drag's factor. On a mirrored
  entity a handle can sit on the far side of its axis, because the
  decomposed rotation includes glam's half turn; the drag still scales the
  right axis.
- **Decision 10: strict primitives.** `MeshShape` denies unknown fields, the
  first use of `deny_unknown_fields` in the engine, so a pre-20c
  `{"Box":{"size":[..]}}` is rejected naming `size` instead of being drawn at
  the wrong size. The client's `parseShape` refuses a non-empty body for the
  same reason. The `MeshShape::default_*` constructors were removed.
  `meshVariantName` stays for the Inspector's shape picker; `shapeFields`,
  `withShapeField` and `ShapeField` were removed.
- **Decision 11: as decided.** A definition's scale is written only when it
  is given. The demo cubes share `CUBE_SCALE`.
- **Decision 12: as decided.** The three Transform rows share one local
  `AxisRow` component.

Verified: 116 core and 130 WASM Rust tests, 291 vitest tests in 11 files,
clippy, eslint, `tsc --build` and `go vet` clean. In the browser, on WebGPU,
every check listed under Consequences passed, along with the translate and
rotate gizmos and respawn. Not yet checked: the mirrored box on WebGL. The
renderer picks WebGPU whenever the browser offers it, and there is no way to
force WebGL yet; the Phase 20d spike adds a temporary `?backend=webgl`
override, and this check runs there.
