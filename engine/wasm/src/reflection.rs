//! Generic component reflection for the Runtime Editor Inspector panel.
//!
//! Lives at the WASM boundary (not in engine/core) because it's purely
//! a translation layer between ECS storage and JSON for JavaScript —
//! it has no gameplay logic of its own. See Phase 13 design discussion
//! for the full reasoning behind each choice below.

use dt_engine_core::components::{
    CameraComponent, EntityInfo, LocalTransform, ProjectionType, Velocity,
};
use dt_engine_core::world::World;
use glam::{EulerRot, Quat, Vec3};
use hecs::Entity;
use serde::{Deserialize, Serialize};

/// Identifies a reflectable component type for the Inspector.
///
/// Deliberately does NOT include WorldTransform or HierarchyNode:
/// - WorldTransform is derived state, recomputed every tick by
///   HierarchySystem from LocalTransform + the parent chain. There's
///   no sane "write" path for it — editing it would just be silently
///   overwritten on the next tick.
/// - HierarchyNode mutation must go through World::set_parent() /
///   remove_parent() to preserve cycle detection. Exposing it as a
///   generic writable field would bypass that entirely.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComponentKind {
    LocalTransform,
    Camera,
    Velocity,
    EntityInfo,
}

impl ComponentKind {
    /// String encoding used at the WASM boundary — JS can't see the
    /// Rust enum directly, so component kind travels as a string.
    pub fn as_str(self) -> &'static str {
        match self {
            ComponentKind::LocalTransform => "LocalTransform",
            ComponentKind::Camera => "Camera",
            ComponentKind::Velocity => "Velocity",
            ComponentKind::EntityInfo => "EntityInfo",
        }
    }

    /// Named from_str rather than implementing std::str::FromStr —
    /// deliberately avoids pulling in the trait (and its Err-type
    /// requirement) for what's just a fixed lookup table.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "LocalTransform" => Some(Self::LocalTransform),
            "Camera" => Some(Self::Camera),
            "Velocity" => Some(Self::Velocity),
            "EntityInfo" => Some(Self::EntityInfo),
            _ => None,
        }
    }
}

/// Errors that can occur when reading or writing a component through
/// the reflection layer.
#[derive(Debug)]
pub enum ReflectError {
    /// The entity does not exist in the World (or was despawned).
    EntityNotFound,
    /// The entity exists, but does not have this component.
    ComponentNotPresent,
    /// The JSON payload didn't match the expected shape for this component.
    DeserializationFailed(String),
    /// The payload deserialized fine, but failed a semantic check
    /// (e.g. an unregistered category, or near >= far on a camera).
    ValidationFailed(String),
}

/// One entry per reflectable component. `to_json`/`from_json` own any
/// conversion between the component's storage shape and its JSON wire
/// shape (see `LocalTransformView` below for why these can differ).
///
/// `from_json` takes `&mut World`, not a separate `&EntityRegistry` —
/// `World::registry` is a public field, so any implementation that
/// needs registry access (EntityInfo's category/context validation)
/// reads it directly from the World it already has.
pub struct ComponentDescriptor {
    pub kind: ComponentKind,
    pub display_name: &'static str,
    pub has: fn(&World, Entity) -> bool,
    pub to_json: fn(&World, Entity) -> Result<serde_json::Value, ReflectError>,
    pub from_json: fn(&mut World, Entity, serde_json::Value) -> Result<(), ReflectError>,
}

/// The full set of reflectable components. Add one entry here — and
/// the has/to_json/from_json functions below — to make a new component
/// type editable in the Inspector.
pub fn registry() -> &'static [ComponentDescriptor] {
    &[
        ComponentDescriptor {
            kind: ComponentKind::LocalTransform,
            display_name: "Transform",
            has: local_transform_has,
            to_json: local_transform_to_json,
            from_json: local_transform_from_json,
        },
        ComponentDescriptor {
            kind: ComponentKind::Velocity,
            display_name: "Velocity",
            has: velocity_has,
            to_json: velocity_to_json,
            from_json: velocity_from_json,
        },
        ComponentDescriptor {
            kind: ComponentKind::Camera,
            display_name: "Camera",
            has: camera_has,
            to_json: camera_to_json,
            from_json: camera_from_json,
        },
        ComponentDescriptor {
            kind: ComponentKind::EntityInfo,
            display_name: "Entity Info",
            has: entity_info_has,
            to_json: entity_info_to_json,
            from_json: entity_info_from_json,
        },
    ]
}

