//! Engine-side change-event queue (ADR-036).
//!
//! API-driven entity changes are recorded as fixed four-word records
//! `[kind, handle, a, b]` and handed to JavaScript once per frame as a flat
//! `Uint32Array` by `EngineWorld::drain_events`. `u32::MAX` means "none".
//! Events carry ids only; consumers re-read state through the getters.
//!
//! The kind constants are mirrored in TypeScript (`engine.ts`), the same way
//! the boundary's status codes are.

/// "No value" in the `a` and `b` words of a record.
pub const NONE: u32 = u32::MAX;

pub const KIND_ENTITY_SPAWNED: u32 = 0;
pub const KIND_ENTITY_DESPAWNED: u32 = 1;
/// a = old parent handle, b = new parent handle (either may be `NONE`).
#[allow(dead_code)] // Recorded by set_parent/remove_parent in the next step.
pub const KIND_ENTITY_REPARENTED: u32 = 2;
/// a = component kind id.
pub const KIND_COMPONENT_CHANGED: u32 = 3;
/// The queue overflowed and its contents were discarded: refetch snapshots.
pub const KIND_RESYNC: u32 = 4;

/// Words per record: `[kind, handle, a, b]`.
pub const RECORD_WORDS: usize = 4;

/// Records the queue holds before it overflows into a `Resync`.
pub const DEFAULT_CAPACITY_RECORDS: usize = 4096;

pub struct EventQueue {
    words: Vec<u32>,
    capacity_records: usize,
    overflowed: bool,
}

impl EventQueue {
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_CAPACITY_RECORDS)
    }

    pub fn with_capacity(capacity_records: usize) -> Self {
        Self {
            words: Vec::new(),
            capacity_records,
            overflowed: false,
        }
    }

    /// Records one event.
    ///
    /// An identical `ComponentChanged` that is already queued, with no
    /// structural event for the same handle queued since, is dropped
    /// (ADR-036 decision 4). Structural events are never dropped. If the
    /// queue is full, its contents are discarded and a single `Resync` is
    /// returned by the next drain (decision 7); records pushed while a
    /// `Resync` is pending are discarded too, since consumers will refetch.
    pub fn push(&mut self, kind: u32, handle: u32, a: u32, b: u32) {
        if self.overflowed {
            return;
        }
        if kind == KIND_COMPONENT_CHANGED && self.has_pending_component_change(handle, a) {
            return;
        }
        if self.words.len() / RECORD_WORDS >= self.capacity_records {
            self.words.clear();
            self.overflowed = true;
            return;
        }
        self.words.extend_from_slice(&[kind, handle, a, b]);
    }

    /// Returns every recorded word and empties the queue, or a single
    /// `Resync` record if the queue overflowed since the last drain.
    pub fn drain(&mut self) -> Vec<u32> {
        if self.overflowed {
            self.overflowed = false;
            return vec![KIND_RESYNC, NONE, NONE, NONE];
        }
        std::mem::take(&mut self.words)
    }

    /// True if an identical `ComponentChanged` is queued for `handle`, and
    /// no structural event for `handle` has been queued after it. Scans
    /// newest to oldest; records for other handles are skipped.
    fn has_pending_component_change(&self, handle: u32, component: u32) -> bool {
        for record in self.words.chunks_exact(RECORD_WORDS).rev() {
            if record[1] != handle {
                continue;
            }
            if record[0] != KIND_COMPONENT_CHANGED {
                return false;
            }
            if record[2] == component {
                return true;
            }
        }
        false
    }
}

impl Default for EventQueue {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn records(words: &[u32]) -> Vec<[u32; 4]> {
        words
            .chunks_exact(RECORD_WORDS)
            .map(|c| [c[0], c[1], c[2], c[3]])
            .collect()
    }

    #[test]
    fn event_kind_values_are_stable() {
        // Mirrored in client/renderer/src/events.ts. Changing a value is a
        // wire-format change: update both sides together.
        assert_eq!(NONE, u32::MAX);
        assert_eq!(KIND_ENTITY_SPAWNED, 0);
        assert_eq!(KIND_ENTITY_DESPAWNED, 1);
        assert_eq!(KIND_ENTITY_REPARENTED, 2);
        assert_eq!(KIND_COMPONENT_CHANGED, 3);
        assert_eq!(KIND_RESYNC, 4);
    }

    #[test]
    fn drain_on_empty_queue_returns_nothing() {
        let mut queue = EventQueue::new();

        assert!(queue.drain().is_empty());
    }

