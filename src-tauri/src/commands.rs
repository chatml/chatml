use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use tauri::{Manager, State};

use crate::error::AppResult;
use crate::sidecar;
use crate::state::AppState;
use crate::watcher;

/// Mark the app as ready (called from frontend when connected)
#[tauri::command]
pub fn mark_app_ready(state: State<'_, Arc<AppState>>) {
    state.mark_ready();
}

/// Restart the sidecar process (async to avoid blocking)
#[tauri::command]
pub async fn restart_sidecar(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
) -> AppResult<()> {
    sidecar::restart_sidecar_async(app, Arc::clone(&state)).await
}

/// Set minimize-to-tray preference
#[tauri::command]
pub fn set_minimize_to_tray(enabled: bool, state: State<'_, Arc<AppState>>) {
    state.set_minimize_to_tray(enabled);
}

/// Check if window is visible
#[tauri::command]
pub fn is_window_visible(app: tauri::AppHandle) -> bool {
    if let Some(window) = app.get_webview_window("main") {
        window.is_visible().unwrap_or(false)
    } else {
        false
    }
}

/// Start watching a workspace directory for file changes
#[tauri::command]
pub fn watch_workspace(
    app: tauri::AppHandle,
    workspace_id: String,
    workspace_path: String,
) -> AppResult<()> {
    watcher::watch_workspace(&app, workspace_id, workspace_path)
}

/// Stop watching a workspace directory
#[tauri::command]
pub fn unwatch_workspace(workspace_id: String) -> AppResult<()> {
    watcher::unwatch_workspace(&workspace_id)
}

/// Get the authentication token for backend API calls
#[tauri::command]
pub fn get_auth_token(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    state
        .get_auth_token()
        .ok_or_else(|| "Auth token not available".to_string())
}

/// Get the port the backend sidecar is running on
#[tauri::command]
pub fn get_backend_port(state: State<'_, Arc<AppState>>) -> Result<u16, String> {
    state
        .get_sidecar_port()
        .ok_or_else(|| "Backend port not available yet".to_string())
}

/// Get and consume any pending OAuth callback URL
#[tauri::command]
pub fn get_pending_oauth_callback(state: State<'_, Arc<AppState>>) -> Option<String> {
    state.take_pending_oauth_callback()
}

// ============================================================================
// File attachment commands
// ============================================================================

/// Metadata about a file
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub size: u64,
    pub is_directory: bool,
    pub is_file: bool,
}

/// Image dimensions
#[derive(Debug, Serialize)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
}

/// Read file metadata (size, type)
#[tauri::command]
pub fn read_file_metadata(path: String) -> Result<FileMetadata, String> {
    let path = Path::new(&path);
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to read metadata: {}", e))?;

    Ok(FileMetadata {
        size: metadata.len(),
        is_directory: metadata.is_dir(),
        is_file: metadata.is_file(),
    })
}

/// Read file content as base64
#[tauri::command]
pub fn read_file_as_base64(path: String, max_size: Option<u64>) -> Result<String, String> {
    let path_ref = Path::new(&path);

    // Check file size first
    let metadata = fs::metadata(path_ref).map_err(|e| format!("Failed to read metadata: {}", e))?;

    if metadata.is_dir() {
        return Err("Cannot read directory as base64".to_string());
    }

    // Default max size is 10MB
    let max_size = max_size.unwrap_or(10 * 1024 * 1024);
    if metadata.len() > max_size {
        return Err(format!(
            "File too large: {} bytes (max {} bytes)",
            metadata.len(),
            max_size
        ));
    }

    let content = fs::read(path_ref).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(BASE64.encode(&content))
}

