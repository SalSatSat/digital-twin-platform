//! WASM bindings for the Digital Twin Platform engine.
//!
//! This crate exposes the ECS core to JavaScript via wasm-bindgen.
//! [`EngineWorld`] is the single entry point — it wraps the ECS World,
//! systems, and entity handle management behind a JavaScript-friendly API.
//!
//! All types that cross the WASM boundary must be representable in JavaScript.
//! Rust structs are exposed as JavaScript classes via `#[wasm_bindgen]`.
//! Complex types like Vec3 and Quat are decomposed into individual f32 values.
use dt_engine_core::{
    bundle::{CameraBundle, DynamicObjectBundle, StaticObjectBundle},
    components::{
        CameraComponent, EntityInfo, HierarchyError, HierarchyNode, LocalTransform, ProjectionType,
        WorldTransform,
    },
    systems::{HierarchySystem, MovementSystem, System},
    world::World,
};
use glam::{Quat, Vec3};
use hecs::Entity;
use serde::Serialize;
use wasm_bindgen::prelude::*;

mod reflection;
use reflection::ComponentKind;

/// Converts a ReflectError into a human-readable message.
///
/// Returned as plain data (Option<String>: None on success, Some(message)
/// on failure) rather than thrown as a JsValue exception. Both an
/// unregistered EntityInfo category and an invalid camera near/far pair
/// are expected, user-triggerable outcomes from editing values in the
/// Inspector — not exceptional programmer errors — so they're modeled
/// as return values a caller can branch on, not something that
/// interrupts control flow. This mirrors the same reasoning already
/// applied to set_parent/remove_parent's status-code design: expected
/// domain outcomes are data, not exceptions.
fn reflect_error_to_message(err: reflection::ReflectError) -> String {
    use reflection::ReflectError::*;
    match err {
        EntityNotFound => "entity not found".to_string(),
        ComponentNotPresent => "component not present on entity".to_string(),
        DeserializationFailed(msg) => format!("invalid value: {msg}"),
        ValidationFailed(msg) => msg,
    }
}

/// One entry in the flat list returned by `list_entity_hierarchy`.
#[derive(Serialize)]
struct EntityHierarchyNode {
    handle: u32,
    parent_handle: Option<u32>,
    name: String,
    contexts: Vec<String>,
}

