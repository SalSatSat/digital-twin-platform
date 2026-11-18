# ADR-040: GLB Models — `Model` Mesh Shape and `MeshRenderer` Material Slots

## Status
Accepted.

## Date
2026-11-18

## Context
ADR-038 introduced `Mesh`, with primitive shapes and a `Model` variant promised
for this phase, and `Material`, a single sRGB base colour. ADR-039 made every
visual draw from one world matrix and kept `Mesh` `Copy` until models arrive.
Phase 20d draws GLB models at runtime.

The decisions below were agreed before the phase and then checked in the Phase
20d spike, whose renderer results are in ADR-041. The spike drew three glTF
sample models (WaterBottle, MetalRoughSpheresNoTextures, NegativeScaleTest)
through a throwaway refcounted cache on all three renderers it measured, ran
automated lifecycle checks on each, and parsed hand-built GLBs under node
vitest. Spike questions are cited as Q1 to Q12. Where the spike changed a
decision, the decision says so.

## Decision
1. **`Model { key }` is a `MeshShape` variant.** On the wire it is
   `{ "shape": { "Model": { "key": "WaterBottle.glb" } } }`, and it follows
   ADR-039 decision 10 (`deny_unknown_fields`). `key` is a `String`, so `Mesh`
   stops being `Copy`. The variant's default in `MESH_VARIANTS` is
   `{ "key": "" }`.

2. **Keys.** An empty key means "unassigned" and draws nothing. The engine
   checks syntax only, at the reflection boundary: at most 256 bytes and no
   control characters, rejected with a message that names `key`. Whether a key
   names a real file is the resolver's question (decision 4).

3. **No import scale, authored origin.** Models are in metres, as glTF
   specifies. A model is drawn at its authored scale and origin, with no
   auto-centring. Wrong units are an
   asset defect, fixed in the asset pipeline or, later, in per-asset metadata.
   An entity sizes a model with its scale (ADR-039).

4. **Resolver.** The app supplies `(key, signal: AbortSignal) =>
   Promise<ArrayBuffer>`. Version one fetches `/models/<key>` from Vite's
   `public/models/`. (Changed from `/assets/`: Vite copies `public/` into
   `dist/`, where `assets/` is its own build output folder.) It splits the key
   on `/` and encodes each segment, and it fails for an empty, `.` or `..`
   segment, so a key cannot leave `/models/`. A non-OK status is a failure, and
   so is an HTML response: Vite answers a request for a missing public file
   with the app's `index.html` and a 200. GLB only: bytes that do not start
   with `glTF` are a failure. Vite serves only the public files it knew at
   startup or that its file watcher reported, so files added from outside a
   dev container need a dev server restart.

5. **Asset cache.** A renderer module keeps one entry per key:
   - a state: pending, ready or failed;
   - its users, the handles that show the asset or wait for it, which are the
     refcount (pending waiters count);
   - a template, the parsed `gltf.scene`. Instances are `template.clone()`,
     which share its geometries, materials and textures: ten instances use the
     same GPU memory as one (Q4);
   - a slot map from each Three material to its glTF material index, recorded
     at load from `parser.associations` (Q12). Clones share materials, so the
     map holds for every instance. Primitives on glTF's default material have
     no index.

   At zero users, a pending load is aborted through the resolver's signal
   (added by the spike), a ready asset disposes its geometries, materials and
   textures once each, and a failed entry is dropped. All renderer memory
   counters returned to their baseline on all three renderers (Q4, Q8). There
   is no LRU: an asset lives while an entity uses it. A failed key warns once
   per session, stays failed while it has users, and is retried by the next use
   after every user has gone.

   The parse function is injected, defaulting to `GLTFLoader.parseAsync`.
   Under node vitest, `GLTFLoader` parses an untextured GLB but rejects a
   textured one (`self is not defined`), so tests inject their own (Q7, added
   by the spike).

6. **Async attach.** A finished load marks every waiting handle dirty, and the
   next `update()` reconciles those handles against the engine's current
   `Mesh`. There are no per-load tokens: when a new entity reuses a handle
   while the old entity's model is still loading, only the new entity's model
   is shown (Q8). `planVisualUpdate` takes the asset state as an input, so the
   decision stays pure and tested.

7. **Visual root.** A model's visual root is a plain `Group` that takes the
   engine's world matrix (`matrixAutoUpdate = false`, ADR-039). The model
   instance is its child, and the GLB's own nodes keep `matrixAutoUpdate` and
   their authored transforms: models followed every gizmo drag, and
   NegativeScaleTest's mirrored nodes rendered correctly (Q6). The root exists
   while the `Mesh` does, and is empty while the model is pending, failed or
   unassigned, so transform and visibility sync work the same for every visual.
   `MeshManager`'s visual record therefore holds an `Object3D`: a `Mesh` for a
   primitive, a `Group` for a model.

