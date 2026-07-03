use crate::bundle::{DynamicObjectBundle, StaticObjectBundle};
use crate::world::World;
use glam::Vec3;
use hecs::Entity;

/// Creates entities with predefined component configurations.
///
/// EntityFactory provides named constructors for common entity archetypes.
/// Each method spawns an entity into the given World with the correct
/// initial components already attached via the Bundle pattern.
///
/// This is the preferred way to create entities when you don't need
/// to construct a Bundle explicitly. For full control over bundle
/// configuration — including name, category, and context — construct
/// the Bundle directly and use World::spawn_bundle().
pub struct EntityFactory;

impl EntityFactory {
    /// Creates a new EntityFactory.
    pub fn new() -> Self {
        Self
    }

    /// Creates a static entity at the given position.
    ///
    /// A static entity has a position but does not move each tick.
    ///
    /// Components attached: Transform, EntityInfo, HierarchyNode
    pub fn create_static_object(&self, world: &mut World, position: Vec3) -> Entity {
        world.spawn_bundle(StaticObjectBundle::new("Static Object", position))
    }

    /// Creates a dynamic entity at the given position with the given velocity.
    ///
    /// A dynamic entity has both a position and a velocity, meaning it will
    /// be moved each tick by the MovementSystem.
    ///
    /// Components attached: Transform, EntityInfo, HierarchyNode, Velocity
    pub fn create_dynamic_object(
        &self,
        world: &mut World,
        position: Vec3,
        velocity: Vec3,
    ) -> Entity {
        world.spawn_bundle(DynamicObjectBundle::new(
            "Dynamic Object",
            position,
            velocity,
        ))
    }
}

impl Default for EntityFactory {
    fn default() -> Self {
        Self::new()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{EntityInfo, HierarchyNode, Transform, Velocity};

    #[test]
    fn factory_creates_static_object_with_base_components() {
        let mut world = World::new();
        let factory = EntityFactory::new();
        let position = Vec3::new(1.0, 0.0, 0.0);

        let entity = factory.create_static_object(&mut world, position);

        assert!(world.contains(entity));
        assert!(world.get_component::<Transform>(entity).is_ok());
        assert!(world.get_component::<EntityInfo>(entity).is_ok());
        assert!(world.get_component::<HierarchyNode>(entity).is_ok());
        let transform = world.get_component::<Transform>(entity).unwrap();
        assert_eq!(transform.position, position);
    }

    #[test]
    fn factory_static_object_has_no_velocity() {
        let mut world = World::new();
        let factory = EntityFactory::new();

        let entity = factory.create_static_object(&mut world, Vec3::ZERO);

        assert!(world.get_component::<Velocity>(entity).is_err());
    }

    #[test]
    fn factory_creates_dynamic_object_with_all_components() {
        let mut world = World::new();
        let factory = EntityFactory::new();
        let position = Vec3::new(0.0, 0.0, 0.0);
        let velocity = Vec3::new(1.0, 0.0, 0.0);

        let entity = factory.create_dynamic_object(&mut world, position, velocity);

        assert!(world.contains(entity));
        assert!(world.get_component::<Transform>(entity).is_ok());
        assert!(world.get_component::<EntityInfo>(entity).is_ok());
        assert!(world.get_component::<HierarchyNode>(entity).is_ok());
        let vel = world.get_component::<Velocity>(entity).unwrap();
        assert_eq!(vel.value, velocity);
    }

    #[test]
    fn factory_creates_independent_entities() {
        let mut world = World::new();
        let factory = EntityFactory::new();

        let entity_a = factory.create_static_object(&mut world, Vec3::new(1.0, 0.0, 0.0));
        let entity_b = factory.create_static_object(&mut world, Vec3::new(2.0, 0.0, 0.0));

        assert_ne!(entity_a, entity_b);
        assert_eq!(world.entity_count(), 2);
        let pos_a = world.get_component::<Transform>(entity_a).unwrap().position;
        let pos_b = world.get_component::<Transform>(entity_b).unwrap().position;
        assert_ne!(pos_a, pos_b);
    }
}
