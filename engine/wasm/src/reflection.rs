//! Generic component reflection for the Runtime Editor Inspector panel.
//!
//! Lives at the WASM boundary (not in engine/core) because it's purely
//! a translation layer between ECS storage and JSON for JavaScript —
//! it has no gameplay logic of its own.

use dt_engine_core::components::{
    CameraComponent, EntityInfo, LocalTransform, Material, Mesh, MeshShape, ProjectionType,
    Velocity,
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
    Mesh,
    Material,
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
            ComponentKind::Mesh => "Mesh",
            ComponentKind::Material => "Material",
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
            ComponentKind::Mesh => 4,
            ComponentKind::Material => 5,
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
            "Mesh" => Some(Self::Mesh),
            "Material" => Some(Self::Material),
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
    /// The variants of a tagged-enum component, each with its default wire
    /// JSON. Empty for a component without variants. It lets the Inspector
    /// switch a variant without keeping a client-side copy of the defaults
    /// (ADR-038).
    pub variants: &'static [VariantDescriptor],
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

/// One variant of a tagged-enum component, such as a `Mesh` shape.
pub struct VariantDescriptor {
    /// The variant's name as it appears on the wire, for example "Sphere".
    pub name: &'static str,
    /// The complete component wire JSON with this variant at its defaults,
    /// ready for `from_json` or `add_from_json`.
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
            variants: &[],
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
            variants: &[],
        },
        ComponentDescriptor {
            kind: ComponentKind::Camera,
            display_name: "Camera",
            has: camera_has,
            to_json: camera_to_json,
            from_json: camera_from_json,
            optional: None,
            variants: &[],
        },
        ComponentDescriptor {
            kind: ComponentKind::EntityInfo,
            display_name: "Entity Info",
            has: entity_info_has,
            to_json: entity_info_to_json,
            from_json: entity_info_from_json,
            optional: None,
            variants: &[],
        },
        ComponentDescriptor {
            kind: ComponentKind::Mesh,
            display_name: "Mesh",
            has: mesh_has,
            to_json: mesh_to_json,
            from_json: mesh_from_json,
            optional: Some(OptionalOps {
                add_from_json: mesh_add_from_json,
                remove: mesh_remove,
                default_json: mesh_default_json,
            }),
            variants: MESH_VARIANTS,
        },
        ComponentDescriptor {
            kind: ComponentKind::Material,
            display_name: "Material",
            has: material_has,
            to_json: material_to_json,
            from_json: material_from_json,
            optional: Some(OptionalOps {
                add_from_json: material_add_from_json,
                remove: material_remove,
                default_json: material_default_json,
            }),
            variants: &[],
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

/// A variant of a tagged-enum component with its default wire JSON,
/// JSON-serializable. Used by EngineWorld::component_variants_json()
/// (lib.rs) so the Inspector's variant switch reads the engine's defaults
/// instead of keeping a copy client-side (ADR-038).
#[derive(Debug, Serialize)]
pub struct ComponentVariantInfo {
    pub name: &'static str,
    /// The complete component JSON with this variant at its defaults.
    pub default: serde_json::Value,
}

/// The variants of `kind`, in display order, each with its default
/// component JSON. None for a kind without variants. All or nothing: if any
/// default cannot be produced, none is returned.
pub fn component_variants(kind: ComponentKind) -> Option<Vec<ComponentVariantInfo>> {
    let descriptor = find_descriptor(kind)?;
    if descriptor.variants.is_empty() {
        return None;
    }
    descriptor
        .variants
        .iter()
        .map(|variant| {
            Some(ComponentVariantInfo {
                name: variant.name,
                default: (variant.default_json)().ok()?,
            })
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
///
/// `scale` is required, like every other field (ADR-039 decision 8). Each
/// axis must be finite and non-zero; negative axes mirror.
#[derive(Serialize, Deserialize)]
struct LocalTransformView {
    position: Vec3,
    rotation_euler_deg: [f32; 3],
    scale: Vec3,
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
        scale: transform.scale,
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
    validate_finite("position", view.position.to_array())?;
    validate_finite("rotation_euler_deg", view.rotation_euler_deg)?;
    validate_scale(view.scale)?;
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
    transform.scale = view.scale;
    Ok(())
}

/// Every axis of a LocalTransform `field` must be finite. JSON like `1e39`
/// reaches here as infinity once narrowed to f32, and a non-finite local
/// transform poisons the world matrix of the entity and its descendants.
fn validate_finite(field: &str, values: [f32; 3]) -> Result<(), ReflectError> {
    for (axis, value) in ["x", "y", "z"].into_iter().zip(values) {
        if !value.is_finite() {
            return Err(ReflectError::ValidationFailed(format!(
                "LocalTransform {field}.{axis} must be a finite number (got {value})"
            )));
        }
    }
    Ok(())
}

/// Every axis of a LocalTransform scale must be finite and non-zero
/// (ADR-039 decision 2). Negative axes are allowed: they mirror. The check
/// is explicit because `inf != 0` is true, and JSON like `1e39` reaches
/// here as infinity once narrowed to f32. Shared with
/// `EngineWorld::set_local_scale`.
pub(crate) fn validate_scale(scale: Vec3) -> Result<(), ReflectError> {
    for (axis, value) in [("x", scale.x), ("y", scale.y), ("z", scale.z)] {
        if !value.is_finite() || value == 0.0 {
            return Err(ReflectError::ValidationFailed(format!(
                "LocalTransform scale.{axis} must be a finite, non-zero number (got {value})"
            )));
        }
    }
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
// ─── Mesh and Material ──────────────────────────────────────────────────
// Plain pass-through, like Velocity: storage shape and wire shape are
// identical. Values are validated here, at the boundary (ADR-038
// decision 4), by one function per component that both the set path
// (`*_from_json`) and the add path (`*_add_from_json`) go through, so the
// two cannot drift and neither touches the World until validation passes.

fn mesh_has(world: &World, entity: Entity) -> bool {
    world.get_component::<Mesh>(entity).is_ok()
}

fn mesh_to_json(world: &World, entity: Entity) -> Result<serde_json::Value, ReflectError> {
    let mesh = world
        .get_component::<Mesh>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    serde_json::to_value(*mesh).map_err(|e| ReflectError::DeserializationFailed(e.to_string()))
}

/// Parses and validates a Mesh from its wire JSON.
fn mesh_from_wire(json: serde_json::Value) -> Result<Mesh, ReflectError> {
    let mesh: Mesh = serde_json::from_value(json)
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))?;
    validate_mesh_shape(&mesh.shape)?;
    Ok(mesh)
}

/// Rejects a dimension that is not a finite number greater than zero.
/// The finite check is not redundant: `inf > 0.0` is true.
fn validate_dimension(shape: &str, parameter: &str, value: f32) -> Result<(), ReflectError> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(ReflectError::ValidationFailed(format!(
            "{shape} {parameter} must be a finite number greater than zero (got {value})"
        )))
    }
}

/// Every dimension of every shape must be finite and greater than zero
/// (ADR-038 decision 4). A Plane's size is a Vec2 whose second component is
/// its extent along Z, so it is reported as `size.z`.
fn validate_mesh_shape(shape: &MeshShape) -> Result<(), ReflectError> {
    match shape {
        MeshShape::Box { size } => {
            validate_dimension("Box", "size.x", size.x)?;
            validate_dimension("Box", "size.y", size.y)?;
            validate_dimension("Box", "size.z", size.z)
        }
        MeshShape::Sphere { radius } => validate_dimension("Sphere", "radius", *radius),
        MeshShape::Cylinder { radius, height } => {
            validate_dimension("Cylinder", "radius", *radius)?;
            validate_dimension("Cylinder", "height", *height)
        }
        MeshShape::Plane { size } => {
            validate_dimension("Plane", "size.x", size.x)?;
            validate_dimension("Plane", "size.z", size.y)
        }
    }
}

fn mesh_from_json(
    world: &mut World,
    entity: Entity,
    json: serde_json::Value,
) -> Result<(), ReflectError> {
    if !world.contains(entity) {
        return Err(ReflectError::EntityNotFound);
    }
    let new_mesh = mesh_from_wire(json)?;
    let mut mesh = world
        .get_component_mut::<Mesh>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    *mesh = new_mesh;
    Ok(())
}

fn mesh_add_from_json(
    world: &mut World,
    entity: Entity,
    json: serde_json::Value,
) -> Result<(), ReflectError> {
    let mesh = mesh_from_wire(json)?;
    world
        .add_component(entity, mesh)
        .map_err(|_| ReflectError::EntityNotFound)
}

fn mesh_remove(world: &mut World, entity: Entity) -> Result<(), ReflectError> {
    world
        .remove_component::<Mesh>(entity)
        .map(|_mesh| ())
        .map_err(|e| match e {
            hecs::ComponentError::NoSuchEntity => ReflectError::EntityNotFound,
            hecs::ComponentError::MissingComponent(_) => ReflectError::ComponentNotPresent,
        })
}

/// The core default Mesh, serialized by the same path as `mesh_to_json`, so
/// the default can never drift from the wire shape.
fn mesh_default_json() -> Result<serde_json::Value, ReflectError> {
    serde_json::to_value(Mesh::default())
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))
}

