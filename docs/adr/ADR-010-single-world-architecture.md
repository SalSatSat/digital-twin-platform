# ADR-010: Single World Architecture

## Status

Accepted

## Date

2026-06-06

## Context

The platform needs to decide whether to use a single ECS World instance for
the primary runtime or multiple World instances. This decision affects how
entities are queried, how state is shared, and how large-scale spatial data
is managed.

## Decision

We use a single World instance for the primary runtime. Multiple World
instances are reserved for two specific cases: test isolation and independent
scenario comparison.

## Reasoning

A World in hecs is a completely isolated container — entities in separate
Worlds cannot interact or be queried together. Using multiple Worlds for
the primary runtime would mean entities cannot reference each other across
World boundaries, which creates unnecessary complexity for a platform where
entities need to interact regardless of their spatial location.

The streaming and district-loading behaviour that multiple scenes provide
in other environments is better achieved through spatial partitioning within
a single World — dividing the world into regions and processing only active
regions per tick. This approach keeps all entities in a shared query space
while still providing performance benefits of selective processing.

Test isolation is a legitimate use case for multiple Worlds — each test
creates its own isolated World, runs assertions, and discards it. Independent
scenario comparison is another legitimate use case where two simulations
must run in parallel without interaction.

## Consequences

- All entities exist in a shared query space regardless of their location
- Systems can query any entity without crossing World boundaries
- Streaming and spatial partitioning must be implemented within the single
  World using explicit region management — this is deferred to a later phase
- Tests are naturally isolated because each test owns its own World instance
- Independent scenario comparison can be implemented using multiple World
  instances when that feature is required
