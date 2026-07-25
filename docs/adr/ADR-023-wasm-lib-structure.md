# ADR-023: WASM Binding Layer Structure

## Status
Accepted

## Date
2026-07-25

## Context
During Phase 11 a TODO comment in engine/wasm/src/lib.rs suggested splitting
the file into engine_world.rs and handles.rs when it exceeded comfortable
reading size. After reviewing the file at approximately 200 lines, the split
was reconsidered.

## Decision
engine/wasm/src/lib.rs remains as a single file. The TODO comment was
replaced with a module-level doc comment. The file will be split when a
genuinely separate concern with its own lifecycle emerges — such as a physics
or audio WASM module — not purely based on line count.

## Reasoning
The file has two natural groupings already provided by Rust's impl block
syntax: the public #[wasm_bindgen] impl block for JavaScript-facing methods,
and the private impl block for internal helpers like allocate_handle(). This
structure is clear and navigable at the current size. Splitting into
engine_world.rs would move the same code to a different filename with no
reduction in complexity. The split would be justified when a new system
introduces a separate EngineWorld concern — for example, a PhysicsWorld or
AudioWorld with its own initialization lifecycle. At that point the module
boundary would reflect a real architectural boundary rather than an
arbitrary line count threshold.

## Consequences
- engine/wasm/src/ contains only lib.rs — simple to navigate
- Future WASM modules (physics, audio) will each get their own file
  when they are introduced, creating a natural module structure
- The lib.rs file will grow as more WASM methods are added — this
  should be reviewed again if it exceeds approximately 400 lines
