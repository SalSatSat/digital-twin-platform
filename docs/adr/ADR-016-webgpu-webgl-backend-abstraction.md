# ADR-016: WebGPU and WebGL Backend Abstraction

## Status
Accepted

## Date
2026-06-27

## Context
The platform committed to WebGPU-first rendering with WebGL fallback from
day one. Phase 4 implemented only WebGL for simplicity. Phase 6 introduces
WebGPU alongside WebGL, requiring a design that supports both backends
without duplicating render loop logic or making the Renderer class aware
of which backend is active.

## Decision
We introduce a RenderBackend interface implemented by two concrete classes —
WebGLBackend and WebGPUBackend. The Renderer class detects browser capability
at construction time via navigator.gpu and instantiates the appropriate
backend. The render loop calls backend.render() regardless of which backend
is active.

## Reasoning
The key difference between WebGLRenderer and WebGPURenderer in Three.js is
that WebGPURenderer requires async initialization via init() before rendering
can begin. Abstracting both behind a common RenderBackend interface with an
initialize() method handles this difference cleanly — WebGLBackend.initialize()
resolves immediately, WebGPUBackend.initialize() awaits the underlying init()
call. The Renderer class never needs to know which path was taken.

WebGPURenderer is imported from three/webgpu, a separate entry point from
the main three package. WebGLRenderer remains imported from three. Mixing
imports from both entry points in the same file causes type mismatches, so
each backend is isolated in its own file with its own import.

The Renderer logs which backend was selected at initialization time to aid
debugging, since WebGPU availability varies significantly across browsers
and devices.

## Consequences
- The render loop is identical regardless of which backend is active —
  no conditional logic in the render path
- Adding a third backend in the future requires only a new class implementing
  RenderBackend — Renderer itself does not change
- WebGPU is used in Chrome 113+ and other supporting browsers — Safari and
  older browsers fall back to WebGL automatically
- WebGPURenderer.dispose() must not be called before initialize() completes
  — guarded by an isInitialized flag in WebGPUBackend
- A known WASM memory exhaustion issue occurs when entities tick
  indefinitely without being despawned — this is a entity lifecycle concern
  tracked for resolution in Phase 8, not a rendering backend concern
- three/webgpu re-exports all core Three.js types, so files importing
  WebGPU-specific types should import from three/webgpu rather than
  mixing three and three/webgpu imports
