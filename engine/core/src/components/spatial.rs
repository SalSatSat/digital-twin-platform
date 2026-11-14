use glam::{Affine3A, Mat3A, Quat, Vec3, Vec3A};

/// The local transform of an entity — position, rotation and scale relative
/// to its parent.
///
/// For root entities (no parent), local transform equals world transform.
/// For child entities, the world transform is computed by HierarchySystem
/// by composing this transform with all ancestor local transforms.
///
/// Always set LocalTransform when moving, rotating or scaling an entity.
/// Never write to WorldTransform directly — it is managed by HierarchySystem.
///
/// `scale` is per axis. Each axis must be finite and non-zero; a negative
/// axis mirrors the entity. The reflection boundary enforces this (ADR-039).
///
/// # Construction
///
/// LocalTransform uses a builder pattern for optional fields:
///
/// ```ignore
/// // Position only
/// LocalTransform::new(position)
///
/// // Position, rotation and scale
/// LocalTransform::new(position).with_rotation(rotation).with_scale(scale)
/// ```
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LocalTransform {
    pub position: Vec3,
    pub rotation: Quat,
    pub scale: Vec3,
}

impl LocalTransform {
    /// Creates a new LocalTransform at the given position with identity
    /// rotation and unit scale.
    pub fn new(position: Vec3) -> Self {
        Self {
            position,
            rotation: Quat::IDENTITY,
            scale: Vec3::ONE,
        }
    }

    /// Sets the rotation on this LocalTransform and returns it.
    /// Intended for use in builder chains: LocalTransform::new(pos).with_rotation(rot)
    pub fn with_rotation(mut self, rotation: Quat) -> Self {
        self.rotation = rotation;
        self
    }

    /// Sets the scale on this LocalTransform and returns it.
    /// Intended for use in builder chains: LocalTransform::new(pos).with_scale(scale)
    pub fn with_scale(mut self, scale: Vec3) -> Self {
        self.scale = scale;
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
    /// Creates a LocalTransform at the world origin with identity rotation
    /// and unit scale.
    fn default() -> Self {
        Self::new(Vec3::ZERO)
    }
}

/// The world transform of an entity — an exact affine matrix (ADR-039).
///
/// Computed and maintained by HierarchySystem each tick.
/// Never set this directly — it will be overwritten.
///
/// For root entities, WorldTransform is LocalTransform as a matrix.
/// For child entities, it is the product of all ancestor LocalTransforms
/// down to this entity. Under a non-uniformly scaled ancestor that product
/// can be sheared, which no position-rotation-scale triple represents, so
/// the matrix is the source of truth and the parts are accessors:
/// `position()` is exact; `rotation()` and `lossy_scale()` are decomposed
/// (exact without shear, approximate under it, like Unity's `lossyScale`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorldTransform(Affine3A);

impl WorldTransform {
    pub const IDENTITY: Self = Self(Affine3A::IDENTITY);

    /// Wraps an affine matrix.
    pub fn from_affine(affine: Affine3A) -> Self {
        Self(affine)
    }

    /// The affine matrix.
    pub fn affine(&self) -> Affine3A {
        self.0
    }

    /// Creates a WorldTransform from a LocalTransform.
    /// Used for root entities where local == world.
    pub fn from_local(local: &LocalTransform) -> Self {
        Self(Affine3A::from_scale_rotation_translation(
            local.scale,
            local.rotation,
            local.position,
        ))
    }

    /// World position: the translation column. Exact.
    pub fn position(&self) -> Vec3 {
        self.0.translation.into()
    }

    /// World rotation, decomposed from the matrix.
    /// Normalised: under shear the decomposed quaternion is not unit length.
    pub fn rotation(&self) -> Quat {
        self.0.to_scale_rotation_translation().1.normalize()
    }

    /// World scale, decomposed from the matrix. With a negative determinant
    /// glam puts the mirror on X (pinned by a test).
    pub fn lossy_scale(&self) -> Vec3 {
        self.0.to_scale_rotation_translation().0
    }

