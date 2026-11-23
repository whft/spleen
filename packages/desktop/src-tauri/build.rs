fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new()
                .commands(&["spleen_desktop_invoke", "spleen_desktop_open_dialog"]),
        ),
    )
    .expect("failed to run tauri-build");
}
