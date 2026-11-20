use crate::paths::SpleenPaths;
use crate::settings::{
    launch_at_login_enabled, read_json_or_default, set_launch_at_login, write_json_atomic,
    DesktopSettings,
};
use crate::sidecar::ServerProcess;
use crate::AppState;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

static WINDOW_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_window_label(prefix: &str) -> String {
    let seq = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{seq}")
}

fn bootstrap_from_state(app: &AppHandle, state: &AppState) -> crate::window::Bootstrap {
    crate::window::Bootstrap {
        origin: state.origin.lock().unwrap().clone(),
        client_token: state.client_token.lock().unwrap().clone(),
        home: crate::paths::home_dir(),
        arch: std::env::consts::ARCH.to_string(),
        version: app.package_info().version.to_string(),
    }
}

fn is_allowed_uc_url(raw: &str) -> Option<url::Url> {
    let trimmed = raw.trim();
    let candidate = if trimmed.is_empty() {
        "https://www.unknowncheats.me/forum/"
    } else {
        trimmed
    };
    let parsed = url::Url::parse(candidate).ok()?;
    if parsed.scheme() != "https" {
        return None;
    }
    match parsed.host_str() {
        Some("www.unknowncheats.me" | "unknowncheats.me") => Some(parsed),
        _ => None,
    }
}