    /// Composes this transform with a child local transform.
    /// Returns the child's world transform.
    pub fn compose(&self, child_local: &LocalTransform) -> Self {
        Self(self.0 * Self::from_local(child_local).0)
    }

    /// Returns the LocalTransform with scale `local_scale` that, composed
    /// under this (parent) transform, best matches a world pose of
    /// `position`, `rotation` and `world_scale`. Returns None if the result
    /// is not finite (a singular parent).
    ///
    /// The position is exact. The rotation solves
    /// `R = P⁻¹ · R(rotation) · S_world · S_local⁻¹` and orthonormalises it,
    /// which is exact whenever the requested pose is reachable with
    /// `local_scale` (including mirrored and negatively scaled parents) and
    /// approximate otherwise (a rotated child under a non-uniform parent).
    pub fn local_for(
        &self,
        position: Vec3,
        rotation: Quat,
        world_scale: Vec3,
        local_scale: Vec3,
    ) -> Option<LocalTransform> {
        let inverse = self.0.inverse();
        let linear = inverse.matrix3
            * Mat3A::from_quat(rotation)
            * Mat3A::from_diagonal(world_scale)
            * Mat3A::from_diagonal(local_scale.recip());
        // The determinant of `linear` is positive whenever the scales are
        // consistent, so the decomposition yields a proper rotation and puts
        // no mirror into the discarded scale.
        let (_, rotation, _) = Affine3A {
            matrix3: linear,
            translation: Vec3A::ZERO,
        }
        .to_scale_rotation_translation();
        let local = LocalTransform {
            position: inverse.transform_point3(position),
            rotation: rotation.normalize(),
            scale: local_scale,
        };
        (local.position.is_finite() && local.rotation.is_finite() && local.scale.is_finite())
            .then_some(local)
    }
}

impl Default for WorldTransform {
    fn default() -> Self {
        Self::IDENTITY
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use std::f32::consts::{FRAC_PI_2, FRAC_PI_4, PI};

    fn assert_vec3_eq(actual: Vec3, expected: Vec3) {
        assert_relative_eq!(actual.x, expected.x, epsilon = 1e-5);
        assert_relative_eq!(actual.y, expected.y, epsilon = 1e-5);
        assert_relative_eq!(actual.z, expected.z, epsilon = 1e-5);
    }

    fn assert_same_rotation(actual: Quat, expected: Quat) {
        assert!(
            actual.dot(expected).abs() > 1.0 - 1e-5,
            "rotation {actual:?} != {expected:?}"
        );
    }

    /// A parent whose world matrix underflows to singular: 1e-30 squared is
    /// below f32's smallest subnormal, so the X column becomes exactly zero.
    /// Boundary validation (non-zero scale) cannot catch this.
    fn singular_parent() -> WorldTransform {
        let tiny = Affine3A::from_scale(Vec3::new(1e-30, 1.0, 1.0));
        WorldTransform::from_affine(tiny * tiny)
    }

    // -- LocalTransform --------------------------------------------------------

    #[test]
    fn local_transform_defaults_to_origin_with_identity_rotation_and_unit_scale() {
        let transform = LocalTransform::default();
        assert_eq!(transform.position, Vec3::ZERO);
        assert_eq!(transform.rotation, Quat::IDENTITY);
        assert_eq!(transform.scale, Vec3::ONE);
    }

    #[test]
    fn local_transform_new_sets_position_with_identity_rotation_and_unit_scale() {
        let expected = Vec3::new(1.0, 2.0, 3.0);
        let transform = LocalTransform::new(expected);
        assert_eq!(transform.position, expected);
        assert_eq!(transform.rotation, Quat::IDENTITY);
        assert_eq!(transform.scale, Vec3::ONE);
    }

    #[test]
    fn local_transform_with_rotation_sets_rotation() {
        let position = Vec3::new(1.0, 0.0, 0.0);
        let rotation = Quat::from_rotation_y(FRAC_PI_2);
        let transform = LocalTransform::new(position).with_rotation(rotation);
        assert_eq!(transform.position, position);
        assert_eq!(transform.rotation, rotation);
    }

    #[test]
    fn local_transform_with_scale_sets_scale_only() {
        let rotation = Quat::from_rotation_x(0.3);
        let transform = LocalTransform::new(Vec3::X)
            .with_rotation(rotation)
            .with_scale(Vec3::new(2.0, -1.0, 0.5));
        assert_eq!(transform.position, Vec3::X);
        assert_eq!(transform.rotation, rotation);
        assert_eq!(transform.scale, Vec3::new(2.0, -1.0, 0.5));
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

    // -- WorldTransform: construction and accessors ----------------------------

    #[test]
    fn world_transform_from_local_mirrors_position_rotation_and_scale() {
        let local = LocalTransform::new(Vec3::new(1.0, 2.0, 3.0))
            .with_rotation(Quat::from_rotation_y(0.5))
            .with_scale(Vec3::new(2.0, 3.0, 4.0));

        let world = WorldTransform::from_local(&local);

        assert_eq!(world.position(), local.position);
        assert_same_rotation(world.rotation(), local.rotation);
        assert_vec3_eq(world.lossy_scale(), local.scale);
    }

    #[test]
    fn world_transform_decomposition_puts_a_mirror_on_the_x_axis() {
        // Pins glam's convention rather than assuming it (ADR-039 decision 3):
        // a Y mirror decomposes as an X mirror plus a half turn about Z.
        let local = LocalTransform::default().with_scale(Vec3::new(1.0, -1.0, 1.0));

        let world = WorldTransform::from_local(&local);

        assert_vec3_eq(world.lossy_scale(), Vec3::new(-1.0, 1.0, 1.0));
        assert_same_rotation(world.rotation(), Quat::from_rotation_z(PI));
    }

    #[test]
    fn world_transform_rotation_is_unit_length_under_shear() {
        let parent = WorldTransform::from_local(
            &LocalTransform::default().with_scale(Vec3::new(2.0, 1.0, 1.0)),
        );
        let child = LocalTransform::default().with_rotation(Quat::from_rotation_z(FRAC_PI_4));

        let world = parent.compose(&child);

        // Non-vacuity: the matrix really is sheared (columns not orthogonal).
        let m = world.affine().matrix3;
        assert!(m.x_axis.dot(m.y_axis) < -1.0, "expected shear, got {m:?}");
        assert_relative_eq!(world.rotation().length(), 1.0, epsilon = 1e-5);
    }

    // -- WorldTransform: compose -----------------------------------------------

    #[test]
    fn world_transform_compose_applies_parent_rotation_to_child_position() {
        // Parent at origin, rotated 90 degrees around Y axis
        let parent = WorldTransform::from_local(
            &LocalTransform::default().with_rotation(Quat::from_rotation_y(FRAC_PI_2)),
        );

        // Child at (1, 0, 0) in local space
        let child_local = LocalTransform::new(Vec3::new(1.0, 0.0, 0.0));

        // After 90 degree Y rotation, (1,0,0) becomes (0,0,-1)
        let child_world = parent.compose(&child_local);

        assert_vec3_eq(child_world.position(), Vec3::new(0.0, 0.0, -1.0));
    }

    #[test]
    fn world_transform_compose_adds_parent_position() {
        let parent = WorldTransform::from_local(&LocalTransform::new(Vec3::new(5.0, 0.0, 0.0)));
        let child_local = LocalTransform::new(Vec3::new(1.0, 0.0, 0.0));

        let child_world = parent.compose(&child_local);

        assert_vec3_eq(child_world.position(), Vec3::new(6.0, 0.0, 0.0));
    }

    #[test]
    fn world_transform_compose_scales_child_position_by_parent_scale() {
        let parent = WorldTransform::from_local(
            &LocalTransform::default().with_scale(Vec3::new(2.0, 3.0, 4.0)),
        );
        let child_local = LocalTransform::new(Vec3::ONE);

        let child_world = parent.compose(&child_local);

        assert_vec3_eq(child_world.position(), Vec3::new(2.0, 3.0, 4.0));
    }

    #[test]
    fn world_transform_compose_multiplies_parent_and_child_scale() {
        let parent =
            WorldTransform::from_local(&LocalTransform::default().with_scale(Vec3::splat(2.0)));
        let child_local = LocalTransform::default().with_scale(Vec3::new(1.0, 3.0, 1.0));

        let child_world = parent.compose(&child_local);

        assert_vec3_eq(child_world.lossy_scale(), Vec3::new(2.0, 6.0, 2.0));
    }

    #[test]
    fn world_transform_compose_shears_a_rotated_child_under_a_non_uniform_parent() {
        // Parent stretched 2x along X; child turned 45 degrees about Z.
        // Columns are diag(2,1,1) * Rz(45): x = (2c, s, 0), y = (-2s, c, 0),
        // with c = s = sqrt(1/2). Not orthogonal: x.y = -1.5.
        let parent = WorldTransform::from_local(
            &LocalTransform::default().with_scale(Vec3::new(2.0, 1.0, 1.0)),
        );
        let child = LocalTransform::default().with_rotation(Quat::from_rotation_z(FRAC_PI_4));

        let m = parent.compose(&child).affine().matrix3;

        let h = std::f32::consts::FRAC_1_SQRT_2;
        assert_vec3_eq(m.x_axis.into(), Vec3::new(2.0 * h, h, 0.0));
        assert_vec3_eq(m.y_axis.into(), Vec3::new(-2.0 * h, h, 0.0));
        assert_vec3_eq(m.z_axis.into(), Vec3::Z);
    }

    // -- WorldTransform: local_for ---------------------------------------------

    #[test]
    fn world_transform_local_for_inverts_compose() {
        let parent = WorldTransform::from_local(
            &LocalTransform::new(Vec3::new(5.0, -2.0, 1.0))
                .with_rotation(Quat::from_rotation_y(FRAC_PI_2))
                .with_scale(Vec3::splat(2.0)),
        );
        let local = LocalTransform::new(Vec3::new(1.0, 2.0, 3.0))
            .with_rotation(Quat::from_rotation_x(0.5))
            .with_scale(Vec3::new(1.0, 2.0, 3.0));
        let world = parent.compose(&local);

        let recovered = parent
            .local_for(
                world.position(),
                world.rotation(),
                world.lossy_scale(),
                local.scale,
            )
            .expect("parent is invertible");

        assert_vec3_eq(recovered.position, local.position);
        assert_same_rotation(recovered.rotation, local.rotation);
        assert_eq!(recovered.scale, local.scale);
    }

    #[test]
    fn world_transform_local_for_round_trips_a_child_of_a_mirrored_parent() {
        // The pre-amendment ADR-039 formula (inverse parent rotation times
        // world rotation) turns this child 180 degrees on a no-op write.
        let parent = WorldTransform::from_local(
            &LocalTransform::default().with_scale(Vec3::new(-1.0, 1.0, 1.0)),
        );
        let local = LocalTransform::new(Vec3::X).with_rotation(Quat::from_rotation_y(FRAC_PI_2));
        let world = parent.compose(&local);

        // Non-vacuity: the child's world matrix really is mirrored.
        assert!(world.affine().matrix3.determinant() < 0.0);
        let recovered = parent
            .local_for(
                world.position(),
                world.rotation(),
                world.lossy_scale(),
                local.scale,
            )
            .expect("parent is invertible");
        assert_vec3_eq(recovered.position, local.position);
        assert_same_rotation(recovered.rotation, local.rotation);
    }

    #[test]
    fn world_transform_local_for_returns_none_under_a_singular_parent() {
        let parent = singular_parent();
        assert_eq!(parent.affine().matrix3.determinant(), 0.0);

        let result = parent.local_for(Vec3::ONE, Quat::IDENTITY, Vec3::ONE, Vec3::ONE);

        assert!(result.is_none(), "expected None, got {result:?}");
    }
}