/// The main entry point exposed to JavaScript.
///
/// EngineWorld wraps the ECS World and MovementSystem
/// and exposes a JavaScript-friendly API via wasm-bindgen.
///
/// JavaScript cannot work with Rust types directly. This struct acts
/// as a translation layer — converting between JS-compatible types
/// (numbers, arrays) and the Rust types used internally.
///
/// # Entity Handles
///
/// hecs Entity IDs use u64 internally, which JavaScript cannot represent
/// safely. We store entities in a Vec<Option<Entity>> and expose their
/// index as u32 to JavaScript. None slots represent despawned entities
/// and can be reused by new spawns.
#[wasm_bindgen]
pub struct EngineWorld {
    world: World,
    movement_system: MovementSystem,
    hierarchy_system: HierarchySystem,
    /// Stores entity handles indexed by a u32 ID passed to JavaScript.
    /// None indicates a despawned slot available for reuse.
    entity_handles: Vec<Option<Entity>>,
    /// The handle of the currently active camera.
    /// None means no camera has been set as active.
    active_camera_handle: Option<u32>,
}
#[wasm_bindgen]
impl EngineWorld {
    /// Creates a new empty EngineWorld.
    /// Call this once from JavaScript to initialize the engine.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            world: World::new(),
            movement_system: MovementSystem::new(),
            hierarchy_system: HierarchySystem::new(),
            entity_handles: Vec::new(),
            active_camera_handle: None,
        }
    }
    /// Returns the number of entities currently in the world.
    pub fn entity_count(&self) -> u32 {
        self.world.entity_count()
    }
    /// Spawns a dynamic entity at the given position with the given velocity.
    /// Returns a u32 handle that JavaScript uses to reference this entity.
    // 8 args is inherent to this constructor's shape (name + position + velocity);
    // grouping into a params struct would need a matching TS-side signature change
    // across all call sites -- not worth it for a spawn function, not general logic.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_dynamic_object(
        &mut self,
        name: &str,
        x: f32,
        y: f32,
        z: f32,
        vx: f32,
        vy: f32,
        vz: f32,
    ) -> u32 {
        let entity = self.world.spawn_bundle(DynamicObjectBundle::new(
            name,
            Vec3::new(x, y, z),
            Vec3::new(vx, vy, vz),
        ));
        self.allocate_handle(entity)
    }
    /// Spawns a static entity at the given position.
    /// Returns a u32 handle that JavaScript uses to reference this entity.
    pub fn spawn_static_object(&mut self, name: &str, x: f32, y: f32, z: f32) -> u32 {
        let entity = self
            .world
            .spawn_bundle(StaticObjectBundle::new(name, Vec3::new(x, y, z)));
        self.allocate_handle(entity)
    }
    /// Despawns an entity by handle, freeing its ECS memory and
    /// marking its handle slot as available for reuse.
    ///
    /// Returns true if the entity existed and was despawned.
    /// Returns false if the handle is invalid or already despawned.
    pub fn despawn_entity(&mut self, handle: u32) -> bool {
        let slot = self.entity_handles.get_mut(handle as usize);
        match slot {
            Some(Some(entity)) => {
                let entity = *entity;
                self.world.despawn(entity);
                self.entity_handles[handle as usize] = None;
                true
            }
            _ => false,
        }
    }
    /// Sets `child`'s parent to `parent` by handle.
    ///
    /// Returns a status code:
    ///   0 = success
    ///   1 = entity not found (invalid handle, despawned, or missing HierarchyNode)
    ///   2 = would create a cycle (child is parent, or an ancestor of parent)
    ///
    /// Idempotent: setting a child's parent to its current parent returns 0.
    ///
    /// Status code, not a thrown exception: WouldCreateCycle and
    /// EntityNotFound are both expected, user-triggerable outcomes in
    /// an interactive editor (a drag-and-drop reparent landing on an
    /// invalid target is normal usage, not a bug), so they're modeled
    /// as data the caller branches on rather than control-flow
    /// interruptions. Also: Result<(), JsValue> was tested here and
    /// found to break WASM instantiation in this project's toolchain —
    /// see commit history around Phase 13 for the investigation.
    pub fn set_parent(&mut self, child_handle: u32, parent_handle: u32) -> u8 {
        let Some(child) = self.resolve_handle(child_handle) else {
            return 1;
        };
        let Some(parent) = self.resolve_handle(parent_handle) else {
            return 1;
        };
        match self.world.set_parent(child, parent) {
            Ok(()) => 0,
            Err(HierarchyError::EntityNotFound) => 1,
            Err(HierarchyError::WouldCreateCycle) => 2,
        }
    }
    /// Removes `child`'s parent by handle, making it a root entity.
    ///
    /// Returns a status code:
    ///   0 = success (including if the entity was already a root — no-op)
    ///   1 = entity not found (invalid handle, despawned, or missing HierarchyNode)
    pub fn remove_parent(&mut self, child_handle: u32) -> u8 {
        let Some(child) = self.resolve_handle(child_handle) else {
            return 1;
        };
        match self.world.remove_parent(child) {
            Ok(()) => 0,
            Err(HierarchyError::EntityNotFound) => 1,
            // remove_parent's Rust API only has one error variant, but match
            // exhaustively rather than `_ => 1` so this breaks loudly at
            // compile time if HierarchyError ever grows a new variant.
            Err(HierarchyError::WouldCreateCycle) => {
                unreachable!("remove_parent cannot produce WouldCreateCycle")
            }
        }
    }
    /// Advances the world by one tick.
    ///
    /// delta_time is the elapsed time in seconds since the last tick.
    /// Pass the actual elapsed time from your JavaScript animation loop
    /// for frame-rate independent movement.
    pub fn tick(&mut self, delta_time: f32) {
        self.movement_system.run(&mut self.world, delta_time);
        self.hierarchy_system.run(&mut self.world, delta_time);
    }
    /// Returns the position of an entity as a flat [x, y, z] array.
    /// Returns None if the handle is invalid, despawned, or has no WorldTransform.
    ///
    /// Reads WorldTransform, not LocalTransform, so that positions
    /// reported to the renderer account for parenting — an entity
    /// attached to a moving/rotated parent reports its absolute
    /// world-space position, not its position relative to its parent.
    pub fn get_position(&self, handle: u32) -> Option<Vec<f32>> {
        let entity = self
            .entity_handles
            .get(handle as usize)
            .and_then(|slot| slot.as_ref())?;
        let transform = self.world.get_component::<WorldTransform>(*entity).ok()?;
        Some(vec![
            transform.position.x,
            transform.position.y,
            transform.position.z,
        ])
    }
    /// Returns the rotation of an entity as a flat quaternion [x, y, z, w].
    /// Returns None if the handle is invalid, despawned, or has no WorldTransform.
    ///
    /// Reads WorldTransform, not LocalTransform, for the same reason as
    /// get_position — an entity attached to a rotated parent should
    /// report its absolute world-space rotation.
    pub fn get_rotation(&self, handle: u32) -> Option<Vec<f32>> {
        let entity = self
            .entity_handles
            .get(handle as usize)
            .and_then(|slot| slot.as_ref())?;
        let transform = self.world.get_component::<WorldTransform>(*entity).ok()?;
        Some(vec![
            transform.rotation.x,
            transform.rotation.y,
            transform.rotation.z,
            transform.rotation.w,
        ])
    }
    /// Returns whether an entity is currently visible.
    /// Returns None if the handle is invalid or despawned.
    pub fn get_visible(&self, handle: u32) -> Option<bool> {
        let entity = self
            .entity_handles
            .get(handle as usize)
            .and_then(|slot| slot.as_ref())?;
        let info = self.world.get_component::<EntityInfo>(*entity).ok()?;
        Some(info.visible)
    }
    /// Spawns a perspective camera entity.
    /// Returns a u32 handle that JavaScript uses to reference this camera.
    ///
    /// context should be one of: "Editor", "Runtime", "Universal"
    pub fn spawn_camera(&mut self, name: &str, x: f32, y: f32, z: f32, context: &str) -> u32 {
        let entity =
            self.world
                .spawn_bundle(CameraBundle::perspective(name, Vec3::new(x, y, z), context));
        self.allocate_handle(entity)
    }
    /// Sets the active camera by handle.
    /// The active camera is used by the renderer as the main viewpoint.
    pub fn set_active_camera(&mut self, handle: u32) {
        // Verify the handle is valid before setting it
        if let Some(Some(_)) = self.entity_handles.get(handle as usize) {
            self.active_camera_handle = Some(handle);
        }
    }
    /// Returns the handle of the currently active camera.
    /// Returns None if no active camera has been set.
    pub fn get_active_camera(&self) -> Option<u32> {
        self.active_camera_handle
    }
    /// Returns the position and rotation of a camera as a flat array.
    /// Format: [px, py, pz, rx, ry, rz, rw]
    /// where p = position, r = rotation quaternion (x, y, z, w)
    /// Returns None if the handle is invalid or has no LocalTransform.
    pub fn get_camera_transform(&self, handle: u32) -> Option<Vec<f32>> {
        let entity = self
            .entity_handles
            .get(handle as usize)
            .and_then(|slot| slot.as_ref())?;
        let transform = self.world.get_component::<LocalTransform>(*entity).ok()?;
        Some(vec![
            transform.position.x,
            transform.position.y,
            transform.position.z,
            transform.rotation.x,
            transform.rotation.y,
            transform.rotation.z,
            transform.rotation.w,
        ])
    }
    /// Returns the field of view in degrees for a perspective camera.
    /// Returns None if the handle is invalid or the camera is not perspective.
    pub fn get_camera_fov(&self, handle: u32) -> Option<f32> {
        let entity = self
            .entity_handles
            .get(handle as usize)
            .and_then(|slot| slot.as_ref())?;
        let camera = self.world.get_component::<CameraComponent>(*entity).ok()?;
        match camera.projection {
            ProjectionType::Perspective { fov_degrees, .. } => Some(fov_degrees),
            _ => None,
        }
    }
    /// Sets the position and rotation of a camera entity.
    ///
    /// Used to write camera transform back to the ECS after
    /// the user moves the camera via controls in the renderer.
    ///
    /// position: x, y, z
    /// rotation: quaternion x, y, z, w
    #[allow(clippy::too_many_arguments)]
    pub fn set_camera_transform(
        &mut self,
        handle: u32,
        x: f32,
        y: f32,
        z: f32,
        rx: f32,
        ry: f32,
        rz: f32,
        rw: f32,
    ) {
        if let Some(Some(entity)) = self.entity_handles.get(handle as usize) {
            let entity = *entity;
            if let Ok(mut transform) = self.world.get_component_mut::<LocalTransform>(entity) {
                transform.position = Vec3::new(x, y, z);
                transform.rotation = Quat::from_xyzw(rx, ry, rz, rw);
            }
        }
    }

    // ── Components (Inspector reflection) ────────────────────────────────
    // Thin wrappers over the reflection module — this is deliberately
    // the ONLY place EngineWorld touches reflection::*, keeping the
    // WASM-boundary translation concern (handle -> Entity, error ->
    // message) separate from the reflection logic itself.

    /// Returns the reflectable component kinds present on an entity, by
    /// string name (e.g. "LocalTransform", "Camera"). Empty if the
    /// handle is invalid or despawned — a query, not a mutation, so it
    /// follows the existing "invalid handle -> empty result" convention.
    pub fn list_components(&self, handle: u32) -> Vec<String> {
        let Some(entity) = self.resolve_handle(handle) else {
            return Vec::new();
        };
        reflection::list_components(&self.world, entity)
            .into_iter()
            .map(|kind| kind.as_str().to_string())
            .collect()
    }
    /// Returns a component's current value as a JSON string, or None if
    /// the handle is invalid, the kind name is unrecognized, or the
    /// entity doesn't have that component.
    pub fn get_component_json(&self, handle: u32, kind: &str) -> Option<String> {
        let entity = self.resolve_handle(handle)?;
        let kind = ComponentKind::from_str(kind)?;
        let descriptor = reflection::find_descriptor(kind)?;
        let value = (descriptor.to_json)(&self.world, entity).ok()?;
        Some(value.to_string())
    }
    /// Writes a component's value from a JSON string.
    ///
    /// Returns None on success, or Some(message) describing why the
    /// write was rejected — invalid JSON shape, near >= far, an
    /// unregistered category. A return value rather than a thrown
    /// exception: an invalid Inspector edit is an expected, routine
    /// outcome of a user typing something invalid, not an exceptional
    /// programmer error, so it's modeled as data the caller can put
    /// straight into UI state (e.g. an inline validation message)
    /// without needing try/catch. See reflect_error_to_message's doc
    /// comment for the same reasoning applied to set_parent/remove_parent.
    pub fn set_component_json(&mut self, handle: u32, kind: &str, json: &str) -> Option<String> {
        let Some(entity) = self.resolve_handle(handle) else {
            return Some("entity not found".to_string());
        };
        let Some(kind) = ComponentKind::from_str(kind) else {
            return Some("unknown component kind".to_string());
        };
        let Some(descriptor) = reflection::find_descriptor(kind) else {
            return Some("unknown component kind".to_string());
        };
        let value: serde_json::Value = match serde_json::from_str(json) {
            Ok(v) => v,
            Err(e) => return Some(format!("invalid JSON: {e}")),
        };
        match (descriptor.from_json)(&mut self.world, entity, value) {
            Ok(()) => None,
            Err(e) => Some(reflect_error_to_message(e)),
        }
    }
    /// Returns all registered entity categories as a JSON array, for
    /// populating the Inspector's category dropdown. Includes built-ins
    /// and any custom categories added at runtime.
    pub fn list_categories(&self) -> String {
        serde_json::to_string(self.world.registry.categories()).unwrap_or_else(|_| "[]".to_string())
    }

    /// Returns all registered entity contexts as a JSON array, for
    /// populating the Inspector's context multi-select. Includes built-ins
    /// and any custom contexts added at runtime.
    pub fn list_contexts(&self) -> String {
        serde_json::to_string(self.world.registry.contexts()).unwrap_or_else(|_| "[]".to_string())
    }

    // ── Entity Hierarchy (list view) ───────────────────────────────────
    // Distinct from the reflection block above: this doesn't read
    // component *values* generically, it's a fixed-shape translation
    // of EngineWorld's own handle table + HierarchyNode into something
    // the Entity Hierarchy panel can render as a tree. Lives here
    // rather than a separate module because it depends on
    // entity_handles, a private EngineWorld field — see Phase 13
    // design discussion.

    /// Returns every live entity as a flat list, JSON-encoded, for the
    /// Entity Hierarchy panel to reconstruct into a tree client-side.
    ///
    /// Each entry carries `parent_handle` (None for roots) rather than
    /// `children`, deliberately flat rather than nested — building a
    /// nested tree here would duplicate HierarchySystem's own
    /// depth-first walk for a different purpose (serialization, not
    /// transform composition), and a flat list is what a drag-and-drop
    /// tree UI wants to reconcile against anyway.
    pub fn list_entity_hierarchy(&self) -> String {
        // Entity -> handle reverse lookup. entity_handles only maps
        // handle -> Entity; this is the one place EngineWorld needs
        // the reverse direction, so it's built here rather than
        // maintained as permanent state elsewhere.
        let entity_to_handle: std::collections::HashMap<Entity, u32> = self
            .entity_handles
            .iter()
            .enumerate()
            .filter_map(|(index, slot)| slot.map(|entity| (entity, index as u32)))
            .collect();

        let nodes: Vec<EntityHierarchyNode> = self
            .entity_handles
            .iter()
            .enumerate()
            .filter_map(|(index, slot)| slot.map(|entity| (index as u32, entity)))
            .map(|(handle, entity)| {
                // Every spawn bundle attaches EntityInfo (confirmed:
                // base/camera/dynamic_object/static_object bundles all
                // add it explicitly) — no fallback label needed, this
                // .expect documents that guarantee rather than silently
                // masking a bundle that stopped attaching it.
                let info = self
                    .world
                    .get_component::<EntityInfo>(entity)
                    .expect("every spawned entity has EntityInfo");
                let name = info.name.clone();
                let contexts = info.contexts.clone();
                let parent_handle = self
                    .world
                    .get_component::<HierarchyNode>(entity)
                    .ok()
                    .and_then(|node| node.parent)
                    .and_then(|parent_entity| entity_to_handle.get(&parent_entity).copied());
                EntityHierarchyNode {
                    handle,
                    parent_handle,
                    name,
                    contexts,
                }
            })
            .collect();

        serde_json::to_string(&nodes).unwrap_or_else(|_| "[]".to_string())
    }
}

