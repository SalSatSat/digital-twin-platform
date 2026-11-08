# ADR-038: Mesh and Material Components

## Status
Accepted

## Date
2026-10-31

## Context
No entity carries an appearance today. `SceneManager.loadScene` spawns a
bundle, then builds a `THREE.Mesh` itself from the scene definition's `color`
(a box with a hardcoded 0.8 size) and keeps it next to the entity handle in
`spawnedEntities`. The ECS cannot say what an entity looks like or whether it
is drawn, and the Inspector has nothing to edit. Three consumers depend on that
Three-side mesh: `pickEntity` raycasts the visible meshes, `getEntityMesh`
feeds the transform gizmo, and `unloadScene` disposes them.

Two things in that arrangement do not survive Phase 20b:

- Gizmo eligibility. `TransformGizmo.resolveTargets` requires
  `getMesh(h)?.visible === true`, a Three flag standing in for
  `EntityInfo.visible`. An entity without a `Mesh` would never receive the
  gizmo, so a Unity-style empty could not be positioned. It is the same mistake
  ADR-037 removed for `dynamic`: a cached copy of ECS state in the view.
- `SceneDefinition` describes visuals with a single `color`. Phase 27 will save
  and load `SceneDefinition`, so whatever it uses to describe visuals becomes
  the persisted form.

ADR-037 supplies what this needs: optional components that can be added and
removed after spawn, `default_component_json`, and the `ComponentAdded` /
`ComponentRemoved` events. ADR-036 events carry a handle and a component id,
never a value, so a consumer reads the component after the event. Phase 20c
adds runtime GLB models to the same component, and the engine has no transform
scale until then, so a primitive's size has to live in `Mesh`.

## Decision
`Mesh` and `Material` are optional ECS components. The renderer draws an entity
from them, as a view that reads the ECS and never as a second source of truth.

1. **Components and ids.** `Mesh` has component id 4 and `Material` has id 5,
   both registered with `optional` operations (ADR-037 decision 1) and a
   default wire JSON. `LocalTransform`, `Velocity`, `Camera` and `EntityInfo`
   keep ids 0 to 3. The ids are pinned by tests in Rust and in `events.ts`, as
   in ADR-036. Bundles do not spawn with either component. An entity without a
   `Mesh` is not drawn. A `Material` without a `Mesh` has no effect.

2. **`Mesh` wire shape.** `{ "shape": { "<Variant>": { ... } } }`, an
   externally tagged enum, the same representation as `Camera`'s
   `ProjectionType`. The enum is `MeshShape`. Phase 20c adds a `Model` variant
   to it, so the wire does not change then.

3. **Primitives.** Four variants. Every parameter is in world units, and all
   shapes are centred on the entity's origin:

   | Variant    | Parameters                  | Orientation                        | Default      |
   |------------|-----------------------------|------------------------------------|--------------|
   | `Box`      | `size: [x, y, z]`           | extents along local X, Y, Z        | `[1, 1, 1]`  |
   | `Sphere`   | `radius`                    |                                    | `0.5`        |
   | `Cylinder` | `radius`, `height`          | axis along local Y                 | `0.5`, `2.0` |
   | `Plane`    | `size: [x, z]`              | in the local XZ plane, normal +Y   | `[10, 10]`   |

   The defaults follow Unity's primitives (from memory, not doc-verified
   here): a unit cube, a sphere and a cylinder with a diameter of 1, and a
   10 by 10 plane. A `Plane` is single-sided: it is drawn and picked from the
   +Y side only, as in Unity. Tessellation (segment counts) is a renderer
   constant and is not part of the component.

4. **Validation.** Every dimension must be finite and greater than zero. A
   failing value is rejected at the reflection boundary with a message (the
   `set_component_json` and `add_component_json` convention) and the entity is
   left unchanged. A bad value never reaches Three, because a throw inside the
   render loop stops rendering (ADR-036 decision 6).

5. **`Material` wire shape.** `{ "base_color": [r, g, b] }`, sRGB components
   in 0 to 1, the way a colour is authored, with no alpha. Values outside 0 to 1
   or non-finite are rejected. The default is white, `[1, 1, 1]`. The target
   material model is metallic-roughness PBR. Until a field says otherwise the
   renderer keeps `MeshStandardMaterial` with Three's default roughness and
   metalness, which is what the current cubes use. Roughness, metalness,
   emission and alpha are additive later through serde defaults. Alpha needs
   blend-mode and sorting decisions of its own, so it is not added speculatively.
   The renderer converts with an explicit sRGB colour space. Three's `setRGB`
   defaults to its linear working space (from memory; to be checked against the
   installed Three types), so a naive call would change every colour.

6. **Defaults and fallback.** The Add Component menu gets its default from
   `default_component_json`: a unit `Box` and a white `Material`. A `Mesh`
   without a `Material` is drawn with the engine's default `Material` JSON,
   which the renderer fetches through `defaultComponentJson`, so the fallback
   is defined once, in the engine. The 0.8 box size was a hardcode in
   `createMesh`, not a design. The default scene states it explicitly, so
   today's visuals do not change.

