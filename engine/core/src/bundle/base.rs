use crate::bundle::Bundle;
use crate::components::{EntityInfo, HierarchyNode, LocalTransform, WorldTransform};
use crate::world::World;
use glam::Vec3;
use hecs::Entity;

/// The base bundle present on every entity.
///
/// Contains the three components that all entities share:
/// - LocalTransform — position in 3D space
/// - EntityInfo — identity, classification, and active state
/// - HierarchyNode — position in the scene tree
///
/// All other bundles include BaseBundle as their foundation,
/// ensuring every entity always has these three components.
pub struct BaseBundle {
    pub transform: LocalTransform,
    pub info: EntityInfo,
    pub hierarchy: HierarchyNode,
}

impl BaseBundle {
    /// Creates a BaseBundle with the given name at the world origin.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            transform: LocalTransform::default(),
            info: EntityInfo::new(name),
            hierarchy: HierarchyNode::new(),
        }
    }

    /// Creates a BaseBundle with the given name at the given position.
    pub fn with_position(name: impl Into<String>, position: Vec3) -> Self {
        Self {
            transform: LocalTransform::new(position),
            info: EntityInfo::new(name),
            hierarchy: HierarchyNode::new(),
        }
    }
}

impl Bundle for BaseBundle {
    fn spawn_into(self, world: &mut World) -> Entity {
        let entity = world.spawn();
        let world_transform = WorldTransform::from_local(&self.transform);
        world.add_component(entity, self.transform).unwrap();
        world.add_component(entity, world_transform).unwrap();
        world.add_component(entity, self.info).unwrap();
        world.add_component(entity, self.hierarchy).unwrap();
        entity
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_bundle_spawns_entity_with_transform_info_and_hierarchy() {
        let mut world = World::new();
        let bundle = BaseBundle::new("Test");

        let entity = bundle.spawn_into(&mut world);

        assert!(world.get_component::<LocalTransform>(entity).is_ok());
        assert!(world.get_component::<EntityInfo>(entity).is_ok());
        assert!(world.get_component::<HierarchyNode>(entity).is_ok());
    }

    #[test]
    fn base_bundle_sets_entity_name() {
        let mut world = World::new();
        let bundle = BaseBundle::new("My Entity");

        let entity = bundle.spawn_into(&mut world);

        let info = world.get_component::<EntityInfo>(entity).unwrap();
        assert_eq!(info.name, "My Entity");
    }

    #[test]
    fn base_bundle_new_spawns_at_origin() {
        let mut world = World::new();
        let bundle = BaseBundle::new("Origin Entity");

        let entity = bundle.spawn_into(&mut world);

        let transform = world.get_component::<LocalTransform>(entity).unwrap();
        assert_eq!(transform.position, Vec3::ZERO);
    }

    #[test]
    fn base_bundle_with_position_sets_correct_position() {
        let mut world = World::new();
        let position = Vec3::new(1.0, 2.0, 3.0);
        let bundle = BaseBundle::with_position("Positioned Entity", position);

        let entity = bundle.spawn_into(&mut world);

        let transform = world.get_component::<LocalTransform>(entity).unwrap();
        assert_eq!(transform.position, position);
    }

    #[test]
    fn base_bundle_hierarchy_is_root_by_default() {
        let mut world = World::new();
        let bundle = BaseBundle::new("Root Entity");

        let entity = bundle.spawn_into(&mut world);

        let hierarchy = world.get_component::<HierarchyNode>(entity).unwrap();
        assert!(hierarchy.is_root());
        assert!(!hierarchy.has_children());
    }
}
