# ADR-001: Monorepo Structure

## Status

Accepted

## Date

2026-06-06

## Context

The platform consists of multiple distinct concerns — a Rust ECS engine, a
TypeScript renderer, a React frontend, and Go backend services. We needed to
decide whether to manage these as separate repositories or a single monorepo.

## Decision

We use a single monorepo with top-level directories reflecting team ownership
and deployment boundaries.

## Reasoning

A monorepo allows atomic commits across boundaries, shared tooling, and a
single source of truth for the entire platform. The alternative — multiple
repositories — introduces version coordination overhead and makes cross-cutting
changes more expensive. For a platform where the engine, renderer, and backend
are tightly coupled by design, a monorepo is the correct tradeoff. The
structure is kept flat and explicit rather than deeply nested to avoid
over-engineering.

## Consequences

- All platform concerns live in one repository and can be versioned together
- Tooling complexity is centralized in one place rather than duplicated
- New developers clone one repository and get the full platform
- CI/CD pipelines must be scoped carefully to avoid unnecessary builds
- As the team grows, ownership boundaries must be enforced by convention
  rather than repository access controls
