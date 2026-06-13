use crate::components::physics::Velocity;
use crate::components::spatial::Transform;
use crate::systems::System;
use crate::world::World;

/// Updates the position of every entity that has both a Transform
/// and a Velocity component.
///
/// Each tick, position is updated as:
///   transform.position += velocity.value * delta_time
///
/// Entities with a Transform but no Velocity are not affected.
/// Entities with a Velocity but no Transform are not affected.
pub struct MovementSystem;

impl MovementSystem {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MovementSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl System for MovementSystem {
    fn name(&self) -> &str {
        "MovementSystem"
    }

    fn run(&mut self, world: &mut World, delta_time: f32) {
        for (transform, velocity) in world.inner_mut().query_mut::<(&mut Transform, &Velocity)>() {
            transform.position += velocity.value * delta_time;
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::factory::EntityFactory;
    use approx::assert_relative_eq;
    use glam::Vec3;

    #[test]
    fn movement_system_moves_dynamic_entity_each_tick() {
        // ARRANGE
        let mut world = World::new();
        let factory = EntityFactory::new();
        let mut system = MovementSystem::new();

        let entity =
            factory.create_dynamic_object(&mut world, Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0));

        // ACT — run one tick with a delta_time of 1 second
        system.run(&mut world, 1.0);

        // ASSERT — entity moved 1 unit along the X axis
        let transform = world.get_component::<Transform>(entity).unwrap();
        assert_relative_eq!(transform.position.x, 1.0);
        assert_relative_eq!(transform.position.y, 0.0);
        assert_relative_eq!(transform.position.z, 0.0);
    }

    #[test]
    fn movement_system_respects_delta_time() {
        // ARRANGE
        let mut world = World::new();
        let factory = EntityFactory::new();
        let mut system = MovementSystem::new();

        let entity =
            factory.create_dynamic_object(&mut world, Vec3::ZERO, Vec3::new(2.0, 0.0, 0.0));

        // ACT — run one tick with a delta_time of 0.5 seconds
        system.run(&mut world, 0.5);

        // ASSERT — entity moved 1 unit (2.0 velocity * 0.5 delta_time)
        let transform = world.get_component::<Transform>(entity).unwrap();
        assert_relative_eq!(transform.position.x, 1.0);
    }

    #[test]
    fn movement_system_does_not_move_static_entity() {
        // ARRANGE
        let mut world = World::new();
        let factory = EntityFactory::new();
        let mut system = MovementSystem::new();

        let entity = factory.create_static_object(&mut world, Vec3::new(5.0, 0.0, 0.0));

        // ACT
        system.run(&mut world, 1.0);

        // ASSERT — static entity position is unchanged
        let transform = world.get_component::<Transform>(entity).unwrap();
        assert_relative_eq!(transform.position.x, 5.0);
    }

    #[test]
    fn movement_system_moves_multiple_entities_independently() {
        // ARRANGE
        let mut world = World::new();
        let factory = EntityFactory::new();
        let mut system = MovementSystem::new();

        let entity_a =
            factory.create_dynamic_object(&mut world, Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0));
        let entity_b =
            factory.create_dynamic_object(&mut world, Vec3::ZERO, Vec3::new(0.0, 2.0, 0.0));

        // ACT
        system.run(&mut world, 1.0);

        // ASSERT — each entity moved according to its own velocity
        let pos_a = world.get_component::<Transform>(entity_a).unwrap().position;
        let pos_b = world.get_component::<Transform>(entity_b).unwrap().position;

        assert_relative_eq!(pos_a.x, 1.0);
        assert_relative_eq!(pos_a.y, 0.0);
        assert_relative_eq!(pos_b.x, 0.0);
        assert_relative_eq!(pos_b.y, 2.0);
    }
}
