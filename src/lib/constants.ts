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

// Shared Tailwind prose classes for markdown content rendering
export const PROSE_CLASSES = 'prose prose-base dark:prose-invert max-w-none text-base leading-relaxed prose-p:my-3 prose-pre:my-2 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/50 prose-pre:text-xs prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-headings:font-semibold prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-ul:marker:text-primary prose-ol:marker:text-primary';

// Compact prose classes for inline comment threads and smaller markdown areas
export const PROSE_CLASSES_COMPACT = 'prose prose-sm dark:prose-invert max-w-none text-sm leading-normal prose-p:my-1 prose-pre:my-1 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/50 prose-pre:text-xs prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-headings:font-semibold prose-headings:my-1.5 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-ul:marker:text-primary prose-ol:marker:text-primary';

// Tool rendering constants
export const TOOL_TARGET_TRUNCATE = 60;
export const TOOL_COMMAND_TRUNCATE = 80;

// Feature flags (build-time)
/** Enable browser-style multi-tab navigation. Set to false to disable. */
export const ENABLE_BROWSER_TABS = true;
