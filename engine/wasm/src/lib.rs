use dt_engine_core::{
    components::Transform,
    factory::EntityFactory,
    systems::{MovementSystem, System},
    world::World,
};
use glam::Vec3;
use hecs::Entity;
use wasm_bindgen::prelude::*;

/// The main entry point exposed to JavaScript.
///
/// EngineWorld wraps the ECS World, EntityFactory, and MovementSystem
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
    factory: EntityFactory,
    movement_system: MovementSystem,
    /// Stores entity handles indexed by a u32 ID passed to JavaScript.
    /// None indicates a despawned slot available for reuse.
    entity_handles: Vec<Option<Entity>>,
}

#[wasm_bindgen]
impl EngineWorld {
    /// Creates a new empty EngineWorld.
    /// Call this once from JavaScript to initialize the engine.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            world: World::new(),
            factory: EntityFactory::new(),
            movement_system: MovementSystem::new(),
            entity_handles: Vec::new(),
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
        let entity = self.factory.create_dynamic_object(
            &mut self.world,
            Vec3::new(x, y, z),
            Vec3::new(vx, vy, vz),
        );
        self.allocate_handle(entity)
    }

    /// Spawns a static entity at the given position.
    /// Returns a u32 handle that JavaScript uses to reference this entity.
    pub fn spawn_static_object(&mut self, x: f32, y: f32, z: f32) -> u32 {
        let entity = self
            .factory
            .create_static_object(&mut self.world, Vec3::new(x, y, z));
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
    }

    /// Returns the position of an entity as a flat [x, y, z] array.
    /// Returns None if the handle is invalid, despawned, or has no Transform.
    pub fn get_position(&self, handle: u32) -> Option<Vec<f32>> {
        let entity = self
            .entity_handles
            .get(handle as usize)
            .and_then(|slot| slot.as_ref())?;
        let transform = self.world.get_component::<Transform>(*entity).ok()?;
        Some(vec![
            transform.position.x,
            transform.position.y,
            transform.position.z,
        ])
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
