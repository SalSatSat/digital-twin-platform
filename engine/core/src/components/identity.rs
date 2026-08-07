use uuid::Uuid;

/// Identity component — present on every entity.
///
/// Provides human-readable identification, active state,
/// visibility state, and classification via category and contexts.
/// Every entity in the world has exactly one EntityInfo component.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EntityInfo {
    /// Stable unique identifier — survives serialization and networking.
    pub id: Uuid,

    /// Human-readable label shown in the editor hierarchy.
    pub name: String,

    /// Whether systems process this entity each tick.
    /// Disabled entities are skipped by all systems.
    pub enabled: bool,

    /// Whether this entity is rendered visually.
    /// An entity can be enabled but not visible — its systems
    /// run but it produces no visual output.
    pub visible: bool,

    /// The category this entity belongs to.
    /// References a valid EntityCategoryDef name in the EntityRegistry.
    /// An entity belongs to exactly one category.
    /// Defaults to "Default".
    pub category: String,

    /// The contexts in which this entity exists.
    /// References valid EntityContextDef names in the EntityRegistry.
    /// An entity can exist in multiple contexts simultaneously —
    /// for example, both "Editor" and "Preview" but not "Runtime".
    /// Defaults to ["Universal"].
    pub contexts: Vec<String>,
}

impl EntityInfo {
    /// Creates a new EntityInfo with a generated UUID and sensible defaults.
    /// Category defaults to "Default", contexts default to ["Universal"].
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            enabled: true,
            visible: true,
            category: "Default".to_string(),
            contexts: vec!["Universal".to_string()],
        }
    }

    /// Creates a new EntityInfo with explicit category and contexts.
    pub fn with_classification(
        name: impl Into<String>,
        category: impl Into<String>,
        contexts: Vec<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            enabled: true,
            visible: true,
            category: category.into(),
            contexts,
        }
    }

    /// Returns true if this entity exists in the given context.
    pub fn is_in_context(&self, context: &str) -> bool {
        self.contexts.iter().any(|c| c == context)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_info_new_sets_name_and_defaults() {
        let info = EntityInfo::new("Test Entity");

        assert_eq!(info.name, "Test Entity");
        assert!(info.enabled);
        assert!(info.visible);
        assert_eq!(info.category, "Default");
        assert_eq!(info.contexts, vec!["Universal"]);
    }

    #[test]
    fn entity_info_generates_unique_ids() {
        let info_a = EntityInfo::new("Entity A");
        let info_b = EntityInfo::new("Entity B");

        assert_ne!(info_a.id, info_b.id);
    }

    #[test]
    fn entity_info_with_classification_sets_category_and_contexts() {
        let info = EntityInfo::with_classification(
            "Scene Camera",
            "Camera",
            vec!["Editor".to_string(), "Preview".to_string()],
        );

        assert_eq!(info.name, "Scene Camera");
        assert_eq!(info.category, "Camera");
        assert_eq!(info.contexts.len(), 2);
        assert!(info.is_in_context("Editor"));
        assert!(info.is_in_context("Preview"));
        assert!(!info.is_in_context("Runtime"));
    }

    #[test]
    fn entity_info_is_in_context_returns_false_for_unknown_context() {
        let info = EntityInfo::new("Entity");
        assert!(!info.is_in_context("Editor"));
        assert!(info.is_in_context("Universal"));
    }
}
