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
/// Currently systems are called directly, in a fixed order, from
/// `EngineWorld::tick` (engine/wasm/src/lib.rs). The target design is a
/// Scheduler that owns a collection of systems and runs them in a defined
/// order each tick, with support for system ordering, dependencies, and
/// parallel execution where components don't overlap.
///
/// Deliberately deferred: with two systems and one ordering constraint
/// (Hierarchy after Movement, ADR-024) a Scheduler would encode only that
/// constraint and be redesigned by the first real workload. Revisit when a
/// third system is added, or when a system needs another system's output
/// beyond run order.
// TODO(refactor): introduce a Scheduler that owns Vec<Box<dyn System>>
// and drives the tick loop with ordering and dependency support.
// Trigger: a third system, or an inter-system data dependency.
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
