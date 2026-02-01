// UI timing constants
export const COPY_FEEDBACK_DURATION_MS = 2000;
export const TOAST_DURATION_MS = 2000;

// WebSocket constants
export const WEBSOCKET_RECONNECT_BASE_DELAY_MS = 1000;
export const WEBSOCKET_RECONNECT_MAX_DELAY_MS = 30000;
export const WEBSOCKET_RECONNECT_MAX_ATTEMPTS = 50;
export const WEBSOCKET_DISCONNECT_GRACE_MS = 5000;

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

// Feature flags (build-time)
/** Enable browser-style multi-tab navigation. Set to false to disable. */
export const ENABLE_BROWSER_TABS = true;
