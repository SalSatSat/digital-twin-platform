use crate::bundle::Bundle;
use crate::components::{HierarchyError, HierarchyNode};
use crate::registry::EntityRegistry;
use hecs::Entity;

/// The central container for all entities and components.
///
/// World is the root of the ECS hierarchy. It owns all entities and their
/// associated components, and provides the API for creating, modifying,
/// and destroying them.
///
/// World wraps hecs::World and exposes a clean API tailored to this platform.
/// Systems access components via queries through inner() and inner_mut().
pub struct World {
    inner: hecs::World,
    /// Registry of valid entity categories and contexts.
    /// Owned by the World and serialized with the scene.
    pub registry: EntityRegistry,
}

impl World {
    /// Creates a new empty World with a seeded EntityRegistry.
    pub fn new() -> Self {
        Self {
            inner: hecs::World::new(),
            registry: EntityRegistry::new(),
        }
    }

    /// Returns the number of entities currently in the World.
    pub fn entity_count(&self) -> u32 {
        self.inner.len()
    }

    /// Spawns a new empty entity with no components.
    /// Returns the Entity ID — store this to refer to the entity later.
    ///
    /// Prefer spawn_bundle() for spawning entities with components.
    pub fn spawn(&mut self) -> Entity {
        self.inner.spawn(())
    }

    /// Spawns a bundle into the World and returns the Entity ID.
    ///
    /// This is the preferred way to create entities. Bundles ensure
    /// every entity of a given archetype always has the correct
    /// set of components.
    pub fn spawn_bundle<B: Bundle>(&mut self, bundle: B) -> Entity {
        bundle.spawn_into(self)
    }

    /// Adds a component to an existing entity.
    /// If the entity already has this component type, it is replaced.
    ///
    /// Returns an error if the entity does not exist.
    pub fn add_component<T: hecs::Component>(
        &mut self,
        entity: Entity,
        component: T,
    ) -> Result<(), hecs::NoSuchEntity> {
        self.inner.insert_one(entity, component)
    }

    /// Removes a component from an existing entity.
    /// Returns an error if the entity does not exist or lacks the component.
    pub fn remove_component<T: hecs::Component>(
        &mut self,
        entity: Entity,
    ) -> Result<T, hecs::ComponentError> {
        self.inner.remove_one::<T>(entity)
    }