/// The Mesh variants the Inspector can switch between, in display order.
const MESH_VARIANTS: &[VariantDescriptor] = &[
    VariantDescriptor {
        name: "Box",
        default_json: mesh_box_default_json,
    },
    VariantDescriptor {
        name: "Sphere",
        default_json: mesh_sphere_default_json,
    },
    VariantDescriptor {
        name: "Cylinder",
        default_json: mesh_cylinder_default_json,
    },
    VariantDescriptor {
        name: "Plane",
        default_json: mesh_plane_default_json,
    },
];

/// A Mesh with `shape`, as wire JSON. Every variant default goes through
/// the same serialization as `mesh_to_json`, so a default can never drift
/// from the wire shape.
fn mesh_shape_default_json(shape: MeshShape) -> Result<serde_json::Value, ReflectError> {
    serde_json::to_value(Mesh::new(shape))
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))
}

fn mesh_box_default_json() -> Result<serde_json::Value, ReflectError> {
    mesh_shape_default_json(MeshShape::default_box())
}

fn mesh_sphere_default_json() -> Result<serde_json::Value, ReflectError> {
    mesh_shape_default_json(MeshShape::default_sphere())
}

fn mesh_cylinder_default_json() -> Result<serde_json::Value, ReflectError> {
    mesh_shape_default_json(MeshShape::default_cylinder())
}

