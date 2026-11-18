use crate::paths::SpleenPaths;
use crate::settings::{
    launch_at_login_enabled, read_json_or_default, set_launch_at_login, write_json_atomic,
    DesktopSettings,
};
use crate::sidecar::ServerProcess;
use crate::AppState;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

fn fail(command: &str) -> Result<Value, String> {
    log::warn!("unsupported desktop command: {command}");
    Err(format!("not_implemented_in_tauri:{command}"))
}

fn settings(state: &AppState) -> std::sync::MutexGuard<'_, DesktopSettings> {
    state.settings.lock().unwrap()
}

fn persist_settings(state: &AppState) -> Result<(), String> {
    let value = settings(state).clone();
    write_json_atomic(&state.paths.settings_file(), &value).map_err(|e| e.to_string())
}

fn arg_str(args: &Value, key: &str) -> String {
    args.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn arg_bool(args: &Value, key: &str) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn window_of(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window is not open".to_string())
}

fn read_theme_payload(path: &std::path::Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(json!({ "name": name, "size": text.len(), "text": text }))
}

#[tauri::command]
pub async fn spleen_desktop_open_dialog(
    app: AppHandle,
    options: Value,
) -> Result<Value, String> {
    let properties: Vec<String> = options
        .get("properties")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_else(|| vec!["openFile".into()]);
    let multi = properties.iter().any(|p| p == "multiSelections");
    let directory = properties.iter().any(|p| p == "openDirectory");
    let title = options
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Spleen")
        .to_string();
    let title_for_dialog = title.clone();
    let filters = options
        .get("filters")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut builder = app.dialog().file().set_title(title.clone());
    for filter in &filters {
        let name = filter
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Files")
            .to_string();
        let extensions: Vec<String> = filter
            .get("extensions")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(name, &refs);
    }

    let app_handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        if directory {
            app_handle
                .dialog()
                .file()
                .set_title(title_for_dialog.clone())
                .blocking_pick_folder()
        } else if multi {
            builder
                .blocking_pick_files()
                .and_then(|files| files.into_iter().next())
        } else {
            builder.blocking_pick_file()
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    match picked {
        None => Ok(json!({ "canceled": true, "filePaths": [] })),
        Some(file) => {
            let path = file.into_path().map_err(|e| e.to_string())?;
            Ok(json!({
                "canceled": false,
                "filePaths": [path.to_string_lossy().to_string()]
            }))
        }
    }
}

async fn update_payload(app: &AppHandle) -> Result<Value, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let current = app.package_info().version.to_string();
    match updater.check().await {
        Ok(Some(update)) => Ok(json!({
            "available": true,
            "version": update.version,
            "currentVersion": current,
            "body": update.body,
            "date": update.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(json!({ "available": false, "currentVersion": current })),
        Err(error) => {
            log::warn!("update check failed: {error}");
            Err(format!("update_check_failed:{error}"))
        }
    }
}

#[tauri::command]
pub async fn spleen_desktop_invoke(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    cmd: String,
    args: Value,
) -> Result<Value, String> {
    match cmd.as_str() {
        "desktop_get_app_version" => Ok(json!(app.package_info().version.to_string())),
        "desktop_get_current_window_state" => {
            let window = window_of(&app)?;
            Ok(json!({
                "visible": window.is_visible().unwrap_or(false),
                "maximized": window.is_maximized().unwrap_or(false),
                "fullscreen": window.is_fullscreen().unwrap_or(false),
                "focused": window.is_focused().unwrap_or(false),
            }))
        }
        "desktop_is_window_fullscreen" => {
            Ok(json!(window_of(&app)?.is_fullscreen().unwrap_or(false)))
        }
        "desktop_minimize_current_window" => {
            window_of(&app)?.minimize().map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "desktop_toggle_current_window_maximized" => {
            let window = window_of(&app)?;
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize().map_err(|e| e.to_string())?;
            } else {
                window.maximize().map_err(|e| e.to_string())?;
            }
            Ok(json!(true))
        }
        "desktop_close_current_window" => {
            window_of(&app)?.close().map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "desktop_focus_window" | "desktop_focus_main_window" => {
            crate::window::focus_main(&app);
            Ok(json!(true))
        }
        "desktop_start_window_drag" => {
            window_of(&app)?.start_dragging().map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "desktop_set_window_title" => {
            let title = arg_str(&args, "title");
            if !title.is_empty() {
                window_of(&app)?.set_title(&title).map_err(|e| e.to_string())?;
            }
            Ok(json!(true))
        }
        "desktop_set_window_pinned" => {
            let pinned = arg_bool(&args, "pinned");
            window_of(&app)?
                .set_always_on_top(pinned)
                .map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "desktop_get_window_pinned" => {
            Ok(json!(window_of(&app)?.is_always_on_top().unwrap_or(false)))
        }
        "desktop_get_minimize_to_tray" => Ok(json!({
            "supported": true,
            "enabled": settings(&state).minimize_to_tray,
        })),
        "desktop_set_minimize_to_tray" => {
            settings(&state).minimize_to_tray = arg_bool(&args, "enabled");
            persist_settings(&state)?;
            Ok(json!(true))
        }
        "desktop_get_launch_at_login" => Ok(json!({
            "supported": true,
            "enabled": launch_at_login_enabled(),
        })),
        "desktop_set_launch_at_login" => {
            let enabled = arg_bool(&args, "enabled");
            set_launch_at_login(enabled)?;
            settings(&state).launch_at_login = enabled;
            persist_settings(&state)?;
            Ok(json!(true))
        }
        "desktop_get_keep_awake" => {
            let enabled = settings(&state).keep_awake;
            Ok(json!({ "supported": true, "enabled": enabled, "active": enabled }))
        }
        "desktop_set_keep_awake" => {
            let enabled = arg_bool(&args, "enabled");
            settings(&state).keep_awake = enabled;
            persist_settings(&state)?;
            crate::set_keep_awake(enabled);
            Ok(json!(true))
        }
        "desktop_get_update_channel" => Ok(json!(settings(&state).update_channel)),
        "desktop_set_update_channel" => {
            let channel = arg_str(&args, "channel");
            if channel == "stable" || channel == "canary" {
                settings(&state).update_channel = channel;
                persist_settings(&state)?;
            }
            Ok(json!(true))
        }
        "desktop_get_locale" => Ok(json!(settings(&state).locale)),
        "desktop_set_locale" => {
            settings(&state).locale = arg_str(&args, "locale");
            persist_settings(&state)?;
            Ok(json!(true))
        }
        "desktop_set_menu_shortcuts" => {
            settings(&state).menu_shortcuts = args.clone();
            persist_settings(&state)?;
            Ok(json!(true))
        }
        "desktop_set_close_tab_target" => {
            settings(&state).close_tab_target = arg_str(&args, "target");
            persist_settings(&state)?;
            Ok(json!(true))
        }
        "desktop_set_window_runtime_key" | "desktop_set_window_theme" => Ok(json!(true)),
        "desktop_hosts_get" => {
            let mut hosts = state.hosts.lock().unwrap().clone();
            hosts["localOrigin"] = json!(state.origin.lock().unwrap().clone());
            Ok(hosts)
        }
        "desktop_hosts_set" => {
            let mut next = args.clone();
            next["localOrigin"] = json!(state.origin.lock().unwrap().clone());
            write_json_atomic(&state.paths.hosts_file(), &next).map_err(|e| e.to_string())?;
            *state.hosts.lock().unwrap() = next;
            Ok(json!(true))
        }
        "desktop_local_client_token_get" => {
            Ok(json!(state.client_token.lock().unwrap().clone()))
        }
        "desktop_install_id_get" => Ok(json!(settings(&state).install_id)),
        "desktop_get_lan_address" => Ok(json!(lan_address())),
        "desktop_managed_opencode_compatible" => Ok(json!(true)),
        "desktop_tray_actions_ready" => Ok(json!(true)),
        "desktop_tray_update" => {
            crate::update_tray(&app, &args);
            Ok(json!(true))
        }
        "desktop_notify" => {
            let title = arg_str(&args, "title");
            let body = arg_str(&args, "body");
            let _ = app
                .notification()
                .builder()
                .title(if title.is_empty() { "Spleen" } else { &title })
                .body(body)
                .show();
            Ok(json!(true))
        }
        "desktop_clear_session_notifications" => Ok(json!(true)),
        "desktop_open_external_url" => {
            let url = arg_str(&args, "url");
            if !is_safe_external_url(&url) {
                return Err("unsafe external url".into());
            }
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "desktop_open_path" => {
            let path = arg_str(&args, "path");
            app.opener()
                .open_path(path, None::<&str>)
                .map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "desktop_reveal_path" => {
            let path = arg_str(&args, "path");
            app.opener()
                .reveal_item_in_dir(path)
                .map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "desktop_open_in_app" | "desktop_open_file_in_app" => {
            Err("not_implemented_in_tauri:installed_app_launch".into())
        }
        "desktop_get_installed_apps" | "desktop_fetch_app_icons" | "desktop_filter_installed_apps" => {
            Ok(json!([]))
        }
        "desktop_save_markdown_file" => {
            let content = arg_str(&args, "content");
            let suggested = arg_str(&args, "defaultFileName");
            let app_handle = app.clone();
            let picked = tauri::async_runtime::spawn_blocking(move || {
                app_handle
                    .dialog()
                    .file()
                    .add_filter("Markdown", &["md", "markdown"])
                    .set_file_name(if suggested.is_empty() {
                        "spleen-export.md"
                    } else {
                        &suggested
                    })
                    .blocking_save_file()
            })
            .await
            .map_err(|e| e.to_string())?;
            let Some(file) = picked else {
                return Ok(json!(""));
            };
            let path = file.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, content).map_err(|e| e.to_string())?;
            Ok(json!(path.to_string_lossy().to_string()))
        }
        "desktop_read_file" => {
            let path = PathBuf::from(arg_str(&args, "path"));
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            Ok(json!(text))
        }
        "desktop_pick_theme_file" => {
            let app_handle = app.clone();
            let picked = tauri::async_runtime::spawn_blocking(move || {
                app_handle
                    .dialog()
                    .file()
                    .add_filter("Spleen theme", &["json", "jsonc"])
                    .blocking_pick_file()
            })
            .await
            .map_err(|e| e.to_string())?;
            let Some(file) = picked else {
                return Ok(Value::Null);
            };
            read_theme_payload(&file.into_path().map_err(|e| e.to_string())?).map(Value::from)
                .or_else(|error| Err(error))
        }
        "desktop_collect_local_diagnostics" => {
            let log = std::fs::read_to_string(state.paths.server_log()).unwrap_or_default();
            let tail: String = log
                .lines()
                .rev()
                .take(400)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            Ok(json!({
                "app": "Spleen",
                "version": app.package_info().version.to_string(),
                "dataDir": state.paths.data_dir.to_string_lossy(),
                "logTail": tail,
            }))
        }
        "desktop_check_for_updates" => update_payload(&app).await,
        "desktop_download_and_install_update" => {
            let updater = app.updater().map_err(|e| e.to_string())?;
            let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
                return Ok(json!({ "available": false }));
            };
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|e| e.to_string())?;
            app.restart();
        }
        "desktop_restart" => {
            app.restart();
        }
        "desktop_take_pending_extension_installs"
        | "desktop_take_pending_host_actions"
        | "desktop_take_pending_session_links" => Ok(json!([])),
        "desktop_new_window" | "desktop_new_window_at_url" | "desktop_new_window_for_host" => {
            Err("not_implemented_in_tauri:multi_window".into())
        }
        "desktop_open_draft_mini_chat_window" | "desktop_open_session_mini_chat_window" => {
            Err("not_implemented_in_tauri:mini_chat_window".into())
        }
        "desktop_clipboard_read_selection" | "desktop_clipboard_write_selection" => {
            Err("not_implemented_in_tauri:primary_selection".into())
        }
        other => fail(other),
    }
}

fn is_safe_external_url(url: &str) -> bool {
    match url::Url::parse(url) {
        Ok(parsed) => matches!(parsed.scheme(), "http" | "https" | "mailto"),
        Err(_) => false,
    }
}

fn lan_address() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("8.8.8.8:80")?;
            socket.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_default()
}

pub fn load_state(paths: SpleenPaths) -> AppState {
    let settings: DesktopSettings = read_json_or_default(&paths.settings_file());
    if !paths.settings_file().exists() {
        let _ = write_json_atomic(&paths.settings_file(), &settings);
    }
    let hosts: Value = read_json_or_default(&paths.hosts_file());
    let hosts = if hosts.is_null() {
        json!({
            "hosts": [],
            "defaultHostId": "local",
            "initialHostChoiceCompleted": false,
            "localOrigin": null
        })
    } else {
        hosts
    };
    AppState {
        paths,
        server: Arc::new(Mutex::new(None::<ServerProcess>)),
        settings: Mutex::new(settings),
        hosts: Mutex::new(hosts),
        client_token: Mutex::new(String::new()),
        origin: Mutex::new(String::new()),
    }
}