/// Looks up an entity's reflectable components by probing hecs directly
/// (via World::get_component's is_ok()) — intentionally not a tracked
/// manifest. A second tracker could drift from the World's real state;
/// probing cannot, since it reads the same storage the ECS itself uses.
pub fn list_components(world: &World, entity: Entity) -> Vec<ComponentKind> {
    registry()
        .iter()
        .filter(|descriptor| (descriptor.has)(world, entity))
        .map(|descriptor| descriptor.kind)
        .collect()
}

/// Finds the descriptor for a given kind. Shared by lib.rs's
/// get_component_json/set_component_json so the lookup logic exists
/// in exactly one place, rather than each caller re-searching registry().
pub fn find_descriptor(kind: ComponentKind) -> Option<&'static ComponentDescriptor> {
    registry().iter().find(|d| d.kind == kind)
}

// ─── Velocity ───────────────────────────────────────────────────────────
// Plain pass-through: Velocity's storage shape and wire shape are
// identical, so this is the simplest possible descriptor implementation.

fn velocity_has(world: &World, entity: Entity) -> bool {
    world.get_component::<Velocity>(entity).is_ok()
}

fn velocity_to_json(world: &World, entity: Entity) -> Result<serde_json::Value, ReflectError> {
    let velocity = world
        .get_component::<Velocity>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    serde_json::to_value(*velocity).map_err(|e| ReflectError::DeserializationFailed(e.to_string()))
}

fn velocity_from_json(
    world: &mut World,
    entity: Entity,
    json: serde_json::Value,
) -> Result<(), ReflectError> {
    if !world.contains(entity) {
        return Err(ReflectError::EntityNotFound);
    }
    let new_velocity: Velocity = serde_json::from_value(json)
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))?;
    let mut velocity = world
        .get_component_mut::<Velocity>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    *velocity = new_velocity;
    Ok(())
}

// ─── LocalTransform ─────────────────────────────────────────────────────
// LocalTransformView exists because the wire shape (Euler degrees) must
// differ from the storage shape (Quat) — see Phase 13 design discussion.
// This is the pattern to follow for any future component with the same
// need; LocalTransform itself is untouched, no serde derive added to it.

/// JSON-facing shape of LocalTransform. Rotation is intrinsic XYZ Euler
/// angles in degrees — [pitch, yaw, roll] — chosen for Inspector
/// editability; storage stays quaternion-based to avoid gimbal lock
/// and drift during runtime composition.
#[derive(Serialize, Deserialize)]
struct LocalTransformView {
    position: Vec3,
    rotation_euler_deg: [f32; 3],
}

fn local_transform_has(world: &World, entity: Entity) -> bool {
    world.get_component::<LocalTransform>(entity).is_ok()
}

fn local_transform_to_json(
    world: &World,
    entity: Entity,
) -> Result<serde_json::Value, ReflectError> {
    let transform = world
        .get_component::<LocalTransform>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    let (x, y, z) = transform.rotation.to_euler(EulerRot::XYZ);
    let view = LocalTransformView {
        position: transform.position,
        rotation_euler_deg: [x.to_degrees(), y.to_degrees(), z.to_degrees()],
    };
    serde_json::to_value(&view).map_err(|e| ReflectError::DeserializationFailed(e.to_string()))
}

