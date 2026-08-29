# =============================================================================
# Digital Twin Platform -- Makefile
#
# This is the single command vocabulary for the entire project.
# All commands are intended to be run inside the devcontainer.
#
# Usage:
#   make <target>
#
# Run `make help` to see all available commands.
# =============================================================================

# Load toolchain versions from .toolchain-versions
# The := operator evaluates immediately, not lazily
include .toolchain-versions
export

# --- Configuration -----------------------------------------------------------
# These variables define where each part of the project lives.
# If the structure ever changes, update here -- not scattered across targets.
ENGINE_DIR   := engine
CLIENT_DIR   := client
SERVER_DIR   := server
API_DIR      := server/api
SYNC_DIR     := server/sync

# --- Help --------------------------------------------------------------------
# This target reads comments starting with ## and prints them as help text.
# The pattern: add ## before any target to document it automatically.
.PHONY: help
help: ## Show this help message
	@awk 'BEGIN {FS = ":.*##"}; /^[a-zA-Z_-]+:.*##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# --- Setup -------------------------------------------------------------------
.PHONY: setup
setup: ## First-time setup -- install all dependencies
	@echo "-> Setting up engine dependencies..."
	cd $(ENGINE_DIR) && cargo fetch
	@echo "-> Setting up client dependencies..."
	pnpm install
	@echo "-> Setting up server dependencies..."
	cd $(API_DIR) && go mod download
	cd $(SYNC_DIR) && go mod download
	@echo "Done. Run 'make dev' to start the full stack."

# --- Development -------------------------------------------------------------
.PHONY: dev
dev: ## Start the full local development stack
	@echo "-> Starting full development stack..."
	@$(MAKE) -j4 dev-engine dev-client dev-api dev-sync

.PHONY: dev-engine
dev-engine: ## Watch and recompile the Rust WASM engine on changes
	@echo "-> Starting engine watcher..."
	cd $(ENGINE_DIR) && cargo watch -i .gitignore -i "*.md" -s "cargo build"

.PHONY: dev-client
dev-client: ## Start the frontend Vite dev server
	@echo "-> Starting frontend dev server..."
	cd $(CLIENT_DIR)/app && pnpm dev

.PHONY: dev-api
dev-api: ## Start the Go API server with hot reload
	@echo "-> Starting API server..."
	cd $(API_DIR) && go run .

.PHONY: dev-sync
dev-sync: ## Start the Go sync server with hot reload
	@echo "-> Starting sync server..."
	cd $(SYNC_DIR) && go run .

# --- Build -------------------------------------------------------------------
.PHONY: build
build: ## Production build of all targets
	@$(MAKE) build-engine
	@$(MAKE) build-client
	@$(MAKE) build-server

.PHONY: build-engine
build-engine: ## Compile Rust ECS to WASM (production)
	@echo "-> Building engine..."
	cd $(ENGINE_DIR)/wasm && wasm-pack build --target web --out-dir pkg
	@echo "-> Syncing WASM binary to client..."
	pnpm install --force

.PHONY: build-wasm
build-wasm: ## Rebuild WASM and sync binary to client packages (development)
	@echo "-> Building WASM..."
	cd $(ENGINE_DIR)/wasm && wasm-pack build --target web --out-dir pkg
	@echo "-> Syncing WASM package..."
	rm -f client/renderer/node_modules/dt-engine-wasm/dt_engine_wasm_bg.wasm
	cp $(ENGINE_DIR)/wasm/pkg/dt_engine_wasm_bg.wasm client/renderer/node_modules/dt-engine-wasm/dt_engine_wasm_bg.wasm
	rm -f client/renderer/node_modules/dt-engine-wasm/dt_engine_wasm.js
	cp $(ENGINE_DIR)/wasm/pkg/dt_engine_wasm.js client/renderer/node_modules/dt-engine-wasm/dt_engine_wasm.js
	rm -f client/renderer/node_modules/dt-engine-wasm/dt_engine_wasm.d.ts
	cp $(ENGINE_DIR)/wasm/pkg/dt_engine_wasm.d.ts client/renderer/node_modules/dt-engine-wasm/dt_engine_wasm.d.ts
	@echo "-> Clearing Vite dependency cache (stale WASM binding cache)..."
	rm -rf $(CLIENT_DIR)/app/node_modules/.vite
	@echo "Done. Restart the dev server and hard refresh the browser."

.PHONY: build-client
build-client: ## Build the frontend for production
	@echo "-> Building client..."
	cd $(CLIENT_DIR)/app && pnpm build

.PHONY: build-server
build-server: ## Build Go binaries for production
	@echo "-> Building API server..."
	cd $(API_DIR) && go build -o bin/api .
	@echo "-> Building sync server..."
	cd $(SYNC_DIR) && go build -o bin/sync .

# --- Testing -----------------------------------------------------------------
.PHONY: test
test: ## Run all tests across the entire project
	@$(MAKE) test-engine
	@$(MAKE) test-client
	@$(MAKE) test-server

.PHONY: test-engine
test-engine: ## Run Rust engine tests
	@echo "-> Testing engine..."
	cd $(ENGINE_DIR) && cargo test

.PHONY: test-client
test-client: ## Run frontend tests
	@echo "-> Testing client..."
	cd $(CLIENT_DIR)/app && pnpm test

.PHONY: test-server
test-server: ## Run Go server tests
	@echo "-> Testing API server..."
	cd $(API_DIR) && go test ./...
	@echo "-> Testing sync server..."
	cd $(SYNC_DIR) && go test ./...

# --- Code quality ------------------------------------------------------------
.PHONY: lint
lint: ## Run all linters and type checks
	@$(MAKE) lint-engine
	@$(MAKE) lint-client
	@$(MAKE) typecheck-client
	@$(MAKE) lint-server

.PHONY: lint-engine
lint-engine: ## Lint Rust code with clippy
	cd $(ENGINE_DIR) && cargo clippy -- -D warnings

.PHONY: lint-client
lint-client: ## Lint frontend TypeScript code
	cd $(CLIENT_DIR)/app && pnpm lint
.PHONY: typecheck-client
typecheck-client: ## Type-check the frontend (deletes stale .tsbuildinfo first -- see ADR-025)
	@echo "-> Type-checking client..."
	cd $(CLIENT_DIR)/app && find . -name "*.tsbuildinfo" -delete && npx tsc --build --noEmit

.PHONY: lint-server
lint-server: ## Lint Go code
	cd $(API_DIR) && go vet ./...
	cd $(SYNC_DIR) && go vet ./...

.PHONY: fmt
fmt: ## Format all code
	cd $(ENGINE_DIR) && cargo fmt
	cd $(CLIENT_DIR)/app && pnpm format
	cd $(API_DIR) && go fmt ./...
	cd $(SYNC_DIR) && go fmt ./...

# --- Cleanup -----------------------------------------------------------------
.PHONY: clean
clean: ## Remove all build artifacts
	@echo "-> Cleaning engine artifacts..."
	cd $(ENGINE_DIR) && cargo clean
	@echo "-> Cleaning client artifacts..."
	rm -rf $(CLIENT_DIR)/app/dist
	@echo "-> Cleaning server binaries..."
	rm -rf $(API_DIR)/bin $(SYNC_DIR)/bin
	@echo "Done."
