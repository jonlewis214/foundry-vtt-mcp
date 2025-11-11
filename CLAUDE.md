# MCP Server Fork - Development Guide

> **Related Documentation:**
> - [README.md](./README.md) - Upstream project documentation (installation, features, usage)
> - [FORK_MODIFICATIONS.md](./FORK_MODIFICATIONS.md) - AGM-specific modifications to the fork

## Project Overview

This is a **fork** of [Foundry VTT MCP Bridge](https://github.com/adambdooley/foundry-vtt-mcp), modified for the **Autonomous Game Master (AGM)** project.

**Upstream Project**: Model Context Protocol (MCP) server that connects Foundry VTT with Claude Desktop for AI-powered campaign management. Supports D&D 5e and Pathfinder 2e systems, providing 25+ MCP tools for character management, compendium search, content creation, quest management, dice rolling, and AI map generation via ComfyUI.

**AGM Fork Additions**: Real-time chat event streaming via external WebSocket (port 3001) to enable autonomous AI game mastering. See [FORK_MODIFICATIONS.md](./FORK_MODIFICATIONS.md) for complete details.

## Architecture

The project uses a **monorepo workspace structure** with three main packages:

```
Claude Desktop ↔ MCP Protocol ↔ MCP Server ↔ WebSocket/WebRTC ↔ Foundry Module ↔ Foundry VTT
                                     ↓
                              ComfyUI Service
```

### Package Structure

- **`packages/mcp-server/`** - Node.js MCP server that communicates with Claude Desktop via stdio
  - Implements MCP protocol handlers for tools and resources
  - Manages WebSocket/WebRTC connections to Foundry
  - Spawns and controls ComfyUI backend process for map generation
  - Uses a wrapper/backend architecture: `index.ts` (wrapper) spawns `backend.ts` (actual MCP logic)
  - Bundled for distribution using esbuild

- **`packages/foundry-module/`** - Foundry VTT client-side module
  - Runs inside Foundry VTT browser environment
  - Provides WebSocket/WebRTC bridge to MCP server
  - Handles GM-only security restrictions
  - Manages enhanced creature index for fast searches
  - Controls ComfyUI integration for map uploads
  - Monitors chat messages and emits real-time events to MCP server

- **`shared/`** - Shared TypeScript types and schemas
  - Common interfaces (CharacterInfo, SceneInfo, CompendiumSearchResult, etc.)
  - Used by both MCP server and Foundry module for type safety
  - Must be built before other packages

- **`installer/`** - NSIS (Windows) and PKG/DMG (Mac) installer builders
  - Scripts download and bundle Node.js runtime, ComfyUI, and dependencies
  - Auto-configures Claude Desktop MCP settings

## Common Development Commands

### Building

```bash
# Build everything (shared first, then workspaces)
npm run build

# Build specific packages
npm run build:shared       # Build shared types (required first)
npm run build:server       # Build MCP server
npm run build:foundry      # Build Foundry module
npm run bundle:server      # Create bundled MCP server (single file with esbuild)
npm run build:release      # Complete release build (shared + server bundle + foundry)
```

### Development

```bash
# Watch mode for MCP server development
npm run dev

# Type checking (all workspaces)
npm run typecheck

# Linting
npm run lint
npm run lint:fix
```

### Testing

```bash
# Run all workspace tests
npm run test

# MCP server has vitest tests
npm run test --workspace=packages/mcp-server
npm run test:watch --workspace=packages/mcp-server
npm run test:coverage --workspace=packages/mcp-server
```

### Maintenance

```bash
# Clean build artifacts
npm run clean         # Remove dist folders in workspaces
npm run clean:all     # Also remove tsbuildinfo and logs

# Dependency auditing
npm run audit:deps     # Security vulnerabilities
npm run audit:unused   # Unused dependencies (knip)
npm run audit:circular # Circular dependencies (madge)

# Bundle size analysis
npm run size:analyze   # Analyze MCP server bundle size
```

### Installers

```bash
# Stage installer files (without downloading ComfyUI)
npm run installer:stage

# Build installers (requires platform-specific tools)
# Windows: Requires NSIS installed
# Mac: Requires pkgbuild/hdiutil (built-in on macOS)
cd installer
node build-nsis.js --version v0.5.5     # Windows NSIS installer
node build-mac-pkg.js                   # macOS PKG installer
node build-dmg.js                       # macOS DMG distribution
```

## TypeScript Configuration

The project uses **TypeScript Project References** for incremental builds:

- Base config: `tsconfig.json` at root
- Each package has its own `tsconfig.json`
- Path aliases defined:
  - `@shared/*` → `./shared/*`
  - `@foundry-module/*` → `./packages/foundry-module/*`
  - `@mcp-server/*` → `./packages/mcp-server/src/*`

**Important:** Always build `shared` package first before building other packages.

## Key Architecture Patterns

### MCP Server Architecture

The MCP server uses a **wrapper/backend split** (`index.ts` + `backend.ts`):

- **Wrapper (index.ts)**: Lightweight MCP protocol handler that communicates with Claude Desktop via stdio
  - Spawns `backend.ts` as a separate process
  - Proxies tool/resource requests to backend via local socket (port 31414)
  - Handles cleanup when Claude Desktop disconnects

- **Backend (backend.ts)**: Core MCP logic
  - Implements all MCP tools (character, compendium, scene, etc.)
  - Manages Foundry VTT connection via WebSocket/WebRTC
  - Controls ComfyUI process spawning and lifecycle
  - Uses file locking to ensure single instance
  - Subscribes to real-time Foundry events (chat messages, etc.)
  - Exposes MCP resources for accessing chat history and events

**Why this architecture?** Allows backend to persist across multiple Claude Desktop sessions and manage long-running processes (ComfyUI). The persistent backend also maintains event subscriptions and chat message queues.

### Connection Methods

The Foundry module supports two connection types:

1. **WebSocket** - For local network connections (localhost, LAN)
   - Direct socket.io connection from Foundry to MCP server

2. **WebRTC** - For remote connections (internet)
   - Peer-to-peer connection initiated through browser
   - Uses STUN/TURN for NAT traversal
   - Implemented via `werift` library in MCP server, browser WebRTC API in Foundry module

Connection type can be auto-detected or manually configured in Foundry settings.

### Security Model

- **GM-Only Access**: All MCP functionality restricted to Game Master users
  - Silent checks in Foundry module - non-GM users get no messages or access
  - Implemented in `packages/foundry-module/src/main.ts:33` and other entry points

- **Write Operation Toggle**: Settings allow restricting Claude to read-only access

### Enhanced Creature Index

The Foundry module builds a cached JSON index of all compendium creatures with rich metadata (CR, type, size, abilities, etc.) for instant searches. This is critical for performance as it avoids scanning hundreds of compendium packs on every search.

- Built automatically on first load if missing
- Stored in world directory: `worlds/{worldId}/enhanced-creature-index.json`
- Rebuild via settings UI or data access API

### Real-Time Chat Monitoring (AGM Fork Addition)

> **For complete implementation details and architecture flow, see [FORK_MODIFICATIONS.md](./FORK_MODIFICATIONS.md#2-real-time-chat-event-streaming).**

The MCP Bridge implements **event-driven chat monitoring** to enable reactive AI game mastering. This allows AI agents to respond to player messages in real-time.

#### Architecture Flow (Summary)

```
Player sends chat → Foundry createChatMessage hook → WebSocket event → EventEmitter → Chat queue → MCP resource
```

#### Implementation Details

**Foundry Module (Browser):**
- `setupChatEventBridge()` in `packages/foundry-module/src/data-access.ts:4359`
- Registers Foundry hook: `Hooks.on('createChatMessage', ...)`
- Extracts message data (id, speaker, content, timestamp, whisper status)
- Emits to MCP server: `socketBridge.emitToServer('foundry-event', { type: 'chat-message-created', data: messageData })`
- **Security**: GM-only emission (non-GM users cannot send events)
- **Timing**: Hook registered in `start()` function AFTER socketBridge creation (critical for proper reference)

**MCP Server (Node.js):**
- `FoundryConnector` extends `EventEmitter` (`packages/mcp-server/src/foundry-connector.ts:19`)
- Receives WebSocket message with `type: 'foundry-event'`
- Emits to backend subscribers: `this.emit('foundry-event', message.data)`
- `FoundryClient` exposes event methods: `on()`, `off()`, `once()` (`packages/mcp-server/src/foundry-client.ts:108-129`)

**Backend Chat Queue:**
- Chat message queue in `packages/mcp-server/src/backend.ts:1304`
- Stores up to 100 recent messages (FIFO)
- Event listener: `foundryClient.on('foundry-event', ...)` filters for `chat-message-created`
- Memory usage: ~50KB (100 messages × ~500 bytes)

**MCP Resource:**
- Resource URI: `foundry://chat/stream`
- MIME type: `application/x-ndjson` (newline-delimited JSON)
- Exposed via `list_resources` and `read_resource` handlers
- Returns all queued messages as NDJSON stream
- If Foundry disconnected: returns error with empty messages array

#### Usage from MCP Client

```typescript
// Claude Desktop or GameMasterAgent can read:
const chatResource = await mcp.readResource('foundry://chat/stream');
// Returns NDJSON:
// {"id":"msg1","speaker":"Alice","content":"I attack!","timestamp":1699999999999,"isWhisper":false}
// {"id":"msg2","speaker":"Bob","content":"I help!","timestamp":1700000000000,"isWhisper":false}
```

#### Message Format

```typescript
{
  id: string;              // Foundry message ID
  speaker: string;         // Character name or "Unknown"
  content: string;         // HTML chat content
  timestamp: number;       // Unix timestamp (ms)
  isWhisper: boolean;      // True if whispered to specific users
  flavor?: string;         // Optional flavor text (e.g., roll labels)
}
```

#### Important Implementation Notes

1. **Timing Bug Fix**: `setupChatEventBridge()` MUST be called AFTER `socketBridge` is created in `start()`, not in `ready()` handler
2. **EventEmitter Pattern**: Decouples WebSocket handling from chat processing
3. **Message Routing**: `foundry-event` messages exit early before ComfyUI handler (no conflicts)
4. **Memory Safety**: Queue limited to 100 messages to prevent unbounded growth
5. **Backward Compatibility**: All existing MCP tools unchanged; chat monitoring is additive

### Tool Organization

MCP tools are organized by domain in `packages/mcp-server/src/tools/`:
- `character.ts` - Character queries and stats
- `compendium.ts` - Search creatures, items, spells
- `scene.ts` - Scene information and token data
- `actor-creation.ts` - Create NPCs and actors
- `quest-creation.ts` - Journal entry and quest generation
- `dice-roll.ts` - Interactive roll requests to players
- `campaign-management.ts` - Multi-part quest tracking
- `ownership.ts` - Actor permission management
- `map-generation.ts` - ComfyUI integration for AI maps

Each tool file exports a class with `getTools()` method returning MCP tool definitions.

## Development Workflow

### Working on MCP Server

1. Build shared types: `npm run build:shared`
2. Start dev watcher: `npm run dev` (runs TypeScript in watch mode)
3. Test by running: `node packages/mcp-server/dist/index.js`
4. For Claude Desktop integration, configure `claude_desktop_config.json` to point to built file

### Working on Foundry Module (AGM Docker Setup)

> **AGM-specific workflow. For upstream development, see [README.md](./README.md#manual-installation).**

The Foundry module is **volume-mounted** into the Foundry VTT container, so changes automatically sync after building.

1. Build shared types: `npm run build:shared`
2. Build module: `npm run build:foundry`
3. Refresh Foundry VTT page in browser (F5) to load the updated module
4. No container restart needed - changes appear immediately

**Volume Mount:** `./packages/foundry-module/dist` → `/data/Data/modules/foundry-mcp-bridge` (configured in `../docker-compose.yml`)

**Note:** The first time you set this up, ensure the module is enabled in Foundry's module management settings.

See [FORK_MODIFICATIONS.md](./FORK_MODIFICATIONS.md#6-foundry-module-volume-mount) for Docker configuration details.

### Testing Full Integration

1. Build release: `npm run build:release`
2. Ensure Foundry VTT is running with world loaded
3. Configure Claude Desktop with MCP server path
4. Restart Claude Desktop
5. Enable Foundry MCP Bridge module in Foundry
6. Chat with Claude about your Foundry world

## Bundling and Distribution

The MCP server is bundled using **esbuild** for distribution:
- Bundles all dependencies into single `.cjs` file
- Target: Node.js 18+ CommonJS
- Bundled files: `dist/index.bundle.cjs` (wrapper) and `dist/backend.bundle.cjs` (backend)
- Installers use bundled versions to avoid npm install at user's end

## CI/CD

GitHub Actions workflows in `.github/workflows/`:

- **`build-complete-release.yml`** - Multi-platform release build
  - Builds Windows NSIS installer
  - Builds macOS PKG/DMG installer
  - Creates GitHub release with all artifacts
  - Updates Foundry VTT package registry
  - Triggered on version tags (e.g., `v0.5.5`)

Version is read from root `package.json` unless tag or manual input provided.

## Configuration Files

- **`claude_desktop_config.example.json`** - Example Claude Desktop MCP configuration
- **`packages/foundry-module/module.json`** - Foundry module manifest (version, compatibility, etc.)
- **`tsconfig.json`** - Root TypeScript configuration with project references

## Important Notes

- The project requires **Node.js 18+** (specified in all package.json engines fields)
- Foundry module targets **Foundry VTT v13**
- ComfyUI integration requires Python 3.11 and GPU with 8GB+ VRAM for map generation (not used in AGM)
- All communication between components uses strongly-typed interfaces from `shared/src/types.ts`
- The MCP server backend uses file locking (`os.tmpdir()/foundry-mcp-backend.lock`) to ensure only one instance runs
- Campaign and quest data is stored in Foundry journal entries with special flags for tracking

**AGM Fork-Specific:**
- **Chat monitoring is GM-only**: Only Game Master users emit chat events (security boundary)
- **Chat queue persists in backend**: Survives WebSocket reconnections but resets on backend restart
- **Port mapping**: 31414 (control), 31415 (Foundry WebSocket), 31416 (WebRTC signaling), **3001 (external WebSocket - AGM only)**
- **External WebSocket server** broadcasts chat events to GameMasterAgent - see [FORK_MODIFICATIONS.md](./FORK_MODIFICATIONS.md)
- **Docker deployment**: AGM runs containerized, not as Claude Desktop MCP server