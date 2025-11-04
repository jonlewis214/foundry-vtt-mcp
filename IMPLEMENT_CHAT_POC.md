# MCP Server: Add External WebSocket Broadcast for Chat Events

## Objective

Add a dedicated WebSocket server endpoint on **port 3001** that broadcasts real-time Foundry VTT chat events to external clients (specifically the GameMasterAgent). This is a thin bridge layer on top of existing infrastructure.

---

## Current State Analysis

### ✅ What Already Exists

The MCP Server has **complete** real-time chat event infrastructure:

1. **Chat Event Capture** - `packages/foundry-module/src/data-access.ts:4359`
   - Foundry hook `createChatMessage` captures all player chat messages
   - Emits events via WebSocket/WebRTC: `socketBridge.emitToServer('foundry-event', { type: 'chat-message-created', data: messageData })`
   - GM-only for security

2. **EventEmitter Architecture** - `packages/mcp-server/src/foundry-connector.ts:19`
   - `FoundryConnector extends EventEmitter`
   - Receives WebSocket messages and emits `foundry-event` to internal subscribers
   - Exposes `on()`, `off()`, `once()` methods via `FoundryClient` wrapper

3. **Chat Message Queue** - `packages/mcp-server/src/backend.ts:1310-1326`
   - Subscribes to `foundry-event` EventEmitter
   - Maintains 100-message circular buffer
   - Filters for `chat-message-created` events

4. **WebSocket Infrastructure** - `packages/mcp-server/src/foundry-connector.ts:101`
   - Full `ws` library (v8.14.0) integration
   - WebSocket server for Foundry connections on port 31415
   - HTTP server for WebRTC signaling on port 31416

5. **Message Format** (already standardized):
```typescript
{
  id: string;              // Foundry message ID
  speaker: string;         // Character name or "Unknown"
  content: string;         // HTML chat content
  timestamp: number;       // Unix timestamp (ms)
  isWhisper: boolean;      // True if whispered to specific users
  flavor?: string;         // Optional flavor text
}
```

### ❌ What's Missing

**External Client Broadcasting**: No mechanism for external applications (GameMasterAgent) to subscribe to the `foundry-event` stream. The existing infrastructure is internal-only.

**Solution**: Add a second WebSocket server on port 3001 that subscribes to the existing `foundry-event` EventEmitter and broadcasts to connected external clients.

---

## Implementation Plan

### File to Modify

**`packages/mcp-server/src/backend.ts`**

### Location in File

Add the new WebSocket server **immediately after** the existing `foundryClient.on('foundry-event', ...)` subscription (around line 1327, after the chat queue setup).

### Code to Add

```typescript
// ============================================================================
// External WebSocket Server for Chat Event Broadcasting (GameMasterAgent)
// ============================================================================

import { WebSocketServer as ExternalWSS, WebSocket as ExternalWS } from 'ws';
import { createServer as createExternalServer } from 'http';

// Create dedicated HTTP server for external event broadcasting
const externalEventServer = createExternalServer();
const externalEventWss = new ExternalWSS({ server: externalEventServer });
const externalEventClients = new Set<ExternalWS>();

// Track connected external clients
externalEventWss.on('connection', (ws: ExternalWS) => {
  logger.info('External event client connected (GameMasterAgent)');
  externalEventClients.add(ws);

  // Clean up on disconnect
  ws.on('close', () => {
    externalEventClients.delete(ws);
    logger.info('External event client disconnected', {
      remainingClients: externalEventClients.size
    });
  });

  ws.on('error', (error) => {
    externalEventClients.delete(ws);
    logger.warn('External event client error', { error: error.message });
  });

  // Send connection acknowledgment
  ws.send(JSON.stringify({
    type: 'connection-established',
    timestamp: Date.now(),
    message: 'Connected to Foundry MCP chat event stream'
  }));
});

// Start external WebSocket server on port 3001
const EXTERNAL_EVENT_PORT = 3001;
externalEventServer.listen(EXTERNAL_EVENT_PORT, () => {
  logger.info('External event WebSocket server listening', {
    port: EXTERNAL_EVENT_PORT,
    purpose: 'Broadcasting Foundry chat events to GameMasterAgent'
  });
});

// Subscribe to foundry-event and broadcast to external clients
foundryClient.on('foundry-event', (eventData: any) => {
  // Only broadcast chat message events to external clients
  if (eventData.type === 'chat-message-created') {
    const payload = JSON.stringify({
      type: 'foundry-event',
      data: eventData
    });

    // Broadcast to all connected external clients
    let successCount = 0;
    let failCount = 0;

    externalEventClients.forEach(client => {
      if (client.readyState === ExternalWS.OPEN) {
        try {
          client.send(payload);
          successCount++;
        } catch (error: any) {
          failCount++;
          logger.warn('Failed to send to external client', {
            error: error.message
          });
        }
      }
    });

    if (successCount > 0) {
      logger.debug('Broadcasted chat event to external clients', {
        speaker: eventData.data?.speaker,
        successCount,
        failCount,
        totalClients: externalEventClients.size
      });
    }
  }
});

// Cleanup on shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down external event server');
  externalEventClients.forEach(client => client.close());
  externalEventServer.close();
});

process.on('SIGINT', () => {
  logger.info('Shutting down external event server');
  externalEventClients.forEach(client => client.close());
  externalEventServer.close();
});

// ============================================================================
// End of External WebSocket Server
// ============================================================================
```

