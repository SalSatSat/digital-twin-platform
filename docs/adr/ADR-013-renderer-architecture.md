# ADR-013: Renderer Architecture

## Status
Accepted

## Date
2026-06-19

## Context
The renderer needs to manage Three.js scene setup, the WASM-compiled ECS,
and the per-frame loop that keeps them in sync. We needed to decide how
these responsibilities are distributed across classes for the first working
version of the render pipeline.

## Decision
A single Renderer class owns the Three.js Scene, Camera, WebGLRenderer, and
the WASM EngineWorld together. It exposes a small lifecycle API — initialize,
start, stop, dispose — and drives the tick loop internally via
requestAnimationFrame.

## Reasoning
The goal for this phase was proving the full pipeline works end to end —
Rust ECS, compiled to WASM, driving a visible Three.js object. Separating
"owns the ECS" from "owns the rendering" into different classes would have
been the more correct long-term design, but it adds coordination complexity
that wasn't justified before the basic loop was proven. Combining them into
one class kept the first implementation simple enough to verify quickly and
correctly.

The lifecycle API (initialize/start/stop/dispose) was chosen to map cleanly
onto React's component lifecycle via useEffect, since the renderer needs to
be created and torn down in sync with a mounted/unmounted component.

## Consequences
- The Renderer class has two responsibilities — rendering and ECS ownership
  — which will need to be separated as multiple entities, WebGPU, and camera
  controls are added
- The lifecycle API is stable and unlikely to change even as the internals
  are split apart later
- React integration is straightforward because the class was designed
  around mount/unmount semantics from the start
- This is a known point of future refactor, similar in spirit to the
  EntityFactory Bundle refactor — correct simplification now, deliberate
  technical debt to revisit once more of the platform is built out
