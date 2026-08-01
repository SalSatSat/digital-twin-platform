use crate::bundle::{BaseBundle, Bundle};
use crate::components::{CameraComponent, EntityInfo, ProjectionType};
use crate::world::World;
use glam::Vec3;
use hecs::Entity;

/// A camera entity — defines a viewpoint into the scene.
///
/// Contains: LocalTransform, EntityInfo, HierarchyNode, CameraComponent
///
/// The EntityInfo is automatically configured with the Camera category.
/// The context determines where this camera is active:
/// - "Editor"    — Scene Camera, only active in the editor
/// - "Runtime"   — Main Camera, only active at runtime
/// - "Universal" — active in both contexts
pub struct CameraBundle {
    pub base: BaseBundle,
    pub camera: CameraComponent,
}

impl CameraBundle {
    /// Creates a perspective camera at the given position.
    pub fn perspective(
        name: impl Into<String>,
        position: Vec3,
        context: impl Into<String>,
    ) -> Self {
        let mut base = BaseBundle::with_position(name, position);
        base.info =
            EntityInfo::with_classification(base.info.name.clone(), "Camera", vec![context.into()]);
        Self {
            base,
            camera: CameraComponent::perspective(),
        }
    }

    /// Creates an orthographic camera at the given position.
    pub fn orthographic(
        name: impl Into<String>,
        position: Vec3,
        context: impl Into<String>,
    ) -> Self {
        let mut base = BaseBundle::with_position(name, position);
        base.info =
            EntityInfo::with_classification(base.info.name.clone(), "Camera", vec![context.into()]);
        Self {
            base,
            camera: CameraComponent::orthographic(),
        }
    }

    /// Creates a camera with a custom projection type.
    pub fn with_projection(
        name: impl Into<String>,
        position: Vec3,
        context: impl Into<String>,
        projection: ProjectionType,
    ) -> Self {
        let mut base = BaseBundle::with_position(name, position);
        base.info =
            EntityInfo::with_classification(base.info.name.clone(), "Camera", vec![context.into()]);
        Self {
            base,
            camera: CameraComponent::new(projection),
        }
    }
}

impl Bundle for CameraBundle {
    fn spawn_into(self, world: &mut World) -> Entity {
        let entity = self.base.spawn_into(world);
        world.add_component(entity, self.camera).unwrap();
        entity
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{EntityInfo, HierarchyNode, LocalTransform};

    #[test]
    fn camera_bundle_perspective_spawns_with_all_components() {
        let mut world = World::new();
        let bundle = CameraBundle::perspective("Scene Camera", Vec3::new(0.0, 5.0, 10.0), "Editor");

        let entity = bundle.spawn_into(&mut world);

        assert!(world.get_component::<LocalTransform>(entity).is_ok());
        assert!(world.get_component::<EntityInfo>(entity).is_ok());
        assert!(world.get_component::<HierarchyNode>(entity).is_ok());
        assert!(world.get_component::<CameraComponent>(entity).is_ok());
    }

    #[test]
    fn camera_bundle_sets_camera_category() {
        let mut world = World::new();
        let bundle = CameraBundle::perspective("Scene Camera", Vec3::ZERO, "Editor");

        let entity = bundle.spawn_into(&mut world);

        let info = world.get_component::<EntityInfo>(entity).unwrap();
        assert_eq!(info.category, "Camera");
    }

    #[test]
    fn camera_bundle_sets_context() {
        let mut world = World::new();
        let bundle = CameraBundle::perspective("Runtime Camera", Vec3::ZERO, "Runtime");

        let entity = bundle.spawn_into(&mut world);

        let info = world.get_component::<EntityInfo>(entity).unwrap();
        assert!(info.is_in_context("Runtime"));
        assert!(!info.is_in_context("Editor"));
    }

    #[test]
    fn camera_bundle_perspective_uses_perspective_projection() {
        let mut world = World::new();
        let bundle = CameraBundle::perspective("Camera", Vec3::ZERO, "Universal");

        let entity = bundle.spawn_into(&mut world);

        let camera = world.get_component::<CameraComponent>(entity).unwrap();
        assert!(matches!(
            camera.projection,
            ProjectionType::Perspective { .. }
        ));
    }

    #[test]
    fn camera_bundle_orthographic_uses_orthographic_projection() {
        let mut world = World::new();
        let bundle = CameraBundle::orthographic("Ortho Camera", Vec3::ZERO, "Editor");

        let entity = bundle.spawn_into(&mut world);

        let camera = world.get_component::<CameraComponent>(entity).unwrap();
        assert!(matches!(
            camera.projection,
            ProjectionType::Orthographic { .. }
        ));
    }

    #[test]
    fn camera_bundle_sets_position() {
        let mut world = World::new();
        let position = Vec3::new(0.0, 5.0, 10.0);
        let bundle = CameraBundle::perspective("Camera", position, "Editor");

        let entity = bundle.spawn_into(&mut world);

        let transform = world.get_component::<LocalTransform>(entity).unwrap();
        assert_eq!(transform.position, position);
    }
}
