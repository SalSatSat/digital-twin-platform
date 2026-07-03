use hecs::Entity;

/// Hierarchy component — defines an entity's position in the scene tree.
///
/// Every entity has a HierarchyNode. Entities with no parent are root
/// entities. Entities with a parent are children of that entity.
///
/// Maintaining consistency between parent and children is the
/// responsibility of the code that modifies the hierarchy — setting
/// a parent on a child should also add the child to the parent's
/// children list. A dedicated hierarchy system will enforce this
/// in a future phase.
#[derive(Debug, Clone)]
pub struct HierarchyNode {
    /// The parent entity, if any.
    /// None means this is a root entity in the scene tree.
    pub parent: Option<Entity>,

    /// Ordered list of child entities.
    /// The order determines rendering and update order among siblings.
    pub children: Vec<Entity>,
}

impl HierarchyNode {
    /// Creates a new root HierarchyNode with no parent and no children.
    pub fn new() -> Self {
        Self {
            parent: None,
            children: Vec::new(),
        }
    }

    /// Returns true if this entity has no parent — it is a root entity.
    pub fn is_root(&self) -> bool {
        self.parent.is_none()
    }

    /// Returns true if this entity has at least one child.
    pub fn has_children(&self) -> bool {
        !self.children.is_empty()
    }
}

impl Default for HierarchyNode {
    fn default() -> Self {
        Self::new()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hierarchy_node_new_is_root_with_no_children() {
        let node = HierarchyNode::new();

        assert!(node.is_root());
        assert!(!node.has_children());
        assert!(node.parent.is_none());
        assert!(node.children.is_empty());
    }

    #[test]
    fn hierarchy_node_with_children_is_not_leaf() {
        // We can't create real hecs Entities in a unit test without a World,
        // so we verify the has_children logic with a manually constructed node.
        let mut node = HierarchyNode::new();

        // Manually push a placeholder — testing the logic, not the entity
        // The actual entity value doesn't matter for this assertion
        node.children.push(hecs::Entity::DANGLING);

        assert!(node.has_children());
        assert!(node.is_root()); // still a root — having children doesn't change that
    }
}
