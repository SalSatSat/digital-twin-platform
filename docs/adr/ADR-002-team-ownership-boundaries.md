# ADR-002: Team Ownership Boundaries

## Status

Accepted

## Date

2026-06-06

## Context

The platform has two distinct engineering disciplines — web developers familiar
with React and Go, and engine developers familiar with graphics programming,
Rust, and WebAssembly. We needed a folder structure that reflects and enforces
these ownership boundaries without creating unnecessary friction between teams.

## Decision

Top-level directories map directly to team ownership. The web team owns
`client/app/` and `server/`. The engine team owns `engine/` and
`client/renderer/`. The `shared/` directory is a neutral zone requiring
cross-team review.

## Reasoning

Placing the renderer under `client/` rather than `engine/` was initially
considered, but the renderer is a graphics programming concern — it owns the
Three.js scene graph, WebGPU pipeline, and draw call strategy. These are
engine team responsibilities, not web team responsibilities. The web team
consumes the renderer through a clean API but does not maintain it. Mapping
ownership to folder structure makes this boundary visible and mechanical
rather than implicit and conversational.

## Consequences

- Team members know which directories they own without documentation
- The renderer and engine share a team, reducing the API surface that needs
  formal coordination
- The web team can work on React and Go independently of engine concerns
- Cross-boundary changes require explicit coordination via the shared/ layer
- As the team grows, ownership can be enforced via code review assignments
  mapped to directory paths
