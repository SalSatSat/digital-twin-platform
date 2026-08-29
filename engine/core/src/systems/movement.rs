use crate::components::EntityInfo;
use crate::components::physics::Velocity;
use crate::components::spatial::LocalTransform;
use crate::systems::System;
use crate::world::World;

/// Updates the position of every entity that has both a LocalTransform
/// and a Velocity component.
///
/// Each tick, position is updated as:
///   transform.position += velocity.value * delta_time
///
/// Entities with a LocalTransform but no Velocity are not affected.
/// Entities with a Velocity but no LocalTransform are not affected.
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
        for (transform, velocity, info) in
            world
                .inner_mut()
                .query_mut::<(&mut LocalTransform, &Velocity, &EntityInfo)>()
        {
            if !info.enabled {
                continue;
            }
            transform.position += velocity.value * delta_time;
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::{DynamicObjectBundle, StaticObjectBundle};
    use approx::assert_relative_eq;
    use glam::Vec3;

    #[test]
    fn movement_system_moves_dynamic_entity_each_tick() {
        // ARRANGE
        let mut world = World::new();
        let mut system = MovementSystem::new();

        let entity = world.spawn_bundle(DynamicObjectBundle::new(
            "Dynamic Object",
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
        ));

        // ACT — run one tick with a delta_time of 1 second
        system.run(&mut world, 1.0);

        // ASSERT — entity moved 1 unit along the X axis
        let transform = world.get_component::<LocalTransform>(entity).unwrap();
        assert_relative_eq!(transform.position.x, 1.0);
        assert_relative_eq!(transform.position.y, 0.0);
        assert_relative_eq!(transform.position.z, 0.0);
    }

    #[test]
    fn movement_system_respects_delta_time() {
        // ARRANGE
        let mut world = World::new();
        let mut system = MovementSystem::new();

        let entity = world.spawn_bundle(DynamicObjectBundle::new(
            "Dynamic Object",
            Vec3::ZERO,
            Vec3::new(2.0, 0.0, 0.0),
        ));

        // ACT — run one tick with a delta_time of 0.5 seconds
        system.run(&mut world, 0.5);

        // ASSERT — entity moved 1 unit (2.0 velocity * 0.5 delta_time)
        let transform = world.get_component::<LocalTransform>(entity).unwrap();
        assert_relative_eq!(transform.position.x, 1.0);
    }

    #[test]
    fn movement_system_does_not_move_static_entity() {
        // ARRANGE
        let mut world = World::new();
        let mut system = MovementSystem::new();

        let entity = world.spawn_bundle(StaticObjectBundle::new(
            "Static Object",
            Vec3::new(5.0, 0.0, 0.0),
        ));

        // ACT
        system.run(&mut world, 1.0);

        // ASSERT — static entity position is unchanged
        let transform = world.get_component::<LocalTransform>(entity).unwrap();
        assert_relative_eq!(transform.position.x, 5.0);
    }

    #[test]
    fn movement_system_moves_multiple_entities_independently() {
        // ARRANGE
        let mut world = World::new();
        let mut system = MovementSystem::new();

        let entity_a = world.spawn_bundle(DynamicObjectBundle::new(
            "Entity A",
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
        ));
        let entity_b = world.spawn_bundle(DynamicObjectBundle::new(
            "Entity B",
            Vec3::ZERO,
            Vec3::new(0.0, 2.0, 0.0),
        ));

        // ACT
        system.run(&mut world, 1.0);

        // ASSERT — each entity moved according to its own velocity
        let pos_a = world
            .get_component::<LocalTransform>(entity_a)
            .unwrap()
            .position;
        let pos_b = world
            .get_component::<LocalTransform>(entity_b)
            .unwrap()
            .position;

        assert_relative_eq!(pos_a.x, 1.0);
        assert_relative_eq!(pos_a.y, 0.0);
        assert_relative_eq!(pos_b.x, 0.0);
        assert_relative_eq!(pos_b.y, 2.0);
    }

    #[test]
    fn movement_system_remains_stable_over_many_ticks() {
        // ARRANGE
        let mut world = World::new();
        let mut system = MovementSystem::new();

        let entity = world.spawn_bundle(DynamicObjectBundle::new(
            "Dynamic Object",
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
        ));

        // ACT — run 10,000 ticks at 60fps (about 2.75 hours of simulation)
        for _ in 0..10_000 {
            system.run(&mut world, 1.0 / 60.0);
        }

        // ASSERT — position should be finite and match expected value
        let transform = world.get_component::<LocalTransform>(entity).unwrap();
        assert!(transform.position.x.is_finite());
        assert!(transform.position.y.is_finite());
        assert!(transform.position.z.is_finite());
        assert_relative_eq!(transform.position.x, 10_000.0 / 60.0, epsilon = 0.1);
    }

    #[test]
    fn movement_system_does_not_move_disabled_entity() {
        // ARRANGE
        let mut world = World::new();
        let mut system = MovementSystem::new();

        let entity = world.spawn_bundle(DynamicObjectBundle::new(
            "Disabled Object",
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
        ));
        world
            .get_component_mut::<EntityInfo>(entity)
            .unwrap()
            .enabled = false;

        // ACT
        system.run(&mut world, 1.0);

        // ASSERT — disabled entity did not move despite having Velocity
        let transform = world.get_component::<LocalTransform>(entity).unwrap();
        assert_relative_eq!(transform.position.x, 0.0);
    }
}
