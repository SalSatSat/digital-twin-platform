# ADR-021: Scene Definition and SceneManager

## Status
Accepted

## Date
2026-07-25

## Context
The Renderer.setup() method had accumulated all scene content —
camera spawning, light creation, entity spawning — directly inside it.
This made the Renderer responsible for both rendering infrastructure
and scene content, which violated the single responsibility principle
and made it impossible to load different scenes or change scene content
without modifying the Renderer itself.

## Decision
We introduced a SceneDefinition interface as a pure data structure
describing scene content, and a SceneManager class that bridges
SceneDefinition data with runtime Engine and Three.js state. The
Renderer delegates all scene content management to SceneManager and
retains only rendering infrastructure responsibilities.

## Reasoning
A SceneDefinition is pure data — it has no runtime state and can be
serialized, loaded from a file, or constructed programmatically. The
SceneManager is the runtime bridge that takes that data and spawns
the corresponding ECS entities, Three.js cameras, and lights. Keeping
these two concepts separate means scene content can change without
touching the Renderer, and the Renderer can render any scene without
knowing its specific contents.

The DEFAULT_SCENE constant defines the initial scene loaded on startup.
It is explicit about what exists — two cameras with their contexts,
two lights with their properties, and three dynamic entities with
their names, positions, velocities, and colors. This replaces the
previous hardcoded setup() method which had the same information
but embedded in imperative code rather than declarative data.

The Renderer retains a fallback camera for the brief period between
construction and the first scene being loaded. Once a scene is loaded,
the active camera always comes from SceneManager.

## Consequences
- Loading a different scene requires only calling
  sceneManager.loadScene(newScene) — no Renderer changes needed
- Scene content is declarative and readable — the DEFAULT_SCENE
  constant is self-documenting
- The Renderer's responsibilities are now strictly rendering:
  backend selection, render loop, resize handling, keyboard input
- SceneManager owns the boundary despawn/respawn logic for dynamic
  entities — this is temporary until a proper spatial management
  system is introduced
- Scene serialization and loading from files is a natural next step
  that this architecture supports without structural changes
