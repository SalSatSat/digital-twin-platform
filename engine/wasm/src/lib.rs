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
/// safely. We store entities in a Vec and expose their index as u32 to
/// JavaScript. JavaScript passes the index back to reference an entity.
#[wasm_bindgen]
pub struct EngineWorld {
    world: World,
    factory: EntityFactory,
    movement_system: MovementSystem,
    /// Stores entity handles indexed by a u32 ID passed to JavaScript.
    entity_handles: Vec<Entity>,
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
    ///
    /// A dynamic entity has both position and velocity — it will move
    /// each tick when tick() is called.
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
        self.entity_handles.push(entity);
        // Return the index as the JavaScript-facing handle
        (self.entity_handles.len() - 1) as u32
    }

    /// Spawns a static entity at the given position.
    /// Returns a u32 handle that JavaScript uses to reference this entity.
    ///
    /// A static entity has position only — it does not move each tick.
    pub fn spawn_static_object(&mut self, x: f32, y: f32, z: f32) -> u32 {
        let entity = self
            .factory
            .create_static_object(&mut self.world, Vec3::new(x, y, z));
        self.entity_handles.push(entity);
        (self.entity_handles.len() - 1) as u32
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
    ///
    /// Returns None if the handle is invalid or the entity has no Transform.
    /// JavaScript receives this as a Float32Array or null.
    pub fn get_position(&self, handle: u32) -> Option<Vec<f32>> {
        let entity = self.entity_handles.get(handle as usize)?;
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
