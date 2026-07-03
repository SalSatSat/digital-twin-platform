pub mod definitions;

pub use definitions::{EntityCategoryDef, EntityContextDef};

use uuid::Uuid;

/// Manages valid entity categories and contexts.
///
/// EntityRegistry is the source of truth for what categories and
/// contexts are available in the platform. It is owned by the World
/// and serialized with the scene.
///
/// Built-in categories and contexts are seeded on creation and
/// cannot be deleted. Custom ones can be added and removed at runtime.
pub struct EntityRegistry {
    categories: Vec<EntityCategoryDef>,
    contexts: Vec<EntityContextDef>,
}

impl EntityRegistry {
    /// Creates a new registry seeded with built-in categories and contexts.
    pub fn new() -> Self {
        let mut registry = Self {
            categories: Vec::new(),
            contexts: Vec::new(),
        };
        registry.seed_builtins();
        registry
    }

    fn seed_builtins(&mut self) {
        // Built-in categories
        self.categories.push(EntityCategoryDef::builtin(
            "Default",
            "General purpose entity with no specific classification",
        ));
        self.categories.push(EntityCategoryDef::builtin(
            "Camera",
            "An entity that defines a viewpoint into the scene",
        ));

        // Built-in contexts
        self.contexts.push(EntityContextDef::builtin(
            "Editor",
            "Only active in the editor — not present at runtime",
            Some("#4f9eed".to_string()),
        ));
        self.contexts.push(EntityContextDef::builtin(
            "Runtime",
            "Only active at runtime — not present in the editor",
            Some("#48bb78".to_string()),
        ));
        self.contexts.push(EntityContextDef::builtin(
            "Universal",
            "Active in all contexts — editor and runtime",
            Some("#9f7aea".to_string()),
        ));
    }

    /// Adds a custom category. Returns its generated UUID.
    pub fn add_category(
        &mut self,
        name: impl Into<String>,
        description: impl Into<String>,
        icon: Option<String>,
    ) -> Uuid {
        let def = EntityCategoryDef::custom(name, description, icon);
        let id = def.id;
        self.categories.push(def);
        id
    }

    /// Adds a custom context. Returns its generated UUID.
    pub fn add_context(
        &mut self,
        name: impl Into<String>,
        description: impl Into<String>,
        color: Option<String>,
    ) -> Uuid {
        let def = EntityContextDef::custom(name, description, color);
        let id = def.id;
        self.contexts.push(def);
        id
    }

    /// Removes a custom category by ID.
    /// Returns an error if the category is built-in or does not exist.
    pub fn remove_category(&mut self, id: Uuid) -> Result<(), RegistryError> {
        let pos = self
            .categories
            .iter()
            .position(|c| c.id == id)
            .ok_or(RegistryError::NotFound)?;
        if self.categories[pos].is_builtin {
            return Err(RegistryError::CannotRemoveBuiltin);
        }
        self.categories.remove(pos);
        Ok(())
    }

    /// Removes a custom context by ID.
    /// Returns an error if the context is built-in or does not exist.
    pub fn remove_context(&mut self, id: Uuid) -> Result<(), RegistryError> {
        let pos = self
            .contexts
            .iter()
            .position(|c| c.id == id)
            .ok_or(RegistryError::NotFound)?;
        if self.contexts[pos].is_builtin {
            return Err(RegistryError::CannotRemoveBuiltin);
        }
        self.contexts.remove(pos);
        Ok(())
    }

    /// Returns true if a category with the given name exists.
    pub fn category_exists(&self, name: &str) -> bool {
        self.categories.iter().any(|c| c.name == name)
    }

    /// Returns true if a context with the given name exists.
    pub fn context_exists(&self, name: &str) -> bool {
        self.contexts.iter().any(|c| c.name == name)
    }

    /// Returns all registered categories.
    pub fn categories(&self) -> &[EntityCategoryDef] {
        &self.categories
    }

    /// Returns all registered contexts.
    pub fn contexts(&self) -> &[EntityContextDef] {
        &self.contexts
    }
}

impl Default for EntityRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Errors that can occur when modifying the registry.
#[derive(Debug, PartialEq)]
pub enum RegistryError {
    /// The requested entry does not exist in the registry.
    NotFound,
    /// Built-in entries cannot be removed.
    CannotRemoveBuiltin,
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_seeds_builtin_categories_on_creation() {
        let registry = EntityRegistry::new();

        assert!(registry.category_exists("Default"));
        assert!(registry.category_exists("Camera"));
    }

    #[test]
    fn registry_seeds_builtin_contexts_on_creation() {
        let registry = EntityRegistry::new();

        assert!(registry.context_exists("Editor"));
        assert!(registry.context_exists("Runtime"));
        assert!(registry.context_exists("Universal"));
    }

    #[test]
    fn registry_add_category_makes_it_available() {
        let mut registry = EntityRegistry::new();
        registry.add_category("Vehicle", "A moving vehicle entity", None);

        assert!(registry.category_exists("Vehicle"));
    }

    #[test]
    fn registry_add_context_makes_it_available() {
        let mut registry = EntityRegistry::new();
        registry.add_context("Preview", "Active during preview mode", None);

        assert!(registry.context_exists("Preview"));
    }

    #[test]
    fn registry_cannot_remove_builtin_category() {
        let mut registry = EntityRegistry::new();
        let builtin_id = registry.categories()[0].id;

        let result = registry.remove_category(builtin_id);
        assert_eq!(result, Err(RegistryError::CannotRemoveBuiltin));
    }

    #[test]
    fn registry_cannot_remove_builtin_context() {
        let mut registry = EntityRegistry::new();
        let builtin_id = registry.contexts()[0].id;

        let result = registry.remove_context(builtin_id);
        assert_eq!(result, Err(RegistryError::CannotRemoveBuiltin));
    }

    #[test]
    fn registry_can_remove_custom_category() {
        let mut registry = EntityRegistry::new();
        let id = registry.add_category("Vehicle", "A moving vehicle entity", None);

        let result = registry.remove_category(id);
        assert!(result.is_ok());
        assert!(!registry.category_exists("Vehicle"));
    }

    #[test]
    fn registry_remove_nonexistent_returns_not_found() {
        let mut registry = EntityRegistry::new();
        let result = registry.remove_category(Uuid::new_v4());

        assert_eq!(result, Err(RegistryError::NotFound));
    }
}
