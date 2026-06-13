use crate::components::{Transform, Velocity};
use crate::world::World;
use glam::Vec3;
use hecs::Entity;

/// Creates entities with predefined component configurations.
///
/// EntityFactory provides named constructors for common entity archetypes.
/// Each method spawns an entity into the given World with the correct
/// initial components already attached.
///
/// This is the preferred way to create entities. Direct use of World::spawn
/// followed by individual add_component calls is reserved for cases where
/// no suitable archetype exists.
///
/// # Future Refactor — Bundle Pattern
///
/// The current implementation uses one method per archetype, which does not
/// scale as the number of entity types grows. The target design is a
/// Bundle trait — a struct that groups a set of components together and
/// can be spawned as a unit:
///
/// ```ignore
/// pub struct BuildingBundle {
///     pub transform: Transform,
///     pub metadata: BuildingMetadata,
/// }
///
/// impl Bundle for BuildingBundle { ... }
///
/// let entity = factory.spawn(&mut world, BuildingBundle { ... });
/// ```
///
/// With this pattern, adding a new archetype means defining a new Bundle
/// struct — EntityFactory itself never needs to change. This refactor
/// should be done once the full ECS loop is proven end to end and the
/// team has sufficient familiarity with Rust generics and traits.
// TODO(refactor): replace hardcoded archetype methods with a generic
// Bundle trait and a single spawn<B: Bundle>() method.
pub struct EntityFactory;

impl EntityFactory {
    /// Creates a new EntityFactory.
    pub fn new() -> Self {
        Self
    }

    /// Creates a static entity at the given position.
    ///
    /// A static entity has a position but does not move each tick.
    /// Use this for anything that occupies space but has no velocity —
    /// buildings, markers, anchor points, etc.
    ///
    /// Components attached: Transform
    pub fn create_static_object(&self, world: &mut World, position: Vec3) -> Entity {
        let entity = world.spawn();
        world
            .add_component(entity, Transform::new(position))
            .unwrap();
        entity
    }

    /// Creates a dynamic entity at the given position with the given velocity.
    ///
    /// A dynamic entity has both a position and a velocity, meaning it will
    /// be moved each tick by the MovementSystem.
    ///
    /// Components attached: Transform, Velocity
    pub fn create_dynamic_object(
        &self,
        world: &mut World,
        position: Vec3,
        velocity: Vec3,
    ) -> Entity {
        let entity = world.spawn();
        world
            .add_component(entity, Transform::new(position))
            .unwrap();
        world
            .add_component(entity, Velocity::new(velocity))
            .unwrap();
        entity
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

    #[test]
    fn factory_creates_static_object_with_transform() {
        // ARRANGE
        let mut world = World::new();
        let factory = EntityFactory::new();
        let position = Vec3::new(1.0, 0.0, 0.0);

        // ACT
        let entity = factory.create_static_object(&mut world, position);

        // ASSERT — entity exists and has a Transform at the correct position
        assert!(world.contains(entity));
        let transform = world.inner().get::<&Transform>(entity).unwrap();
        assert_eq!(transform.position, position);
    }

    #[test]
    fn factory_static_object_has_no_velocity() {
        // ARRANGE
        let mut world = World::new();
        let factory = EntityFactory::new();

        // ACT
        let entity = factory.create_static_object(&mut world, Vec3::ZERO);

        // ASSERT — static objects must not have a Velocity component
        assert!(world.inner().get::<&Velocity>(entity).is_err());
    }

    #[test]
    fn factory_creates_dynamic_object_with_transform_and_velocity() {
        // ARRANGE
        let mut world = World::new();
        let factory = EntityFactory::new();
        let position = Vec3::new(0.0, 0.0, 0.0);
        let velocity = Vec3::new(1.0, 0.0, 0.0);

        // ACT
        let entity = factory.create_dynamic_object(&mut world, position, velocity);

        // ASSERT — entity has both Transform and Velocity
        assert!(world.contains(entity));
        let transform = world.inner().get::<&Transform>(entity).unwrap();
        let vel = world.inner().get::<&Velocity>(entity).unwrap();
        assert_eq!(transform.position, position);
        assert_eq!(vel.value, velocity);
    }

    #[test]
    fn factory_creates_independent_entities() {
        // ARRANGE
        let mut world = World::new();
        let factory = EntityFactory::new();

        // ACT — create two entities
        let entity_a = factory.create_static_object(&mut world, Vec3::new(1.0, 0.0, 0.0));
        let entity_b = factory.create_static_object(&mut world, Vec3::new(2.0, 0.0, 0.0));

        // ASSERT — entities are distinct and have independent positions
        assert_ne!(entity_a, entity_b);
        assert_eq!(world.entity_count(), 2);
        let pos_a = world.inner().get::<&Transform>(entity_a).unwrap().position;
        let pos_b = world.inner().get::<&Transform>(entity_b).unwrap().position;
        assert_ne!(pos_a, pos_b);
    }
}
