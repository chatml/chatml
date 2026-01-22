// UI timing constants
export const COPY_FEEDBACK_DURATION_MS = 2000;
export const TOAST_DURATION_MS = 2000;

// WebSocket constants
export const WEBSOCKET_RECONNECT_DELAY_MS = 3000;

// Health check constants
export const HEALTH_CHECK_MAX_RETRIES = 15;
export const HEALTH_CHECK_INITIAL_DELAY_MS = 300;
export const HEALTH_CHECK_REQUEST_TIMEOUT_MS = 5000;
export const HEALTH_CHECK_MAX_BACKOFF_MS = 5000;

// Update checker constants
export const UPDATE_CHECK_DELAY_MS = 3000;

// Sidecar restart delay
export const SIDECAR_RESTART_DELAY_MS = 1000;

// Git status polling interval
export const GIT_STATUS_POLL_INTERVAL_MS = 30000; // 30 seconds

// Custom event names (for cross-component communication)
export const ADD_WORKSPACE_REQUESTED_EVENT = 'add-workspace-requested';
