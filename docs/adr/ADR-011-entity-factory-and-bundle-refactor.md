# ADR-011: EntityFactory Pattern and Planned Bundle Refactor

## Status

Accepted

## Date

2026-06-06

## Context

The platform needs a scalable way to create entities with predefined
component configurations. Without a deliberate pattern, entity creation
code gets duplicated across the codebase and component combinations drift
over time.

## Decision

We implement an EntityFactory with hardcoded archetype methods as the initial
approach, structured as a module directory to support multiple factory files.
This will be refactored to a Bundle trait pattern in a future phase.

## Reasoning

The correct long-term design is a Bundle trait — a struct that groups a set
of components together and can be spawned as a unit. With this pattern,
adding a new archetype means defining a new Bundle struct without modifying
EntityFactory itself. However, implementing this pattern correctly requires
familiarity with Rust generics and traits at a level that would slow down
initial development. The hardcoded approach is explicit, easy to understand,
and correct for the current number of archetypes.

The factory module is structured as a directory rather than a single file
from the start, anticipating that different domains will have their own
factory files as the platform grows. This means the Bundle refactor will
only change the internals of each factory file, not the module structure.

## Consequences

- Entity creation is centralised in factory files rather than scattered
- The module structure supports multiple domain-specific factories without
  restructuring
- The current hardcoded approach does not scale beyond a small number of
  archetypes — this is a known limitation with a planned resolution
- The Bundle refactor should be prioritised once the team has sufficient
  Rust generics experience and the archetype count justifies it
- All factory methods are marked with a TODO comment describing the
  target Bundle design to guide the future refactor
