# ADR-012: WASM Boundary Design

## Status

Accepted

## Date

2026-06-13

## Context

The Rust ECS core must be callable from JavaScript in the browser. This
requires a deliberate boundary design — JavaScript cannot work with Rust
types directly, and some Rust types cannot cross the WASM boundary without
translation. The boundary design affects API ergonomics, type safety, and
future extensibility.

## Decision

We introduce a dedicated engine/wasm crate that wraps engine/core and exposes
a JavaScript-friendly API via wasm-bindgen. Entity IDs are represented as u32
handles at the boundary, backed by a Vec of hecs Entity values inside the
WASM layer.

## Reasoning

The engine/core crate is kept entirely free of WASM concerns. This means it
can always be compiled and tested natively without a browser, and the ECS
logic is never coupled to JavaScript interop requirements. The engine/wasm
crate is the only place that knows about wasm-bindgen.

hecs Entity IDs use u64 internally. JavaScript numbers are 64-bit floats
which can only represent integers exactly up to 2^53, making u64 unsafe to
pass directly to JavaScript. The u32 handle approach stores entities in a
Vec inside the WASM layer and exposes their Vec index to JavaScript. This
is safe for our current needs — u32 supports over 4 billion entities — and
can be replaced with a more sophisticated handle system later.

The EngineWorld struct exposed to JavaScript wraps the World, EntityFactory,
and MovementSystem in a single object. This gives JavaScript a single entry
point rather than requiring it to manage multiple Rust objects.

## Consequences

- engine/core remains pure Rust with no WASM dependencies — fully testable
  natively
- engine/wasm is the single translation layer between Rust and JavaScript
- The u32 handle approach is a simplification — entity handles are never
  reused after despawn in the current implementation, meaning the Vec grows
  monotonically. A handle recycling system should be added when the platform
  needs to support frequent entity creation and destruction
- wasm-pack produces a pkg/ directory containing the compiled WASM binary
  and generated JavaScript bindings — this is build output and is gitignored
- The JavaScript API is strongly typed via generated TypeScript definitions,
  giving the renderer and frontend type-safe access to the engine
