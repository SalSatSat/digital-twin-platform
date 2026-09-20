# ADR-031: Dual Shader Material Implementations (GLSL/WebGL + TSL/WebGPU)

## Status
Accepted

## Date
2026-09-12

## Context
ADR-016 established that `WebGLBackend` (classic `THREE.WebGLRenderer`,
imported from `three`) and `WebGPUBackend` (`WebGPURenderer`, imported
from `three/webgpu`) are two genuinely separate rendering pipelines
selected once at startup via `navigator.gpu` — but at that point neither
backend had any custom shader content, so the ADR only had to resolve
type-import conflicts between the two `three` entry points.

Phase 15 (Infinite Grid) is the first feature requiring a custom
procedural shader rather than a stock Three.js material
(`MeshStandardMaterial` etc.). This surfaced a real material-level
incompatibility ADR-016 never had to address: classic `THREE.WebGLRenderer`
only understands `THREE.ShaderMaterial` with hand-written GLSL, while
`WebGPURenderer` only understands node-based materials built with
Three.js's Shading Language (TSL) — a `THREE.ShaderMaterial` with GLSL
source will not run on `WebGPURenderer`, and a TSL `NodeMaterial` will
not run on classic `WebGLRenderer`. There is no single material
implementation that works on both backends in this project's setup.

## Decision
Any custom-shaded material is implemented twice — once as GLSL in a
`*-webgl.ts` file (`THREE.ShaderMaterial`), once as TSL nodes in a
`*-webgpu.ts` file (`THREE.NodeMaterial` / `MeshBasicNodeMaterial` with
`colorNode`/`opacityNode` etc.) — with the choice made once, at mesh
construction time, using the same `hasWebGPU` flag `Renderer` already
computes to select the render backend itself. The two implementations
are expected to express the same algorithm; their construction
functions live side by side (see `client/renderer/src/grid/
grid-material-webgl.ts` and `grid-material-webgpu.ts` for the Phase 15
grid as the reference example) and are cross-referenced in comments so
a change to one is a visible prompt to update the other.

Config values that are fixed constants (not runtime-configurable) are
baked directly into the TSL node graph as plain node constants rather
than wrapped in `uniform()` nodes. An earlier attempt to use `uniform()`
for the grid's fixed constants hit a WebGPU-side "Uniform not declared"
compile error; removing the uniform wrapper (since nothing needed
runtime mutation) resolved it and is simpler besides. `uniform()` should
only be reached for once a value genuinely needs to change after the
material is built (the GLSL side already does this correctly for
per-frame values like camera position, which classic `ShaderMaterial`
has no built-in equivalent for — see `updateGridPosition()` in
`grid-mesh.ts`).

## Reasoning
A shared abstraction layer over both shading languages (e.g. writing
one DSL and transpiling to both GLSL and WGSL/TSL) was not attempted —
it would be substantial infrastructure for a single feature, and
Three.js's own TSL already exists specifically to unify WebGL2/WebGPU
node-based rendering going forward; fighting that by inventing a
project-specific abstraction on top would work against the ecosystem's
own direction rather than with it. Writing both by hand, kept
deliberately close in structure and naming, was judged the lowest-risk
option for a single-developer/learning-focused project: each
implementation stays simple, readable GLSL or TSL on its own terms,
at the cost of manual duplication discipline when the algorithm changes.

Baking fixed constants directly into the node graph rather than
defaulting to `uniform()` everywhere follows the project's existing
"don't build for configurability that isn't needed yet" stance (mirrors
the Phase 15 scoping decision to keep `GRID_CONFIG` non-configurable
for now) — it also happened to route around a genuine compile-time bug,
which is a useful data point but not the primary reason for the
pattern.

## Consequences
Any future custom-shaded feature (Phase 18's selection outline, etc. —
Phase 16's gizmo was also expected to need this, but flat/unlit materials
sufficed; see ADR-032) should expect the same two-file treatment
whenever it needs a procedural/custom-shaded material rather than a
stock Three.js material — this is now the established pattern, not a
one-off for the grid. `RenderBackend`'s own interface (ADR-016) is
unaffected; this ADR only concerns material/shader content built on
top of whichever backend is active.

Keeping the two implementations in sync is a manual, not enforced,
discipline — nothing currently fails a build if one is updated and the
other isn't. If a third or fourth custom-shaded feature lands and this
becomes a recurring source of drift, worth revisiting whether a shared
GLSL-and-TSL test (e.g. asserting both produce the same line-mask value
for a set of sample coordinates, evaluated in JS rather than on a GPU)
is worth the investment.