impl Default for EngineWorld {
    fn default() -> Self {
        Self::new()
    }
}
impl EngineWorld {
    /// Finds the first available None slot or pushes a new entry.
    /// Returns the index as the JavaScript-facing handle.
    fn allocate_handle(&mut self, entity: Entity) -> u32 {
        // Reuse a despawned slot if available
        if let Some(index) = self.entity_handles.iter().position(|s| s.is_none()) {
            self.entity_handles[index] = Some(entity);
            return index as u32;
        }
        // No free slots — push a new entry
        self.entity_handles.push(Some(entity));
        (self.entity_handles.len() - 1) as u32
    }
    /// Resolves a JavaScript-facing u32 handle to its underlying Entity.
    /// Returns None if the handle is out of range or the slot is empty
    /// (despawned).
    fn resolve_handle(&self, handle: u32) -> Option<Entity> {
        self.entity_handles
            .get(handle as usize)
            .and_then(|slot| slot.as_ref())
            .copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_rotation_returns_identity_for_freshly_spawned_entity() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_dynamic_object("Cube", 0.0, 0.0, 0.0, 1.0, 0.0, 0.0);

        let rotation = world
            .get_rotation(handle)
            .expect("entity should have a rotation");

        assert_eq!(rotation, vec![0.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn get_rotation_returns_none_for_invalid_handle() {
        let world = EngineWorld::new();
        assert!(world.get_rotation(999).is_none());
    }

    #[test]
    fn get_rotation_returns_none_for_despawned_entity() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);
        world.despawn_entity(handle);

        assert!(world.get_rotation(handle).is_none());
    }

    #[test]
    fn get_rotation_reflects_rotation_written_via_reflection_after_tick() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);

