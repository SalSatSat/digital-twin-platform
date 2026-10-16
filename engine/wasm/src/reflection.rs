//! Generic component reflection for the Runtime Editor Inspector panel.
//!
//! Lives at the WASM boundary (not in engine/core) because it's purely
//! a translation layer between ECS storage and JSON for JavaScript —
//! it has no gameplay logic of its own.

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

    /// Stable numeric id used in change events (ADR-036). Explicit values,
    /// not a cast of the enum, so reordering the enum cannot silently change
    /// the wire format. Mirrored in TypeScript.
    pub fn id(self) -> u32 {
        match self {
            ComponentKind::LocalTransform => 0,
            ComponentKind::Camera => 1,
            ComponentKind::Velocity => 2,
            ComponentKind::EntityInfo => 3,
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
    /// The entity already has this component. Adds are strict (ADR-037).
    ComponentAlreadyPresent,
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
    /// `Some` only for components that may be added and removed after
    /// spawn (ADR-037). `None` marks a mandatory component.
    pub optional: Option<OptionalOps>,
}

/// Structural operations of an optional component. Kept in one `Option`
/// on the descriptor so a mandatory component cannot carry add/remove
/// functions, and an optional one cannot lack them.
pub struct OptionalOps {
    /// Adds the component from its full wire JSON (what `to_json` returns).
    /// The caller has already checked entity, kind and absence.
    pub add_from_json: fn(&mut World, Entity, serde_json::Value) -> Result<(), ReflectError>,
    /// Removes the component. The caller has already checked presence.
    pub remove: fn(&mut World, Entity) -> Result<(), ReflectError>,
    /// The default wire JSON the Inspector offers when adding.
    pub default_json: fn() -> Result<serde_json::Value, ReflectError>,
}

impl ComponentDescriptor {
    /// True when the component may be added or removed after spawn.
    pub fn is_optional(&self) -> bool {
        self.optional.is_some()
    }
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
            optional: None,
        },
        ComponentDescriptor {
            kind: ComponentKind::Velocity,
            display_name: "Velocity",
            has: velocity_has,
            to_json: velocity_to_json,
            from_json: velocity_from_json,
            optional: Some(OptionalOps {
                add_from_json: velocity_add_from_json,
                remove: velocity_remove,
                default_json: velocity_default_json,
            }),
        },
        ComponentDescriptor {
            kind: ComponentKind::Camera,
            display_name: "Camera",
            has: camera_has,
            to_json: camera_to_json,
            from_json: camera_from_json,
            optional: None,
        },
        ComponentDescriptor {
            kind: ComponentKind::EntityInfo,
            display_name: "Entity Info",
            has: entity_info_has,
            to_json: entity_info_to_json,
            from_json: entity_info_from_json,
            optional: None,
        },
    ]
}

/// Serializable view of a ComponentDescriptor's public-facing identity
/// — kind name and display name only, no function pointers.
/// ComponentDescriptor itself can't derive Serialize (it holds fn
/// pointers); this exists so the WASM boundary can expose the static
/// registry to JS without JS needing its own copy of the names.
#[derive(Serialize)]
pub struct ComponentKindInfo {
    pub kind: &'static str,
    pub display_name: &'static str,
    /// True when the Inspector may offer to add or remove this kind.
    pub optional: bool,
}

