# ADR-003: Renderer Ownership

## Status
Accepted

## Date
2026-06-06

## Context
The renderer package sits inside `client/` but requires deep graphics
programming knowledge — WebGPU pipeline design, Three.js scene graph
management, draw call optimization, and WebGL fallback strategy. We needed
to decide which team owns it and how it integrates with the React frontend.

## Decision
The engine team owns `client/renderer/`. It is a separate pnpm workspace
package consumed by `client/app/` through a clean TypeScript API. The web
team consumes the renderer but does not maintain its internals.

## Reasoning
The renderer is physically inside `client/` because it is a TypeScript package
that runs in the browser — it is not compiled to WASM and is not part of the
Rust workspace. However, the knowledge required to build and maintain it
belongs to the engine team. Assigning it to the web team would require web
developers to understand GPU pipelines, which is unreasonable. Assigning it
to the engine team gives graphics programmers full ownership of the rendering
pipeline in the language and environment they are working in. The package
boundary enforced by pnpm workspaces makes the API surface between the two
teams explicit and versioned.

## Consequences
- The engine team works across three languages — Rust, WASM bindings, and
  TypeScript — which is a significant toolchain surface for one team
- The web team has a stable, typed API to mount and interact with the renderer
  without understanding its internals
- Changes to the renderer's internal pipeline do not require web team
  involvement unless the public API changes
- The devcontainer must support all three toolchains for the engine team