fn mesh_plane_default_json() -> Result<serde_json::Value, ReflectError> {
    mesh_shape_default_json(MeshShape::default_plane())
}

fn material_has(world: &World, entity: Entity) -> bool {
    world.get_component::<Material>(entity).is_ok()
}

fn material_to_json(world: &World, entity: Entity) -> Result<serde_json::Value, ReflectError> {
    let material = world
        .get_component::<Material>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    serde_json::to_value(*material).map_err(|e| ReflectError::DeserializationFailed(e.to_string()))
}

/// Parses and validates a Material from its wire JSON.
fn material_from_wire(json: serde_json::Value) -> Result<Material, ReflectError> {
    let material: Material = serde_json::from_value(json)
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))?;
    validate_material(&material)?;
    Ok(material)
}

/// Each channel must be in 0 to 1 (ADR-038 decision 5). NaN and infinity
/// fall outside the range, so one range check covers non-finite values too.
fn validate_material(material: &Material) -> Result<(), ReflectError> {
    let channels = [
        ("r", material.base_color.x),
        ("g", material.base_color.y),
        ("b", material.base_color.z),
    ];
    for (channel, value) in channels {
        if !(0.0..=1.0).contains(&value) {
            return Err(ReflectError::ValidationFailed(format!(
                "base_color.{channel} must be a finite number between 0 and 1 (got {value})"
            )));
        }
    }
    Ok(())
}

fn material_from_json(
    world: &mut World,
    entity: Entity,
    json: serde_json::Value,
) -> Result<(), ReflectError> {
    if !world.contains(entity) {
        return Err(ReflectError::EntityNotFound);
    }
    let new_material = material_from_wire(json)?;
    let mut material = world
        .get_component_mut::<Material>(entity)
        .map_err(|_| ReflectError::ComponentNotPresent)?;
    *material = new_material;
    Ok(())
}

