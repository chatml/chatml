use serde::Serialize;

/// Application error type with structured error information
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", content = "message")]
pub enum AppError {
    /// Sidecar process related errors
    Sidecar(String),
    /// File watcher related errors
    Watcher(String),
    /// General application errors
    Internal(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Sidecar(msg) => write!(f, "Sidecar error: {}", msg),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sidecar_error_display() {
        let error = AppError::Sidecar("test message".to_string());
        assert_eq!(format!("{}", error), "Sidecar error: test message");
    }

    #[test]
    fn test_watcher_error_display() {
        let error = AppError::Watcher("watch failed".to_string());
        assert_eq!(format!("{}", error), "Watcher error: watch failed");
    }

    #[test]
    fn test_internal_error_display() {
        let error = AppError::Internal("something broke".to_string());
        assert_eq!(format!("{}", error), "Internal error: something broke");
    }

    #[test]
    fn test_from_io_error() {
        let io_error = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let app_error: AppError = io_error.into();
        match app_error {
            AppError::Internal(msg) => assert!(msg.contains("file not found")),
            _ => panic!("Expected Internal error variant"),
        }
    }

    #[test]
    fn test_error_serialization() {
        let error = AppError::Sidecar("spawn failed".to_string());
        let json = serde_json::to_string(&error).unwrap();
        assert!(json.contains("Sidecar"));
        assert!(json.contains("spawn failed"));
    }
}
