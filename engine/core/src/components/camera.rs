/// The projection type used by a camera entity.
///
/// Perspective projection mimics natural human vision — objects appear
/// smaller with distance. Use this for most viewpoints.
///
/// Orthographic projection has no perspective distortion — objects are
/// the same size regardless of distance. Use this for technical or
/// isometric views.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ProjectionType {
    /// Perspective projection — natural human vision.
    Perspective {
        /// Vertical field of view in degrees.
        fov_degrees: f32,
        /// Distance to the near clipping plane.
        near: f32,
        /// Distance to the far clipping plane.
        far: f32,
    },
    /// Orthographic projection — no perspective distortion.
    Orthographic {
        /// Half-size of the orthographic viewport in world units.
        size: f32,
        /// Distance to the near clipping plane.
        near: f32,
        /// Distance to the far clipping plane.
        far: f32,
    },
}

impl ProjectionType {
    /// Creates a default perspective projection.
    /// 75 degree FOV, near 0.1, far 1000.0
    pub fn default_perspective() -> Self {
        Self::Perspective {
            fov_degrees: 75.0,
            near: 0.1,
            far: 1000.0,
        }
    }

    /// Creates a default orthographic projection.
    pub fn default_orthographic() -> Self {
        Self::Orthographic {
            size: 10.0,
            near: 0.1,
            far: 1000.0,
        }
    }
}

/// Camera component — defines a viewpoint into the scene.
///
/// Attach this component to any entity that represents a camera.
/// The entity's Transform defines where the camera is and what
/// direction it is looking.
///
/// Every camera entity should use the Camera category in EntityInfo
/// and an appropriate context (Editor, Runtime, or Universal).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CameraComponent {
    /// The projection type and parameters for this camera.
    pub projection: ProjectionType,
}

impl CameraComponent {
    /// Creates a new camera with the given projection type.
    pub fn new(projection: ProjectionType) -> Self {
        Self { projection }
    }

    /// Creates a camera with default perspective projection.
    pub fn perspective() -> Self {
        Self {
            projection: ProjectionType::default_perspective(),
        }
    }

    /// Creates a camera with default orthographic projection.
    pub fn orthographic() -> Self {
        Self {
            projection: ProjectionType::default_orthographic(),
        }
    }
}

impl Default for CameraComponent {
    fn default() -> Self {
        Self::perspective()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_component_default_is_perspective() {
        let camera = CameraComponent::default();
        assert!(matches!(
            camera.projection,
            ProjectionType::Perspective { .. }
        ));
    }

    #[test]
    fn camera_component_perspective_has_correct_defaults() {
        let camera = CameraComponent::perspective();
        match camera.projection {
            ProjectionType::Perspective {
                fov_degrees,
                near,
                far,
            } => {
                assert_eq!(fov_degrees, 75.0);
                assert_eq!(near, 0.1);
                assert_eq!(far, 1000.0);
            }
            _ => panic!("Expected perspective projection"),
        }
    }

    #[test]
    fn camera_component_orthographic_has_correct_defaults() {
        let camera = CameraComponent::orthographic();
        match camera.projection {
            ProjectionType::Orthographic { size, near, far } => {
                assert_eq!(size, 10.0);
                assert_eq!(near, 0.1);
                assert_eq!(far, 1000.0);
            }
            _ => panic!("Expected orthographic projection"),
        }
    }

    #[test]
    fn camera_component_new_sets_projection() {
        let projection = ProjectionType::Perspective {
            fov_degrees: 60.0,
            near: 0.01,
            far: 500.0,
        };
        let camera = CameraComponent::new(projection);
        assert_eq!(camera.projection, projection);
    }
}
