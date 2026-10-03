# ADR-035: Inspector Euler Rotation Convention (YXZ)

## Status
Accepted

## Date
2026-10-04

## Context
The Inspector edits rotation as three Euler angles, while storage stays a
quaternion. `LocalTransformView` (`engine/wasm/src/reflection.rs`) converts
between them. It originally used intrinsic XYZ order, laid out as [pitch,
yaw, roll]. In XYZ order the middle axis is Y, and a decomposition can only
report the middle axis within +/-90 degrees. Yaw is the most common rotation
in a Y-up scene, so turning an entity past a quarter-circle with the
transform gizmo made the Inspector flip to an equivalent triple: 91 degrees
of yaw read back as (-180, 89, -180). The rotation itself was correct (the
entity was oriented as dragged), but the displayed numbers were confusing.

## Decision
Convert with intrinsic YXZ order: yaw, then pitch, then roll, composed as
Ry * Rx * Rz. The JSON layout stays [pitch (X), yaw (Y), roll (Z)], so the
Inspector fields and their meaning for single-axis edits are unchanged. This
is equivalent to Unity's documented order (rotations applied around Z, then
X, then Y), and matches the order the editor camera controls already use for
look rotation.

## Reasoning
Putting yaw on the outermost axis lets it turn freely through +/-180
degrees, so the common case reads sensibly. The +/-90 degree decomposition
limit moves to pitch, where it is the familiar gimbal limit and matters
least. A quaternion-to-Euler conversion cannot avoid ambiguity somewhere,
so the choice is which axis carries it.

The change was cheap because no persisted data used the old convention: no
scene file or scene definition stores Euler rotations, and the order appears
only in `LocalTransformView`. It was made before scene persistence (Phase 27)
so the persisted format would start with the right convention.

## Consequences
Values with two or more non-zero axes now mean a different orientation than
under XYZ; single-axis values are unchanged. Pitch beyond +/-90 degrees still
reads back as an equivalent triple, as in Unity. Any future persisted format
or importer that stores Euler angles must state this order explicitly.