### Import Statements

The necessary imports are **already present** at the top of `backend.ts`:
- `ws` library is already imported for the main WebSocket functionality
- `http.createServer` is already imported

However, to avoid naming conflicts with existing imports, use **aliased imports** for the external server:

```typescript
// Add these aliases at the top of backend.ts (around line 1-20)
import { WebSocketServer as ExternalWSS, WebSocket as ExternalWS } from 'ws';
import { createServer as createExternalServer } from 'http';
```

**Note**: If the existing imports already use these exact names, the aliases in the code block above are already correct. If not, adjust the aliases to avoid conflicts.

---

## Docker Configuration

### File to Modify

**`docker-compose.yml`** (in project root)

### Change Required

Add port 3001 to the MCP service:

```yaml
mcp:
  # ... existing configuration ...
  ports:
    - "3000:3000"    # Existing MCP HTTP API
    - "3001:3001"    # NEW: External event broadcasting
    # ... other ports ...
```

---

## Testing

### 1. Rebuild MCP Server

```bash
cd McpServer
npm run build:server
```

### 2. Restart Docker Container

```bash
docker-compose restart mcp
```

### 3. Test with `wscat`

Install `wscat` if not already installed:
```bash
npm install -g wscat
```

Connect to the external event server:
```bash
wscat -c ws://localhost:3001
```

**Expected Output**:
```json
{"type":"connection-established","timestamp":1699999999999,"message":"Connected to Foundry MCP chat event stream"}
```

### 4. Trigger Chat Events

1. Open Foundry VTT at `http://localhost:30000`
2. Log in as GM
3. Send a chat message as a player character

**Expected `wscat` Output**:
```json
{
  "type": "foundry-event",
  "data": {
    "type": "chat-message-created",
    "data": {
      "id": "abc123",
      "speaker": "PlayerName",
      "content": "<p>Hello world!</p>",
      "timestamp": 1700000000000,
      "isWhisper": false
    }
  }
}
```

### 5. Verify Logs

Check MCP server logs:
```bash
docker-compose logs mcp
```

**Expected Log Entries**:
```
[INFO] External event WebSocket server listening port=3001
[INFO] External event client connected (GameMasterAgent)
[DEBUG] Broadcasted chat event to external clients speaker=PlayerName successCount=1
```

---

## Event Flow Diagram

```
Player Chat Message (Foundry UI)
    ↓
Foundry Hook: createChatMessage
    ↓
Socket Bridge: emitToServer('foundry-event')
    ↓
WebSocket/WebRTC → MCP Server (port 31415)
    ↓
FoundryConnector: handleMessage() emits 'foundry-event'
    ↓
EventEmitter Subscribers:
    ├─→ Chat Queue (backend.ts:1310) [EXISTING]
    └─→ External Broadcast (backend.ts:NEW) [NEW CODE]
         ↓
    External WebSocket Server (port 3001)
         ↓
    GameMasterAgent Clients (Python/JavaScript)
```

---

## Message Format Reference

### Outbound to External Clients

```typescript
{
  type: 'foundry-event',           // Wrapper type
  data: {
    type: 'chat-message-created',  // Event subtype
    data: {
      id: string,                  // Foundry message ID
      speaker: string,             // Character name
      content: string,             // HTML chat content
      timestamp: number,           // Unix ms
      isWhisper: boolean,          // Private message flag
      flavor?: string              // Optional flavor text
    }
  }
}
```

### Connection Acknowledgment

```typescript
{
  type: 'connection-established',
  timestamp: number,
  message: string
}
```

---

## Architecture Notes

### Why Port 3001?

- **Port 3000**: MCP HTTP API (existing)
- **Port 31415**: Foundry WebSocket connection (existing)
- **Port 31416**: WebRTC signaling (existing)
- **Port 3001**: NEW - External event broadcasting (simple, memorable, near 3000)