    #[test]
    fn drain_returns_records_in_order_and_empties_the_queue() {
        let mut queue = EventQueue::new();
        queue.push(KIND_ENTITY_SPAWNED, 0, NONE, NONE);
        queue.push(KIND_ENTITY_SPAWNED, 1, NONE, NONE);
        queue.push(KIND_ENTITY_DESPAWNED, 0, NONE, NONE);

        let first = queue.drain();
        let second = queue.drain();

        assert_eq!(
            records(&first),
            vec![
                [KIND_ENTITY_SPAWNED, 0, NONE, NONE],
                [KIND_ENTITY_SPAWNED, 1, NONE, NONE],
                [KIND_ENTITY_DESPAWNED, 0, NONE, NONE],
            ]
        );
        assert!(second.is_empty());
    }

    #[test]
    fn structural_events_for_a_reused_handle_are_never_coalesced() {
        let mut queue = EventQueue::new();
        queue.push(KIND_ENTITY_SPAWNED, 1, NONE, NONE);
        queue.push(KIND_ENTITY_DESPAWNED, 1, NONE, NONE);
        queue.push(KIND_ENTITY_SPAWNED, 1, NONE, NONE);

        assert_eq!(records(&queue.drain()).len(), 3);
    }

    #[test]
    fn identical_component_changes_collapse_to_one_record() {
        let mut queue = EventQueue::new();
        queue.push(KIND_COMPONENT_CHANGED, 1, 7, NONE);
        queue.push(KIND_COMPONENT_CHANGED, 1, 7, NONE);
        queue.push(KIND_COMPONENT_CHANGED, 1, 7, NONE);

        assert_eq!(
            records(&queue.drain()),
            vec![[KIND_COMPONENT_CHANGED, 1, 7, NONE]]
        );
    }

    #[test]
    fn component_changes_for_different_handles_or_kinds_are_kept() {
        let mut queue = EventQueue::new();
        queue.push(KIND_COMPONENT_CHANGED, 1, 7, NONE);
        queue.push(KIND_COMPONENT_CHANGED, 2, 7, NONE);
        queue.push(KIND_COMPONENT_CHANGED, 1, 8, NONE);

        assert_eq!(records(&queue.drain()).len(), 3);
    }

    #[test]
    fn component_change_is_not_collapsed_across_a_structural_event_for_the_same_handle() {
        let mut queue = EventQueue::new();
        queue.push(KIND_COMPONENT_CHANGED, 1, 7, NONE);
        queue.push(KIND_ENTITY_DESPAWNED, 1, NONE, NONE);
        queue.push(KIND_ENTITY_SPAWNED, 1, NONE, NONE);
        queue.push(KIND_COMPONENT_CHANGED, 1, 7, NONE);

        assert_eq!(records(&queue.drain()).len(), 4);
    }

    #[test]
    fn component_change_collapses_past_a_structural_event_for_another_handle() {
        let mut queue = EventQueue::new();
        queue.push(KIND_COMPONENT_CHANGED, 1, 7, NONE);
        queue.push(KIND_ENTITY_SPAWNED, 2, NONE, NONE);
        queue.push(KIND_COMPONENT_CHANGED, 1, 7, NONE);

        assert_eq!(
            records(&queue.drain()),
            vec![
                [KIND_COMPONENT_CHANGED, 1, 7, NONE],
                [KIND_ENTITY_SPAWNED, 2, NONE, NONE],
            ]
        );
    }

    #[test]
    fn overflow_discards_everything_and_drains_a_single_resync() {
        let mut queue = EventQueue::with_capacity(2);
        queue.push(KIND_ENTITY_SPAWNED, 0, NONE, NONE);
        queue.push(KIND_ENTITY_SPAWNED, 1, NONE, NONE);
        queue.push(KIND_ENTITY_SPAWNED, 2, NONE, NONE);

        let drained = queue.drain();

        assert_eq!(records(&drained), vec![[KIND_RESYNC, NONE, NONE, NONE]]);
        assert!(queue.drain().is_empty());
    }

    #[test]
    fn queue_works_normally_after_a_resync() {
        let mut queue = EventQueue::with_capacity(2);
        queue.push(KIND_ENTITY_SPAWNED, 0, NONE, NONE);
        queue.push(KIND_ENTITY_SPAWNED, 1, NONE, NONE);
        queue.push(KIND_ENTITY_SPAWNED, 2, NONE, NONE);
        assert_eq!(
            records(&queue.drain()),
            vec![[KIND_RESYNC, NONE, NONE, NONE]]
        );

        queue.push(KIND_ENTITY_SPAWNED, 3, NONE, NONE);

        assert_eq!(
            records(&queue.drain()),
            vec![[KIND_ENTITY_SPAWNED, 3, NONE, NONE]]
        );
    }
}