fn local_transform_from_json(
    world: &mut World,
    entity: Entity,
    json: serde_json::Value,
) -> Result<(), ReflectError> {
    if !world.contains(entity) {
        return Err(ReflectError::EntityNotFound);
    }
    let view: LocalTransformView = serde_json::from_value(json)
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))?;
    let [pitch, yaw, roll] = view.rotation_euler_deg;
    let rotation = Quat::from_euler(
        EulerRot::XYZ,
        pitch.to_radians(),
        yaw.to_radians(),
        roll.to_radians(),
    );
    let mut transform = world
        .get_component_mut::<LocalTransform>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    transform.position = view.position;
    transform.rotation = rotation;
    Ok(())
}

// ─── Camera ─────────────────────────────────────────────────────────────
// Direct serde derive on CameraComponent/ProjectionType (no view type) —
// unlike LocalTransform, the enum's default externally-tagged JSON shape
// is already what the frontend's variant selector needs. What Camera
// DOES need that Velocity/LocalTransform don't: a semantic validation
// step before write. near >= far is nonsensical for either projection
// variant and would produce a broken/invisible camera with no clear
// cause — reject-and-report rather than silently clamp (see design
// discussion). fov_degrees/size range validation is deliberately NOT
// added here — that was explicitly deferred to a later pass, not an
// oversight.

fn camera_has(world: &World, entity: Entity) -> bool {
    world.get_component::<CameraComponent>(entity).is_ok()
}

fn camera_to_json(world: &World, entity: Entity) -> Result<serde_json::Value, ReflectError> {
    let camera = world
        .get_component::<CameraComponent>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    serde_json::to_value(*camera).map_err(|e| ReflectError::DeserializationFailed(e.to_string()))
}

/// Checks near < far for whichever projection variant is active.
/// Both variants carry near/far, so this doesn't need to branch on
/// what the frontend is allowed to send — just on what's physically
/// sane once we have concrete values.
fn validate_projection(projection: &ProjectionType) -> Result<(), ReflectError> {
    let (near, far) = match projection {
        ProjectionType::Perspective { near, far, .. } => (*near, *far),
        ProjectionType::Orthographic { near, far, .. } => (*near, *far),
    };
    if near >= far {
        return Err(ReflectError::ValidationFailed(format!(
            "near ({near}) must be less than far ({far})"
        )));
    }
    Ok(())
}

fn camera_from_json(
    world: &mut World,
    entity: Entity,
    json: serde_json::Value,
) -> Result<(), ReflectError> {
    if !world.contains(entity) {
        return Err(ReflectError::EntityNotFound);
    }
    let new_camera: CameraComponent = serde_json::from_value(json)
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))?;
    // Validate BEFORE touching the World — same "no partial mutation
    // on failure" principle World::set_parent() follows for cycles.
    validate_projection(&new_camera.projection)?;
    let mut camera = world
        .get_component_mut::<CameraComponent>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    *camera = new_camera;
    Ok(())
}

// ─── EntityInfo ─────────────────────────────────────────────────────────
// Asymmetric read/write shape — a variant of the LocalTransformView
// pattern, but for a different reason. LocalTransform needed a view type
// because storage and wire VALUES differ (quat vs euler). EntityInfo's
// storage and wire values are identical, but the WRITE surface must be
// smaller than the read surface: `id` is shown to the user (to_json uses
// the full EntityInfo, id included) but must never be attacker/client
// -settable (from_json deserializes into EntityInfoWrite, which simply
// has no `id` field — there's no code path that could accidentally wire
// a client-supplied id back into the component, because the type doesn't
// carry one).
//
// category/contexts also get validated against World::registry before
// write — this is the "registry validation" HANDOFF.md flagged as
// relevant to Phase 13, now concretely implemented.

/// Write-only shape for EntityInfo. Deliberately excludes `id` — see
/// module doc comment above for why omission (not a runtime check) is
/// the enforcement mechanism for id being read-only.
#[derive(Deserialize)]
struct EntityInfoWrite {
    name: String,
    enabled: bool,
    visible: bool,
    category: String,
    contexts: Vec<String>,
}

