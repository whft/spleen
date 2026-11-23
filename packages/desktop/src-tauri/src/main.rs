#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod paths;
mod settings;
mod sidecar;
mod ssh;
mod window;

use paths::SpleenPaths;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

pub struct AppState {
    pub paths: SpleenPaths,
    pub server: Arc<Mutex<Option<sidecar::ServerProcess>>>,
    pub settings: Mutex<settings::DesktopSettings>,
    pub hosts: Mutex<Value>,
    pub ssh: ssh::SshManager,
    pub client_token: Mutex<String>,
    pub origin: Mutex<String>,
}

static SHUTDOWN_STARTED: AtomicBool = AtomicBool::new(false);

pub fn update_tray(app: &tauri::AppHandle, payload: &Value) {
    let Some(tray) = app.tray_by_id("spleen-tray") else {
        return;
    };
    let unread = payload
        .get("unreadCount")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let tooltip = if unread > 0 {
        format!("Spleen — {unread} unread")
    } else {
        "Spleen".to_string()
    };
    let _ = tray.set_tooltip(Some(&tooltip));
}

#[cfg(windows)]
pub fn set_keep_awake(enabled: bool) {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };
    unsafe {
        if enabled {
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        } else {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}

#[cfg(not(windows))]
pub fn set_keep_awake(_enabled: bool) {}

fn resolve_network_launch_config(paths: &SpleenPaths) -> (String, bool, Option<&'static str>) {
    let raw: Value = settings::read_json_or_default(&paths.web_settings_file());
    let lan_requested = raw
        .get("desktopLanAccessEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let saved_password = raw
        .get("desktopUiPassword")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    match (lan_requested, saved_password) {
        (true, Some(pw)) => (pw, true, None),
        (true, None) => (sidecar::random_secret(), false, Some("missing-password")),
        (false, Some(pw)) => (pw, false, None),
        (false, None) => (sidecar::random_secret(), false, None),
    }
}

async fn boot(app: tauri::AppHandle) -> Result<(), String> {
    let (paths, server_binary, web_dist, opencode_dir, built_in_extensions) = {
        let state = app.state::<AppState>();
        (
            state.paths.clone(),
            paths::resource_path(&app, "binaries/spleen-server.exe"),
            paths::resource_path(&app, "web-dist"),
            paths::resource_path(&app, "opencode-cli"),
            paths::resource_path(&app, "built-in-extensions"),
        )
    };

    let (password, lan_access_active, lan_access_blocked_reason) =
        resolve_network_launch_config(&paths);
    if lan_access_active {
        log::info!("desktop LAN access active (binding 0.0.0.0)");
    }
    let process = sidecar::spawn(sidecar::SpawnOptions {
        server_binary: &server_binary,
        opencode_dir: &opencode_dir,
        web_dist_dir: &web_dist,
        built_in_extensions_dir: &built_in_extensions,
        paths: &paths,
        password: &password,
        lan_access_active,
        lan_access_blocked_reason,
    })?;
    let origin = process.origin.clone();
    {
        let state = app.state::<AppState>();
        *state.server.lock().unwrap() = Some(process);
        *state.origin.lock().unwrap() = origin.clone();
    }

    sidecar::wait_for_health(&origin, std::time::Duration::from_secs(120)).await?;
    let token = sidecar::login(&origin, &password).await?;
    {
        let state = app.state::<AppState>();
        *state.client_token.lock().unwrap() = token.clone();
    }
    log::info!("backend ready at {origin}");

    let bootstrap = window::Bootstrap {
        origin: origin.clone(),
        client_token: token,
        home: paths::home_dir(),
        arch: std::env::consts::ARCH.to_string(),
        version: app.package_info().version.to_string(),
    };
    let app_for_window = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = window::create_main(&app_for_window, &bootstrap) {
            log::error!("main window failed: {error}");
        }
    })
    .map_err(|e| e.to_string())?;

    if std::env::args().any(|arg| arg == "--background") {
        let app_for_hide = app.clone();
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
        let _ = app_for_hide.clone().run_on_main_thread(move || {
            if let Some(window) = app_for_hide.get_webview_window("main") {
                let _ = window.hide();
            }
        });
    }
    Ok(())
}

async fn graceful_stop(app: tauri::AppHandle) {
    let taken = {
        let state = app.state::<AppState>();
        state.ssh.shutdown_all();
        let mut guard = state.server.lock().unwrap();
        let process = guard.take();
        drop(guard);
        drop(state);
        process
    };
    if let Some(process) = taken {
        process.shutdown().await;
    }
}

fn main() {
    let paths = SpleenPaths::resolve();
    let state = bridge::load_state(paths);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::focus_main(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("spleen".into()),
                    },
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            bridge::spleen_desktop_invoke,
            bridge::spleen_desktop_open_dialog
        ])
        .setup(|app| {
            let show = MenuItemBuilder::with_id("show", "Show Spleen").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit Spleen").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            TrayIconBuilder::with_id("spleen-tray")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => window::focus_main(app),
                    "quit" => {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            graceful_stop(handle.clone()).await;
                            handle.exit(0);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        window::focus_main(tray.app_handle());
                    }
                })
                .build(app)?;

            window::create_splash(app.handle())?;

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = boot(handle.clone()).await {
                    log::error!("startup failed: {error}");
                    use tauri_plugin_dialog::DialogExt;
                    let message = format!(
                        "Spleen could not start its local engine.\n\n{error}\n\nLogs: {}",
                        handle
                            .state::<AppState>()
                            .paths
                            .logs_dir
                            .to_string_lossy()
                    );
                    let _ = handle
                        .dialog()
                        .message(message)
                        .title("Spleen")
                        .blocking_show();
                    handle.exit(1);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Resized(_) = event {
                let maximized = window.is_maximized().unwrap_or(false);
                let _ = window.emit(
                    "spleen:window-maximized-changed",
                    serde_json::json!({ "maximized": maximized }),
                );
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                let app = window.app_handle();
                let minimize = {
                    let state = app.state::<AppState>();
                    let enabled = state.settings.lock().unwrap().minimize_to_tray;
                    drop(state);
                    enabled
                };
                if minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build Spleen");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() && !SHUTDOWN_STARTED.swap(true, Ordering::SeqCst) {
                api.prevent_exit();
                let handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    graceful_stop(handle.clone()).await;
                    handle.exit(0);
                });
            }
        }
    });
}
