use crate::bundle::Bundle;
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
    use crate::components::{EntityInfo, HierarchyNode, Transform, Velocity};
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

        assert!(world.get_component::<Transform>(entity).is_ok());
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

        assert!(world.get_component::<Transform>(entity).is_ok());
        assert!(world.get_component::<EntityInfo>(entity).is_ok());
        assert!(world.get_component::<HierarchyNode>(entity).is_ok());
        assert!(world.get_component::<Velocity>(entity).is_ok());
    }

    #[test]
    fn world_add_component_attaches_to_entity() {
        let mut world = World::new();
        let entity = world.spawn();
        let transform = Transform::new(Vec3::new(1.0, 2.0, 3.0));

        world.add_component(entity, transform).unwrap();

        let retrieved = world.get_component::<Transform>(entity).unwrap();
        assert_eq!(retrieved.position, Vec3::new(1.0, 2.0, 3.0));
    }

    #[test]
    fn world_remove_component_detaches_from_entity() {
        let mut world = World::new();
        let entity = world.spawn();
        world.add_component(entity, Transform::default()).unwrap();

        let result = world.remove_component::<Transform>(entity);

        assert!(result.is_ok());
        assert!(world.get_component::<Transform>(entity).is_err());
    }

    #[test]
    fn world_get_component_returns_correct_value() {
        let mut world = World::new();
        let entity = world.spawn();
        let expected = Vec3::new(4.0, 5.0, 6.0);
        world
            .add_component(entity, Transform::new(expected))
            .unwrap();

        let transform = world.get_component::<Transform>(entity).unwrap();

        assert_eq!(transform.position, expected);
    }

    #[test]
    fn world_get_component_mut_allows_modification() {
        let mut world = World::new();
        let entity = world.spawn();
        world.add_component(entity, Transform::default()).unwrap();

        {
            let mut transform = world.get_component_mut::<Transform>(entity).unwrap();
            transform.position = Vec3::new(9.0, 0.0, 0.0);
        }

        let transform = world.get_component::<Transform>(entity).unwrap();
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

        world.add_component(entity, Transform::default()).unwrap();
        world
            .add_component(entity, Velocity::new(Vec3::new(1.0, 0.0, 0.0)))
            .unwrap();

        assert!(world.get_component::<Transform>(entity).is_ok());
        assert!(world.get_component::<Velocity>(entity).is_ok());
    }
}