        // A 90-degree yaw is exactly representable in a quaternion —
        // avoids floating-point tolerance issues below. Same choice
        // reflection.rs's own rotation round-trip test makes.
        let json = serde_json::json!({
            "position": [0.0, 0.0, 0.0],
            "rotation_euler_deg": [0.0, 90.0, 0.0]
        });
        let rejection = world.set_component_json(handle, "LocalTransform", &json.to_string());
        assert!(rejection.is_none(), "write should succeed: {:?}", rejection);

        // WorldTransform is only recomputed from LocalTransform when
        // HierarchySystem runs — this mirrors exactly what the
        // renderer's per-frame sync depends on, and is the actual
        // mechanism this test is guarding against regressing.
        world.tick(0.0);

        let rotation = world
            .get_rotation(handle)
            .expect("entity should have a rotation");
        let expected = Quat::from_rotation_y(std::f32::consts::FRAC_PI_2);
        assert!((rotation[0] - expected.x).abs() < 0.001);
        assert!((rotation[1] - expected.y).abs() < 0.001);
        assert!((rotation[2] - expected.z).abs() < 0.001);
        assert!((rotation[3] - expected.w).abs() < 0.001);
    }

    #[test]
    fn get_visible_returns_true_for_freshly_spawned_entity() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);

        assert_eq!(world.get_visible(handle), Some(true));
    }

    #[test]
    fn get_visible_returns_none_for_invalid_handle() {
        let world = EngineWorld::new();
        assert!(world.get_visible(999).is_none());
    }

    #[test]
    fn get_visible_reflects_value_written_via_reflection() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);

        let json = serde_json::json!({
            "name": "Cube",
            "enabled": true,
            "visible": false,
            "category": "Default",
            "contexts": ["Universal"]
        });
        let rejection = world.set_component_json(handle, "EntityInfo", &json.to_string());
        assert!(rejection.is_none(), "write should succeed: {:?}", rejection);

        assert_eq!(world.get_visible(handle), Some(false));
    }

    #[test]
    fn list_entity_hierarchy_includes_contexts() {
        let mut world = EngineWorld::new();
        world.spawn_camera("Scene Camera", 0.0, 0.0, 0.0, "Editor");

        let json = world.list_entity_hierarchy();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed[0]["contexts"], serde_json::json!(["Editor"]));
    }
}
