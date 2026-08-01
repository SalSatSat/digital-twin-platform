use crate::bundle::{BaseBundle, Bundle};
use crate::components::Velocity;
use crate::world::World;
use glam::Vec3;
use hecs::Entity;

/// A dynamic entity — has position and velocity, moves each tick.
///
/// Contains: LocalTransform, EntityInfo, HierarchyNode, Velocity
/// Use for anything that moves — vehicles, sensors, animated objects.
pub struct DynamicObjectBundle {
    pub base: BaseBundle,
    pub velocity: Velocity,
}

impl DynamicObjectBundle {
    /// Creates a dynamic entity at the given position with the given velocity.
    pub fn new(name: impl Into<String>, position: Vec3, velocity: Vec3) -> Self {
        Self {
            base: BaseBundle::with_position(name, position),
            velocity: Velocity::new(velocity),
        }
    }
}

impl Bundle for DynamicObjectBundle {
    fn spawn_into(self, world: &mut World) -> Entity {
        let entity = self.base.spawn_into(world);
        world.add_component(entity, self.velocity).unwrap();
        entity
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{EntityInfo, HierarchyNode, LocalTransform, Velocity};

    #[test]
    fn dynamic_object_bundle_spawns_with_all_components() {
        let mut world = World::new();
        let bundle =
            DynamicObjectBundle::new("Dynamic Object", Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0));

        let entity = bundle.spawn_into(&mut world);

        assert!(world.get_component::<LocalTransform>(entity).is_ok());
        assert!(world.get_component::<EntityInfo>(entity).is_ok());
        assert!(world.get_component::<HierarchyNode>(entity).is_ok());
        assert!(world.get_component::<Velocity>(entity).is_ok());
    }

    #[test]
    fn dynamic_object_bundle_sets_velocity() {
        let mut world = World::new();
        let velocity = Vec3::new(2.0, 0.0, 0.0);
        let bundle = DynamicObjectBundle::new("Moving Object", Vec3::ZERO, velocity);

        let entity = bundle.spawn_into(&mut world);

        let vel = world.get_component::<Velocity>(entity).unwrap();
        assert_eq!(vel.value, velocity);
    }

    #[test]
    fn dynamic_object_bundle_sets_name() {
        let mut world = World::new();
        let bundle = DynamicObjectBundle::new("Named Object", Vec3::ZERO, Vec3::ZERO);

        let entity = bundle.spawn_into(&mut world);

        let info = world.get_component::<EntityInfo>(entity).unwrap();
        assert_eq!(info.name, "Named Object");
    }
}
