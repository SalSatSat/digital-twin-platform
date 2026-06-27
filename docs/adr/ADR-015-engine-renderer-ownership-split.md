# ADR-015: Engine and Renderer Ownership Split

## Status
Accepted

## Date
2026-06-27

## Context
In Phase 4, the Renderer class owned both the Three.js scene and the WASM
EngineWorld together. This meant nothing outside the Renderer could access
ECS state, multiple consumers could not share the same world, and adding
a second render backend (WebGPU) would require duplicating ECS ownership
logic. As the platform grows toward multiple cameras, an editor, and a
hierarchy panel, all of which need access to ECS state, this coupling
became a blocker.

## Decision
We split ownership into two classes. Engine owns the WASM EngineWorld and
exposes a clean API for ticking the world and reading entity state. Renderer
owns the Three.js scene, camera, and WebGL renderer, and receives an Engine
reference at construction time to read from. EngineView creates and manages
the lifecycle of both.

## Reasoning
The ECS is the single source of truth for all entity state. Making it
independently accessible — not locked inside a renderer — means any future
consumer (editor panels, hierarchy view, debug tools, a second camera) can
read from it without going through the renderer. The renderer becomes a
pure consumer of state rather than an owner of it.

Receiving Engine as a constructor argument rather than creating it internally
keeps the Renderer focused on rendering concerns only. It also makes the
boundary explicit — the Renderer does not initialize WASM, does not spawn
entities, and does not manage ECS lifecycle. Those responsibilities belong
to Engine alone.

EngineView in the React layer owns both objects and manages their combined
lifecycle via useEffect, ensuring both are created together and disposed
together when the component unmounts.

## Consequences
- Any future consumer of ECS state receives an Engine reference directly
  rather than going through the Renderer
- Adding a second render backend (WebGPU) in Phase 6 requires only a new
  Renderer implementation — Engine is unchanged
- Multiple cameras can be implemented as multiple Renderer instances sharing
  one Engine, without duplicating ECS state
- The Renderer has no fallback if Engine is not initialized before setup()
  is called — this is enforced by Engine.assertInitialized() throwing early
  with a clear error message
- EngineView is responsible for correct ordering: initialize Engine first,
  then call Renderer.setup(), then Renderer.start()