fn entity_info_has(world: &World, entity: Entity) -> bool {
    world.get_component::<EntityInfo>(entity).is_ok()
}

fn entity_info_to_json(world: &World, entity: Entity) -> Result<serde_json::Value, ReflectError> {
    let info = world
        .get_component::<EntityInfo>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    // Full struct, including id — read side shows everything.
    serde_json::to_value(&*info).map_err(|e| ReflectError::DeserializationFailed(e.to_string()))
}

fn entity_info_from_json(
    world: &mut World,
    entity: Entity,
    json: serde_json::Value,
) -> Result<(), ReflectError> {
    if !world.contains(entity) {
        return Err(ReflectError::EntityNotFound);
    }
    let write: EntityInfoWrite = serde_json::from_value(json)
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))?;

    // Validate category/contexts against World::registry BEFORE touching
    // the component — same "no partial mutation on failure" principle
    // as camera_from_json and World::set_parent().
    if !world.registry.category_exists(&write.category) {
        return Err(ReflectError::ValidationFailed(format!(
            "category '{}' is not registered",
            write.category
        )));
    }
    for context in &write.contexts {
        if !world.registry.context_exists(context) {
            return Err(ReflectError::ValidationFailed(format!(
                "context '{context}' is not registered"
            )));
        }
    }

    let mut info = world
        .get_component_mut::<EntityInfo>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    info.name = write.name;
    info.enabled = write.enabled;
    info.visible = write.visible;
    info.category = write.category;
    info.contexts = write.contexts;
    // info.id is never assigned here — EntityInfoWrite has no id field,
    // so there is nothing to assign it from.
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn velocity_round_trips_through_json() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, Velocity::new(Vec3::new(1.0, 2.0, 3.0)))
            .unwrap();

        let json = velocity_to_json(&world, entity).unwrap();
        // glam's Vec3 serializes as a JSON array [x, y, z], indexed
        // positionally — not an object with named keys. Worth remembering
        // for the frontend field renderer too.
        assert_eq!(json["value"][0], 1.0);

        let updated = serde_json::json!({ "value": [9.0, 0.0, 0.0] });
        velocity_from_json(&mut world, entity, updated).unwrap();

        let velocity = world.get_component::<Velocity>(entity).unwrap();
        assert_eq!(velocity.value, Vec3::new(9.0, 0.0, 0.0));
    }

    #[test]
    fn velocity_from_json_rejects_missing_entity() {
        let mut world = World::new();
        let entity = world.spawn();
        world.add_component(entity, Velocity::default()).unwrap();
        world.despawn(entity);

        let result = velocity_from_json(&mut world, entity, serde_json::json!({}));
        assert!(matches!(result, Err(ReflectError::EntityNotFound)));
    }

    #[test]
    fn local_transform_round_trips_rotation_through_euler() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, LocalTransform::new(Vec3::ZERO))
            .unwrap();

        // A 90-degree yaw is exactly representable — good for asserting
        // without floating-point tolerance headaches.
        let json = serde_json::json!({
            "position": [0.0, 0.0, 0.0],
            "rotation_euler_deg": [0.0, 90.0, 0.0]
        });
        local_transform_from_json(&mut world, entity, json).unwrap();

        let result = local_transform_to_json(&world, entity).unwrap();
        let yaw = result["rotation_euler_deg"][1].as_f64().unwrap();
        assert!((yaw - 90.0).abs() < 0.001);
    }

    #[test]
    fn list_components_finds_present_components_only() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, LocalTransform::new(Vec3::ZERO))
            .unwrap();
        // No Velocity attached.

        let kinds = list_components(&world, entity);
        assert!(kinds.contains(&ComponentKind::LocalTransform));
        assert!(!kinds.contains(&ComponentKind::Velocity));
    }

    #[test]
    fn camera_round_trips_through_json() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, CameraComponent::perspective())
            .unwrap();

        let json = camera_to_json(&world, entity).unwrap();
        // ProjectionType's default externally-tagged shape:
        // { "projection": { "Perspective": { "fov_degrees": 75.0, ... } } }
        assert_eq!(json["projection"]["Perspective"]["fov_degrees"], 75.0);

        let updated = serde_json::json!({
            "projection": { "Orthographic": { "size": 5.0, "near": 0.1, "far": 100.0 } }
        });
        camera_from_json(&mut world, entity, updated).unwrap();

        let camera = world.get_component::<CameraComponent>(entity).unwrap();
        assert!(matches!(
            camera.projection,
            ProjectionType::Orthographic { size, .. } if size == 5.0
        ));
    }

    #[test]
    fn camera_from_json_rejects_near_greater_than_far() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, CameraComponent::perspective())
            .unwrap();

        // near (100.0) >= far (10.0) — physically nonsensical, must be
        // rejected rather than silently swapped or clamped.
        let invalid = serde_json::json!({
            "projection": { "Perspective": { "fov_degrees": 60.0, "near": 100.0, "far": 10.0 } }
        });
        let result = camera_from_json(&mut world, entity, invalid);
        assert!(matches!(result, Err(ReflectError::ValidationFailed(_))));

        // And critically: the rejected write must not have partially
        // applied. The camera should still hold its original values.
        let camera = world.get_component::<CameraComponent>(entity).unwrap();
        assert!(matches!(
            camera.projection,
            ProjectionType::Perspective { fov_degrees, .. } if fov_degrees == 75.0
        ));
    }

    #[test]
    fn entity_info_round_trips_writable_fields() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, EntityInfo::new("Original Name"))
            .unwrap();

        let updated = serde_json::json!({
            "name": "Renamed",
            "enabled": false,
            "visible": true,
            "category": "Default",
            "contexts": ["Runtime"]
        });
        entity_info_from_json(&mut world, entity, updated).unwrap();

        let info = world.get_component::<EntityInfo>(entity).unwrap();
        assert_eq!(info.name, "Renamed");
        assert!(!info.enabled);
        assert_eq!(info.contexts, vec!["Runtime".to_string()]);
    }

    #[test]
    fn entity_info_from_json_cannot_overwrite_id() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, EntityInfo::new("Original Name"))
            .unwrap();
        let original_id = world.get_component::<EntityInfo>(entity).unwrap().id;

        // Even if a client sent an "id" field, EntityInfoWrite has no
        // such field to deserialize it into — serde_json::from_value
        // simply ignores unknown keys by default, so this proves the
        // real component's id is untouched rather than merely unread.
        let payload_with_id = serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000000",
            "name": "Renamed",
            "enabled": true,
            "visible": true,
            "category": "Default",
            "contexts": ["Universal"]
        });
        entity_info_from_json(&mut world, entity, payload_with_id).unwrap();

        let info = world.get_component::<EntityInfo>(entity).unwrap();
        assert_eq!(info.id, original_id);
    }

    #[test]
    fn entity_info_from_json_rejects_unregistered_category() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, EntityInfo::new("Test"))
            .unwrap();

        let invalid = serde_json::json!({
            "name": "Test",
            "enabled": true,
            "visible": true,
            "category": "NotARealCategory",
            "contexts": ["Universal"]
        });
        let result = entity_info_from_json(&mut world, entity, invalid);
        assert!(matches!(result, Err(ReflectError::ValidationFailed(_))));

        // Rejected write must not have partially applied.
        let info = world.get_component::<EntityInfo>(entity).unwrap();
        assert_eq!(info.category, "Default");
    }

    #[test]
    fn entity_info_from_json_rejects_unregistered_context() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, EntityInfo::new("Test"))
            .unwrap();

        let invalid = serde_json::json!({
            "name": "Test",
            "enabled": true,
            "visible": true,
            "category": "Default",
            "contexts": ["Universal", "NotARealContext"]
        });
        let result = entity_info_from_json(&mut world, entity, invalid);
        assert!(matches!(result, Err(ReflectError::ValidationFailed(_))));
    }
}
