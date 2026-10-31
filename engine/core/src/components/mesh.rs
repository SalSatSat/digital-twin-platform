use glam::{Vec2, Vec3};

/// The geometry a [`Mesh`] draws.
///
/// Every dimension is in world units and every shape is centred on the
/// entity's origin. The engine has no transform scale, so a primitive's size
/// lives here. Serialized as an externally tagged enum, the same
/// representation as `ProjectionType`, so a model variant can be added later
/// without changing the wire format (ADR-038).
///
/// Dimensions must be finite and greater than zero. That is checked where
/// JSON enters the engine (reflection), not by these types.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum MeshShape {
    /// A box.
    Box {
        /// Extents along local X, Y and Z.
        size: Vec3,
    },
    /// A sphere.
    Sphere {
        /// Distance from the origin to the surface.
        radius: f32,
    },
    /// A cylinder whose axis runs along local Y.
    Cylinder {
        /// Radius of the circular cross-section.
        radius: f32,
        /// Extent along local Y.
        height: f32,
    },
    /// A single-sided plane in the local XZ plane, facing +Y.
    Plane {
        /// Extents along local X and Z.
        size: Vec2,
    },
}

impl MeshShape {
    /// A unit cube: one world unit on every axis.
    pub fn default_box() -> Self {
        Self::Box { size: Vec3::ONE }
    }

    /// A sphere with a diameter of one world unit (radius 0.5).
    pub fn default_sphere() -> Self {
        Self::Sphere { radius: 0.5 }
    }

    /// A cylinder with a diameter of one world unit and a height of two
    /// (radius 0.5, height 2.0).
    pub fn default_cylinder() -> Self {
        Self::Cylinder {
            radius: 0.5,
            height: 2.0,
        }
    }

    /// A plane of 10 by 10 world units.
    pub fn default_plane() -> Self {
        Self::Plane {
            size: Vec2::new(10.0, 10.0),
        }
    }
}

/// Mesh component — the geometry an entity is drawn with.
///
/// An entity without a Mesh is not drawn. A Mesh is drawn with the entity's
/// Material, or with the default Material when it has none.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Mesh {
    /// The geometry to draw.
    pub shape: MeshShape,
}

impl Mesh {
    /// Creates a Mesh with the given shape.
    pub fn new(shape: MeshShape) -> Self {
        Self { shape }
    }
}

impl Default for Mesh {
    /// Creates a Mesh with a unit cube.
    fn default() -> Self {
        Self::new(MeshShape::default_box())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mesh_shape_default_box_is_a_unit_cube() {
        // ARRANGE + ACT
        let shape = MeshShape::default_box();

        // ASSERT — one world unit on every axis, like Unity's cube
        assert_eq!(shape, MeshShape::Box { size: Vec3::ONE });
    }

    #[test]
    fn mesh_shape_default_sphere_has_a_diameter_of_one() {
        let shape = MeshShape::default_sphere();

        assert_eq!(shape, MeshShape::Sphere { radius: 0.5 });
    }

    #[test]
    fn mesh_shape_default_cylinder_has_a_diameter_of_one_and_height_two() {
        let shape = MeshShape::default_cylinder();

        assert_eq!(
            shape,
            MeshShape::Cylinder {
                radius: 0.5,
                height: 2.0
            }
        );
    }

    #[test]
    fn mesh_shape_default_plane_is_ten_by_ten() {
        let shape = MeshShape::default_plane();

        assert_eq!(
            shape,
            MeshShape::Plane {
                size: Vec2::new(10.0, 10.0)
            }
        );
    }

    #[test]
    fn mesh_new_sets_shape() {
        // ARRANGE — a shape that is not the default, so a constructor that
        // ignores its argument cannot pass
        let shape = MeshShape::Sphere { radius: 2.0 };

        // ACT
        let mesh = Mesh::new(shape);

        // ASSERT
        assert_eq!(mesh.shape, shape);
    }

    #[test]
    fn mesh_default_is_a_unit_cube() {
        // ARRANGE + ACT
        let mesh = Mesh::default();

        // ASSERT — written as a literal, not through default_box(), so this
        // does not pass by comparing two wrong values
        assert_eq!(mesh.shape, MeshShape::Box { size: Vec3::ONE });
    }
}
