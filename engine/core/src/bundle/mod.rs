pub mod base;
pub mod dynamic_object;
pub mod static_object;

pub use base::BaseBundle;
pub use dynamic_object::DynamicObjectBundle;
pub use static_object::StaticObjectBundle;

use crate::world::World;
use hecs::Entity;

/// A Bundle groups a set of components that are spawned together
/// as a unit into a World.
///
/// Implement this trait to define a reusable entity archetype.
/// Each implementation decides which components get added and
/// in what configuration.
///
/// # Future Direction
///
/// Currently each Bundle implementation calls world.spawn() and
/// world.add_component() directly. A future improvement would be
/// to use hecs's native bundle spawning via world.inner_mut().spawn()
/// with a tuple of components, which is more efficient as it avoids
/// multiple separate insertions. This is deferred until the component
/// set per bundle is more stable.
pub trait Bundle {
    /// Spawns this bundle into the World and returns the Entity ID.
    fn spawn_into(self, world: &mut World) -> Entity;
}