/// Get image dimensions (width, height)
#[tauri::command]
pub fn get_image_dimensions(path: String) -> Result<ImageDimensions, String> {
    let path_ref = Path::new(&path);

    // Read first few bytes to detect format
    let file = fs::File::open(path_ref).map_err(|e| format!("Failed to open file: {}", e))?;

    // Use image crate if available, otherwise try simple detection
    // For now, use a simple approach that reads file header
    let mut reader = BufReader::new(file);
    let mut header = [0u8; 32];
    std::io::Read::read(&mut reader, &mut header)
        .map_err(|e| format!("Failed to read file header: {}", e))?;

    // PNG: bytes 16-23 contain width (4 bytes BE) and height (4 bytes BE) in IHDR chunk
    if header.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        let width = u32::from_be_bytes([header[16], header[17], header[18], header[19]]);
        let height = u32::from_be_bytes([header[20], header[21], header[22], header[23]]);
        return Ok(ImageDimensions { width, height });
    }

    // JPEG: Need to parse markers to find SOF
    if header.starts_with(&[0xFF, 0xD8]) {
        // Simple JPEG parsing - look for SOF marker
        let content = fs::read(path_ref).map_err(|e| format!("Failed to read file: {}", e))?;
        let mut i = 2;
        // Limit iterations to prevent scanning through very large malformed files
        // SOF marker should appear within first 64KB for well-formed JPEGs
        let max_scan = content.len().min(65536);
        while i < max_scan.saturating_sub(10) {
            if content[i] == 0xFF {
                let marker = content[i + 1];
                // SOF0, SOF1, SOF2 markers contain dimensions
                if marker == 0xC0 || marker == 0xC1 || marker == 0xC2 {
                    let height = u16::from_be_bytes([content[i + 5], content[i + 6]]) as u32;
                    let width = u16::from_be_bytes([content[i + 7], content[i + 8]]) as u32;
                    return Ok(ImageDimensions { width, height });
                }
                // Skip to next marker
                if marker != 0xD8 && marker != 0xD9 && marker != 0x01 {
                    let len = u16::from_be_bytes([content[i + 2], content[i + 3]]) as usize;
                    i += 2 + len;
                } else {
                    i += 2;
                }
            } else {
                i += 1;
            }
        }
        return Err("Could not find dimensions in JPEG file".to_string());
    }

    // GIF: bytes 6-7 are width (LE), bytes 8-9 are height (LE)
    if header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a") {
        let width = u16::from_le_bytes([header[6], header[7]]) as u32;
        let height = u16::from_le_bytes([header[8], header[9]]) as u32;
        return Ok(ImageDimensions { width, height });
    }

    // WebP: RIFF container with VP8 or VP8L chunk
    if header.starts_with(b"RIFF") && &header[8..12] == b"WEBP" {
        // For simplicity, we'll read the whole file for WebP
        let content = fs::read(path_ref).map_err(|e| format!("Failed to read file: {}", e))?;

        // VP8L (lossless): dimensions at offset 21-24
        if content.len() > 24 && &content[12..16] == b"VP8L" {
            let bits = u32::from_le_bytes([content[21], content[22], content[23], content[24]]);
            let width = (bits & 0x3FFF) + 1;
            let height = ((bits >> 14) & 0x3FFF) + 1;
            return Ok(ImageDimensions { width, height });
        }

        // VP8 (lossy): dimensions at different offset
        if content.len() > 29 && &content[12..16] == b"VP8 " {
            // Skip to frame header (starts with 0x9D 0x01 0x2A)
            for i in 20..content.len() - 6 {
                if content[i..i + 3] == [0x9D, 0x01, 0x2A] {
                    let width =
                        u16::from_le_bytes([content[i + 3], content[i + 4]]) as u32 & 0x3FFF;
                    let height =
                        u16::from_le_bytes([content[i + 5], content[i + 6]]) as u32 & 0x3FFF;
                    return Ok(ImageDimensions { width, height });
                }
            }
        }

        return Err("Could not find dimensions in WebP file".to_string());
    }

    Err("Unsupported image format".to_string())
}

/// Count lines in a text file
#[tauri::command]
pub fn count_file_lines(path: String) -> Result<usize, String> {
    let path_ref = Path::new(&path);

    // Check if it's a text file by size (don't count lines in huge files)
    let metadata = fs::metadata(path_ref).map_err(|e| format!("Failed to read metadata: {}", e))?;

    if metadata.is_dir() {
        return Err("Cannot count lines in directory".to_string());
    }

    // Limit to 10MB for line counting
    if metadata.len() > 10 * 1024 * 1024 {
        return Err("File too large for line counting".to_string());
    }

    let file = fs::File::open(path_ref).map_err(|e| format!("Failed to open file: {}", e))?;
    let reader = BufReader::new(file);
    let count = reader.lines().count();

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: Testing Tauri commands directly requires the Tauri State wrapper,
    // which is difficult to mock. Instead, we test the underlying AppState
    // operations that the commands delegate to.

    #[test]
    fn test_mark_app_ready_logic() {
        let state = Arc::new(AppState::new());
        assert!(!state.is_ready());
        state.mark_ready();
        assert!(state.is_ready());
    }

    #[test]
    fn test_set_minimize_to_tray_logic() {
        let state = Arc::new(AppState::new());
        assert!(!state.should_minimize_to_tray());
        state.set_minimize_to_tray(true);
        assert!(state.should_minimize_to_tray());
        state.set_minimize_to_tray(false);
        assert!(!state.should_minimize_to_tray());
    }

    #[test]
    fn test_get_auth_token_returns_none_when_not_set() {
        let state = Arc::new(AppState::new());
        assert!(state.get_auth_token().is_none());
    }

    #[test]
    fn test_get_auth_token_returns_value_when_set() {
        let state = Arc::new(AppState::new());
        state.set_auth_token("test-token-123".to_string());
        assert_eq!(state.get_auth_token(), Some("test-token-123".to_string()));
    }

    #[test]
    fn test_get_backend_port_returns_none_when_not_set() {
        let state = Arc::new(AppState::new());
        assert!(state.get_sidecar_port().is_none());
    }

    #[test]
    fn test_get_backend_port_returns_value_when_set() {
        let state = Arc::new(AppState::new());
        state.set_sidecar_port(9876);
        assert_eq!(state.get_sidecar_port(), Some(9876));
    }

    #[test]
    fn test_pending_oauth_callback_lifecycle() {
        let state = Arc::new(AppState::new());

        // Initially no callback
        assert!(state.take_pending_oauth_callback().is_none());

        // Set a callback
        state.set_pending_oauth_callback("chatml://oauth?code=abc".to_string());

        // Take consumes it
        let callback = state.take_pending_oauth_callback();
        assert_eq!(callback, Some("chatml://oauth?code=abc".to_string()));

        // Second take returns None (already consumed)
        assert!(state.take_pending_oauth_callback().is_none());
    }
}
