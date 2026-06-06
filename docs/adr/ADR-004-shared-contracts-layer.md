# ADR-004: Shared Contracts Layer

## Status
Accepted

## Date
2026-06-06

## Context
The engine, frontend, and backend services need to exchange data. Without a
deliberate boundary, data shape definitions get duplicated across packages and
drift over time — a Go struct, a TypeScript interface, and a Rust struct all
representing the same entity but defined independently and maintained
separately.

## Decision
All cross-team data contracts live in `shared/`. This directory contains
Protobuf schema definitions in `shared/proto/` and shared type definitions
in `shared/types/`. Changes to `shared/` require cross-team review.

## Reasoning
The alternative — each team defining their own types and manually keeping
them in sync — is the most common source of subtle bugs in multi-language
systems. A single source of truth for data shapes, from which each language
generates its own types, eliminates an entire category of drift errors. The
`shared/` directory is not owned by any single team, which makes the review
requirement a natural forcing function for cross-team communication when
contracts need to change. Protobuf was chosen as the schema language because
it supports code generation for Go, Rust, and TypeScript from a single
definition file.

## Consequences
- Data shape changes require updating one file rather than three
- Code generation tooling must be set up for Go, Rust, and TypeScript
- Neither team can unilaterally change a shared contract without review
- The `shared/` layer adds a coordination step that slows down contract
  changes — this is intentional, not a bug
- Protobuf introduces a build step and toolchain dependency that must be
  maintained in the devcontainer
