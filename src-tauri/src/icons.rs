/// Extract app icon as base64-encoded PNG.
/// Returns empty string if extraction fails or platform unsupported.
#[cfg(target_os = "macos")]
pub fn get_icon_base64(app_path: &str) -> String {
    std::panic::catch_unwind(|| get_icon_base64_inner(app_path))
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn get_icon_base64_inner(app_path: &str) -> String {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    use objc2_app_kit::{NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSSize, NSString};

    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let ns_path = NSString::from_str(app_path);
        let icon = workspace.iconForFile(&ns_path);

        // Request 64x64 for HiDPI
        icon.setSize(NSSize::new(64.0, 64.0));

        // Get TIFF data from the icon, then create a bitmap rep from it
        let tiff = match icon.TIFFRepresentation() {
            Some(t) => t,
            None => return String::new(),
        };

        let bitmap = match NSBitmapImageRep::imageRepWithData(&tiff) {
            Some(b) => b,
            None => return String::new(),
        };

        // Convert to PNG
        let png_data = bitmap.representationUsingType_properties(
            objc2_app_kit::NSBitmapImageFileType::PNG,
            &objc2_foundation::NSDictionary::new(),
        );

        match png_data {
            Some(data) => {
                let bytes = data.as_bytes_unchecked();
                BASE64.encode(bytes)
            }
            None => String::new(),
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn get_icon_base64(_app_path: &str) -> String {
    String::new()
}
