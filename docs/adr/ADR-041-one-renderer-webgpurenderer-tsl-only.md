# ADR-041: One Renderer — `WebGPURenderer` and TSL Only

## Status
Accepted. Supersedes ADR-031. Amends ADR-016.

## Date
2026-11-18

## Context
ADR-016 put two renderers behind `RenderBackend`: `WebGPURenderer` (from
`three/webgpu`) when the browser exposes `navigator.gpu`, and the classic
`WebGLRenderer` (from `three`) otherwise. ADR-031 followed from it: every
custom material is written twice, in GLSL for the classic renderer and in TSL
for `WebGPURenderer`. So far only the grid has one.

The November 2026 architecture review (point 5) asked whether to keep that
split. Two things made it pressing. Three.js issue #30560 reports a high
per-object CPU cost in `WebGPURenderer`. And Phase 20d brings PBR models,
which need environment lighting, so prefiltering an environment (PMREM) would
become a third piece of code written once per renderer.

Phase 20d therefore opened with a throwaway spike. It measured both renderers,
plus `WebGPURenderer` forced onto its WebGL 2 backend, and answered twelve
questions. This ADR records the renderer results and the decision. ADR-040
records the model-loading results from the same spike.

`WebGPURenderer` has two backends of its own: WebGPU, and WebGL 2 when no
WebGPU adapter is granted. In this ADR, "`WebGPURenderer` on WebGL 2" means
that fallback, which is not the classic `WebGLRenderer`.

## Spike Evidence
Measured on 2026-11-18 on Windows 11, Brave 157 (Chromium 157), 11 logical
processors and a 143 Hz display. The GPU was not reported, because Brave hides
it from pages. Three r177 and r187 were measured. The spike code was never
committed.

**Cost per frame.** CPU time of `render()`, median milliseconds, three r177.
Each frame also rewrote every world matrix from a `Float32Array`, as
`MeshManager.syncTransforms` does. That write was timed separately and is not
included.

| Scene                         | Classic `WebGLRenderer` | `WebGPURenderer` on WebGPU | `WebGPURenderer` on WebGL 2 |
|-------------------------------|------------------------:|---------------------------:|----------------------------:|
| 5k meshes, a material each    | 21.6                    | 44.6                       | 41.7                        |
| 5k meshes, one material       | 10.6                    | 33.2                       | 34.9                        |
| 20k meshes, a material each   | 82.2                    | 197.7                      | 177.1                       |
| 20k meshes, one material      | 40.6                    | 131.7                      | 142.6                       |
| `BatchedMesh`, 20k instances  | 7.1                     | 8.5                        | 7.2                         |

- Separate meshes cost 2 to 2.4 times as much on `WebGPURenderer` with a
  material per mesh, which is what `MeshManager` does today, and about three
  times as much with one shared material. Its two backends cost the same, so
  the cost is in the renderer, not the graphics API.
- The first frame with 20k separate meshes took 63 ms on the classic renderer
  with one material, against 0.8 to 1.0 s on `WebGPURenderer`. With a
  material per mesh it took 1.6 s against 2.0 to 3.0 s.
- `BatchedMesh` brought all three within about 20% of each other, with first
  frames under 70 ms.
- Three r187 measured the same, except that first frames on `WebGPURenderer`'s
  WebGL 2 backend got slower (20k meshes with a material each: 6.1 s against
  2.0 s on r177).
- Writing 20k world matrices took about 2.4 ms per frame, before the per-visual
  WASM reads that Phase 20f removes.

**Look.** Each subject was rendered alone at 640×360 on each renderer, three
r187, under six lighting setups (no environment, a RoomEnvironment and an HDR
file, each with tone mapping off and Neutral). The figure is the worst share
of the subject's pixels where a channel differs by more than 16 levels:

| Subject                                         | WebGPU vs `WebGPURenderer`'s WebGL 2 | `WebGPURenderer` on WebGPU vs classic |
|-------------------------------------------------|-------------------------------------:|--------------------------------------:|
| Textured PBR model (WaterBottle)                | 0.6%                                 | 1.8%                                  |
| Smooth metals lit by an environment             | 8%                                   | 13%                                   |
| Lit primitive (Cube D)                          | 0.4%                                 | 1.3%                                  |
| Grid (the same TSL; classic draws the GLSL twin) | 0%                                   | 21%, 82% with tone mapping            |

