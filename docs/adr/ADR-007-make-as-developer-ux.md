# ADR-007: Make as Developer UX

## Status
Accepted

## Date
2026-06-06

## Context
The platform has three language toolchains, each with its own build and test
commands — cargo for Rust, go for Go, and pnpm for Node.js. Without a unified
interface, developers need to know which tool to use for which part of the
codebase, and CI pipelines diverge from local development workflows.

## Decision
We use a single Makefile at the repository root as the canonical interface
for all developer operations. All commands follow the pattern make <target>
regardless of which language or service is involved.

## Reasoning
The Makefile is not a build system replacement — it is a vocabulary layer.
Each target delegates to the appropriate language-native tooling internally.
The benefit is that make dev, make test, and make build mean the same thing
regardless of which part of the codebase is involved. CI pipelines use the
same commands as local development, eliminating drift between environments.
New developers have a single place to discover available operations via
make help. The self-documenting help target, which reads comments from the
Makefile itself, ensures the command list stays accurate without a separate
maintenance burden.

## Consequences
- Every developer operation is discoverable via make help
- CI pipelines and local development use identical commands
- Adding a new service or package requires adding corresponding make targets
- The Makefile must be kept in sync with the actual project structure
- Developers unfamiliar with Make need to learn its basic conventions,
  particularly the tab indentation requirement for recipe lines