    /// Returns an immutable reference to a component on the given entity.
    ///
    /// Returns an error if the entity does not exist or does not have
    /// the requested component type.
    pub fn get_component<T: hecs::Component>(
        &self,
        entity: Entity,
    ) -> Result<hecs::Ref<'_, T>, hecs::ComponentError> {
        self.inner.get::<&T>(entity)
    }

    /// Returns a mutable reference to a component on the given entity.
    ///
    /// Returns an error if the entity does not exist or does not have
    /// the requested component type.
    pub fn get_component_mut<T: hecs::Component>(
        &mut self,
        entity: Entity,
    ) -> Result<hecs::RefMut<'_, T>, hecs::ComponentError> {
        self.inner.get::<&mut T>(entity)
    }

    /// Returns true if the entity exists in the World.
    pub fn contains(&self, entity: Entity) -> bool {
        self.inner.contains(entity)
    }

    /// Despawns an entity, removing it and all its components from the World.
    /// Returns true if the entity existed and was removed, false otherwise.
    pub fn despawn(&mut self, entity: Entity) -> bool {
        self.inner.despawn(entity).is_ok()
    }

    /// Sets `child`'s parent to `new_parent`, maintaining full
    /// consistency of the hierarchy: if `child` already has a parent,
    /// it is removed from that parent's `children` list before being
    /// added to `new_parent`'s.
    ///
    /// Idempotent: calling this with the same `new_parent` the child
    /// already has is a no-op that returns Ok, not an error.
    ///
    /// Returns `HierarchyError::EntityNotFound` if either entity does
    /// not exist or lacks a HierarchyNode.
    ///
    /// Returns `HierarchyError::WouldCreateCycle` if `new_parent` is
    /// `child` itself, or is a descendant of `child` — either case
    /// would cause HierarchySystem's depth-first propagation to
    /// recurse infinitely.
    pub fn set_parent(&mut self, child: Entity, new_parent: Entity) -> Result<(), HierarchyError> {
        // Validate both entities exist and have HierarchyNode before
        // mutating anything. This guarantees that if we return an
        // error, the tree is left completely unchanged.
        if !self.contains(child) || self.get_component::<HierarchyNode>(child).is_err() {
            return Err(HierarchyError::EntityNotFound);
        }
        if !self.contains(new_parent) || self.get_component::<HierarchyNode>(new_parent).is_err() {
            return Err(HierarchyError::EntityNotFound);
        }

        // Reject self-parenting and cycles through the ancestor chain.
        if self.creates_cycle(child, new_parent) {
            return Err(HierarchyError::WouldCreateCycle);
        }

        // Idempotent short-circuit: if child is already parented to
        // new_parent, there's nothing to do.
        let current_parent = self.get_component::<HierarchyNode>(child).unwrap().parent;
        if current_parent == Some(new_parent) {
            return Ok(());
        }

        // Detach from the old parent, if any.
        if let Some(old_parent) = current_parent
            && let Ok(mut old_parent_node) = self.get_component_mut::<HierarchyNode>(old_parent)
        {
            old_parent_node.children.retain(|&e| e != child);
        }

        // Attach to the new parent.
        {
            let mut new_parent_node = self.get_component_mut::<HierarchyNode>(new_parent).unwrap();
            new_parent_node.children.push(child);
        }
        {
            let mut child_node = self.get_component_mut::<HierarchyNode>(child).unwrap();
            child_node.parent = Some(new_parent);
        }

        Ok(())
    }

    /// Removes `child`'s parent, if any, making it a root entity.
    /// Also removes `child` from its former parent's `children` list.
    ///
    /// No-op (returns Ok) if `child` is already a root.
    ///
    /// Returns `HierarchyError::EntityNotFound` if `child` does not
    /// exist or lacks a HierarchyNode.
    pub fn remove_parent(&mut self, child: Entity) -> Result<(), HierarchyError> {
        if !self.contains(child) || self.get_component::<HierarchyNode>(child).is_err() {
            return Err(HierarchyError::EntityNotFound);
        }

        let old_parent = self.get_component::<HierarchyNode>(child).unwrap().parent;

        let Some(old_parent) = old_parent else {
            // Already a root — nothing to do.
            return Ok(());
        };

        if let Ok(mut old_parent_node) = self.get_component_mut::<HierarchyNode>(old_parent) {
            old_parent_node.children.retain(|&e| e != child);
        }

        let mut child_node = self.get_component_mut::<HierarchyNode>(child).unwrap();
        child_node.parent = None;

        Ok(())
    }

    /// Returns true if making `candidate_parent` the parent of `entity`
    /// would create a cycle — i.e. `candidate_parent` is `entity` itself,
    /// or `entity` appears somewhere in `candidate_parent`'s ancestor chain.
    ///
    /// Walks upward from `candidate_parent` toward the root, checking
    /// at each step whether we've encountered `entity`. Bounded by tree
    /// depth, not entity count.
    fn creates_cycle(&self, entity: Entity, candidate_parent: Entity) -> bool {
        let mut current = candidate_parent;
        loop {
            if current == entity {
                return true;
            }
            match self.get_component::<HierarchyNode>(current) {
                Ok(node) => match node.parent {
                    Some(next) => current = next,
                    None => return false, // reached a root without hitting `entity`
                },
                Err(_) => return false, // shouldn't happen given prior validation, but safe default
            }
        }
    }

    /// Returns an immutable reference to the inner hecs::World.
    /// Used by systems to query components across all entities.
    pub fn inner(&self) -> &hecs::World {
        &self.inner
    }

    /// Returns a mutable reference to the inner hecs::World.
    /// Used by systems to query and modify components across all entities.
    pub fn inner_mut(&mut self) -> &mut hecs::World {
        &mut self.inner
    }
}

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::{DynamicObjectBundle, StaticObjectBundle};
    use crate::components::hierarchy::HierarchyError;
    use crate::components::{EntityInfo, HierarchyNode, LocalTransform, Velocity};
    use crate::systems::System;
    use glam::Vec3;

    #[test]
    fn world_is_empty_on_creation() {
        let world = World::new();
        assert_eq!(world.entity_count(), 0);
    }

    #[test]
    fn world_has_registry_with_builtin_categories() {
        let world = World::new();
        assert!(world.registry.category_exists("Default"));
        assert!(world.registry.category_exists("Camera"));
    }

    #[test]
    fn world_has_registry_with_builtin_contexts() {
        let world = World::new();
        assert!(world.registry.context_exists("Editor"));
        assert!(world.registry.context_exists("Runtime"));
        assert!(world.registry.context_exists("Universal"));
    }

    #[test]
    fn world_spawn_creates_entity() {
        let mut world = World::new();
        let entity = world.spawn();

        assert_eq!(world.entity_count(), 1);
        assert!(world.contains(entity));
    }

    #[test]
    fn world_spawn_bundle_creates_static_object() {
        let mut world = World::new();
        let entity = world.spawn_bundle(StaticObjectBundle::new("Static", Vec3::ZERO));

        assert!(world.get_component::<LocalTransform>(entity).is_ok());
        assert!(world.get_component::<EntityInfo>(entity).is_ok());
        assert!(world.get_component::<HierarchyNode>(entity).is_ok());
        assert!(world.get_component::<Velocity>(entity).is_err());
    }

    #[test]
    fn world_spawn_bundle_creates_dynamic_object() {
        let mut world = World::new();
        let entity = world.spawn_bundle(DynamicObjectBundle::new(
            "Dynamic",
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
        ));

        assert!(world.get_component::<LocalTransform>(entity).is_ok());
        assert!(world.get_component::<EntityInfo>(entity).is_ok());
        assert!(world.get_component::<HierarchyNode>(entity).is_ok());
        assert!(world.get_component::<Velocity>(entity).is_ok());
    }

    #[test]
    fn world_add_component_attaches_to_entity() {
        let mut world = World::new();
        let entity = world.spawn();
        let transform = LocalTransform::new(Vec3::new(1.0, 2.0, 3.0));

        world.add_component(entity, transform).unwrap();

        let retrieved = world.get_component::<LocalTransform>(entity).unwrap();
        assert_eq!(retrieved.position, Vec3::new(1.0, 2.0, 3.0));
    }

    #[test]
    fn world_remove_component_detaches_from_entity() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, LocalTransform::default())
            .unwrap();

        let result = world.remove_component::<LocalTransform>(entity);

        assert!(result.is_ok());
        assert!(world.get_component::<LocalTransform>(entity).is_err());
    }

    #[test]
    fn world_get_component_returns_correct_value() {
        let mut world = World::new();
        let entity = world.spawn();
        let expected = Vec3::new(4.0, 5.0, 6.0);
        world
            .add_component(entity, LocalTransform::new(expected))
            .unwrap();

        let transform = world.get_component::<LocalTransform>(entity).unwrap();

        assert_eq!(transform.position, expected);
    }

    #[test]
    fn world_get_component_mut_allows_modification() {
        let mut world = World::new();
        let entity = world.spawn();
        world
            .add_component(entity, LocalTransform::default())
            .unwrap();

        {
            let mut transform = world.get_component_mut::<LocalTransform>(entity).unwrap();
            transform.position = Vec3::new(9.0, 0.0, 0.0);
        }

        let transform = world.get_component::<LocalTransform>(entity).unwrap();
        assert_eq!(transform.position, Vec3::new(9.0, 0.0, 0.0));
    }

    #[test]
    fn world_despawn_removes_entity() {
        let mut world = World::new();
        let entity = world.spawn();

        let result = world.despawn(entity);

        assert!(result);
        assert_eq!(world.entity_count(), 0);
        assert!(!world.contains(entity));
    }

    #[test]
    fn world_entity_can_have_multiple_components() {
        let mut world = World::new();
        let entity = world.spawn();

        world
            .add_component(entity, LocalTransform::default())
            .unwrap();
        world
            .add_component(entity, Velocity::new(Vec3::new(1.0, 0.0, 0.0)))
            .unwrap();

        assert!(world.get_component::<LocalTransform>(entity).is_ok());
        assert!(world.get_component::<Velocity>(entity).is_ok());
    }

    // ── set_parent / remove_parent tests ────────────────────────────────────────

    #[test]
    fn world_set_parent_attaches_child_to_root_parent() {
        // ARRANGE — two independent root entities
        let mut world = World::new();
        let parent = world.spawn_bundle(StaticObjectBundle::new("Parent", Vec3::ZERO));
        let child = world.spawn_bundle(StaticObjectBundle::new("Child", Vec3::ZERO));

        // ACT
        let result = world.set_parent(child, parent);

        // ASSERT — child's HierarchyNode now points at parent,
        // and parent's children list contains child
        assert!(result.is_ok());
        let child_node = world.get_component::<HierarchyNode>(child).unwrap();
        assert_eq!(child_node.parent, Some(parent));

        let parent_node = world.get_component::<HierarchyNode>(parent).unwrap();
        assert!(parent_node.children.contains(&child));
    }

    #[test]
    fn world_set_parent_moves_child_from_old_parent_to_new_parent() {
        // ARRANGE — child already parented to old_parent
        let mut world = World::new();
        let old_parent = world.spawn_bundle(StaticObjectBundle::new("Old Parent", Vec3::ZERO));
        let new_parent = world.spawn_bundle(StaticObjectBundle::new("New Parent", Vec3::ZERO));
        let child = world.spawn_bundle(StaticObjectBundle::new("Child", Vec3::ZERO));

        world.set_parent(child, old_parent).unwrap();

        // ACT — reparent to new_parent
        let result = world.set_parent(child, new_parent);

        // ASSERT — child no longer appears in old_parent's children,
        // and now appears in new_parent's children. This is the core
        // "set_parent owns full consistency" guarantee — without this,
        // old_parent would retain a dangling reference to child forever.
        assert!(result.is_ok());

        let old_parent_node = world.get_component::<HierarchyNode>(old_parent).unwrap();
        assert!(!old_parent_node.children.contains(&child));

        let new_parent_node = world.get_component::<HierarchyNode>(new_parent).unwrap();
        assert!(new_parent_node.children.contains(&child));

        let child_node = world.get_component::<HierarchyNode>(child).unwrap();
        assert_eq!(child_node.parent, Some(new_parent));
    }

    #[test]
    fn world_set_parent_to_same_parent_is_idempotent() {
        // ARRANGE — child already parented
        let mut world = World::new();
        let parent = world.spawn_bundle(StaticObjectBundle::new("Parent", Vec3::ZERO));
        let child = world.spawn_bundle(StaticObjectBundle::new("Child", Vec3::ZERO));
        world.set_parent(child, parent).unwrap();

        // ACT — set_parent again with the same parent
        let result = world.set_parent(child, parent);

        // ASSERT — no error, and child appears exactly once in parent's
        // children (not duplicated by a redundant insertion)
        assert!(result.is_ok());
        let parent_node = world.get_component::<HierarchyNode>(parent).unwrap();
        let occurrences = parent_node.children.iter().filter(|&&e| e == child).count();
        assert_eq!(occurrences, 1);
    }

    #[test]
    fn world_remove_parent_detaches_child_and_clears_parent_field() {
        // ARRANGE
        let mut world = World::new();
        let parent = world.spawn_bundle(StaticObjectBundle::new("Parent", Vec3::ZERO));
        let child = world.spawn_bundle(StaticObjectBundle::new("Child", Vec3::ZERO));
        world.set_parent(child, parent).unwrap();

        // ACT
        let result = world.remove_parent(child);

        // ASSERT — child is a root again, and parent no longer lists it
        assert!(result.is_ok());
        let child_node = world.get_component::<HierarchyNode>(child).unwrap();
        assert!(child_node.is_root());

        let parent_node = world.get_component::<HierarchyNode>(parent).unwrap();
        assert!(!parent_node.children.contains(&child));
    }

    #[test]
    fn world_remove_parent_on_already_root_entity_is_noop() {
        // ARRANGE — entity was never parented
        let mut world = World::new();
        let entity = world.spawn_bundle(StaticObjectBundle::new("Root", Vec3::ZERO));

        // ACT
        let result = world.remove_parent(entity);

        // ASSERT — Ok, not an error, and still a root
        assert!(result.is_ok());
        let node = world.get_component::<HierarchyNode>(entity).unwrap();
        assert!(node.is_root());
    }

    #[test]
    fn world_set_parent_returns_error_for_nonexistent_child() {
        // ARRANGE — a valid parent, but a child Entity that was never spawned.
        // Entity::DANGLING is hecs's documented sentinel for exactly this —
        // an Entity value guaranteed not to exist in any World.
        let mut world = World::new();
        let parent = world.spawn_bundle(StaticObjectBundle::new("Parent", Vec3::ZERO));

        // ACT
        let result = world.set_parent(hecs::Entity::DANGLING, parent);

        // ASSERT
        assert_eq!(result, Err(HierarchyError::EntityNotFound));
    }

    #[test]
    fn world_set_parent_returns_error_for_nonexistent_parent() {
        // ARRANGE — mirror of the above, but the missing entity is the parent
        let mut world = World::new();
        let child = world.spawn_bundle(StaticObjectBundle::new("Child", Vec3::ZERO));

        // ACT
        let result = world.set_parent(child, hecs::Entity::DANGLING);

        // ASSERT
        assert_eq!(result, Err(HierarchyError::EntityNotFound));
    }

    #[test]
    fn world_set_parent_rejects_self_parenting() {
        // ARRANGE — an entity cannot be its own parent; this is the
        // degenerate cycle case (a cycle of length zero)
        let mut world = World::new();
        let entity = world.spawn_bundle(StaticObjectBundle::new("Entity", Vec3::ZERO));

        // ACT
        let result = world.set_parent(entity, entity);

        // ASSERT
        assert_eq!(result, Err(HierarchyError::WouldCreateCycle));

        // Tree must be unchanged — still a root, no self-reference in children
        let node = world.get_component::<HierarchyNode>(entity).unwrap();
        assert!(node.is_root());
        assert!(!node.children.contains(&entity));
    }

    #[test]
    fn world_set_parent_rejects_cycle_through_ancestor_chain() {
        // ARRANGE — build grandparent -> parent -> child, then attempt to
        // make grandparent a child of `child`. This would create a cycle:
        // grandparent -> parent -> child -> grandparent -> ...
        let mut world = World::new();
        let grandparent = world.spawn_bundle(StaticObjectBundle::new("Grandparent", Vec3::ZERO));
        let parent = world.spawn_bundle(StaticObjectBundle::new("Parent", Vec3::ZERO));
        let child = world.spawn_bundle(StaticObjectBundle::new("Child", Vec3::ZERO));

        world.set_parent(parent, grandparent).unwrap();
        world.set_parent(child, parent).unwrap();

        // ACT — attempt to close the loop
        let result = world.set_parent(grandparent, child);

        // ASSERT — rejected, and critically, the tree must be completely
        // unchanged. This confirms the cycle check runs BEFORE any mutation
        // — if it mutated partway through, grandparent could end up with
        // no parent AND removed from its old children list, corrupting
        // the tree even though the operation "failed".
        assert_eq!(result, Err(HierarchyError::WouldCreateCycle));

        let grandparent_node = world.get_component::<HierarchyNode>(grandparent).unwrap();
        assert!(grandparent_node.is_root());

        let child_node = world.get_component::<HierarchyNode>(child).unwrap();
        assert!(!child_node.children.contains(&grandparent));
    }

    #[test]
    fn world_set_parent_then_hierarchy_system_tick_produces_correct_world_transform() {
        // ARRANGE — integration test bridging World::set_parent with
        // HierarchySystem, confirming the two subsystems agree on what
        // "parented" means. Parent at (5,0,0), child spawned at local (1,0,0).
        let mut world = World::new();
        let mut system = crate::systems::HierarchySystem::new();

        let parent =
            world.spawn_bundle(StaticObjectBundle::new("Parent", Vec3::new(5.0, 0.0, 0.0)));
        let child = world.spawn_bundle(StaticObjectBundle::new("Child", Vec3::new(1.0, 0.0, 0.0)));

        world.set_parent(child, parent).unwrap();

        // ACT
        system.run(&mut world, 0.0);

        // ASSERT — same expectation as HANDOFF.md's manual browser
        // verification: (5,0,0) + local (1,0,0) = world (6,0,0)
        let child_wt = world
            .get_component::<crate::components::WorldTransform>(child)
            .unwrap();
        approx::assert_relative_eq!(child_wt.position.x, 6.0, epsilon = 1e-6);
        approx::assert_relative_eq!(child_wt.position.y, 0.0, epsilon = 1e-6);
        approx::assert_relative_eq!(child_wt.position.z, 0.0, epsilon = 1e-6);
    }
}
