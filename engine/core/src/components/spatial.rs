use glam::{Quat, Vec3};

/// The local transform of an entity — position and rotation relative to its parent.
///
/// For root entities (no parent), local transform equals world transform.
/// For child entities, the world transform is computed by HierarchySystem
/// by composing this transform with all ancestor local transforms.
///
/// Always set LocalTransform when moving or rotating an entity.
/// Never write to WorldTransform directly — it is managed by HierarchySystem.
///
/// # Construction
///
/// LocalTransform uses a builder pattern for optional fields:
///
/// ```ignore
/// // Position only
/// LocalTransform::new(position)
///
/// // Position and rotation
/// LocalTransform::new(position).with_rotation(rotation)
/// ```
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LocalTransform {
    pub position: Vec3,
    pub rotation: Quat,
}

impl LocalTransform {
    /// Creates a new LocalTransform at the given position with identity rotation.
    pub fn new(position: Vec3) -> Self {
        Self {
            position,
            rotation: Quat::IDENTITY,
        }
    }

    /// Sets the rotation on this LocalTransform and returns it.
    /// Intended for use in builder chains: LocalTransform::new(pos).with_rotation(rot)
    pub fn with_rotation(mut self, rotation: Quat) -> Self {
        self.rotation = rotation;
        self
    }

    /// Returns the forward direction vector of this transform.
    /// Forward is defined as -Z in the transform's local space, rotated by this transform's rotation.
    pub fn forward(&self) -> Vec3 {
        self.rotation * Vec3::NEG_Z
    }

    /// Returns the up direction vector of this transform.
    pub fn up(&self) -> Vec3 {
        self.rotation * Vec3::Y
    }
}

impl Default for LocalTransform {
    /// Creates a LocalTransform at the world origin with identity rotation.
    fn default() -> Self {
        Self {
            position: Vec3::ZERO,
            rotation: Quat::IDENTITY,
        }
    }
}

/// The world transform of an entity — absolute position and rotation in the world.
///
/// Computed and maintained by HierarchySystem each tick.
/// Never set this directly — it will be overwritten.
///
/// For root entities, WorldTransform mirrors LocalTransform.
/// For child entities, WorldTransform is the composition of all
/// ancestor LocalTransforms down to this entity.
///
/// Read WorldTransform when you need absolute world position —
/// for rendering, physics queries, or distance calculations.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorldTransform {
    pub position: Vec3,
    pub rotation: Quat,
}

impl WorldTransform {
    /// Creates a new WorldTransform at the given position with identity rotation.
    pub fn new(position: Vec3) -> Self {
        Self {
            position,
            rotation: Quat::IDENTITY,
        }
    }

    /// Creates a WorldTransform from a LocalTransform.
    /// Used for root entities where local == world.
    pub fn from_local(local: &LocalTransform) -> Self {
        Self {
            position: local.position,
            rotation: local.rotation,
        }
    }

    /// Composes this transform with a child local transform.
    /// Returns the child's world transform.
    pub fn compose(&self, child_local: &LocalTransform) -> Self {
        Self {
            position: self.position + self.rotation * child_local.position,
            rotation: (self.rotation * child_local.rotation).normalize(),
        }
    }
}

impl Default for WorldTransform {
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
    fn local_transform_defaults_to_origin_with_identity_rotation() {
        let transform = LocalTransform::default();
        assert_eq!(transform.position, Vec3::ZERO);
        assert_eq!(transform.rotation, Quat::IDENTITY);
    }

    #[test]
    fn local_transform_new_sets_position_with_identity_rotation() {
        let expected = Vec3::new(1.0, 2.0, 3.0);
        let transform = LocalTransform::new(expected);
        assert_eq!(transform.position, expected);
        assert_eq!(transform.rotation, Quat::IDENTITY);
    }

    #[test]
    fn local_transform_with_rotation_sets_rotation() {
        let position = Vec3::new(1.0, 0.0, 0.0);
        let rotation = Quat::from_rotation_y(std::f32::consts::FRAC_PI_2);
        let transform = LocalTransform::new(position).with_rotation(rotation);
        assert_eq!(transform.position, position);
        assert_eq!(transform.rotation, rotation);
    }

    #[test]
    fn local_transform_forward_is_neg_z_by_default() {
        let transform = LocalTransform::default();
        let forward = transform.forward();
        assert_relative_eq!(forward.x, 0.0, epsilon = 1e-6);
        assert_relative_eq!(forward.y, 0.0, epsilon = 1e-6);
        assert_relative_eq!(forward.z, -1.0, epsilon = 1e-6);
    }

    #[test]
    fn local_transform_up_is_y_by_default() {
        let transform = LocalTransform::default();
        let up = transform.up();
        assert_relative_eq!(up.x, 0.0, epsilon = 1e-6);
        assert_relative_eq!(up.y, 1.0, epsilon = 1e-6);
        assert_relative_eq!(up.z, 0.0, epsilon = 1e-6);
    }

    #[test]
    fn world_transform_from_local_mirrors_local() {
        let local = LocalTransform::new(Vec3::new(1.0, 2.0, 3.0));
        let world = WorldTransform::from_local(&local);
        assert_eq!(world.position, local.position);
        assert_eq!(world.rotation, local.rotation);
    }

    #[test]
    fn world_transform_compose_applies_parent_rotation_to_child_position() {
        // Parent at origin, rotated 90 degrees around Y axis
        let parent = WorldTransform {
            position: Vec3::ZERO,
            rotation: Quat::from_rotation_y(std::f32::consts::FRAC_PI_2),
        };

        // Child at (1, 0, 0) in local space
        let child_local = LocalTransform::new(Vec3::new(1.0, 0.0, 0.0));

        // After 90 degree Y rotation, (1,0,0) becomes (0,0,-1)
        let child_world = parent.compose(&child_local);

        assert_relative_eq!(child_world.position.x, 0.0, epsilon = 1e-6);
        assert_relative_eq!(child_world.position.y, 0.0, epsilon = 1e-6);
        assert_relative_eq!(child_world.position.z, -1.0, epsilon = 1e-6);
    }

    #[test]
    fn world_transform_compose_adds_parent_position() {
        // Parent at (5, 0, 0) with no rotation
        let parent = WorldTransform {
            position: Vec3::new(5.0, 0.0, 0.0),
            rotation: Quat::IDENTITY,
        };

        // Child at (1, 0, 0) in local space
        let child_local = LocalTransform::new(Vec3::new(1.0, 0.0, 0.0));

        // World position should be (6, 0, 0)
        let child_world = parent.compose(&child_local);

        assert_relative_eq!(child_world.position.x, 6.0, epsilon = 1e-6);
        assert_relative_eq!(child_world.position.y, 0.0, epsilon = 1e-6);
        assert_relative_eq!(child_world.position.z, 0.0, epsilon = 1e-6);
    }
}
