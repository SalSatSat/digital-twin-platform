# ADR-009: ECS Library Selection

## Status

Accepted

## Date

2026-06-06

## Context

The engine core requires an ECS implementation. The options considered were
bevy_ecs (standalone), hecs, specs, and a custom implementation. Each has
different tradeoffs around API complexity, performance, WASM compatibility,
and learning curve.

## Decision

We use hecs for entity and component storage, and build the system scheduler
ourselves on top of it.

## Reasoning

bevy_ecs is the most featureful option but is designed to work within the
full Bevy engine. Using it standalone means working against assumptions baked
in for that context. specs is the oldest Rust ECS and has largely been
superseded by newer alternatives — its API is verbose and its storage model
is slower than archetype-based alternatives. A fully custom implementation
would provide the deepest learning but costs significant time and produces
an unproven result.

hecs was chosen because it provides correct, fast, archetype-based entity
and component storage without prescribing a system scheduler. Its minimal
API surface means the concepts map directly to ECS fundamentals rather than
a framework's abstractions over those concepts. Building the system scheduler
ourselves gives us full control over the tick loop, which is a requirement
for city-scale performance and WASM integration. hecs has first-class WASM
support and a stable, well-tested implementation.

## Consequences

- Entity and component storage is handled by a battle-tested library
- The system scheduler, tick loop, and WASM integration are our own
  responsibility — more work but more control
- The hecs API is intentionally minimal, meaning some operations require
  more explicit code than a full-featured ECS framework would need
- Upgrading hecs is straightforward since our World wrapper isolates the
  rest of the codebase from direct hecs API calls
- The planned Bundle refactor for EntityFactory will be implemented once
  the team has sufficient Rust generics experience
