use glam::Vec3;

/// Represents the position of an entity in 3D space.
///
/// Attach this component to any entity that has a location in the world.
/// Entities without a Transform have no spatial representation.
///
/// Currently contains only position. Rotation and scale will be
/// added when the renderer requires them.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Transform {
    pub position: Vec3,
}

impl Transform {
    /// Creates a new Transform at the given position.
    pub fn new(position: Vec3) -> Self {
        Self { position }
    }
}

impl Default for Transform {
    /// Creates a Transform at the world origin (0.0, 0.0, 0.0).
    fn default() -> Self {
        Self {
            position: Vec3::ZERO,
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transform_defaults_to_origin() {
        // ARRANGE + ACT — create a Transform using the Default trait
        let transform = Transform::default();

        // ASSERT — the default position must be at the world origin
        // Vec3::ZERO is (0.0, 0.0, 0.0)
        assert_eq!(transform.position, Vec3::ZERO);
    }

    #[test]
    fn transform_new_sets_position() {
        // ARRANGE
        let expected = Vec3::new(1.0, 2.0, 3.0);

        // ACT — create a Transform at a specific position
        let transform = Transform::new(expected);

        // ASSERT
        assert_eq!(transform.position, expected);
    }
}
