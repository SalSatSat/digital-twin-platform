pub mod hierarchy;
pub mod movement;

pub use hierarchy::HierarchySystem;
pub use movement::MovementSystem;

use crate::world::World;

/// Defines the interface that every system must implement.
///
/// A system is a unit of logic that operates on components in the World.
/// It has no state of its own beyond what it needs to perform its function.
/// Systems are registered with a Scheduler and run once per tick.
///
/// # Future Refactor — Scheduler
///
/// Currently systems are called directly. The target design is a Scheduler
/// that owns a collection of systems and runs them in a defined order each
/// tick, with support for system ordering, dependencies, and parallel
/// execution where components don't overlap. This refactor should be done
/// once the full ECS loop is connected to the WASM boundary.
// TODO(refactor): introduce a Scheduler that owns Vec<Box<dyn System>>
// and drives the tick loop with ordering and dependency support.
pub trait System {
    /// Returns the name of this system for debugging and logging.
    fn name(&self) -> &str;

    /// Runs the system for one tick.
    ///
    /// delta_time is the elapsed time in seconds since the last tick.
    /// Systems should use delta_time to make their behaviour
    /// frame-rate independent.
    fn run(&mut self, world: &mut World, delta_time: f32);
}