8. **Loading and failure.** Nothing is drawn while a model is pending, after it
   failed, or while its key is empty. Each failed key warns once. Nothing
   throws in the render loop (ADR-036 decision 6).

9. **`MeshRenderer` replaces `Material`.** Component id 5 is kept and the kind
   is renamed `MeshRenderer`. Nothing is persisted before Phase 27, so there is
   nothing to migrate. On the wire:
   `{ "materials": ["Default", { "Override": { "base_color": [r, g, b] } }] }`.
   - Slot `i` applies to the material whose glTF material index is `i`. A
     missing slot means the model's own material, and extra slots are ignored,
     so a slot list survives swapping the model.
   - A primitive has one material, in slot 0, whose own colour is ADR-038's
     default white. The default scene's cube colours become slot 0 overrides.
   - `Override { base_color }` replaces the material's base colour factor, and
     its textures stay, as glTF multiplies the two. `base_color` keeps
     ADR-038's convention: sRGB components in 0 to 1, anything else rejected,
     with messages that name the field (`materials[1].base_color.g`).
   - An override clones the slot's material for that entity. The clone belongs
     to the entity's visual and is disposed with it. Its textures stay with the
     cache.
   - The default is `{ "materials": [] }`: everything as authored. A `Mesh`
     without a `MeshRenderer` is drawn the same way.
   - Editor effects, such as Phase 21's selection outline, never go through it.
   - Merging the mesh and its materials into one component was rejected,
     because colliders, bounds and queries need geometry without render data.

10. **Picking is recursive.** A hit is mapped to its entity by walking
    `.parent` up to a visual root. Three's raycaster ignores `visible`, so a
    hit under an object that is not visible is skipped (Q5, added by the
    spike).

11. **Lighting.** PBR models need an environment: with only the directional and
    ambient lights, smooth metals render black (Q2). ADR-041 decision 5 gives
    every scene a RoomEnvironment.

12. **Where the loader lives.** The cache and `GLTFLoader` live in the renderer
    package (`client/renderer/src/assets/`), behind the resolver the app
    supplies. Phase 22's IFC import will produce GLB bytes into the same cache.
    How plugins package their code is ADR-045's question.

13. **Inspector.** The `Mesh` editor gets a key text field for `Model`.
    `MeshRenderer` gets a slot list, each slot Default or Override with a
    colour. The Add Component menu offers `MeshRenderer` where it offered
    `Material`.

Out of scope: glTF nodes as entities (one entity per model), animation and
skinning (instances are plain clones, so skinned models are not supported),
Draco, meshopt and KTX2 compression, `.gltf` files with external resources,
per-asset metadata, streaming and progress, an LRU, and client publish.

## Reasoning
- **Refcount by handle, waiters included.** Counting a pending waiter lets the
  cache abort a load nobody wants any more, instead of finishing it and
  disposing the result. The spike's lifecycle checks found no orphan and every
  counter back at its baseline.
- **Reconcile instead of tokens.** Marking handles dirty and re-reading the
  `Mesh` is how `MeshManager` already treats every event (ADR-038 decision 7).
  It makes a stale load harmless without tracking which load belongs to which
  entity, including when handles are reused.
- **Slots by glTF material index.** The index is stable across loads of the
  same file, and Three's loader exposes it. Recording it at load is required,
  because an override clones its material and a clone is not in
  `parser.associations`.
- **An injected parser.** It keeps the cache's refcounting, abort and failure
  rules unit-testable under node vitest, where `GLTFLoader` cannot decode
  textures.

## Consequences
- `Mesh` loses `Copy`. Places that copy a `Mesh` value clone it instead; they
  are mapped before the core step.
- `Material` is renamed across the engine, reflection, events (id 5 kept), the
  client, the Inspector and the default scene.
- `MeshManager`'s visual record generalises from a `Mesh` to an `Object3D`.
- Models arrive asynchronously, so a scene can draw before its models do.
- Instances of a model share GPU memory. Each overridden slot adds one
  material per entity.
- Phase 20h may batch instances of the same model.
- The spike's sample models are not committed. A committed sample model must be
  small and CC0 or self-made.

## Implementation Order (Phase 20d)
1. Remove the classic renderer path (ADR-041).
2. Core: `MeshShape::Model { key }` and key validation. `Mesh` loses `Copy`.
   `MESH_VARIANTS` gains `Model`.
3. `MeshRenderer` replaces `Material`, with reflection, events and the default
   scene.
4. Renderer: the environment (ADR-041 decision 5), the asset cache and
   resolver, async attach, `planVisualUpdate` with asset state, `parseShape`
   accepting `Model`, and the model root.
5. Picking: recursive.
6. Inspector: the key field, the slot list and the Add Component menu.
7. Finish: browser checks, implementation notes, README.
