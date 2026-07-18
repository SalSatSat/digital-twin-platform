# ADR-019: EntityFactory Removal

## Status
Accepted

## Date
2026-07-18

## Context
EntityFactory was introduced in Phase 2 as a way to encapsulate common
entity component combinations — create_static_object() and
create_dynamic_object() were convenience methods that ensured the correct
components were always added together. In Phase 7 the Bundle trait was
introduced, which moved that knowledge directly into bundle structs. At
that point EntityFactory became a thin wrapper around world.spawn_bundle()
with no additional logic. In Phase 9 it became clear that adding
create_camera() would continue the pattern of one method per archetype,
which the Bundle trait was specifically designed to avoid.

## Decision
EntityFactory was removed entirely. All entity creation now uses
world.spawn_bundle() directly with explicit bundle structs.

## Reasoning
Once the Bundle trait existed, EntityFactory added a layer of indirection
without adding value. The bundle struct itself is the documentation of what
components an archetype contains — CameraBundle.perspective() is more
descriptive than factory.create_camera() because the bundle name appears at
the call site. Removing the factory eliminates one layer of abstraction,
reduces the number of files to maintain, and makes entity creation more
explicit. Any future archetype is a new bundle struct, not a new factory
method, which is consistent with the open/closed principle the Bundle trait
was designed to enforce.

## Consequences
- All entity creation goes through world.spawn_bundle() directly
- New archetypes require a new bundle file, not a modification to any
  existing file
- The call site is slightly more verbose — world.spawn_bundle(
  DynamicObjectBundle::new(...)) vs factory.create_dynamic_object(...)
  — but more explicit about what is being created
- The factory/ directory and its files have been deleted from the codebase
- Tests previously using EntityFactory now use world.spawn_bundle() directly
