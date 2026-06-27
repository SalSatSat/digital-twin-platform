# Digital Twin Platform

A real-time simulation and visualization platform for city-scale digital twin experiences. Built with a Rust ECS core compiled to WebAssembly, a Three.js + WebGPU renderer, and Go backend services.

Features:
- Real-time city-scale simulation via a Rust ECS engine compiled to WebAssembly
- WebGPU-first rendering with automatic WebGL fallback
- Plugin-based architecture for extensible simulation and visualization
- Realtime state synchronization via WebSocket
- Fully containerized development environment — no manual toolchain installation

### Screenshots

*Coming soon*

### Requirements

Hardware:
- WebGPU-capable GPU recommended (WebGL fallback supported)

Software:
- [Docker Engine](https://docs.docker.com/engine/install/) (WSL2 backend, no Docker Desktop required)
- [VSCode](https://code.visualstudio.com/) with the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension
- WSL2 with Ubuntu 22.04 or later

> ⚠️ The repository must live inside the WSL2 filesystem (e.g. `~/projects/`), NOT under `/mnt/c/`. Rust compilation across the WSL2/Windows filesystem boundary is unacceptably slow.

### Setup

1. Clone the repository inside your WSL2 filesystem:
```bash
   cd ~/projects
   git clone <repo-url> digital-twin-platform
   cd digital-twin-platform
```

2. Load toolchain versions into your shell (add this to your `~/.bashrc` to make it permanent):
```bash
   export $(cat .toolchain-versions | xargs)
```

3. Copy the environment file and configure as needed:
```bash
   cp .env.example .env
```

4. Open the project in VSCode:
```bash
   code .
```

5. When prompted, click **Reopen in Container**
   > First build takes several minutes — all toolchains are being installed and cached. Subsequent opens use the cached image and are fast.

6. Once inside the devcontainer, run first-time setup:
```bash
   make setup
```

7. Start the full development stack:
```bash
   make dev
```

**Available Commands**

Run `make help` inside the devcontainer for the full list.

| Command | Description |
|---|---|
| `make setup` | First-time dependency installation |
| `make dev` | Start the full development stack |
| `make dev-engine` | Watch and recompile the Rust WASM engine only |
| `make dev-client` | Start the frontend Vite dev server only |
| `make dev-api` | Start the Go API server only |
| `make dev-sync` | Start the Go sync server only |
| `make build` | Production build of all targets |
| `make test` | Run all tests across the project |
| `make lint` | Run all linters |
| `make fmt` | Format all code |
| `make clean` | Remove all build artifacts |

### Architecture

The Digital Twin Platform is built as a layered system where a Rust ECS core 
drives all entity state, compiled to WebAssembly so it runs in the browser. 
An Engine class owns the WASM runtime and exposes a clean API for ticking 
the world and reading entity state. A Renderer consumes that state each frame 
to drive a Three.js scene, and both are mounted and managed by a React 
application.

```
┌─────────────────────────────────────────────────────────────────────┐
│                       React App (client/app)                        │
│                            EngineView                               │
│                 creates and manages lifecycle of both               │
└──────────────────────┬──────────────────────┬───────────────────────┘
                       │ owns                 │ owns
         ┌─────────────▼─────────────┐ ┌──────▼──────────────────────┐
         │           Engine          │ │          Renderer            │
         │   Owns WASM EngineWorld   │ │    Three.js Scene            │
         │   tick()                  │ │    Camera                    │
         │   getPosition()           │ │    WebGL / WebGPU            │
         │   spawnDynamicObject()    │ │    Render loop               │
         └─────────────┬─────────────┘ └──────┬───────────────────────┘
                       │ ▲                     │ reads from Engine
                       │ └─────────────────────┘
                       │ wraps
┌──────────────────────▼──────────────────────────────────────────────┐
│                    WASM Bindings (engine/wasm)                       │
│                EngineWorld — JavaScript-facing API                   │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ wraps
┌──────────────────────▼──────────────────────────────────────────────┐
│                      ECS Core (engine/core)                          │
│           World · EntityFactory · Systems · Components               │
└─────────────────────────────────────────────────────────────────────┘
```

### Project Structure

    digital-twin-platform/
    ├── .devcontainer/
    │   ├── scripts/          # Toolchain installation scripts
    │   ├── devcontainer.json # VSCode devcontainer configuration
    │   └── Dockerfile        # Container definition for dev environment
    ├── client/
    │   ├── app/              # React frontend
    │   └── renderer/         # Three.js + WebGPU renderer
    ├── docker/               # Service Dockerfiles for production builds
    ├── docs/
    │   └── adr/              # Architecture Decision Records
    ├── engine/
    │   ├── core/             # Rust ECS runtime
    │   ├── plugins/          # Engine plugin traits
    │   └── wasm/             # WASM build target + JS bindings
    ├── scripts/              # Build, codegen, and developer utility scripts
    ├── server/
    │   ├── api/              # Go REST API
    │   └── sync/             # Go realtime sync server
    ├── shared/
    │   ├── proto/            # Protobuf schema definitions
    │   └── types/            # Shared type definitions
    ├── testing/
    │   ├── integration/      # Cross-service integration tests
    │   └── e2e/              # End-to-end tests
    ├── .env                  # Local environment variables (gitignored)
    ├── .env.example          # Environment variable template (commit this)
    ├── .gitignore
    ├── .toolchain-versions   # Pinned versions for all language toolchains
    ├── docker-compose.yml    # Runtime infrastructure services
    ├── Makefile              # Developer command vocabulary
    └── README.md

**Team Ownership**

| Directory | Owner | Responsibility |
|---|---|---|
| `engine/core` | Engine team | Rust ECS runtime |
| `engine/wasm` | Engine team | WASM bindings |
| `client/renderer` | Engine team | Three.js + WebGPU renderer |
| `client/app` | Web team | React frontend shell |
| `server/api` | Web team | Go REST API |
| `server/sync` | Web team | Go realtime sync |
| `shared/` | Both teams | Cross-team data contracts |

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| ECS Engine | Rust 1.95 + hecs 0.11 | Entity-component-system runtime |
| Math | glam 0.32 | Vec3, Quat, Mat4 primitives |
| WASM Bridge | wasm-bindgen + wasm-pack | Rust → JavaScript interop |
| Renderer | Three.js 0.177 | 3D scene, WebGL/WebGPU |
| Frontend | React 19 + TypeScript | Application shell |
| Build Tool | Vite 8 | Frontend dev server + bundler |
| Package Manager | pnpm 11 | Monorepo workspace management |
| API Server | Go 1.26 | REST API (future) |
| Sync Server | Go 1.26 + WebSocket | Realtime state sync (future) |
| Database | PostgreSQL 17 | Persistent storage (future) |
| Realtime Cache | Redis 7 | Ephemeral state (future) |
| Dev Environment | Docker + devcontainer | Reproducible toolchain |

### Team

- Muhammad Salihin Bin Zaol-kefli: salsatsat@gmail.com

### Documentation

- Architecture Decision Records: [`docs/adr/`](docs/adr/)

### Guidelines

- [Developer Guidelines](docs/adr/)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
- [Improving this README](https://www.makeareadme.com)

### Contributing

1. Clone this repo inside your WSL2 filesystem
2. Check out the `dev` branch
3. Reopen in devcontainer when prompted by VSCode
4. Run `make setup` on first use
5. Make changes on the `dev` branch
6. Update the changelog
7. Create a Pull Request
   1. From `dev` to `main`
8. Changes will be reviewed and merged into `main` when ready for release

### License

*To be determined*

### Third Party Licenses

| Library | License |
|---|---|
| [Rust](https://www.rust-lang.org/) | MIT / Apache 2.0 |
| [wasm-pack](https://rustwasm.github.io/wasm-pack/) | MIT / Apache 2.0 |
| [Three.js](https://threejs.org/) | MIT |
| [React](https://react.dev/) | MIT |
| [Go](https://go.dev/) | BSD 3-Clause |
| [PostgreSQL](https://www.postgresql.org/) | PostgreSQL License |
| [Redis](https://redis.io/) | RSALv2 / SSPLv1 |

### Roadmap

**Completed**

| Phase | Description |
|---|---|
| Phase 1 | Project scaffold, devcontainer, Makefile, Docker Compose |
| Phase 2 | Rust ECS core — World, Components, Systems, EntityFactory |
| Phase 3 | WASM boundary — EngineWorld, wasm-bindgen, browser verified |
| Phase 4 | First render — Three.js, React, entity driven by Rust ECS |
| Phase 5 | Separate ECS ownership from rendering | Phase 4 |

**Upcoming**

| Phase | Description | Depends On |
|---|---|---|
| Phase 6 | WebGPU path with WebGL fallback | Phase 5 |
| Phase 7 | Bundle refactor — EntityFactory → generic Bundle trait | Phase 5 |
| Phase 8 | Multiple entities | Phase 7 |
| Phase 9 | Multiple camera support | Phase 8 |
| Phase 10 | Basic scene — Scene Camera, Runtime Camera, lighting | Phase 9 |
| Phase 11 | Camera controls — Unity-editor-style navigation | Phase 10 |
| Phase 12 | Entity hierarchy — parent/child relationships | Phase 8 |
| Phase 13 | GLB model loading at runtime | Phase 12 |
| Phase 14 | Event bus — OnEntitySelected and other platform events | Phase 12 |
| Phase 15 | Runtime editor — UI, Hierarchy panel, Inspector | Phase 13, 14 |
| Phase 16 | Debug metrics — FPS, entity count, render stats | Phase 15 |
| Phase 17 | Go backend — persistence and realtime sync | Phase 15 |

> This roadmap is a living document. New phases may be added as requirements evolve.
