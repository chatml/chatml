use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Spawn the Go backend sidecar
            let sidecar_command = app.shell().sidecar("chatml-backend")?;
            let (mut _rx, mut _child) = sidecar_command.spawn()?;

            log::info!("ChatML backend sidecar started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
