# ADR-022: Camera Controls and ECS Write-Back

## Status
Accepted

## Date
2026-07-25

## Context
Phase 11 introduced Unity-editor-style camera controls for the Scene Camera.
This required two design decisions: where camera controls live in the
architecture, and how to handle the data flow direction — controls produce
camera transform data that must be written back to the ECS, which is the
opposite of the normal ECS-to-renderer flow.

## Decision
Camera controls live in client/renderer/ as a CameraControls class that
operates on a Three.js PerspectiveCamera. A write-back callback is injected
by SceneManager when controls are attached to the Scene Camera. Each frame,
after updating the Three.js camera transform, controls call the callback with
the new position and rotation. The callback calls engine.setCameraTransform()
which writes the values to the ECS entity via a new set_camera_transform()
WASM method.

## Reasoning
Camera controls are a renderer concern — they translate user input into camera
transform changes. Placing them in client/renderer/ is consistent with the
team ownership boundary where the engine team owns the renderer. The write-back
callback pattern decouples CameraControls from Engine — CameraControls does
not need to import or know about the Engine class. SceneManager provides the
callback because it owns the relationship between camera handles and Three.js
cameras. This keeps CameraControls reusable and testable in isolation.

The normal data flow is ECS → renderer (ECS is source of truth). Camera
controls introduce a legitimate exception — the user is the authority on
where the Scene Camera is, not the ECS. Writing back to the ECS ensures the
camera position is persisted when scene serialization is introduced in a
later phase. Without write-back, the ECS and renderer would diverge every
time the user moved the camera.

## Consequences
- CameraControls is decoupled from Engine via the write-back callback
- SceneManager owns control attachment and detachment as part of scene
  lifecycle — controls are attached after loadScene() and detached in
  unloadScene()
- The ECS is kept as the source of truth for camera position even when
  the renderer is the authority on user input
- Camera controls currently only apply to the active Scene Camera —
  switching the active camera requires reattaching controls
- The F key conflict between fullscreen toggle (Renderer) and camera
  fly mode is not an issue because fly mode requires right mouse button
  to be held simultaneously
