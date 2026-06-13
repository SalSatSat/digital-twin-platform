use glam::Vec3;

/// Velocity component — represents movement per simulation tick.
///
/// An entity with both Transform and Velocity will have its position
/// updated each tick by the MovementSystem.
///
/// Entities without Velocity are static — they have a position but
/// do not move unless explicitly teleported.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Velocity {
    pub value: Vec3,
}

impl Velocity {
    /// Creates a new Velocity with the given direction and magnitude.
    pub fn new(value: Vec3) -> Self {
        Self { value }
    }
}

impl Default for Velocity {
    fn default() -> Self {
        Self { value: Vec3::ZERO }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn velocity_defaults_to_zero() {
        // ARRANGE + ACT
        let velocity = Velocity::default();

        // ASSERT — a default entity has no movement
        assert_eq!(velocity.value, Vec3::ZERO);
    }

    #[test]
    fn velocity_new_sets_value() {
        // ARRANGE
        let expected = Vec3::new(1.0, 0.0, 0.0);

        // ACT — create a Velocity moving along the X axis
        let velocity = Velocity::new(expected);

        // ASSERT
        assert_eq!(velocity.value, expected);
    }
}
