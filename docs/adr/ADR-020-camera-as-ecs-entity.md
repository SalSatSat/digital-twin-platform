# ADR-020: Camera as ECS Entity

## Status
Accepted

## Date
2026-07-18

## Context
The platform needed multiple camera support — specifically a Scene Camera
for editor navigation and a Runtime Camera for the deployed experience.
The question was whether cameras should be special objects managed outside
the ECS, or first-class ECS entities like any other object in the world.

## Decision
Cameras are ECS entities. A CameraComponent attached to an entity defines
its projection properties. The entity's Transform defines its position and
orientation. The active camera is tracked as a separate handle in EngineWorld
rather than as a flag on CameraComponent.

## Reasoning
Treating cameras as ECS entities means they can be queried, moved by systems,
parented to other entities, serialized, and managed through the same lifecycle
as everything else in the world. A special-cased camera object would require
parallel management infrastructure. CameraBundle ensures every camera entity
always has Transform, EntityInfo, HierarchyNode, and CameraComponent — the
same base components as all other entities, plus the camera-specific data.

The active camera is tracked as active_camera_handle: Option<u32> on
EngineWorld rather than as an is_active flag on CameraComponent for two
reasons. First, it avoids the invariant problem of multiple cameras
accidentally having is_active = true simultaneously. Second, the active
camera is global state — it belongs at the world level, not on an individual
component.

The CameraComponent stores projection type as a ProjectionType enum with
Perspective and Orthographic variants. This covers the two projection types
needed for editor and runtime use without premature abstraction.

Transform was extended with rotation: Quat in this phase because a camera
without orientation is always looking in one fixed direction, making scene
navigation impossible. The builder pattern — Transform::new(position)
.with_rotation(rotation) — was chosen over multiple constructors because
it scales cleanly as more fields are added (scale in a future phase) without
requiring a new named constructor per combination.

The renderer maintains a Map of camera handle to Three.js
PerspectiveCamera. Each frame it reads the active camera handle from the
Engine and uses the corresponding Three.js camera for rendering. A fallback
camera is kept for the period between renderer construction and the first
ECS camera being set as active.

## Consequences
- Cameras participate in the full ECS lifecycle — they can be spawned,
  despawned, queried, and moved by systems
- The Scene Camera uses the Editor context and the Runtime Camera uses the
  Runtime context, making it straightforward to filter cameras by deployment
  context in future systems
- Camera transforms are read from the ECS each frame and applied to Three.js
  cameras — there is one source of truth for camera position and orientation
- The fallback camera in the renderer is a temporary measure — once scene
  management is introduced in Phase 10, the active camera will always be
  set before rendering begins
- Orthographic cameras are defined in CameraBundle but the renderer
  currently only creates PerspectiveCamera instances — orthographic
  rendering support will be added when needed
