pub mod camera;
pub mod hierarchy;
pub mod identity;
pub mod physics;
pub mod spatial;

// Re-export commonly used types
pub use camera::{CameraComponent, ProjectionType};
pub use hierarchy::{HierarchyError, HierarchyNode};
pub use identity::EntityInfo;
pub use physics::Velocity;
pub use spatial::{LocalTransform, WorldTransform};
