use uuid::Uuid;

/// Defines a valid entity category in the registry.
#[derive(Debug, Clone)]
pub struct EntityCategoryDef {
    /// Stable unique identifier for this category.
    pub id: Uuid,

    /// Display name — used as the reference value in EntityInfo.category.
    pub name: String,

    /// Human-readable description shown in the editor.
    pub description: String,

    /// Optional icon identifier for the editor UI.
    pub icon: Option<String>,

    /// Whether this is a built-in category that cannot be deleted.
    pub is_builtin: bool,
}

impl EntityCategoryDef {
    /// Creates a built-in category definition.
    pub fn builtin(name: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            description: description.into(),
            icon: None,
            is_builtin: true,
        }
    }

    /// Creates a custom category definition.
    pub fn custom(
        name: impl Into<String>,
        description: impl Into<String>,
        icon: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            description: description.into(),
            icon,
            is_builtin: false,
        }
    }
}

/// Defines a valid entity context in the registry.
#[derive(Debug, Clone)]
pub struct EntityContextDef {
    /// Stable unique identifier for this context.
    pub id: Uuid,

    /// Display name — used as the reference value in EntityInfo.contexts.
    pub name: String,

    /// Human-readable description shown in the editor.
    pub description: String,

    /// Optional color for the editor UI hierarchy — hex string e.g. "#4f9eed".
    pub color: Option<String>,

    /// Whether this is a built-in context that cannot be deleted.
    pub is_builtin: bool,
}

impl EntityContextDef {
    /// Creates a built-in context definition.
    pub fn builtin(
        name: impl Into<String>,
        description: impl Into<String>,
        color: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            description: description.into(),
            color,
            is_builtin: true,
        }
    }

    /// Creates a custom context definition.
    pub fn custom(
        name: impl Into<String>,
        description: impl Into<String>,
        color: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            description: description.into(),
            color,
            is_builtin: false,
        }
    }
}