fn material_add_from_json(
    world: &mut World,
    entity: Entity,
    json: serde_json::Value,
) -> Result<(), ReflectError> {
    let material = material_from_wire(json)?;
    world
        .add_component(entity, material)
        .map_err(|_| ReflectError::EntityNotFound)
}

fn material_remove(world: &mut World, entity: Entity) -> Result<(), ReflectError> {
    world
        .remove_component::<Material>(entity)
        .map(|_material| ())
        .map_err(|e| match e {
            hecs::ComponentError::NoSuchEntity => ReflectError::EntityNotFound,
            hecs::ComponentError::MissingComponent(_) => ReflectError::ComponentNotPresent,
        })
}

/// The core default Material (white), serialized by the same path as
/// `material_to_json`.
fn material_default_json() -> Result<serde_json::Value, ReflectError> {
    serde_json::to_value(Material::default())
        .map_err(|e| ReflectError::DeserializationFailed(e.to_string()))
}

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
            "rotation_euler_deg": [0.0, 90.0, 0.0],
            "scale": [1.0, 1.0, 1.0]
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
            "rotation_euler_deg": euler,
            "scale": [1.0, 1.0, 1.0]
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

    const OPTIONAL_KINDS: [ComponentKind; 3] = [
        ComponentKind::Velocity,
        ComponentKind::Mesh,
        ComponentKind::Material,
    ];

    #[test]
    fn only_velocity_mesh_and_material_are_optional() {
        for descriptor in registry() {
            assert_eq!(
                descriptor.is_optional(),
                OPTIONAL_KINDS.contains(&descriptor.kind),
                "{:?}",
                descriptor.kind
            );
        }
    }

    #[test]
    fn component_kind_infos_report_which_kinds_are_optional() {
        let infos = serde_json::to_value(component_kind_infos()).unwrap();
        for info in infos.as_array().unwrap() {
            let expected = OPTIONAL_KINDS
                .iter()
                .any(|kind| info["kind"] == kind.as_str());
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

    // ─── Mesh and Material (ADR-038) ────────────────────────────────────

    fn entity_in_new_world() -> (World, Entity) {
        let mut world = World::new();
        let entity = world.spawn();
        (world, entity)
    }

    #[test]
    fn mesh_round_trips_through_json() {
        let (mut world, entity) = entity_in_new_world();
        world
            .add_component(entity, Mesh::new(MeshShape::Sphere { radius: 2.0 }))
            .unwrap();

        let json = mesh_to_json(&world, entity).unwrap();
        // Externally tagged, like Camera's projection (ADR-038 decision 2).
        assert_eq!(
            json,
            serde_json::json!({ "shape": { "Sphere": { "radius": 2.0 } } })
        );

        let updated = serde_json::json!({ "shape": { "Plane": { "size": [4.0, 6.0] } } });
        mesh_from_json(&mut world, entity, updated).unwrap();

        let mesh = world.get_component::<Mesh>(entity).unwrap();
        assert_eq!(
            mesh.shape,
            MeshShape::Plane {
                size: glam::Vec2::new(4.0, 6.0)
            }
        );
    }

    #[test]
    fn mesh_from_json_rejects_unknown_variants_and_malformed_shapes() {
        let (mut world, entity) = entity_in_new_world();
        world.add_component(entity, Mesh::default()).unwrap();

        for json in [
            serde_json::json!({ "shape": { "Torus": { "radius": 1.0 } } }),
            serde_json::json!({ "shape": { "Sphere": {} } }),
            serde_json::json!({ "shape": { "Box": { "size": [1.0, 1.0] } } }),
            serde_json::json!({}),
        ] {
            let result = mesh_from_json(&mut world, entity, json.clone());
            assert!(
                matches!(result, Err(ReflectError::DeserializationFailed(_))),
                "{json}"
            );
        }

        let mesh = world.get_component::<Mesh>(entity).unwrap();
        assert_eq!(*mesh, Mesh::default());
    }

    #[test]
    fn mesh_from_json_rejects_bad_dimensions_and_leaves_the_mesh_unchanged() {
        let (mut world, entity) = entity_in_new_world();
        world.add_component(entity, Mesh::default()).unwrap();

        // (payload, the parameter the message must name). Each payload has
        // exactly one bad dimension, so the named parameter is unambiguous.
        let cases = [
            (
                serde_json::json!({ "shape": { "Box": { "size": [0.0, 1.0, 1.0] } } }),
                "size.x",
            ),
            (
                serde_json::json!({ "shape": { "Box": { "size": [1.0, -1.0, 1.0] } } }),
                "size.y",
            ),
            (
                serde_json::json!({ "shape": { "Box": { "size": [1.0, 1.0, 0.0] } } }),
                "size.z",
            ),
            (
                serde_json::json!({ "shape": { "Sphere": { "radius": 0.0 } } }),
                "radius",
            ),
            (
                serde_json::json!({ "shape": { "Sphere": { "radius": -1.0 } } }),
                "radius",
            ),
            (
                serde_json::json!({ "shape": { "Cylinder": { "radius": 0.0, "height": 2.0 } } }),
                "radius",
            ),
            (
                serde_json::json!({ "shape": { "Cylinder": { "radius": 0.5, "height": 0.0 } } }),
                "height",
            ),
            (
                serde_json::json!({ "shape": { "Plane": { "size": [0.0, 10.0] } } }),
                "size.x",
            ),
            (
                serde_json::json!({ "shape": { "Plane": { "size": [10.0, 0.0] } } }),
                "size.z",
            ),
        ];

        for (json, parameter) in cases {
            match mesh_from_json(&mut world, entity, json.clone()) {
                Err(ReflectError::ValidationFailed(message)) => {
                    assert!(message.contains(parameter), "{json}: {message}");
                }
                other => panic!("{json}: expected ValidationFailed, got {other:?}"),
            }
        }

        // Rejected writes must not have partially applied.
        let mesh = world.get_component::<Mesh>(entity).unwrap();
        assert_eq!(*mesh, Mesh::default());
    }

    #[test]
    fn validate_mesh_shape_rejects_non_finite_dimensions() {
        // JSON cannot carry NaN or infinity, but a Rust caller can, and a
        // positivity check alone would let infinity through (inf > 0).
        let shapes = [
            MeshShape::Box {
                size: Vec3::new(f32::NAN, 1.0, 1.0),
            },
            MeshShape::Box {
                size: Vec3::new(1.0, f32::INFINITY, 1.0),
            },
            MeshShape::Sphere {
                radius: f32::INFINITY,
            },
            MeshShape::Cylinder {
                radius: 0.5,
                height: f32::NAN,
            },
            MeshShape::Plane {
                size: glam::Vec2::new(1.0, f32::INFINITY),
            },
        ];

        for shape in shapes {
            let result = validate_mesh_shape(&shape);
            assert!(
                matches!(result, Err(ReflectError::ValidationFailed(_))),
                "{shape:?}"
            );
        }
    }

    #[test]
    fn material_round_trips_through_json() {
        let (mut world, entity) = entity_in_new_world();
        world
            .add_component(entity, Material::new(Vec3::new(0.25, 0.5, 0.75)))
            .unwrap();

        let json = material_to_json(&world, entity).unwrap();
        assert_eq!(json, serde_json::json!({ "base_color": [0.25, 0.5, 0.75] }));

        let updated = serde_json::json!({ "base_color": [1.0, 0.0, 0.5] });
        material_from_json(&mut world, entity, updated).unwrap();

        let material = world.get_component::<Material>(entity).unwrap();
        assert_eq!(material.base_color, Vec3::new(1.0, 0.0, 0.5));
    }

    #[test]
    fn material_from_json_rejects_bad_colors_and_leaves_the_material_unchanged() {
        let (mut world, entity) = entity_in_new_world();
        world.add_component(entity, Material::default()).unwrap();

        let cases = [
            (
                serde_json::json!({ "base_color": [1.5, 0.0, 0.0] }),
                "base_color.r",
            ),
            (
                serde_json::json!({ "base_color": [0.0, -0.25, 0.0] }),
                "base_color.g",
            ),
            (
                serde_json::json!({ "base_color": [0.0, 0.0, 2.0] }),
                "base_color.b",
            ),
        ];

        for (json, parameter) in cases {
            match material_from_json(&mut world, entity, json.clone()) {
                Err(ReflectError::ValidationFailed(message)) => {
                    assert!(message.contains(parameter), "{json}: {message}");
                }
                other => panic!("{json}: expected ValidationFailed, got {other:?}"),
            }
        }

        let material = world.get_component::<Material>(entity).unwrap();
        assert_eq!(*material, Material::default());
    }

    #[test]
    fn validate_material_rejects_non_finite_colors() {
        let colors = [
            Vec3::new(f32::NAN, 0.0, 0.0),
            Vec3::new(0.0, f32::INFINITY, 0.0),
            Vec3::new(0.0, 0.0, f32::NEG_INFINITY),
        ];

        for base_color in colors {
            let result = validate_material(&Material::new(base_color));
            assert!(
                matches!(result, Err(ReflectError::ValidationFailed(_))),
                "{base_color:?}"
            );
        }
    }

    #[test]
    fn add_component_adds_mesh_and_material_from_their_wire_json() {
        let (mut world, entity) = entity_in_new_world();
        let mesh_json =
            serde_json::json!({ "shape": { "Cylinder": { "radius": 0.5, "height": 2.0 } } });
        let material_json = serde_json::json!({ "base_color": [0.25, 0.5, 0.75] });

        add_component(&mut world, entity, ComponentKind::Mesh, mesh_json).unwrap();
        add_component(&mut world, entity, ComponentKind::Material, material_json).unwrap();

        let mesh = world.get_component::<Mesh>(entity).unwrap();
        assert_eq!(
            *mesh,
            Mesh::new(MeshShape::Cylinder {
                radius: 0.5,
                height: 2.0
            })
        );
        let material = world.get_component::<Material>(entity).unwrap();
        assert_eq!(*material, Material::new(Vec3::new(0.25, 0.5, 0.75)));
    }

    #[test]
    fn add_component_rejects_invalid_mesh_and_material_and_attaches_nothing() {
        let (mut world, entity) = entity_in_new_world();
        let bad_mesh = serde_json::json!({ "shape": { "Sphere": { "radius": 0.0 } } });
        let bad_material = serde_json::json!({ "base_color": [0.0, 1.5, 0.0] });

        let mesh_result = add_component(&mut world, entity, ComponentKind::Mesh, bad_mesh);
        let material_result =
            add_component(&mut world, entity, ComponentKind::Material, bad_material);

        assert!(matches!(
            mesh_result,
            Err(ReflectError::ValidationFailed(_))
        ));
        assert!(matches!(
            material_result,
            Err(ReflectError::ValidationFailed(_))
        ));
        assert!(list_components(&world, entity).is_empty());
    }

    #[test]
    fn remove_component_removes_mesh_and_material() {
        let (mut world, entity) = entity_in_new_world();
        world.add_component(entity, Mesh::default()).unwrap();
        world.add_component(entity, Material::default()).unwrap();

        remove_component(&mut world, entity, ComponentKind::Mesh).unwrap();

        // Mesh and Material are independent: removing one leaves the other.
        assert!(!mesh_has(&world, entity));
        assert!(material_has(&world, entity));

        remove_component(&mut world, entity, ComponentKind::Material).unwrap();
        assert!(!material_has(&world, entity));
    }

    #[test]
    fn default_component_json_for_mesh_and_material_is_the_core_default() {
        assert_eq!(
            default_component_json(ComponentKind::Mesh),
            Some(serde_json::json!({ "shape": { "Box": { "size": [1.0, 1.0, 1.0] } } }))
        );
        assert_eq!(
            default_component_json(ComponentKind::Material),
            Some(serde_json::json!({ "base_color": [1.0, 1.0, 1.0] }))
        );
    }

    #[test]
    fn list_components_reports_mesh_and_material_when_present() {
        let (mut world, entity) = entity_in_new_world();
        assert!(list_components(&world, entity).is_empty());

        world.add_component(entity, Mesh::default()).unwrap();
        world.add_component(entity, Material::default()).unwrap();

        let kinds = list_components(&world, entity);
        assert!(kinds.contains(&ComponentKind::Mesh));
        assert!(kinds.contains(&ComponentKind::Material));
    }

    // ─── Variant defaults (ADR-038) ─────────────────────────────────────

    fn mesh_variant_defaults() -> Vec<ComponentVariantInfo> {
        component_variants(ComponentKind::Mesh).expect("Mesh has variants")
    }

    #[test]
    fn mesh_variants_are_listed_in_order() {
        let variants = mesh_variant_defaults();

        let names: Vec<&str> = variants.iter().map(|variant| variant.name).collect();

        assert_eq!(names, ["Box", "Sphere", "Cylinder", "Plane"]);
    }

    #[test]
    fn only_mesh_has_variants() {
        for descriptor in registry() {
            assert_eq!(
                component_variants(descriptor.kind).is_some(),
                descriptor.kind == ComponentKind::Mesh,
                "{:?}",
                descriptor.kind
            );
        }
    }

    #[test]
    fn each_mesh_variant_default_is_that_variant_at_the_core_defaults() {
        let expected = [
            (
                "Box",
                serde_json::json!({ "shape": { "Box": { "size": [1.0, 1.0, 1.0] } } }),
            ),
            (
                "Sphere",
                serde_json::json!({ "shape": { "Sphere": { "radius": 0.5 } } }),
            ),
            (
                "Cylinder",
                serde_json::json!({ "shape": { "Cylinder": { "radius": 0.5, "height": 2.0 } } }),
            ),
            (
                "Plane",
                serde_json::json!({ "shape": { "Plane": { "size": [10.0, 10.0] } } }),
            ),
        ];

        let actual: Vec<(&str, serde_json::Value)> = mesh_variant_defaults()
            .into_iter()
            .map(|variant| (variant.name, variant.default))
            .collect();

        assert_eq!(actual, expected);
    }

    #[test]
    fn the_first_mesh_variant_default_matches_what_the_add_menu_offers() {
        let first = mesh_variant_defaults().remove(0);

        assert_eq!(
            Some(first.default),
            default_component_json(ComponentKind::Mesh)
        );
    }

    #[test]
    fn every_variant_default_is_accepted_by_add_and_set_and_reads_back_unchanged() {
        for descriptor in registry() {
            let Some(variants) = component_variants(descriptor.kind) else {
                continue;
            };
            assert!(
                descriptor.is_optional(),
                "{:?}: extend this test for a mandatory kind with variants",
                descriptor.kind
            );

            for variant in variants {
                let label = format!("{:?} {}", descriptor.kind, variant.name);
                let (mut world, entity) = entity_in_new_world();

                // Add path, on an entity that lacks the component.
                let added =
                    add_component(&mut world, entity, descriptor.kind, variant.default.clone());
                assert!(added.is_ok(), "{label} add: {added:?}");

                // Set path, replacing what the component held.
                let set = (descriptor.from_json)(&mut world, entity, variant.default.clone());
                assert!(set.is_ok(), "{label} set: {set:?}");

                let read = (descriptor.to_json)(&world, entity).unwrap();
                assert_eq!(read, variant.default, "{label} read back");
            }
        }
    }

    // -- LocalTransform scale (ADR-039) ----------------------------------------

    fn local_transform_json(scale: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "position": [1.0, 2.0, 3.0],
            "rotation_euler_deg": [0.0, 90.0, 0.0],
            "scale": scale
        })
    }

    #[test]
    fn local_transform_round_trips_scale_through_json() {
        let mut world = World::new();
        let entity = spawn_with_local_transform(&mut world);

        local_transform_from_json(
            &mut world,
            entity,
            local_transform_json(serde_json::json!([2.0, 3.0, 0.5])),
        )
        .unwrap();

        let stored = world.get_component::<LocalTransform>(entity).unwrap().scale;
        assert_eq!(stored, Vec3::new(2.0, 3.0, 0.5));
        let json = local_transform_to_json(&world, entity).unwrap();
        assert_eq!(json["scale"], serde_json::json!([2.0, 3.0, 0.5]));
    }

    #[test]
    fn local_transform_from_json_accepts_negative_scale() {
        let mut world = World::new();
        let entity = spawn_with_local_transform(&mut world);

        let result = local_transform_from_json(
            &mut world,
            entity,
            local_transform_json(serde_json::json!([-1.0, 1.0, 1.0])),
        );

        assert!(result.is_ok(), "{result:?}");
        let stored = world.get_component::<LocalTransform>(entity).unwrap().scale;
        assert_eq!(stored, Vec3::new(-1.0, 1.0, 1.0));
    }

    #[test]
    fn local_transform_from_json_requires_scale_and_changes_nothing() {
        let mut world = World::new();
        let entity = spawn_with_local_transform(&mut world);
        let before = *world.get_component::<LocalTransform>(entity).unwrap();
        let json = serde_json::json!({
            "position": [1.0, 2.0, 3.0],
            "rotation_euler_deg": [0.0, 90.0, 0.0]
        });

        let result = local_transform_from_json(&mut world, entity, json);

        assert!(
            matches!(result, Err(ReflectError::DeserializationFailed(ref m)) if m.contains("scale"))
        );
        assert_eq!(
            *world.get_component::<LocalTransform>(entity).unwrap(),
            before
        );
    }

    #[test]
    fn local_transform_from_json_rejects_zero_and_non_finite_scale_naming_the_axis() {
        // 1e39 is valid JSON but overflows f32, so it arrives as infinity.
        let cases = [
            (
                serde_json::json!([0.0, 1.0, 1.0]),
                "LocalTransform scale.x must be a finite, non-zero number (got 0)",
            ),
            (
                serde_json::json!([1.0, -0.0, 1.0]),
                "LocalTransform scale.y must be a finite, non-zero number (got -0)",
            ),
            (
                serde_json::json!([1.0, 1.0, 1e39]),
                "LocalTransform scale.z must be a finite, non-zero number (got inf)",
            ),
        ];
        for (scale, expected) in cases {
            let mut world = World::new();
            let entity = spawn_with_local_transform(&mut world);
            let before = *world.get_component::<LocalTransform>(entity).unwrap();

            let result = local_transform_from_json(&mut world, entity, local_transform_json(scale));

            match result {
                Err(ReflectError::ValidationFailed(message)) => assert_eq!(message, expected),
                other => panic!("expected ValidationFailed({expected:?}), got {other:?}"),
            }
            // Rejected whole: position and rotation are not half-applied.
            assert_eq!(
                *world.get_component::<LocalTransform>(entity).unwrap(),
                before
            );
        }
    }

    #[test]
    fn local_transform_from_json_rejects_non_finite_position_and_rotation_naming_the_field() {
        // 1e39 overflows f32 and arrives as infinity. Before 20c these were
        // stored, making the entity's world matrix (and its children's)
        // non-finite.
        let cases = [
            (
                serde_json::json!({"position": [1e39, 0.0, 0.0], "rotation_euler_deg": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}),
                "LocalTransform position.x must be a finite number (got inf)",
            ),
            (
                serde_json::json!({"position": [0.0, 0.0, 0.0], "rotation_euler_deg": [0.0, -1e39, 0.0], "scale": [1.0, 1.0, 1.0]}),
                "LocalTransform rotation_euler_deg.y must be a finite number (got -inf)",
            ),
        ];
        for (json, expected) in cases {
            let mut world = World::new();
            let entity = spawn_with_local_transform(&mut world);
            let before = *world.get_component::<LocalTransform>(entity).unwrap();

            let result = local_transform_from_json(&mut world, entity, json);

            match result {
                Err(ReflectError::ValidationFailed(message)) => assert_eq!(message, expected),
                other => panic!("expected ValidationFailed({expected:?}), got {other:?}"),
            }
            assert_eq!(
                *world.get_component::<LocalTransform>(entity).unwrap(),
                before
            );
        }
    }
}
