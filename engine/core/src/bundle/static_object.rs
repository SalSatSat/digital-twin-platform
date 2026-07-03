use crate::bundle::{BaseBundle, Bundle};
use crate::world::World;
use glam::Vec3;
use hecs::Entity;

/// A static entity — has position but does not move each tick.
///
/// Contains: Transform, EntityInfo, HierarchyNode
/// Use for anything that occupies space but has no velocity.
pub struct StaticObjectBundle {
    pub base: BaseBundle,
}

impl StaticObjectBundle {
    /// Creates a static entity at the given position with the given name.
    pub fn new(name: impl Into<String>, position: Vec3) -> Self {
        Self {
            base: BaseBundle::with_position(name, position),
        }
    }
}

impl Bundle for StaticObjectBundle {
    fn spawn_into(self, world: &mut World) -> Entity {
        self.base.spawn_into(world)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{EntityInfo, HierarchyNode, Transform, Velocity};

    #[test]
    fn static_object_bundle_spawns_with_base_components() {
        let mut world = World::new();
        let bundle = StaticObjectBundle::new("Static Object", Vec3::new(1.0, 0.0, 0.0));

        let entity = bundle.spawn_into(&mut world);

        assert!(world.get_component::<Transform>(entity).is_ok());
        assert!(world.get_component::<EntityInfo>(entity).is_ok());
        assert!(world.get_component::<HierarchyNode>(entity).is_ok());
    }

    #[test]
    fn static_object_bundle_has_no_velocity() {
        let mut world = World::new();
        let bundle = StaticObjectBundle::new("Static Object", Vec3::ZERO);

        let entity = bundle.spawn_into(&mut world);

        assert!(world.get_component::<Velocity>(entity).is_err());
    }

    #[test]
    fn static_object_bundle_sets_position() {
        let mut world = World::new();
        let position = Vec3::new(5.0, 0.0, 0.0);
        let bundle = StaticObjectBundle::new("Static Object", position);

        let entity = bundle.spawn_into(&mut world);

        let transform = world.get_component::<Transform>(entity).unwrap();
        assert_eq!(transform.position, position);
    }
}
