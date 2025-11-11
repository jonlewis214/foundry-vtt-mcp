# Fork Modifications for AGM Project

This document describes modifications made to the [Foundry VTT MCP Bridge](https://github.com/adambdooley/foundry-vtt-mcp) project to support the **Autonomous Game Master (AGM)** use case.

> **Upstream Project**: [adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp)
> **Fork Purpose**: Enable autonomous AI game mastering through real-time chat monitoring and event streaming

---

## Overview of Changes

The original MCP Bridge enables **Claude Desktop** to interact with Foundry VTT through MCP tools (character queries, compendium searches, content creation, etc.). However, it does not support **autonomous AI agents** that need to:

1. **Listen** to real-time game events (especially chat messages)
2. **React** autonomously without manual Claude Desktop prompts
3. **Run independently** from Claude Desktop (as a Python service)

Our fork adds an **event-driven architecture** to broadcast Foundry events to external clients (GameMasterAgent) via WebSocket.

---

## Key Modifications

### 1. External WebSocket Server (Port 3001)

**What**: Added a WebSocket server that broadcasts Foundry events to external clients.

**Why**: Allows GameMasterAgent (Python service) to receive real-time chat messages without relying on Claude Desktop.

**Implementation**:
- **File**: `packages/mcp-server/src/backend.ts:1332-1429`
- **Port**: 3001 (exposed in Docker container)
- **Protocol**: WebSocket (using `ws` library)
- **Broadcast**: Sends chat events to all connected external clients
- **Security**: Only broadcasts events from GM-authenticated Foundry connections

**Usage**:
```typescript
// External client connects to ws://localhost:3001
// Receives events:
{
  "type": "chat-message-created",
  "data": {
    "id": "msg123",
    "speaker": "Alice",
    "content": "I attack the dragon!",
    "timestamp": 1699999999999,
    "isWhisper": false
  }
}
```

---

### 2. Real-Time Chat Event Streaming

**What**: Foundry module hooks into `createChatMessage` and emits events to MCP server.

**Why**: Enables AI to monitor player chat in real-time for autonomous game mastering.

**Implementation**:

**Foundry Module** (`packages/foundry-module/src/data-access.ts:4359`):
```typescript
export function setupChatEventBridge(socketBridge: SocketBridge) {
  Hooks.on('createChatMessage', (message: ChatMessage) => {
    // Extract message data
    const messageData = {
      id: message.id,
      speaker: message.speaker?.alias || 'Unknown',
      content: message.content,
      timestamp: message.timestamp,
      isWhisper: message.whisper?.length > 0
    };

    // Emit to MCP server
    socketBridge.emitToServer('foundry-event', {
      type: 'chat-message-created',
      data: messageData
    });
  });
}
```

**MCP Server** (`packages/mcp-server/src/backend.ts:1304`):
```typescript
// Chat message queue (last 100 messages)
const chatMessageQueue: ChatMessage[] = [];

// Listen for chat events
foundryClient.on('foundry-event', (event: FoundryEvent) => {
  if (event.type === 'chat-message-created') {
    chatMessageQueue.push(event.data);
    if (chatMessageQueue.length > 100) {
      chatMessageQueue.shift(); // FIFO queue
    }

    // Broadcast to external WebSocket clients
    externalClients.forEach(client => {
      client.send(JSON.stringify(event));
    });
  }
});
```

**Security**: Only GM users can emit chat events (enforced in Foundry module).

---

### 3. Chat Event Queue

**What**: MCP server maintains a queue of the last 100 chat messages.

**Why**:
- Allows reconnecting clients to catch up on recent messages
- Provides historical context for AI decision-making
- Memory-bounded (prevents unbounded growth)

**Implementation**:
- **File**: `packages/mcp-server/src/backend.ts:1304`
- **Size**: 100 messages (FIFO)
- **Memory**: ~50KB (100 messages × ~500 bytes)
- **Persistence**: In-memory only (resets on backend restart)

**Exposed via MCP Resource**:
```typescript
// Resource URI: foundry://chat/stream
// MIME type: application/x-ndjson
const chatResource = await mcp.readResource('foundry://chat/stream');
```

---

### 4. EventEmitter Integration

**What**: `FoundryConnector` extends Node.js `EventEmitter` for pub/sub pattern.

**Why**: Decouples WebSocket message handling from event processing, allowing multiple listeners.

**Implementation**:
- **File**: `packages/mcp-server/src/foundry-connector.ts:19`
- **Pattern**: `this.emit('foundry-event', eventData)`
- **Listeners**: Backend subscribes via `foundryClient.on('foundry-event', handler)`

**Benefits**:
- Clean separation of concerns
- Easy to add new event types (token movement, scene changes, etc.)
- No conflicts with existing MCP tool handlers

---

### 5. Docker Integration

**What**: Modified for containerized deployment in AGM project.

**Why**: AGM runs entirely in Docker (Foundry VTT + MCP Server + GameMasterAgent).

**Changes**:

**Dockerfile** (`packages/mcp-server/Dockerfile`):
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY packages/mcp-server/dist ./dist
COPY packages/shared ./shared
EXPOSE 31414 31415 31416 3001
CMD ["node", "dist/backend.js"]
```

**docker-compose.yml** (at repo root):
```yaml
services:
  mcp-server:
    build:
      context: ./McpServer
      dockerfile: packages/mcp-server/Dockerfile
    ports:
      - "31414:31414"  # Control channel
      - "31415:31415"  # Foundry connector
      - "31416:31416"  # WebRTC signaling
      - "3001:3001"    # External WebSocket (AGM-specific)
    volumes:
      - ./McpServer/packages/foundry-module/dist:/foundry-module
```

**Volume Mount**: Foundry module is volume-mounted into Foundry VTT container for hot-reloading during development.

---

### 6. Foundry Module Volume Mount

**What**: Foundry module `dist/` folder is volume-mounted into Foundry VTT container.

**Why**: Enables rapid development without container rebuilds.

**Configuration**:
```yaml
# In docker-compose.yml
services:
  foundry:
    volumes:
      - ./McpServer/packages/foundry-module/dist:/data/Data/modules/foundry-mcp-bridge
```

**Workflow**:
1. Make changes to Foundry module code
2. Run `npm run build:foundry`
3. Refresh browser (F5) - changes appear immediately
4. No container restart needed

---

## Port Mapping

| Port  | Original Use | AGM Addition | Purpose |
|-------|--------------|--------------|---------|
| 31414 | Control channel | (unchanged) | MCP wrapper ↔ backend communication |
| 31415 | Foundry connector | (unchanged) | WebSocket connection to Foundry module |
| 31416 | WebRTC signaling | (unchanged) | Remote connections via WebRTC |
| **3001** | **N/A** | **NEW** | **External WebSocket for chat events** |

---

## Modified Files Summary

### Added Files
- `packages/mcp-server/Dockerfile` - Container build configuration
- `FORK_MODIFICATIONS.md` - This document

### Modified Files
- `packages/mcp-server/src/backend.ts:1304` - Chat message queue
- `packages/mcp-server/src/backend.ts:1332-1429` - External WebSocket server
- `packages/foundry-module/src/data-access.ts:4359` - `setupChatEventBridge()` function
- `packages/foundry-module/src/main.ts` - Call to `setupChatEventBridge()` in `start()`
- `packages/mcp-server/src/foundry-connector.ts:19` - EventEmitter extension
- `packages/mcp-server/src/foundry-client.ts:108-129` - Event listener methods

### Configuration Files
- `docker-compose.yml` (at repo root) - Container orchestration
- `.env` - Environment variables for containerized deployment

---

## Upstream Compatibility

These modifications are **additive** and maintain compatibility with the original project:

✅ **All original MCP tools work unchanged**
✅ **Claude Desktop integration still works**
✅ **No breaking changes to existing APIs**
✅ **Chat monitoring is opt-in** (only active when external clients connect)
✅ **Can merge upstream updates** with minimal conflicts

The fork can be used as:
1. **Drop-in replacement** for the original project (Claude Desktop use case)
2. **Event-driven bridge** for autonomous AI agents (AGM use case)

---

## Message Flow Diagram

```
Player types in Foundry chat
         ↓
Foundry createChatMessage hook
         ↓
Foundry Module: setupChatEventBridge()
         ↓
WebSocket: socketBridge.emitToServer('foundry-event', ...)
         ↓
MCP Server: FoundryConnector receives WebSocket message
         ↓
EventEmitter: this.emit('foundry-event', event)
         ↓
Backend: foundryClient.on('foundry-event', handler)
         ↓
   ┌────┴────┐
   ↓         ↓
Chat Queue   External WebSocket (port 3001)
(MCP Resource)    ↓
            GameMasterAgent (Python)
```

---

## Testing the Modifications

### Test Chat Event Broadcasting

**Terminal 1** (Run simple WebSocket client):
```bash
# From repo root
python test_chat_websocket.py
```

**Browser** (Foundry VTT):
- Send a chat message in Foundry
- Message should appear in terminal output

**Expected Output**:
```json
{
  "type": "chat-message-created",
  "data": {
    "id": "abc123",
    "speaker": "TestChar",
    "content": "Hello world!",
    "timestamp": 1699999999999,
    "isWhisper": false
  }
}
```

### Test MCP Resource

**Using GameMasterAgent**:
```python
from game_master_agent.integration.client import MCPClient

async with MCPClient() as client:
    # Read chat stream resource
    chat_stream = await client.read_resource('foundry://chat/stream')
    print(chat_stream)  # NDJSON with recent messages
```

---

## Future Enhancements (Not Yet Implemented)

Potential additions to the event system:

- **Token movement events** - Track character positions for tactical AI
- **Combat state changes** - React to initiative, damage, conditions
- **Scene transitions** - Adapt narration when scenes change
- **Item usage events** - Respond to spell casting, item use
- **Journal updates** - Track quest progression

These would follow the same EventEmitter pattern established for chat monitoring.

---

## Maintenance Notes

### Syncing with Upstream

To merge upstream changes:

```bash
# Add upstream remote (one time)
git remote add upstream https://github.com/adambdooley/foundry-vtt-mcp.git

# Fetch and merge
git fetch upstream
git merge upstream/main

# Resolve conflicts in modified files (backend.ts, data-access.ts, etc.)
```

**Expected conflicts**: `backend.ts`, `data-access.ts`, `main.ts` (chat monitoring code)

### Version Tracking

- **Upstream version**: Check `packages/mcp-server/package.json` version field
- **Fork version**: Track in AGM repo root `package.json` or separate file
- **Recommendation**: Tag fork versions as `v{upstream}-agm{n}` (e.g., `v0.5.5-agm1`)

---

## References

- **Upstream Project**: https://github.com/adambdooley/foundry-vtt-mcp
- **MCP Protocol**: https://modelcontextprotocol.io/
- **AGM Project**: See `../ARCHITECTURE.md` and `../CLAUDE.md`
- **Development Guide**: See `CLAUDE.md` in this directory

---

**Last Updated**: 2025-11-11
**Fork Base**: v0.5.5 (adambdooley/foundry-vtt-mcp)
**AGM Version**: In development
