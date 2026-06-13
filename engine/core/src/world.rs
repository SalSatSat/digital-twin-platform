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
}

impl World {
    /// Creates a new empty World with no entities.
    pub fn new() -> Self {
        Self {
            inner: hecs::World::new(),
        }
    }

    /// Returns the number of entities currently in the World.
    pub fn entity_count(&self) -> u32 {
        self.inner.len()
    }

    /// Spawns a new empty entity with no components.
    /// Returns the Entity ID — store this to refer to the entity later.
    ///
    /// In most cases you should use EntityFactory to spawn entities
    /// with their initial components already attached.
    pub fn spawn(&mut self) -> Entity {
        self.inner.spawn(())
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
    use crate::components::{Transform, Velocity};
    use glam::Vec3;

    #[test]
    fn world_is_empty_on_creation() {
        let world = World::new();
        assert_eq!(world.entity_count(), 0);
    }

    #[test]
    fn world_spawn_creates_entity() {
        // ARRANGE + ACT
        let mut world = World::new();
        let entity = world.spawn();

        // ASSERT — entity exists in the world
        assert_eq!(world.entity_count(), 1);
        assert!(world.contains(entity));
    }

    #[test]
    fn world_add_component_attaches_to_entity() {
        // ARRANGE
        let mut world = World::new();
        let entity = world.spawn();
        let transform = Transform::new(Vec3::new(1.0, 2.0, 3.0));

        // ACT
        world.add_component(entity, transform).unwrap();

        // ASSERT — retrieve and verify the component
        let retrieved = world.inner().get::<&Transform>(entity).unwrap();
        assert_eq!(retrieved.position, Vec3::new(1.0, 2.0, 3.0));
    }

    #[test]
    fn world_remove_component_detaches_from_entity() {
        // ARRANGE
        let mut world = World::new();
        let entity = world.spawn();
        world.add_component(entity, Transform::default()).unwrap();

        // ACT
        let result = world.remove_component::<Transform>(entity);

        // ASSERT — component was removed successfully
        assert!(result.is_ok());
        assert!(world.inner().get::<&Transform>(entity).is_err());
    }

    #[test]
    fn world_despawn_removes_entity() {
        // ARRANGE
        let mut world = World::new();
        let entity = world.spawn();
        assert_eq!(world.entity_count(), 1);

        // ACT
        let result = world.despawn(entity);

        // ASSERT
        assert!(result);
        assert_eq!(world.entity_count(), 0);
        assert!(!world.contains(entity));
    }

    #[test]
    fn world_entity_can_have_multiple_components() {
        // ARRANGE
        let mut world = World::new();
        let entity = world.spawn();

        // ACT — add two components separately
        world.add_component(entity, Transform::default()).unwrap();
        world
            .add_component(entity, Velocity::new(Vec3::new(1.0, 0.0, 0.0)))
            .unwrap();

        // ASSERT — entity has both components
        assert!(world.inner().get::<&Transform>(entity).is_ok());
        assert!(world.inner().get::<&Velocity>(entity).is_ok());
    }
}