**Correctness.**
- Mirrored meshes. Both WebGL paths drew a mirrored box correctly on r177 and
  r187. Native WebGPU drew it inside-out on r177: its pipelines fixed the front
  face to counter-clockwise (`WebGPUPipelineUtils`) whatever the sign of the
  world matrix's determinant. Release r180 keys the pipeline on that sign, and
  r185 rebuilds a cached pipeline when the sign changes (three.js PR #33780),
  which is what an Inspector edit or a scale-gizmo drag through zero does.
  Bumping three to r187 (commit 680bac3) fixed it: a mirrored box now matches
  the unmirrored one exactly on all three.
- Tone mapping. `WebGPURenderer` applies tone mapping and the output
  colour-space conversion to the whole frame in an output pass, so the cleared
  background and unlit custom materials are converted too: `#1a1a1a` became
  (2, 2, 2) under Neutral. The classic renderer applies both inside each
  material, and only where the material includes Three's shader chunks. The
  GLSL grid does not include them, so it writes linear values unconverted,
  which is the grid's 21%.
- Environment. A RoomEnvironment prefiltered by each renderer's own
  `PMREMGenerator`, and an equirect HDR file assigned to `scene.environment`
  (which each renderer prefilters itself), both worked on all three. With only
  today's directional and ambient lights, smooth metals render black.
- The startup log reported "WebGPU" because `navigator.gpu` exists, not
  because WebGPU was running. When no adapter is granted, `WebGPURenderer`
  falls back to WebGL 2 with only a console warning.

**TSL-only trial.** The TSL grid ran on `WebGPURenderer`'s WebGL 2 backend with
no GLSL twin and matched its WebGPU rendering: a mean difference of 0.01 of
255, and no pixel off by more than 16.

## Decision
1. **One renderer.** The viewport renders with `WebGPURenderer` from
   `three/webgpu` and nothing else. It uses WebGPU when the browser grants an
   adapter and its own WebGL 2 backend otherwise. The app does not choose. The
   classic backend (`backends/webgl.ts`) and the `navigator.gpu` check are
   removed.

2. **TSL only.** Custom materials are node materials, written once in TSL. The
   GLSL grid material is removed, and ADR-031 is superseded. Built-in
   materials, including those `GLTFLoader` creates, need nothing:
   `WebGPURenderer` converts them.

3. **The seam stays, with one implementation.** `RenderBackend` remains the
   boundary between `Renderer` and Three's renderer, which amends ADR-016. It
   keeps Three's renderer out of `Renderer`, and it promises no second live
   backend.

4. **The real backend is logged.** After initialisation the renderer logs
   whether it runs on WebGPU or on WebGL 2 (`renderer.backend.isWebGPUBackend`),
   so a fallback is visible.

5. **Environment.** `scene.environment` is a RoomEnvironment, prefiltered once
   by `WebGPURenderer`'s `PMREMGenerator` after initialisation. It is a fixed
   renderer default, like the grid's constants (Phase 15): no asset, no ECS
   component and no setting. Its intensity is tuned in the browser during
   Phase 20d against the existing directional and ambient lights, and recorded
   in the implementation notes. An HDR file or a per-scene environment can be
   added later, with scene settings or Phase 27 persistence.

6. **Tone mapping stays off.** `NoToneMapping`, and the output colour space
   stays sRGB, so the background and the grid look as they do today. Neutral is
   the likely operator once tone mapping becomes a scene setting. Because
   `WebGPURenderer` tone-maps the whole frame, that change has to decide the
   background colour and the grid's look as well.

7. **Scaling is batching.** The per-object cost is accepted for separate
   meshes. Large entity counts are served by a batched draw path, Phase 20h
   (ADR-047, written when that phase starts): `BatchedMesh`, fed from Phase
   20f's per-tick batch of changed world transforms. Phase 21 chooses its
   outline technique after 20h, and Phase 22 depends on it.

8. **Three version.** At least r185, for mirrored meshes on WebGPU. The
   dependency is pinned to a minor (`^0.187.0`). Each bump is its own commit,
   with the type check, the tests and a browser check that includes a mirrored
   box.

## Reasoning
- **One look in every browser.** Without WebGPU, users get `WebGPURenderer` on
  WebGL 2, which matches WebGPU closely: 0.6% of a textured model's pixels and
  none of the grid's. A classic fallback would give them the renderer that
  differs most, on environment-lit metals, on the grid and on the background.
- **The gap is per object, and batching closes it.** Ten releases did not
  change it (r177 to r187). Batching brings all three to within about 20%, and
  the classic renderer needs batching too at city scale: 40 to 82 ms per frame
  at 20k separate meshes. Its 2 to 3 times advantage on separate meshes only
  helps until Phase 20h.
- **One implementation per effect.** The dual rule drifted on its first shader:
  the GLSL grid lost the colour-space conversion, and nobody noticed until the
  spike compared pixels. PMREM would have been the second per-renderer path,
  and Phase 21's outline the third. Three's manual says the classic renderer
  gets no larger new features, because the project's focus is
  `WebGPURenderer`.
- **Upstream bugs reach everyone at once.** The r177 mirroring bug hit every
  WebGPU user. Deliberate bumps with a mirrored-box check (decision 8) are the
  mitigation, and the spike showed that such a check catches this kind of bug.

## Alternatives Considered
- **The classic `WebGLRenderer` as the default, GLSL only.** It is two to three
  times faster for separate meshes today and has much shorter first frames.
  Rejected: it is in maintenance mode, it gives up TSL for Phase 21 and later
  effects, it still needs batching at city scale, and WebGPU would go unused.
- **Keep both renderers.** Rejected: every effect written twice (and already
  drifting), two environment paths, a look that depends on the browser, and
  every visual check run twice.
- **`WebGPURenderer` forced onto WebGL 2 everywhere.** Rejected: no benefit
  over letting it choose, and slower first frames on r187.

## Consequences
- The first step of Phase 20d's implementation removes `backends/webgl.ts`,
  the GLSL grid material, `createGridMesh`'s renderer argument and the
  `hasWebGPU` branch in `renderer.ts`, before any model work, so `MeshRenderer`
  and the environment are written once.
- Every browser runs the same renderer and materials. Visual checks cover one
  renderer, on both of its backends.
- Separate meshes cost two to three times the CPU they would on the classic
  renderer until Phase 20h, and first frames with many separate meshes are
  slower (seconds at 20k). Today's scenes are small, and Phase 20e's metrics
  will show when this starts to matter.
- The background and the grid look unchanged, because tone mapping stays off.
  Turning it on later changes both.
- The view gizmo's own `WebGPURenderer` (ADR-032) is unaffected.
- A `WebGPURenderer` bug reaches every user. Bumps are deliberate and checked
  (decision 8).