fn open_path_in_external_app(
    app: &AppHandle,
    target_path: &str,
    app_id: &str,
    app_name: &str,
) -> Result<(), String> {
    let trimmed_path = target_path.trim();
    if trimmed_path.is_empty() {
        return Err("missing target path".into());
    }
    let lowered = format!("{} {}", app_id.to_lowercase(), app_name.to_lowercase());
    let candidate_cmd: Option<&str> = if lowered.contains("cursor") {
        Some("cursor")
    } else if lowered.contains("vscode") || lowered.contains("visual studio code") || app_id == "code" {
        Some("code")
    } else if lowered.contains("explorer") || lowered.contains("files") || lowered.contains("finder") {
        Some("explorer")
    } else if lowered.contains("windsurf") {
        Some("windsurf")
    } else if lowered.contains("zed") {
        Some("zed")
    } else {
        None
    };

    if let Some(cmd) = candidate_cmd {
        #[cfg(target_os = "windows")]
        let spawn_result = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            std::process::Command::new("cmd")
                .args(["/C", "start", "", cmd, trimmed_path])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        };
        #[cfg(not(target_os = "windows"))]
        let spawn_result = std::process::Command::new(cmd).arg(trimmed_path).spawn();

        if spawn_result.is_ok() {
            return Ok(());
        }
    }

    app.opener()
        .open_path(trimmed_path, None::<&str>)
        .map_err(|e| e.to_string())
}

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
    let multi = properties.iter().any(|p| p == "multiSelections")
        || options
            .get("multiple")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let directory = properties.iter().any(|p| p == "openDirectory")
        || options
            .get("directory")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let default_dir = options
        .get("defaultPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|raw| {
            let p = PathBuf::from(raw);
            if p.is_dir() {
                Some(p)
            } else {
                p.parent().filter(|parent| parent.is_dir()).map(PathBuf::from)
            }
        });
    let title = options
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Spleen")
        .to_string();
    let title_for_dialog = title.clone();
    let default_dir_for_folder = default_dir.clone();
    let filters = options
        .get("filters")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut builder = app.dialog().file().set_title(title.clone());
    if let Some(ref dir) = default_dir {
        builder = builder.set_directory(dir);
    }
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
            let mut folder_builder = app_handle.dialog().file().set_title(title_for_dialog.clone());
            if let Some(ref dir) = default_dir_for_folder {
                folder_builder = folder_builder.set_directory(dir);
            }
            folder_builder.blocking_pick_folder()
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
            let enabled = arg_bool(&args, "enabled");
            settings(&state).minimize_to_tray = enabled;
            persist_settings(&state)?;
            Ok(json!({
                "supported": true,
                "enabled": enabled,
            }))
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
            Ok(json!({
                "supported": true,
                "enabled": enabled,
            }))
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
            Ok(json!({
                "supported": true,
                "enabled": enabled,
                "active": enabled,
            }))
        }
        "desktop_get_update_channel" => Ok(json!({
            "channel": settings(&state).update_channel.clone(),
        })),
        "desktop_set_update_channel" => {
            let channel = arg_str(&args, "channel");
            if channel == "stable" || channel == "canary" {
                settings(&state).update_channel = channel;
                persist_settings(&state)?;
            }
            Ok(json!({
                "channel": settings(&state).update_channel.clone(),
            }))
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
        "desktop_open_in_app" => {
            let project_path = arg_str(&args, "projectPath");
            let app_id = arg_str(&args, "appId");
            let app_name = arg_str(&args, "appName");
            open_path_in_external_app(&app, &project_path, &app_id, &app_name)?;
            Ok(json!(true))
        }
        "desktop_open_file_in_app" => {
            let file_path = arg_str(&args, "filePath");
            let app_id = arg_str(&args, "appId");
            let app_name = arg_str(&args, "appName");
            open_path_in_external_app(&app, &file_path, &app_id, &app_name)?;
            Ok(json!(true))
        }
        "desktop_get_installed_apps" => Ok(json!({
            "supported": false,
            "apps": [],
        })),
        "desktop_fetch_app_icons" | "desktop_filter_installed_apps" => Ok(json!([])),
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
            let app_progress = app.clone();
            let app_finish = app.clone();
            let started = Arc::new(AtomicBool::new(false));
            let downloaded_total = Arc::new(AtomicU64::new(0));
            let started_cb = Arc::clone(&started);
            let downloaded_cb = Arc::clone(&downloaded_total);
            update
                .download_and_install(
                    move |chunk_length, content_length| {
                        if !started_cb.swap(true, Ordering::SeqCst) {
                            let _ = app_progress.emit(
                                "spleen:update-progress",
                                json!({
                                    "event": "Started",
                                    "data": { "contentLength": content_length }
                                }),
                            );
                        }
                        let next = downloaded_cb
                            .fetch_add(chunk_length as u64, Ordering::SeqCst)
                            + chunk_length as u64;
                        let _ = app_progress.emit(
                            "spleen:update-progress",
                            json!({
                                "event": "Progress",
                                "data": { "downloaded": next, "total": content_length }
                            }),
                        );
                    },
                    move || {
                        let _ = app_finish.emit(
                            "spleen:update-progress",
                            json!({
                                "event": "Finished",
                                "data": {}
                            }),
                        );
                    },
                )
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
        "desktop_new_window" => {
            let bootstrap = bootstrap_from_state(&app, &state);
            let parsed = url::Url::parse(&bootstrap.origin).map_err(|e| e.to_string())?;
            let label = next_window_label("spleen");
            crate::window::open_local_window(&app, &label, parsed, "Spleen", 1280.0, 800.0, &bootstrap)?;
            Ok(json!({ "ok": true, "label": label }))
        }
        "desktop_new_window_at_url" => {
            let raw_url = arg_str(&args, "url");
            let parsed = url::Url::parse(&raw_url).map_err(|e| e.to_string())?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err("unsafe window url".into());
            }
            let bootstrap = bootstrap_from_state(&app, &state);
            let label = next_window_label("spleen");
            crate::window::open_local_window(&app, &label, parsed, "Spleen", 1280.0, 800.0, &bootstrap)?;
            Ok(json!({ "ok": true, "label": label }))
        }
        "desktop_new_window_for_host" => {
            let host_id = arg_str(&args, "hostId");
            let bootstrap = bootstrap_from_state(&app, &state);
            let mut target_url = bootstrap.origin.clone();
            if !host_id.is_empty() && host_id != "local" {
                let hosts = state.hosts.lock().unwrap();
                if let Some(list) = hosts.get("hosts").and_then(Value::as_array) {
                    if let Some(found) = list.iter().find(|h| h.get("id").and_then(Value::as_str) == Some(host_id.as_str())) {
                        if let Some(host_url) = found.get("url").and_then(Value::as_str) {
                            target_url = host_url.to_string();
                        }
                    }
                }
            }
            let parsed = url::Url::parse(&target_url).map_err(|e| e.to_string())?;
            let label = next_window_label("spleen");
            crate::window::open_local_window(&app, &label, parsed, "Spleen", 1280.0, 800.0, &bootstrap)?;
            Ok(json!({ "ok": true, "label": label }))
        }
        "desktop_open_draft_mini_chat_window" | "desktop_open_session_mini_chat_window" => {
            let bootstrap = bootstrap_from_state(&app, &state);
            let session_id = arg_str(&args, "sessionId");
            let base = bootstrap.origin.trim_end_matches('/');
            let mut parsed = url::Url::parse(&format!("{base}/mini-chat.html")).map_err(|e| e.to_string())?;
            if !session_id.is_empty() {
                parsed.query_pairs_mut().append_pair("sessionId", &session_id);
            }
            let label = next_window_label("mini-chat");
            crate::window::open_local_window(&app, &label, parsed, "Spleen Mini Chat", 540.0, 720.0, &bootstrap)?;
            Ok(json!({ "ok": true, "label": label }))
        }
        "desktop_uc_open_window" => {
            let raw_url = arg_str(&args, "url");
            let parsed = is_allowed_uc_url(&raw_url)
                .ok_or_else(|| "invalid unknowncheats url".to_string())?;
            if let Some(win) = app.get_webview_window("uc-browser") {
                let _ = win.navigate(parsed);
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            } else {
                let win = WebviewWindowBuilder::new(&app, "uc-browser", WebviewUrl::External(parsed))
                    .title("UnknownCheats Verification — Spleen")
                    .inner_size(1100.0, 780.0)
                    .min_inner_size(760.0, 560.0)
                    .decorations(true)
                    .resizable(true)
                    .build()
                    .map_err(|e| e.to_string())?;
                let _ = win.show();
                let _ = win.set_focus();
            }
            Ok(json!({ "ok": true }))
        }
        "desktop_uc_read_cookies" => {
            let Some(win) = app.get_webview_window("uc-browser") else {
                return Ok(json!({
                    "ok": false,
                    "error": "verification_window_not_open",
                    "cookieHeader": "",
                    "count": 0
                }));
            };
            let parsed = url::Url::parse("https://www.unknowncheats.me/").map_err(|e| e.to_string())?;
            let cookies = tokio::task::spawn_blocking(move || win.cookies_for_url(parsed))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            let pairs: Vec<String> = cookies
                .iter()
                .map(|c| format!("{}={}", c.name(), c.value()))
                .collect();
            let count = pairs.len();
            let cookie_header = pairs.join("; ");
            Ok(json!({
                "ok": true,
                "cookieHeader": cookie_header,
                "count": count
            }))
        }
        "desktop_open_browser_window" => {
            let raw_url = arg_str(&args, "url");
            if !is_safe_external_url(&raw_url) {
                return Err("unsafe browser url".into());
            }
            let parsed = url::Url::parse(&raw_url).map_err(|e| e.to_string())?;
            let raw_title = arg_str(&args, "title");
            let window_title = if raw_title.is_empty() {
                "Spleen Browser".to_string()
            } else {
                raw_title
            };
            if let Some(win) = app.get_webview_window("browser-popout") {
                let _ = win.set_title(&window_title);
                let _ = win.navigate(parsed);
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            } else {
                let win = WebviewWindowBuilder::new(&app, "browser-popout", WebviewUrl::External(parsed))
                    .title(&window_title)
                    .inner_size(1200.0, 820.0)
                    .min_inner_size(720.0, 520.0)
                    .decorations(true)
                    .resizable(true)
                    .build()
                    .map_err(|e| e.to_string())?;
                let _ = win.show();
                let _ = win.set_focus();
            }
            Ok(json!({ "ok": true }))
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
