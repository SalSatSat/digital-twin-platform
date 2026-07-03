# ADR-017: Bundle Pattern, Entity Identity, and Registry

## Status
Accepted

## Date
2026-07-03

## Context
Phase 7 addressed three related design problems. First, EntityFactory used
hardcoded methods per archetype which did not scale. Second, entities had no
identity beyond their hecs Entity ID — no name, no classification, no stable
identifier for serialization. Third, the platform needed a way to classify
entities by kind and deployment context that could be extended at runtime
by users without recompiling.

## Decision
We introduced three coordinated designs: a Bundle trait for generic entity
spawning, an EntityInfo and HierarchyNode component pair present on every
entity, and an EntityRegistry owned by World that manages valid categories
and contexts as runtime data.

## Reasoning

### Bundle Trait
The Bundle trait defines a single method — spawn_into(world) — that a struct
implements to spawn itself as a set of components. World gains a generic
spawn_bundle() method that accepts anything implementing Bundle. This replaces
the hardcoded factory methods with a pattern where new archetypes are new
structs, not new methods. EntityFactory now delegates to spawn_bundle()
internally, preserving its public API while using the correct underlying
mechanism.

### EntityInfo and HierarchyNode
Every entity needs identity (name, enabled state, classification) and a
position in the scene tree (parent, children). These are separated into two
components because they change at different rates and for different reasons.
Identity data is mostly static. Hierarchy relationships change when entities
are reparented. Keeping them separate allows systems to query only what they
need. Both components are included in BaseBundle, which every archetype
extends, ensuring no entity can be spawned without them.

EntityInfo uses Vec<String> for contexts rather than a single String because
an entity can legitimately exist in multiple contexts simultaneously — for
example, both Editor and Preview. Category remains a single String because
an entity belongs to exactly one kind.

### EntityRegistry
A Rust enum for categories and contexts would be closed at compile time,
preventing users from defining their own. String-based identifiers backed
by a registry solve this — categories and contexts are managed data rather
than compiled variants. The registry is owned by World and serialized with
the scene. Built-in entries are protected from deletion. Custom entries can
be added and removed at runtime. String comparison for context membership
checks is acceptable at editor scale.

## Consequences
- Every entity always has Transform, EntityInfo, and HierarchyNode —
  this is enforced by BaseBundle being the foundation of all archetypes
- Adding a new archetype requires a new Bundle struct, not a new factory
  method — EntityFactory does not need to change for new entity types
- EntityInfo.id provides a stable UUID that survives serialization and
  can be used as a database key in Phase 17
- HierarchyNode stores hecs Entity values for parent and children —
  these cannot cross the WASM boundary directly and will require
  translation in the editor phase
- The registry is not yet validated against EntityInfo — an entity can
  reference a category or context that does not exist in the registry.
  Validation belongs in Phase 15 with the editor
- The WASM memory exhaustion issue from Phase 6 is unaffected by these
  changes and remains tracked for Phase 8
