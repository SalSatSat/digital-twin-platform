use glam::{Quat, Vec3};

/// Represents the position and orientation of an entity in 3D space.
///
/// Attach this component to any entity that has a location and
/// orientation in the world. Entities without a Transform have
/// no spatial representation.
///
/// Scale will be added when the renderer requires it.
///
/// # Construction
///
/// Transform uses a builder pattern for optional fields:
///
/// ```ignore
/// // Position only
/// Transform::new(position)
///
/// // Position and rotation
/// Transform::new(position).with_rotation(rotation)
///
/// // Position, rotation, and scale (when scale is added)
/// Transform::new(position).with_rotation(rotation).with_scale(scale)
/// ```
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Transform {
    pub position: Vec3,
    pub rotation: Quat,
}

impl Transform {
    /// Creates a new Transform at the given position with identity rotation.
    pub fn new(position: Vec3) -> Self {
        Self {
            position,
            rotation: Quat::IDENTITY,
        }
    }

    /// Sets the rotation on this Transform and returns it.
    /// Intended for use in builder chains: Transform::new(pos).with_rotation(rot)
    pub fn with_rotation(mut self, rotation: Quat) -> Self {
        self.rotation = rotation;
        self
    }

    /// Returns the forward direction vector of this transform.
    /// Forward is defined as -Z in world space, rotated by this transform's rotation.
    pub fn forward(&self) -> Vec3 {
        self.rotation * Vec3::NEG_Z
    }

    /// Returns the up direction vector of this transform.
    pub fn up(&self) -> Vec3 {
        self.rotation * Vec3::Y
    }
}

impl Default for Transform {
    /// Creates a Transform at the world origin with identity rotation.
    fn default() -> Self {
        Self {
            position: Vec3::ZERO,
            rotation: Quat::IDENTITY,
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    #[test]
    fn transform_defaults_to_origin_with_identity_rotation() {
        let transform = Transform::default();
        assert_eq!(transform.position, Vec3::ZERO);
        assert_eq!(transform.rotation, Quat::IDENTITY);
    }

    #[test]
    fn transform_new_sets_position_with_identity_rotation() {
        let expected = Vec3::new(1.0, 2.0, 3.0);
        let transform = Transform::new(expected);
        assert_eq!(transform.position, expected);
        assert_eq!(transform.rotation, Quat::IDENTITY);
    }

    #[test]
    fn transform_with_rotation_sets_rotation() {
        let position = Vec3::new(1.0, 0.0, 0.0);
        let rotation = Quat::from_rotation_y(std::f32::consts::FRAC_PI_2);
        let transform = Transform::new(position).with_rotation(rotation);
        assert_eq!(transform.position, position);
        assert_eq!(transform.rotation, rotation);
    }

    #[test]
    fn transform_forward_is_neg_z_by_default() {
        let transform = Transform::default();
        let forward = transform.forward();
        assert_relative_eq!(forward.x, 0.0, epsilon = 1e-6);
        assert_relative_eq!(forward.y, 0.0, epsilon = 1e-6);
        assert_relative_eq!(forward.z, -1.0, epsilon = 1e-6);
    }

    #[test]
    fn transform_up_is_y_by_default() {
        let transform = Transform::default();
        let up = transform.up();
        assert_relative_eq!(up.x, 0.0, epsilon = 1e-6);
        assert_relative_eq!(up.y, 1.0, epsilon = 1e-6);
        assert_relative_eq!(up.z, 0.0, epsilon = 1e-6);
    }
}
