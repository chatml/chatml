# H3: Streaming Snapshot Recovery on WebSocket Reconnect

## Problem

When the WebSocket disconnects and reconnects while an agent is still streaming, the frontend loses all content received before the disconnect. The backend accumulates `assistant_text` in a Go variable (`currentAssistantMessage`) but only persists to the DB on `result`/`complete`. The frontend's streaming state is in-memory and gets cleared. Existing reconciliation only checks "is the process still running?" — if yes, it does nothing, leaving the UI empty.

## Solution: Backend Streaming Snapshots

The backend periodically snapshots the current streaming state to the DB. On reconnect, the frontend fetches the snapshot to restore its streaming view.

## Data Model

New column on `conversations` table:

```sql
ALTER TABLE conversations ADD COLUMN streaming_snapshot TEXT DEFAULT '';
```

Snapshot JSON structure:

```json
{
  "text": "full accumulated assistant text so far",
  "activeTools": [
    { "id": "tool_use_abc", "tool": "Bash", "startTime": 1706000001 }
  ],
  "thinking": "current thinking content if any",
  "isThinking": false,
  "planModeActive": false
}
```

Not included in snapshot (by design):
- **Segments/timeline** — purely a frontend rendering concern. The recovered text is displayed as a single block. New events after reconnect append normally.

## Backend Changes

### 1. Store Layer (`backend/store/`)

New methods on `SQLiteStore`:

```go
func (s *SQLiteStore) SetStreamingSnapshot(ctx context.Context, convID string, snapshot []byte) error
func (s *SQLiteStore) GetStreamingSnapshot(ctx context.Context, convID string) ([]byte, error)
func (s *SQLiteStore) ClearStreamingSnapshot(ctx context.Context, convID string) error
```

### 2. Output Handler (`backend/agent/manager.go`)

Expand `handleConversationOutput` to track tool and thinking state alongside text, with debounced snapshot flushing:

```go
const snapshotDebounceInterval = 500 * time.Millisecond
```

State tracked:
- `currentAssistantMessage` (string) — already exists
- `activeToolsMap` (map[string]activeToolEntry) — new, maintained on tool_start/tool_end
- `currentThinking` (string) — new, maintained on thinking_delta/thinking
- `isThinking` (bool) — new
- `snapshotDirty` (bool) — new, set true on any state change

Flush strategy (debounced, not fixed ticker):
- On any state-changing event: set `snapshotDirty = true`, reset a 500ms timer
- When timer fires (500ms after last event): if dirty, flush snapshot to DB
- On terminal events (`result`/`complete`/`error`): flush immediately, then clear snapshot
- On output handler exit (process died): persist remaining message + clear snapshot

### 3. New REST Endpoint

`GET /api/conversations/{convId}/streaming-snapshot`

Returns the stored snapshot JSON, or `null` if no active streaming snapshot exists.

### 4. Parser Types (`backend/agent/parser.go`)

New Go struct:

```go
type StreamingSnapshot struct {
    Text         string            `json:"text"`
    ActiveTools  []ActiveToolEntry `json:"activeTools"`
    Thinking     string            `json:"thinking,omitempty"`
    IsThinking   bool              `json:"isThinking"`
    PlanModeActive bool            `json:"planModeActive"`
}

type ActiveToolEntry struct {
    ID        string `json:"id"`
    Tool      string `json:"tool"`
    StartTime int64  `json:"startTime"`
}
```

## Frontend Changes

### 1. New API Function (`src/lib/api.ts`)

```typescript
export async function getStreamingSnapshot(convId: string): Promise<StreamingSnapshot | null>
```

### 2. Updated Reconciliation (`src/hooks/useWebSocket.ts`)

Updated `reconcileStreamingState()`:

```
For each conversation the frontend thinks is streaming:

  a) If NOT active on server (agent finished during disconnect):
     → Same as today: clear streaming state, reload messages from DB

  b) If STILL active on server:
     → Fetch GET /api/conversations/{convId}/streaming-snapshot
     → If snapshot has text:
        - Restore streamingState.text from snapshot.text
        - Create a single segment from the snapshot text
        - Restore activeTools from snapshot.activeTools
        - Restore thinking from snapshot.thinking
        - Keep isStreaming = true
        - Resume receiving WebSocket events normally
     → If snapshot is empty/null:
        - Reload messages from DB as safety net (covers the race
          where result was just persisted but process hasn't exited yet)
        - Keep isStreaming = true, let result/complete event finalize
```

## Edge Cases

### Agent finishes during disconnect
Process exits → removed from `convProcesses` → frontend takes "not active" path → reloads messages from DB. Works correctly with existing reconciliation.

### Agent finishes between snapshot-clear and process-exit
Frontend reconnects, sees process "active," fetches snapshot → empty. Fallback: reload messages from DB, which has the just-persisted final message.

### Agent crashes (SIGKILL, no result event)
`handleConversationOutput` exit path persists remaining `currentAssistantMessage` to DB (existing behavior, lines 349-358 of manager.go). Snapshot cleared on exit. Frontend takes "not active" path, reloads from DB.

### Duplicate text after reconnect
No overlap: the backend continues emitting NEW `assistant_text` events from where it left off. The frontend has the snapshot (up to 500ms stale) + new events. At most 500ms of text is missing (between last flush and disconnect). Acceptable trade-off.

## Files to Modify

| File | Changes |
|------|---------|
| `backend/store/sqlite.go` | Add streaming_snapshot column, Set/Get/Clear methods |
| `backend/agent/manager.go` | Expand handleConversationOutput with tool/thinking tracking + debounced flush |
| `backend/agent/parser.go` | Add StreamingSnapshot and ActiveToolEntry types |
| `backend/server/routes.go` | Add GET streaming-snapshot endpoint |
| `backend/server/handlers.go` | Add GetStreamingSnapshot handler |
| `src/lib/api.ts` | Add getStreamingSnapshot() function |
| `src/hooks/useWebSocket.ts` | Update reconcileStreamingState() with snapshot fetch + restore |
| `src/stores/appStore.ts` | Add restoreStreamingFromSnapshot() method |

## Related

- **CM-103**: Reliable delivery for critical events (H4) — separate issue for polling-based fallback when events are dropped while connected
- **M8**: Wait for ready event before first message — deferred, separate concern

## Testing

1. Start a conversation, let agent stream for a few seconds
2. Kill the WebSocket connection (browser DevTools → Network → offline)
3. Wait 2-3 seconds, re-enable network
4. Verify: accumulated text is restored, agent continues streaming normally
5. Edge case: disconnect and reconnect after agent finishes → verify messages reload correctly