/// The full registry's kind/display-name pairs, JSON-serializable.
/// Used by EngineWorld::list_component_kinds() (lib.rs) so the
/// Inspector's section headers read from the same names as the rest
/// of the reflection layer, instead of keeping a second hardcoded
/// copy client-side.
pub fn component_kind_infos() -> Vec<ComponentKindInfo> {
    registry()
        .iter()
        .map(|d| ComponentKindInfo {
            kind: d.kind.as_str(),
            display_name: d.display_name,
            optional: d.is_optional(),
        })
        .collect()
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

/// Adds an optional component from its full wire JSON (ADR-037).
///
/// Strict, and the checks live here once so no component re-implements
/// them. In order: the entity exists, the kind is optional, the entity does
/// not already have it, then the component converts the JSON. Nothing is
/// mutated unless every check passes.
// TODO(3d): remove this allow once EngineWorld::add_component_json calls it.
#[allow(dead_code)]
pub fn add_component(
    world: &mut World,
    entity: Entity,
    kind: ComponentKind,
    json: serde_json::Value,
) -> Result<(), ReflectError> {
    if !world.contains(entity) {
        return Err(ReflectError::EntityNotFound);
    }
    let descriptor = find_descriptor(kind)
        .ok_or_else(|| ReflectError::ValidationFailed("unknown component kind".to_string()))?;
    let Some(ops) = descriptor.optional.as_ref() else {
        return Err(ReflectError::ValidationFailed(format!(
            "{} cannot be added",
            kind.as_str()
        )));
    };
    if (descriptor.has)(world, entity) {
        return Err(ReflectError::ComponentAlreadyPresent);
    }
    (ops.add_from_json)(world, entity, json)
}

/// Removes an optional component (ADR-037). Strict: fails if the entity
/// lacks it. Same check order as `add_component`.
// TODO(3d): remove this allow once EngineWorld::remove_component calls it.
#[allow(dead_code)]
pub fn remove_component(
    world: &mut World,
    entity: Entity,
    kind: ComponentKind,
) -> Result<(), ReflectError> {
    if !world.contains(entity) {
        return Err(ReflectError::EntityNotFound);
    }
    let descriptor = find_descriptor(kind)
        .ok_or_else(|| ReflectError::ValidationFailed("unknown component kind".to_string()))?;
    let Some(ops) = descriptor.optional.as_ref() else {
        return Err(ReflectError::ValidationFailed(format!(
            "{} cannot be removed",
            kind.as_str()
        )));
    };
    if !(descriptor.has)(world, entity) {
        return Err(ReflectError::ComponentNotPresent);
    }
    (ops.remove)(world, entity)
}

/// The default wire JSON for an optional kind; `None` for a mandatory kind.
/// A default that failed to serialize also reads as `None`, which the
/// Inspector shows as "cannot add"; the guard test below catches it.
// TODO(3d): remove this allow once EngineWorld::default_component_json calls it.
#[allow(dead_code)]
pub fn default_component_json(kind: ComponentKind) -> Option<serde_json::Value> {
    let ops = find_descriptor(kind)?.optional.as_ref()?;
    (ops.default_json)().ok()
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

/// Adds Velocity from its full wire JSON. Entity, kind and absence were
/// already checked by `add_component`; this only converts.
fn velocity_add_from_json(
    world: &mut World,
    entity: Entity,
    json: serde_json::Value,
) -> Result<(), ReflectError> {
    let velocity: Velocity = serde_json::from_value(json)
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))?;
    world
        .add_component(entity, velocity)
        .map_err(|_| ReflectError::EntityNotFound)
}

fn velocity_remove(world: &mut World, entity: Entity) -> Result<(), ReflectError> {
    world
        .remove_component::<Velocity>(entity)
        .map(|_velocity| ())
        .map_err(|e| match e {
            hecs::ComponentError::NoSuchEntity => ReflectError::EntityNotFound,
            hecs::ComponentError::MissingComponent(_) => ReflectError::ComponentNotPresent,
        })
}

/// A zero Velocity, serialized by the same path as `velocity_to_json`, so
/// the default can never drift from the wire shape.
fn velocity_default_json() -> Result<serde_json::Value, ReflectError> {
    serde_json::to_value(Velocity::default())
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))
}

// ─── LocalTransform ─────────────────────────────────────────────────────
// LocalTransformView exists because the wire shape (Euler degrees) must
// differ from the storage shape (Quat).
// This is the pattern to follow for any future component with the same
// need; LocalTransform itself is untouched, no serde derive added to it.