### Why Separate WebSocket Server?

- **Isolation**: Keeps GameMasterAgent communication separate from Foundry-MCP bridge
- **Security**: Easy to firewall/restrict access independently
- **Simplicity**: Dedicated broadcast-only server (no bidirectional protocol)
- **Scalability**: Multiple external clients can connect without affecting Foundry connection

### EventEmitter Subscription Pattern

The implementation uses Node.js EventEmitter's built-in pub/sub:
- **Single source**: `FoundryConnector` emits `foundry-event` once
- **Multiple subscribers**: Chat queue + external broadcast both listen
- **Decoupled**: Adding external broadcast doesn't modify existing chat queue logic
- **Memory efficient**: No message duplication (both subscribers reference same event data)

### Broadcast vs Queue

| Feature | Chat Queue (Existing) | External Broadcast (New) |
|---------|----------------------|--------------------------|
| **Purpose** | MCP resource `foundry://chat/stream` | Real-time push to GameMasterAgent |
| **Storage** | 100-message buffer | No storage (real-time only) |
| **Delivery** | Pull-based (client requests resource) | Push-based (WebSocket broadcast) |
| **Clients** | Claude Desktop via MCP protocol | External apps via raw WebSocket |
| **Latency** | Depends on polling/resource reads | Immediate (<50ms) |

---

## Troubleshooting

### Issue: "External event WebSocket server listening" not in logs

**Cause**: Code not executed during backend startup

**Solution**:
1. Verify code is added after line 1327 in `backend.ts`
2. Check for syntax errors: `npm run build:server`
3. Restart container: `docker-compose restart mcp`

### Issue: `wscat` connection refused

**Cause**: Port 3001 not exposed in Docker

**Solution**:
1. Verify `docker-compose.yml` has `"3001:3001"` in MCP ports
2. Restart containers: `docker-compose down && docker-compose up -d`
3. Check port mapping: `docker-compose ps`

### Issue: Connected but no messages received

**Cause**: Chat events not flowing from Foundry

**Solution**:
1. Verify Foundry MCP Bridge module is **enabled** in Foundry
2. Ensure you're logged in as **GM** (chat events are GM-only)
3. Check MCP logs for "Chat message queued" entries
4. Verify Foundry WebSocket connection: look for "Foundry connected" in logs

### Issue: Messages contain HTML

**Cause**: Foundry stores chat content as HTML

**Solution**: This is expected. GameMasterAgent should strip HTML tags when processing:
```python
from html import unescape
import re

def strip_html(html_content: str) -> str:
    text = re.sub('<[^<]+?>', '', html_content)
    return unescape(text)
```

---

## Success Criteria

✅ **MCP server starts** with log: `External event WebSocket server listening port=3001`

✅ **`wscat` connects** and receives: `{"type":"connection-established",...}`

✅ **Chat events broadcast** when player sends message in Foundry

✅ **Multiple clients supported**: Connect two `wscat` instances, both receive events

✅ **Graceful disconnect**: Closing `wscat` logs "External event client disconnected"

---

## Next Steps (Not Part of This Task)

Once this is implemented and tested:

1. **GameMasterAgent Integration**: Python WebSocket client connects to `ws://localhost:3001`
2. **Event Processing**: LangGraph agent processes incoming chat messages
3. **Response Loop**: Agent posts responses back via MCP HTTP API (`/tools/send-chat-message`)

This task **only** implements the external WebSocket broadcast. GameMasterAgent implementation is separate.

---

## Estimated Time

**30 minutes** (assuming familiarity with TypeScript and Docker)

- 10 min: Add code to `backend.ts`
- 5 min: Update `docker-compose.yml`
- 5 min: Build and restart
- 10 min: Testing with `wscat` and Foundry

---

## Code Style Notes

- Use `logger.info()` for important events (connections, server start)
- Use `logger.debug()` for frequent events (individual message broadcasts)
- Use `logger.warn()` for non-critical errors (client send failures)
- Follow existing naming conventions (`externalEventServer`, `externalEventClients`)
- Add clear comment blocks marking the new section
- Maintain consistent indentation (2 spaces, matching existing code)

---

## References

- **Existing Chat Queue**: `packages/mcp-server/src/backend.ts:1310-1326`
- **EventEmitter Pattern**: `packages/mcp-server/src/foundry-connector.ts:19`
- **WebSocket Library Docs**: https://github.com/websockets/ws
- **Foundry Hook Reference**: https://foundryvtt.com/api/classes/foundry.abstract.Document.html#createDocuments
