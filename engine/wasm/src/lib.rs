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

mod events;
mod reflection;
use events::EventQueue;
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
    /// Change events awaiting `drain_events` (ADR-036).
    event_queue: EventQueue,
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
            event_queue: EventQueue::new(),
        }
    }
    /// Returns the number of entities currently in the world.
    pub fn entity_count(&self) -> u32 {
        self.world.entity_count()
    }
    /// Returns and clears the change events recorded since the last call
    /// (ADR-036). Flat records of four u32 words: [kind, handle, a, b],
    /// with u32::MAX meaning "none". Empty when nothing changed.
    pub fn drain_events(&mut self) -> Vec<u32> {
        self.event_queue.drain()
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
    /// Descendants are despawned with it and their handle slots are freed
    /// too; the entity is also unlinked from its parent. If the active
    /// camera is among the despawned entities, the active camera is cleared.
    ///
    /// Returns true if the entity existed and was despawned.
    /// Returns false if the handle is invalid or already despawned.
    pub fn despawn_entity(&mut self, handle: u32) -> bool {
        let Some(Some(entity)) = self.entity_handles.get(handle as usize).copied() else {
            return false;
        };
        let despawned = self.world.despawn(entity);
        // Handles of every despawned entity, in the same children-first
        // order. The common case (no descendants) stays O(1); only a
        // cascade pays for the reverse lookup.
        let despawned_handles: Vec<u32> = if despawned.len() > 1 {
            let handle_of: std::collections::HashMap<Entity, u32> = self
                .entity_handles
                .iter()
                .enumerate()
                .filter_map(|(index, slot)| slot.map(|e| (e, index as u32)))
                .collect();
            despawned
                .iter()
                .filter_map(|e| handle_of.get(e).copied())
                .collect()
        } else {
            vec![handle]
        };
        for &dead in &despawned_handles {
            self.entity_handles[dead as usize] = None;
            self.event_queue.push(
                events::KIND_ENTITY_DESPAWNED,
                dead,
                events::NONE,
                events::NONE,
            );
        }
        // EngineWorld must never hold a handle to a freed slot.
        let active_camera_is_dead = self.active_camera_handle.is_some_and(|h| {
            self.entity_handles
                .get(h as usize)
                .copied()
                .flatten()
                .is_none()
        });
        if active_camera_is_dead {
            self.active_camera_handle = None;
        }
        true
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
    /// `world_position_stays` mirrors Unity's `Transform.SetParent` flag.
    /// When true, `child`'s LocalTransform is rewritten so its world pose
    /// is unchanged by the move (what a Hierarchy drag-and-drop wants).
    /// When false, its local values are kept and its world pose follows
    /// the new parent (what applying authored local transforms wants).
    ///
    /// Status code, not a thrown exception: WouldCreateCycle and
    /// EntityNotFound are both expected, user-triggerable outcomes in
    /// an interactive editor (a drag-and-drop reparent landing on an
    /// invalid target is normal usage, not a bug), so they're modeled
    /// as data the caller branches on rather than control-flow
    /// interruptions. Also: Result<(), JsValue> was tested here and
    /// found to break WASM instantiation in this project's toolchain.
    pub fn set_parent(
        &mut self,
        child_handle: u32,
        parent_handle: u32,
        world_position_stays: bool,
    ) -> u8 {
        let Some(child) = self.resolve_handle(child_handle) else {
            return 1;
        };
        let Some(parent) = self.resolve_handle(parent_handle) else {
            return 1;
        };
        let old_parent_handle = self.parent_handle_of(child);
        let result = if world_position_stays {
            self.world.set_parent_keep_world(child, parent)
        } else {
            self.world.set_parent(child, parent)
        };
        match result {
            Ok(()) => {
                // Setting the same parent again is an idempotent no-op.
                if old_parent_handle != parent_handle {
                    self.event_queue.push(
                        events::KIND_ENTITY_REPARENTED,
                        child_handle,
                        old_parent_handle,
                        parent_handle,
                    );
                    if world_position_stays {
                        self.record_component_changed(child_handle, ComponentKind::LocalTransform);
                    }
                }
                0
            }
            Err(HierarchyError::EntityNotFound) => 1,
            Err(HierarchyError::WouldCreateCycle) => 2,
        }
    }
    /// Removes `child`'s parent by handle, making it a root entity.
    ///
    /// `world_position_stays` works as in `set_parent`.
    ///
    /// Returns a status code:
    ///   0 = success (including if the entity was already a root — no-op)
    ///   1 = entity not found (invalid handle, despawned, or missing HierarchyNode)
    pub fn remove_parent(&mut self, child_handle: u32, world_position_stays: bool) -> u8 {
        let Some(child) = self.resolve_handle(child_handle) else {
            return 1;
        };
        let old_parent_handle = self.parent_handle_of(child);
        let result = if world_position_stays {
            self.world.remove_parent_keep_world(child)
        } else {
            self.world.remove_parent(child)
        };
        match result {
            Ok(()) => {
                // A root has nothing to detach: no event.
                if old_parent_handle != events::NONE {
                    self.event_queue.push(
                        events::KIND_ENTITY_REPARENTED,
                        child_handle,
                        old_parent_handle,
                        events::NONE,
                    );
                    if world_position_stays {
                        self.record_component_changed(child_handle, ComponentKind::LocalTransform);
                    }
                }
                0
            }
            Err(HierarchyError::EntityNotFound) => 1,
            // remove_parent's Rust API only has one error variant, but match
            // exhaustively rather than `_ => 1` so this breaks loudly at
            // compile time if HierarchyError ever grows a new variant.
            Err(HierarchyError::WouldCreateCycle) => {
                unreachable!("remove_parent cannot produce WouldCreateCycle")
            }
        }
    }
    /// Sets an entity's world-space pose by handle. The engine writes
    /// whichever LocalTransform gives the entity that world pose under
    /// its current parent, so callers (the transform gizmo) never do the
    /// parent math themselves.
    ///
    /// pose: [x, y, z, qx, qy, qz, qw] -- position, then rotation as a
    /// quaternion. A slice rather than eight scalar arguments, which also
    /// keeps this under clippy's argument limit without an allow.
    ///
    /// Returns a status code:
    ///   0 = success
    ///   1 = entity not found (invalid handle, despawned, or missing HierarchyNode)
    ///   2 = malformed pose (wrong length, non-finite value, or zero-length quaternion)
    ///
    /// The cached WorldTransform (what get_position reads) updates on the
    /// next tick.
    pub fn set_world_transform(&mut self, handle: u32, pose: &[f32]) -> u8 {
        let &[x, y, z, qx, qy, qz, qw] = pose else {
            return 2;
        };
        let rotation = Quat::from_xyzw(qx, qy, qz, qw);
        if !pose.iter().all(|v| v.is_finite()) || rotation.length_squared() < 1e-12 {
            return 2;
        }
        let Some(entity) = self.resolve_handle(handle) else {
            return 1;
        };
        match self
            .world
            .set_world_transform(entity, Vec3::new(x, y, z), rotation)
        {
            Ok(()) => {
                self.record_component_changed(handle, ComponentKind::LocalTransform);
                0
            }
            Err(HierarchyError::EntityNotFound) => 1,
            Err(HierarchyError::WouldCreateCycle) => {
                unreachable!("set_world_transform cannot produce WouldCreateCycle")
            }
        }
    }
    /// Advances the world by one tick.
    ///
    /// delta_time is the elapsed time in seconds since the last tick.
    /// Pass the actual elapsed time from your JavaScript animation loop
    /// for frame-rate independent movement.
    ///
    /// Order matters: HierarchySystem must run after MovementSystem so
    /// WorldTransform reflects this tick's movement (ADR-024).
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
    // 8 args (handle + position + quaternion) is inherent to this setter's shape;
    // grouping into a params struct would need a matching TS-side signature change
    // (engine.ts plus its two scene-manager.ts call sites) -- not worth it for a
    // thin boundary setter, not general logic. Same rationale as spawn_dynamic_object.
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
        let Some(entity) = self.resolve_handle(handle) else {
            return;
        };
        let written = match self.world.get_component_mut::<LocalTransform>(entity) {
            Ok(mut transform) => {
                transform.position = Vec3::new(x, y, z);
                transform.rotation = Quat::from_xyzw(rx, ry, rz, rw);
                true
            }
            Err(_) => false,
        };
        if written {
            self.record_component_changed(handle, ComponentKind::LocalTransform);
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
            Ok(()) => {
                self.record_component_changed(handle, kind);
                None
            }
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

    /// Returns every reflectable component kind's display name as a
    /// JSON array of {kind, display_name} objects — the static
    /// registry from reflection.rs, not tied to any entity. Lets the
    /// Inspector's section headers use the same names as the rest of
    /// the reflection layer instead of keeping a separate client-side
    /// copy.
    pub fn list_component_kinds(&self) -> String {
        serde_json::to_string(&reflection::component_kind_infos())
            .unwrap_or_else(|_| "[]".to_string())
    }

    // ── Entity Hierarchy (list view) ───────────────────────────────────
    // Distinct from the reflection block above: this doesn't read
    // component *values* generically, it's a fixed-shape translation
    // of EngineWorld's own handle table + HierarchyNode into something
    // the Entity Hierarchy panel can render as a tree. Lives here
    // rather than a separate module because it depends on
    // entity_handles, a private EngineWorld field.

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
            self.event_queue.push(
                events::KIND_ENTITY_SPAWNED,
                index as u32,
                events::NONE,
                events::NONE,
            );
            return index as u32;
        }
        // No free slots — push a new entry
        self.entity_handles.push(Some(entity));
        let handle = (self.entity_handles.len() - 1) as u32;
        self.event_queue.push(
            events::KIND_ENTITY_SPAWNED,
            handle,
            events::NONE,
            events::NONE,
        );
        handle
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

    /// Handle of `entity`'s parent, or `events::NONE` for a root or an
    /// entity without a HierarchyNode. A reverse lookup (O(slots)), which is
    /// fine because only reparenting calls it.
    fn parent_handle_of(&self, entity: Entity) -> u32 {
        let parent = self
            .world
            .get_component::<HierarchyNode>(entity)
            .ok()
            .and_then(|node| node.parent);
        parent
            .and_then(|p| self.entity_handles.iter().position(|slot| *slot == Some(p)))
            .map_or(events::NONE, |index| index as u32)
    }

    /// Records that `kind` changed on the entity behind `handle` (ADR-036).
    fn record_component_changed(&mut self, handle: u32, kind: ComponentKind) {
        self.event_queue.push(
            events::KIND_COMPONENT_CHANGED,
            handle,
            kind.id(),
            events::NONE,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_world_transform_moves_entity_after_tick() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Box", 0.0, 0.0, 0.0);

        let status = world.set_world_transform(handle, &[1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0]);
        world.tick(0.0);

        assert_eq!(status, 0);
        assert_eq!(world.get_position(handle), Some(vec![1.0, 2.0, 3.0]));
    }

    #[test]
    fn set_world_transform_rejects_malformed_pose() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Box", 0.0, 0.0, 0.0);

        assert_eq!(world.set_world_transform(handle, &[1.0, 2.0, 3.0]), 2);
        assert_eq!(
            world.set_world_transform(handle, &[f32::NAN, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]),
            2
        );
        assert_eq!(
            world.set_world_transform(handle, &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
            2
        );
    }

    #[test]
    fn set_world_transform_returns_not_found_for_invalid_handle() {
        let mut world = EngineWorld::new();

        let status = world.set_world_transform(999, &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]);

        assert_eq!(status, 1);
    }

    #[test]
    fn set_parent_with_world_position_stays_keeps_world_position() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 5.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 1.0, 0.0, 0.0);
        world.tick(0.0);

        let status = world.set_parent(child, parent, true);
        world.tick(0.0);

        assert_eq!(status, 0);
        assert_eq!(world.get_position(child), Some(vec![1.0, 0.0, 0.0]));
    }

    #[test]
    fn set_parent_without_world_position_stays_keeps_local_values() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 5.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 1.0, 0.0, 0.0);
        world.tick(0.0);

        let status = world.set_parent(child, parent, false);
        world.tick(0.0);

        assert_eq!(status, 0);
        assert_eq!(world.get_position(child), Some(vec![6.0, 0.0, 0.0]));
    }

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
    fn despawn_entity_parent_invalidates_descendant_handles() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 0.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 0.0, 0.0, 0.0);
        let grandchild = world.spawn_static_object("Grandchild", 0.0, 0.0, 0.0);
        assert_eq!(world.set_parent(child, parent, false), 0);
        assert_eq!(world.set_parent(grandchild, child, false), 0);

        assert!(world.despawn_entity(parent));

        assert_eq!(world.entity_count(), 0);
        assert_eq!(world.get_visible(parent), None);
        assert_eq!(world.get_visible(child), None);
        assert_eq!(world.get_visible(grandchild), None);
    }

    #[test]
    fn despawn_entity_child_leaves_parent_and_siblings_valid() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 0.0, 0.0, 0.0);
        let child_a = world.spawn_static_object("ChildA", 0.0, 0.0, 0.0);
        let child_b = world.spawn_static_object("ChildB", 0.0, 0.0, 0.0);
        assert_eq!(world.set_parent(child_a, parent, false), 0);
        assert_eq!(world.set_parent(child_b, parent, false), 0);

        assert!(world.despawn_entity(child_a));

        assert_eq!(world.get_visible(child_a), None);
        assert_eq!(world.get_visible(parent), Some(true));
        assert_eq!(world.get_visible(child_b), Some(true));
        assert_eq!(world.entity_count(), 2);
    }

    #[test]
    fn despawn_entity_active_camera_clears_active_camera() {
        let mut world = EngineWorld::new();
        let camera = world.spawn_camera("Scene Camera", 0.0, 0.0, 0.0, "Editor");
        world.set_active_camera(camera);
        assert_eq!(world.get_active_camera(), Some(camera));

        assert!(world.despawn_entity(camera));

        assert_eq!(world.get_active_camera(), None);
    }

    #[test]
    fn despawn_entity_parent_of_active_camera_clears_active_camera() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Rig", 0.0, 0.0, 0.0);
        let camera = world.spawn_camera("Scene Camera", 0.0, 0.0, 0.0, "Editor");
        assert_eq!(world.set_parent(camera, parent, false), 0);
        world.set_active_camera(camera);

        assert!(world.despawn_entity(parent));

        assert_eq!(world.get_active_camera(), None);
    }

    #[test]
    fn despawn_entity_unrelated_entity_keeps_active_camera() {
        let mut world = EngineWorld::new();
        let camera = world.spawn_camera("Scene Camera", 0.0, 0.0, 0.0, "Editor");
        let cube = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);
        world.set_active_camera(camera);

        assert!(world.despawn_entity(cube));

        assert_eq!(world.get_active_camera(), Some(camera));
    }

    fn event(kind: u32, handle: u32) -> [u32; 4] {
        [kind, handle, events::NONE, events::NONE]
    }

    fn reparented(handle: u32, old_parent: u32, new_parent: u32) -> [u32; 4] {
        [
            events::KIND_ENTITY_REPARENTED,
            handle,
            old_parent,
            new_parent,
        ]
    }

    fn component_changed(handle: u32, kind: ComponentKind) -> [u32; 4] {
        [
            events::KIND_COMPONENT_CHANGED,
            handle,
            kind.id(),
            events::NONE,
        ]
    }

    #[test]
    fn component_kind_ids_are_stable() {
        assert_eq!(ComponentKind::LocalTransform.id(), 0);
        assert_eq!(ComponentKind::Camera.id(), 1);
        assert_eq!(ComponentKind::Velocity.id(), 2);
        assert_eq!(ComponentKind::EntityInfo.id(), 3);
    }

    #[test]
    fn set_parent_records_reparented_with_old_and_new_parent() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 0.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 0.0, 0.0, 0.0);
        world.drain_events();

        assert_eq!(world.set_parent(child, parent, false), 0);

        assert_eq!(
            world.drain_events(),
            reparented(child, events::NONE, parent).to_vec()
        );
    }

    #[test]
    fn set_parent_with_world_position_stays_also_records_local_transform_change() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 5.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 1.0, 0.0, 0.0);
        world.drain_events();

        assert_eq!(world.set_parent(child, parent, true), 0);

        let expected: Vec<u32> = [
            reparented(child, events::NONE, parent),
            component_changed(child, ComponentKind::LocalTransform),
        ]
        .concat();
        assert_eq!(world.drain_events(), expected);
    }

    #[test]
    fn set_parent_between_parents_records_old_and_new() {
        let mut world = EngineWorld::new();
        let parent_a = world.spawn_static_object("A", 0.0, 0.0, 0.0);
        let parent_b = world.spawn_static_object("B", 0.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 0.0, 0.0, 0.0);
        assert_eq!(world.set_parent(child, parent_a, false), 0);
        world.drain_events();

        assert_eq!(world.set_parent(child, parent_b, false), 0);

        assert_eq!(
            world.drain_events(),
            reparented(child, parent_a, parent_b).to_vec()
        );
    }

    #[test]
    fn set_parent_to_same_parent_records_nothing() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 0.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 0.0, 0.0, 0.0);
        assert_eq!(world.set_parent(child, parent, true), 0);
        world.drain_events();

        assert_eq!(world.set_parent(child, parent, true), 0);

        assert!(world.drain_events().is_empty());
    }

    #[test]
    fn rejected_set_parent_records_nothing() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 0.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 0.0, 0.0, 0.0);
        assert_eq!(world.set_parent(child, parent, false), 0);
        world.drain_events();

        assert_eq!(world.set_parent(parent, child, false), 2);
        assert_eq!(world.set_parent(child, 999, false), 1);

        assert!(world.drain_events().is_empty());
    }

    #[test]
    fn remove_parent_records_reparented_to_none() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 0.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 0.0, 0.0, 0.0);
        assert_eq!(world.set_parent(child, parent, false), 0);
        world.drain_events();

        assert_eq!(world.remove_parent(child, false), 0);

        assert_eq!(
            world.drain_events(),
            reparented(child, parent, events::NONE).to_vec()
        );
    }

    #[test]
    fn remove_parent_with_world_position_stays_also_records_local_transform_change() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 5.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 1.0, 0.0, 0.0);
        assert_eq!(world.set_parent(child, parent, false), 0);
        world.drain_events();

        assert_eq!(world.remove_parent(child, true), 0);

        let expected: Vec<u32> = [
            reparented(child, parent, events::NONE),
            component_changed(child, ComponentKind::LocalTransform),
        ]
        .concat();
        assert_eq!(world.drain_events(), expected);
    }

    #[test]
    fn remove_parent_on_a_root_records_nothing() {
        let mut world = EngineWorld::new();
        let root = world.spawn_static_object("Root", 0.0, 0.0, 0.0);
        world.drain_events();

        assert_eq!(world.remove_parent(root, true), 0);

        assert!(world.drain_events().is_empty());
    }

    #[test]
    fn set_world_transform_records_component_changed() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);
        world.drain_events();

        let status = world.set_world_transform(handle, &[1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0]);

        assert_eq!(status, 0);
        assert_eq!(
            world.drain_events(),
            component_changed(handle, ComponentKind::LocalTransform).to_vec()
        );
    }

    #[test]
    fn repeated_transform_writes_in_one_frame_record_one_change() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);
        world.drain_events();

        world.set_world_transform(handle, &[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]);
        world.set_world_transform(handle, &[2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]);
        world.set_world_transform(handle, &[3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]);

        assert_eq!(
            world.drain_events(),
            component_changed(handle, ComponentKind::LocalTransform).to_vec()
        );
    }

    #[test]
    fn rejected_set_world_transform_records_nothing() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);
        world.drain_events();

        assert_eq!(
            world.set_world_transform(999, &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]),
            1
        );
        assert_eq!(world.set_world_transform(handle, &[0.0]), 2);

        assert!(world.drain_events().is_empty());
    }

    #[test]
    fn set_camera_transform_records_component_changed() {
        let mut world = EngineWorld::new();
        let camera = world.spawn_camera("Scene Camera", 0.0, 0.0, 0.0, "Editor");
        world.drain_events();

        world.set_camera_transform(camera, 1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0);

        assert_eq!(
            world.drain_events(),
            component_changed(camera, ComponentKind::LocalTransform).to_vec()
        );
    }

    #[test]
    fn set_camera_transform_with_invalid_handle_records_nothing() {
        let mut world = EngineWorld::new();
        world.drain_events();

        world.set_camera_transform(999, 1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0);

        assert!(world.drain_events().is_empty());
    }

    #[test]
    fn set_component_json_records_component_changed_with_kind_id() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);
        world.drain_events();
        let json = serde_json::json!({
            "name": "Renamed",
            "enabled": true,
            "visible": true,
            "category": "Default",
            "contexts": ["Universal"]
        });

        let rejection = world.set_component_json(handle, "EntityInfo", &json.to_string());

        assert!(rejection.is_none(), "write should succeed: {:?}", rejection);
        assert_eq!(
            world.drain_events(),
            component_changed(handle, ComponentKind::EntityInfo).to_vec()
        );
    }

    #[test]
    fn rejected_set_component_json_records_nothing() {
        let mut world = EngineWorld::new();
        let handle = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);
        world.drain_events();
        let unregistered_category = serde_json::json!({
            "name": "Cube",
            "enabled": true,
            "visible": true,
            "category": "NoSuchCategory",
            "contexts": ["Universal"]
        });

        assert!(
            world
                .set_component_json(handle, "EntityInfo", "not json")
                .is_some()
        );
        assert!(
            world
                .set_component_json(handle, "NoSuchKind", "{}")
                .is_some()
        );
        assert!(world.set_component_json(999, "EntityInfo", "{}").is_some());
        assert!(
            world
                .set_component_json(handle, "EntityInfo", &unregistered_category.to_string())
                .is_some()
        );

        assert!(world.drain_events().is_empty());
    }

    #[test]
    fn drain_events_is_empty_on_a_fresh_world() {
        let mut world = EngineWorld::new();

        assert!(world.drain_events().is_empty());
    }

    #[test]
    fn spawn_static_object_records_entity_spawned() {
        let mut world = EngineWorld::new();

        let handle = world.spawn_static_object("Cube", 0.0, 0.0, 0.0);

        assert_eq!(
            world.drain_events(),
            event(events::KIND_ENTITY_SPAWNED, handle).to_vec()
        );
    }

    #[test]
    fn spawn_dynamic_object_records_entity_spawned() {
        let mut world = EngineWorld::new();

        let handle = world.spawn_dynamic_object("Ball", 0.0, 0.0, 0.0, 1.0, 0.0, 0.0);

        assert_eq!(
            world.drain_events(),
            event(events::KIND_ENTITY_SPAWNED, handle).to_vec()
        );
    }

    #[test]
    fn spawn_camera_records_entity_spawned() {
        let mut world = EngineWorld::new();

        let handle = world.spawn_camera("Scene Camera", 0.0, 0.0, 0.0, "Editor");

        assert_eq!(
            world.drain_events(),
            event(events::KIND_ENTITY_SPAWNED, handle).to_vec()
        );
    }

    #[test]
    fn despawn_entity_parent_records_descendants_children_first() {
        let mut world = EngineWorld::new();
        let parent = world.spawn_static_object("Parent", 0.0, 0.0, 0.0);
        let child = world.spawn_static_object("Child", 0.0, 0.0, 0.0);
        let grandchild = world.spawn_static_object("Grandchild", 0.0, 0.0, 0.0);
        assert_eq!(world.set_parent(child, parent, false), 0);
        assert_eq!(world.set_parent(grandchild, child, false), 0);
        world.drain_events();

        assert!(world.despawn_entity(parent));

        let expected: Vec<u32> = [
            event(events::KIND_ENTITY_DESPAWNED, grandchild),
            event(events::KIND_ENTITY_DESPAWNED, child),
            event(events::KIND_ENTITY_DESPAWNED, parent),
        ]
        .concat();
        assert_eq!(world.drain_events(), expected);
    }

    #[test]
    fn despawn_entity_with_invalid_handle_records_nothing() {
        let mut world = EngineWorld::new();
        world.drain_events();

        assert!(!world.despawn_entity(999));

        assert!(world.drain_events().is_empty());
    }

    #[test]
    fn reused_handle_slot_records_despawn_then_spawn_in_order() {
        let mut world = EngineWorld::new();
        let first = world.spawn_static_object("A", 0.0, 0.0, 0.0);
        world.drain_events();

        assert!(world.despawn_entity(first));
        let second = world.spawn_static_object("B", 0.0, 0.0, 0.0);

        assert_eq!(second, first);
        let expected: Vec<u32> = [
            event(events::KIND_ENTITY_DESPAWNED, first),
            event(events::KIND_ENTITY_SPAWNED, second),
        ]
        .concat();
        assert_eq!(world.drain_events(), expected);
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
