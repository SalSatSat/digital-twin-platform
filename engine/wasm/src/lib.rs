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
    components::{CameraComponent, LocalTransform, ProjectionType},
    systems::{HierarchySystem, MovementSystem, System},
    world::World,
};
use glam::{Quat, Vec3};
use hecs::Entity;
use wasm_bindgen::prelude::*;

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
    pub fn spawn_dynamic_object(
        &mut self,
        x: f32,
        y: f32,
        z: f32,
        vx: f32,
        vy: f32,
        vz: f32,
    ) -> u32 {
        let entity = self.world.spawn_bundle(DynamicObjectBundle::new(
            "Dynamic Object",
            Vec3::new(x, y, z),
            Vec3::new(vx, vy, vz),
        ));
        self.allocate_handle(entity)
    }

    /// Spawns a static entity at the given position.
    /// Returns a u32 handle that JavaScript uses to reference this entity.
    pub fn spawn_static_object(&mut self, x: f32, y: f32, z: f32) -> u32 {
        let entity = self
            .world
            .spawn_bundle(StaticObjectBundle::new("Static Object", Vec3::new(x, y, z)));
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
    /// Returns None if the handle is invalid, despawned, or has no LocalTransform.
    pub fn get_position(&self, handle: u32) -> Option<Vec<f32>> {
        let entity = self
            .entity_handles
            .get(handle as usize)
            .and_then(|slot| slot.as_ref())?;
        let transform = self.world.get_component::<LocalTransform>(*entity).ok()?;
        Some(vec![
            transform.position.x,
            transform.position.y,
            transform.position.z,
        ])
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
}
