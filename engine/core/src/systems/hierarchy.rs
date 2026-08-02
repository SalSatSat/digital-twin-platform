use crate::components::{HierarchyNode, LocalTransform, WorldTransform};
use crate::systems::System;
use crate::world::World;
use hecs::Entity;

/// Propagates LocalTransform to WorldTransform for all entities each tick.
///
/// For root entities (no parent), WorldTransform mirrors LocalTransform.
/// For child entities, WorldTransform is computed by composing the parent's
/// WorldTransform with the child's LocalTransform.
///
/// Entities are processed depth-first from root to leaf, ensuring parents
/// are always updated before their children.
pub struct HierarchySystem;

impl HierarchySystem {
    pub fn new() -> Self {
        Self
    }
}

impl Default for HierarchySystem {
    fn default() -> Self {
        Self::new()
    }
}

impl System for HierarchySystem {
    fn name(&self) -> &str {
        "HierarchySystem"
    }

    fn run(&mut self, world: &mut World, _delta_time: f32) {
        // Collect all root entities first to avoid borrow conflicts
        let mut roots: Vec<Entity> = Vec::new();
        for (entity, node, _) in world
            .inner()
            .query::<(Entity, &HierarchyNode, &LocalTransform)>()
            .iter()
        {
            if node.is_root() {
                roots.push(entity);
            }
        }

        for root in roots {
            Self::propagate(world, root, None);
        }
    }
}

impl HierarchySystem {
    /// Recursively propagates transforms from parent to children.
    fn propagate(world: &mut World, entity: Entity, parent_world: Option<WorldTransform>) {
        // Compute this entity's WorldTransform
        let local = match world.get_component::<LocalTransform>(entity) {
            Ok(l) => *l,
            Err(_) => return,
        };

        let world_transform = match parent_world {
            Some(parent) => parent.compose(&local),
            None => WorldTransform::from_local(&local),
        };

        // Write WorldTransform back
        if let Ok(mut wt) = world.get_component_mut::<WorldTransform>(entity) {
            *wt = world_transform;
        }

        // Collect children to avoid borrow conflicts
        let children: Vec<Entity> = world
            .get_component::<HierarchyNode>(entity)
            .map(|node| node.children.clone())
            .unwrap_or_default();

        // Recurse into children
        for child in children {
            Self::propagate(world, child, Some(world_transform));
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::StaticObjectBundle;
    use approx::assert_relative_eq;
    use glam::Vec3;

    #[test]
    fn hierarchy_system_sets_world_transform_for_root_entity() {
        // ARRANGE
        let mut world = World::new();
        let mut system = HierarchySystem::new();
        let entity = world.spawn_bundle(StaticObjectBundle::new("Root", Vec3::new(1.0, 2.0, 3.0)));

        // ACT
        system.run(&mut world, 0.0);

        // ASSERT — world transform matches local transform for root
        let wt = world.get_component::<WorldTransform>(entity).unwrap();
        assert_relative_eq!(wt.position.x, 1.0, epsilon = 1e-6);
        assert_relative_eq!(wt.position.y, 2.0, epsilon = 1e-6);
        assert_relative_eq!(wt.position.z, 3.0, epsilon = 1e-6);
    }

    #[test]
    fn hierarchy_system_propagates_parent_position_to_child() {
        // ARRANGE
        let mut world = World::new();
        let mut system = HierarchySystem::new();

        // Parent at (5, 0, 0)
        let parent =
            world.spawn_bundle(StaticObjectBundle::new("Parent", Vec3::new(5.0, 0.0, 0.0)));

        // Child at (1, 0, 0) in local space
        let child = world.spawn_bundle(StaticObjectBundle::new("Child", Vec3::new(1.0, 0.0, 0.0)));

        // Set up parent-child relationship manually
        {
            let mut child_node = world.get_component_mut::<HierarchyNode>(child).unwrap();
            child_node.parent = Some(parent);
        }
        {
            let mut parent_node = world.get_component_mut::<HierarchyNode>(parent).unwrap();
            parent_node.children.push(child);
        }

        // ACT
        system.run(&mut world, 0.0);

        // ASSERT — child world position is parent (5,0,0) + local (1,0,0) = (6,0,0)
        let child_wt = world.get_component::<WorldTransform>(child).unwrap();
        assert_relative_eq!(child_wt.position.x, 6.0, epsilon = 1e-6);
        assert_relative_eq!(child_wt.position.y, 0.0, epsilon = 1e-6);
        assert_relative_eq!(child_wt.position.z, 0.0, epsilon = 1e-6);
    }

    #[test]
    fn hierarchy_system_propagates_through_multiple_levels() {
        // ARRANGE
        let mut world = World::new();
        let mut system = HierarchySystem::new();

        let grandparent = world.spawn_bundle(StaticObjectBundle::new(
            "Grandparent",
            Vec3::new(10.0, 0.0, 0.0),
        ));
        let parent =
            world.spawn_bundle(StaticObjectBundle::new("Parent", Vec3::new(5.0, 0.0, 0.0)));
        let child = world.spawn_bundle(StaticObjectBundle::new("Child", Vec3::new(1.0, 0.0, 0.0)));

        // Grandparent → Parent → Child
        {
            let mut node = world.get_component_mut::<HierarchyNode>(parent).unwrap();
            node.parent = Some(grandparent);
        }
        {
            let mut node = world
                .get_component_mut::<HierarchyNode>(grandparent)
                .unwrap();
            node.children.push(parent);
        }
        {
            let mut node = world.get_component_mut::<HierarchyNode>(child).unwrap();
            node.parent = Some(parent);
        }
        {
            let mut node = world.get_component_mut::<HierarchyNode>(parent).unwrap();
            node.children.push(child);
        }

        // ACT
        system.run(&mut world, 0.0);

        // ASSERT — child world position = 10 + 5 + 1 = 16
        let child_wt = world.get_component::<WorldTransform>(child).unwrap();
        assert_relative_eq!(child_wt.position.x, 16.0, epsilon = 1e-6);
    }

    #[test]
    fn hierarchy_system_root_entity_world_equals_local() {
        // ARRANGE
        let mut world = World::new();
        let mut system = HierarchySystem::new();

        let entity = world.spawn_bundle(StaticObjectBundle::new("Root", Vec3::new(3.0, 4.0, 5.0)));

        // ACT
        system.run(&mut world, 0.0);

        // ASSERT
        let local = world.get_component::<LocalTransform>(entity).unwrap();
        let world_t = world.get_component::<WorldTransform>(entity).unwrap();
        assert_eq!(local.position, world_t.position);
        assert_eq!(local.rotation, world_t.rotation);
    }
}