7. **Mesh manager.** A renderer module owns the Three objects for visuals.
   `SceneManager` stops holding meshes. The manager treats events as
   invalidation only. `componentAdded`, `componentRemoved` and
   `componentChanged` for `Mesh` or `Material`, and `entityDespawned`, mark
   the handle dirty, and `resync` marks every entity dirty. After the frame's
   events are dispatched, the manager reconciles each dirty handle against the
   engine's current components: build, rebuild, update in place or dispose.
   Reconciling from current state makes the manager idempotent and gives the
   resync path no logic of its own. A `Mesh` change rebuilds the geometry, a
   `Material` change updates the colour in place, removing a `Mesh` disposes
   the visual, and removing a `Material` reverts to the fallback. Geometry is
   per entity until Phase 20c introduces an asset cache.

8. **Transform and visibility stay polled.** Position, rotation and
   `EntityInfo.visible` are read each frame as today. World transforms change
   every tick without an event, and `EntityInfo` is mandatory, so there is no
   structural event to wait for. The manager applies them to the visual.
   Picking keeps testing what is drawn, so it uses the visible visuals.

9. **Selection and the gizmo.** An entity without a `Mesh` is selectable
   from the Hierarchy and has no viewport pick target. Gizmo eligibility
   asks the engine whether the entity is visible and exists, not whether a
   mesh is. `TransformGizmo` loses its `getMesh` dependency. `getEntityMesh`
   is removed once it has no remaining consumer, which is checked before the
   deletion.

10. **`SceneDefinition`.** `color` is removed from entity definitions. An
    entity gets an optional `components` map of wire JSON keyed by component
    kind, and `loadScene` passes each value through `addComponentJson` after
    the spawn. Scene content therefore uses the reflection wire format and
    nothing else, which is also the shape Phase 27 persists. A malformed value
    fails loudly at load as a `ReflectionError`. A small pure helper converts a
    hex literal to the sRGB float triple, so the default scene stays readable.

11. **Client events.** `events.ts` learns component ids 4 and 5. An unknown id
    still decodes to `resync`. The Inspector gets field editors for both kinds,
    registered with the Add and Remove UI from ADR-037. The `Mesh` editor
    switches variant the way the camera projection toggle does, resetting the
    parameters to that variant's defaults. The colour picker's hex conversion
    and the variant switching logic live in a WASM-free renderer module with
    tests, because `client/app` has no test runner.

## Reasoning
Putting the shape's size inside `Mesh` is forced: the engine has no scale, and
20c's model variant carries its own import scale. A tagged enum keeps each
variant's parameters meaningful and is the representation `Camera` already
uses, so the Inspector's variant switching has a precedent. Four variants
rather than one exercise four different parameter shapes (a vector, a scalar,
two scalars, a 2D size), so that code is tested rather than assumed.

Floats for colour match `Velocity`'s array style, keep full precision in the
ECS and need no parser in Rust. The cost is a small, tested hex-to-float
helper on the client.

Reconciling from the engine's current state, instead of replaying events, is
the same lesson as ADR-037's `respawnInPlace`: the ECS is the one source of
truth, and a consumer asks it instead of keeping a copy that events must keep
in sync. It also makes the rescan after an overflow ordinary. The queue holds
4096 records, so a large scene load will produce a `resync`.

Rejected alternatives:

- One `Visual` component holding shape and colour: it would force a model
  reference and its material to be edited together, and Unity separates the two
  (from memory, not doc-verified here).
- A flat `{ kind, a, b, c }` shape: its fields would be meaningless for most
  variants. One component per shape would break "a general `Mesh`".
- A `"#rrggbb"` string: easier to author and matches the colour input, but
  needs parsing and validation in Rust and quantises the stored value.
- Typed `mesh` and `material` fields in `SceneDefinition`: friendlier today,
  but a second description of the same data that Phase 27 would replace.
- Polling the component JSON every frame, as the camera projection does: it
  contradicts ADR-036 and costs a query per entity per frame.
- Keeping gizmo eligibility on the mesh: it makes a view flag decide an
  editing capability.
- Keeping 0.8 as the default size: it would put an arbitrary number in the
  engine.

## Consequences
A new primitive is a `MeshShape` variant, a builder in the mesh manager, a
default, validation and an Inspector editor. The `SceneDefinition.color` field
and `createMesh(color)` are removed. Only `scene.ts` and `scene-manager.ts`
use them today, and the four existing cubes must keep their colours, which is
checked in the browser.

How `Material` applies to a `Model` is deliberately left to Phase 20c. In 20b
it applies to primitives only. 20c must decide between an override of all of a
model's materials and a value that is ignored, and the choice is recorded
there.

The Phase 20b Inspector work has no automated UI test. The logic that can be
wrong (variant defaults, colour conversion, validation messages) is in pure
modules with tests, and the rest is verified in the browser.

