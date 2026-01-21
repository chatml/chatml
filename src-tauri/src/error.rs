use serde::Serialize;

/// Application error type with structured error information
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", content = "message")]
pub enum AppError {
    /// Sidecar process related errors
    Sidecar(String),
    /// Speech recognition related errors
    Speech(String),
    /// File watcher related errors
    Watcher(String),
    /// General application errors
    Internal(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Sidecar(msg) => write!(f, "Sidecar error: {}", msg),
            AppError::Speech(msg) => write!(f, "Speech error: {}", msg),
            AppError::Watcher(msg) => write!(f, "Watcher error: {}", msg),
            AppError::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for AppError {}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

/// Result type alias for app operations
pub type AppResult<T> = Result<T, AppError>;