/// JSON-facing shape of LocalTransform. Rotation is intrinsic YXZ Euler
/// angles in degrees, laid out as [pitch (X), yaw (Y), roll (Z)] and
/// composed as yaw, then pitch, then roll -- equivalent to Unity's
/// Z-then-X-then-Y order. Yaw is the outermost rotation, so it turns
/// freely through +/-180 degrees; only pitch is limited to +/-90 before
/// the decomposition flips to an equivalent triple (the usual gimbal
/// limit). Chosen for Inspector editability; storage stays
/// quaternion-based to avoid gimbal lock and drift during runtime
/// composition. See ADR-035.
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
    // glam returns the angles in the order of the EulerRot variant: yaw, pitch, roll.
    let (yaw, pitch, roll) = transform.rotation.to_euler(EulerRot::YXZ);
    let view = LocalTransformView {
        position: transform.position,
        rotation_euler_deg: [pitch.to_degrees(), yaw.to_degrees(), roll.to_degrees()],
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
        EulerRot::YXZ,
        yaw.to_radians(),
        pitch.to_radians(),
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
// write.

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

    fn spawn_with_local_transform(world: &mut World) -> Entity {
        let entity = world.spawn();
        world
            .add_component(entity, LocalTransform::new(Vec3::ZERO))
            .unwrap();
        entity
    }

    fn set_euler_deg(world: &mut World, entity: Entity, euler: [f32; 3]) {
        let json = serde_json::json!({
            "position": [0.0, 0.0, 0.0],
            "rotation_euler_deg": euler
        });
        local_transform_from_json(world, entity, json).unwrap();
    }

    fn read_euler_deg(world: &World, entity: Entity) -> [f64; 3] {
        let json = local_transform_to_json(world, entity).unwrap();
        let euler = &json["rotation_euler_deg"];
        std::array::from_fn(|i| euler[i].as_f64().unwrap())
    }

    #[test]
    fn local_transform_yaw_past_90_degrees_reads_back_as_pure_yaw() {
        // The reported case: with the old XYZ order, 91 degrees of yaw
        // read back as [-180, 89, -180].
        for yaw in [91.0_f32, 135.0, 179.0, -91.0, -135.0] {
            let mut world = World::new();
            let entity = spawn_with_local_transform(&mut world);

            set_euler_deg(&mut world, entity, [0.0, yaw, 0.0]);

            let [pitch_out, yaw_out, roll_out] = read_euler_deg(&world, entity);
            assert!(pitch_out.abs() < 0.01, "pitch for yaw {yaw}: {pitch_out}");
            assert!(
                (yaw_out - f64::from(yaw)).abs() < 0.01,
                "yaw {yaw}: {yaw_out}"
            );
            assert!(roll_out.abs() < 0.01, "roll for yaw {yaw}: {roll_out}");
        }
    }

    #[test]
    fn local_transform_euler_order_is_yaw_then_pitch_then_roll() {
        let mut world = World::new();
        let entity = spawn_with_local_transform(&mut world);

        set_euler_deg(&mut world, entity, [30.0, 60.0, 15.0]);

        // Built independently of the code under test: Ry * Rx * Rz.
        let expected = Quat::from_rotation_y(60.0_f32.to_radians())
            * Quat::from_rotation_x(30.0_f32.to_radians())
            * Quat::from_rotation_z(15.0_f32.to_radians());
        let actual = world
            .get_component::<LocalTransform>(entity)
            .unwrap()
            .rotation;
        assert!(actual.dot(expected).abs() > 1.0 - 1e-6);
    }

    #[test]
    fn local_transform_round_trips_mixed_euler_angles() {
        let mut world = World::new();
        let entity = spawn_with_local_transform(&mut world);

        set_euler_deg(&mut world, entity, [30.0, 60.0, 15.0]);

        let [pitch, yaw, roll] = read_euler_deg(&world, entity);
        assert!((pitch - 30.0).abs() < 0.01);
        assert!((yaw - 60.0).abs() < 0.01);
        assert!((roll - 15.0).abs() < 0.01);
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

    // ── Optional components: add / remove (ADR-037) ───────────────────

    fn velocity_json(x: f32, y: f32, z: f32) -> serde_json::Value {
        serde_json::json!({ "value": [x, y, z] })
    }

    /// An entity carrying all three mandatory kinds and no Velocity.
    fn entity_with_mandatory_components(world: &mut World) -> Entity {
        let entity = world.spawn();
        world
            .add_component(entity, LocalTransform::new(Vec3::ZERO))
            .unwrap();
        world
            .add_component(entity, CameraComponent::perspective())
            .unwrap();
        world
            .add_component(entity, EntityInfo::new("Probe"))
            .unwrap();
        entity
    }

    const MANDATORY_KINDS: [ComponentKind; 3] = [
        ComponentKind::LocalTransform,
        ComponentKind::Camera,
        ComponentKind::EntityInfo,
    ];

    #[test]
    fn velocity_is_the_only_optional_component() {
        for descriptor in registry() {
            assert_eq!(
                descriptor.is_optional(),
                descriptor.kind == ComponentKind::Velocity,
                "{:?}",
                descriptor.kind
            );
        }
    }

    #[test]
    fn component_kind_infos_report_which_kinds_are_optional() {
        let infos = serde_json::to_value(component_kind_infos()).unwrap();
        for info in infos.as_array().unwrap() {
            let expected = info["kind"] == "Velocity";
            assert_eq!(info["optional"], expected, "{}", info["kind"]);
        }
    }

    #[test]
    fn add_component_adds_velocity_from_its_wire_json() {
        let mut world = World::new();
        let entity = world.spawn();

        add_component(
            &mut world,
            entity,
            ComponentKind::Velocity,
            velocity_json(1.0, 2.0, 3.0),
        )
        .unwrap();

        let velocity = world.get_component::<Velocity>(entity).unwrap();
        assert_eq!(velocity.value, Vec3::new(1.0, 2.0, 3.0));
    }

    #[test]
    fn add_component_rejects_a_component_the_entity_already_has() {
        let mut world = World::new();
        let entity = world.spawn();
        world.add_component(entity, Velocity::new(Vec3::X)).unwrap();

        let result = add_component(
            &mut world,
            entity,
            ComponentKind::Velocity,
            velocity_json(9.0, 9.0, 9.0),
        );

        assert!(matches!(result, Err(ReflectError::ComponentAlreadyPresent)));
        let velocity = world.get_component::<Velocity>(entity).unwrap();
        assert_eq!(velocity.value, Vec3::X);
    }

    #[test]
    fn add_component_rejects_mandatory_kinds_even_when_present() {
        let mut world = World::new();
        let entity = entity_with_mandatory_components(&mut world);

        for kind in MANDATORY_KINDS {
            match add_component(&mut world, entity, kind, serde_json::json!({})) {
                Err(ReflectError::ValidationFailed(message)) => {
                    assert!(message.contains("cannot be added"), "{kind:?}: {message}");
                }
                other => panic!("{kind:?}: expected ValidationFailed, got {other:?}"),
            }
        }
    }

    #[test]
    fn add_component_rejects_invalid_json_and_leaves_the_entity_unchanged() {
        let mut world = World::new();
        let entity = world.spawn();

        let result = add_component(
            &mut world,
            entity,
            ComponentKind::Velocity,
            serde_json::json!({ "value": "fast" }),
        );

        assert!(matches!(
            result,
            Err(ReflectError::DeserializationFailed(_))
        ));
        assert!(!velocity_has(&world, entity));
    }

    #[test]
    fn add_component_rejects_a_missing_entity() {
        let mut world = World::new();
        let entity = world.spawn();
        world.despawn(entity);

        let result = add_component(
            &mut world,
            entity,
            ComponentKind::Velocity,
            velocity_json(0.0, 0.0, 0.0),
        );

        assert!(matches!(result, Err(ReflectError::EntityNotFound)));
    }

    #[test]
    fn remove_component_removes_velocity() {
        let mut world = World::new();
        let entity = world.spawn();
        world.add_component(entity, Velocity::new(Vec3::X)).unwrap();

        remove_component(&mut world, entity, ComponentKind::Velocity).unwrap();

        assert!(!velocity_has(&world, entity));
    }

    #[test]
    fn remove_component_rejects_a_component_the_entity_lacks() {
        let mut world = World::new();
        let entity = world.spawn();

        let result = remove_component(&mut world, entity, ComponentKind::Velocity);

        assert!(matches!(result, Err(ReflectError::ComponentNotPresent)));
    }

    #[test]
    fn remove_component_rejects_mandatory_kinds() {
        let mut world = World::new();
        let entity = entity_with_mandatory_components(&mut world);

        for kind in MANDATORY_KINDS {
            match remove_component(&mut world, entity, kind) {
                Err(ReflectError::ValidationFailed(message)) => {
                    assert!(message.contains("cannot be removed"), "{kind:?}: {message}");
                }
                other => panic!("{kind:?}: expected ValidationFailed, got {other:?}"),
            }
        }

        let kinds = list_components(&world, entity);
        for kind in MANDATORY_KINDS {
            assert!(kinds.contains(&kind), "{kind:?} was removed");
        }
    }

    #[test]
    fn remove_component_rejects_a_missing_entity() {
        let mut world = World::new();
        let entity = world.spawn();
        world.despawn(entity);

        let result = remove_component(&mut world, entity, ComponentKind::Velocity);

        assert!(matches!(result, Err(ReflectError::EntityNotFound)));
    }

    #[test]
    fn default_component_json_for_velocity_adds_a_default_velocity() {
        let mut world = World::new();
        let entity = world.spawn();
        let json = default_component_json(ComponentKind::Velocity).expect("Velocity has a default");

        add_component(&mut world, entity, ComponentKind::Velocity, json).unwrap();

        let velocity = world.get_component::<Velocity>(entity).unwrap();
        assert_eq!(*velocity, Velocity::default());
    }

    #[test]
    fn default_component_json_is_none_for_mandatory_kinds() {
        for kind in MANDATORY_KINDS {
            assert!(default_component_json(kind).is_none(), "{kind:?}");
        }
    }

    // Guard for Phase 20b: a new optional kind (Mesh, Material) must ship a
    // default that its own add path accepts (ADR-037, Consequences).
    #[test]
    fn every_optional_kind_has_a_default_that_add_accepts() {
        for descriptor in registry().iter().filter(|d| d.is_optional()) {
            let mut world = World::new();
            let entity = world.spawn();
            let json = default_component_json(descriptor.kind)
                .unwrap_or_else(|| panic!("{:?} has no default", descriptor.kind));

            add_component(&mut world, entity, descriptor.kind, json)
                .unwrap_or_else(|e| panic!("{:?}: {e:?}", descriptor.kind));

            assert!((descriptor.has)(&world, entity), "{:?}", descriptor.kind);
        }
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