## Addendum: Implementation Notes (2026-11-08)
Phase 20b shipped as decided, in this order: the core components, reflection
(ids 4 and 5, validation, defaults), the client's component ids, the pure
visual logic, the engine's variant defaults, the mesh manager, the
`SceneManager` rewiring, the gizmo's targeting, then the Inspector. What the
implementation added or changed:

- **Decisions 1 to 3: as decided.** Every default, including each shape
  variant's, is serialized by the same path as the component's `to_json`, so
  a default cannot drift from the wire shape, and a test requires each one to
  be accepted by its own add and set.
- **Decisions 4 and 5: validation.** Set and add share one parse-then-validate
  function per component, so neither touches the world until it passes. A
  message names the parameter: `size.x`, `radius`, `height`, `base_color.g`.
  A plane's second size is reported as `size.z`, because it lies in XZ. The
  finite check on a dimension is explicit, since `inf > 0` is true. A colour
  range check needs none, because NaN and infinity fall outside 0 to 1.
- **Decision 7: the manager.** Events only mark entities dirty, through
  `handlesToReconcile`, and each dirty entity is reconciled against the
  engine's current `Mesh` and `Material` by `planVisualUpdate`, which sends
  only the parts that changed: a colour edit never rebuilds geometry. The
  default Material is fetched once, lazily, and a missing one throws,
  because it means the renderer and the WASM package disagree. A malformed
  `Mesh` counts as no `Mesh`, since a throw stops the render loop (ADR-036).
  A resync reconciles every visual and every entity in the hierarchy
  listing: one JSON listing per resync, which is fine now and a scaling item
  later. Tessellation is a renderer constant: 32 by 16 for a sphere, 32
  radial segments for a cylinder.
- **Decision 8: polled, plus `moveTo`.** Position, rotation and visibility
  are still polled. `MeshManager.moveTo` exists only because boundary respawn
  runs in the client and the engine reports the new position only after its
  next tick. It carries a TODO, as does `respawn.ts`: respawn is simulation
  behaviour and belongs in an engine system, which would delete both.
- **Decision 9: the gizmo.** Eligibility is `resolveGizmoTargets`
  (`gizmo/targets.ts`), a pure function over the hierarchy and the engine's
  visibility, so `TransformGizmo` lost its `getMesh` parameter.
  `SceneManager.getEntityMesh` had no consumer left and was removed;
  `MeshManager.getMesh` stays for the tests and for Phase 21. The Runtime
  Camera, and any entity without a `Mesh`, now gets the gizmo and can be
  dragged. A hidden entity still does not.
- **Decision 10: scene definitions.** `SceneDefinition` entities carry
  `components`, applied by `SceneManager.applyComponents` through
  `addComponentJson`; a rejected value throws at load. `DEFAULT_SCENE` builds
  its cubes with a `cube()` helper and `rgbFromInt`. `SceneManager` gained
  `dispose()`, which the renderer calls on teardown, so the mesh manager
  releases its engine subscription.
- **Decision 11 changed: the variants come from the engine.** The ADR said a
  variant switch resets to "that variant's defaults" and did not say from
  where. `ComponentDescriptor` gained a `variants` list, exposed as the static
  `EngineWorld::component_variants_json` and `Engine.componentVariantsJson`,
  and `componentVariants` parses it strictly. The Inspector switches variant
  through the hook's debounced `setValue`, not an immediate write, so a
  pending edit cannot overwrite the new variant. A `switchVariant` helper
  written first for the immediate write was dead on arrival and was removed.
- **Colour, checked rather than assumed.** On Three r177, `setRGB` without a
  colour space draws `97cef7` where `4f9eed` is wanted, so the manager passes
  `SRGBColorSpace`. Tests pin that the four demo colours draw exactly as the
  old renderer drew them.
- **`Material` is independent of `Mesh`.** Removing a `Mesh` leaves its
  `Material`, and adding a `Mesh` back uses it. Unity differs, since its
  material lives on the renderer; a test pins this.
- **Inspector.** `MeshField` has a Shape dropdown from the engine's variants
  and a numeric row per parameter, and `MaterialField` has a colour swatch
  with its hex. Row layout lives in `mesh-edit.ts`, a WASM-free renderer
  module with tests, because `client/app` has no test runner. A variant it
  has no rows for shows a placeholder. The engine's validation message shows
  inline, next to the typed value.
- **Checked in the browser.** The four cubes' colours and size; play-mode
  respawn; click-to-select and the gizmo; removing and re-adding `Mesh` and
  `Material`; the gizmo on a mesh-less entity and on the Runtime Camera;
  editing sizes, a rejected zero, switching every shape, a plane from below,
  a variant switch right after typing, and the colour picker.
- **Still deferred.** How `Material` applies to a `Model` (Phase 20c).
  Moving boundary respawn into an engine system, whose design is a separate
  system, probably a per-entity component, and the third system that the
  deferred Scheduler waits for. Moving the Camera's switch defaults, which
  are still hardcoded in `CameraField`, onto the variants API; that switch
  also keeps near and far, which defaults alone cannot express. Alpha,
  roughness, metalness and emission. Undo. A UI test harness for `client/app`.
