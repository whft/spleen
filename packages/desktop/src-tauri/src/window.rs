use serde_json::json;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub struct Bootstrap {
    pub origin: String,
    pub client_token: String,
    pub home: String,
    pub arch: String,
    pub version: String,
}

fn init_script(bootstrap: &Bootstrap) -> String {
    let b = json!({
        "localOrigin": bootstrap.origin,
        "apiBaseUrl": bootstrap.origin,
        "clientToken": bootstrap.client_token,
        "home": bootstrap.home,
        "arch": bootstrap.arch,
        "version": bootstrap.version,
    });
    format!(
        r#"(function () {{
  var b = {b};
  try {{
    window.__SPLEEN_LOCAL_ORIGIN__ = b.localOrigin;
    window.__SPLEEN_API_BASE_URL__ = b.apiBaseUrl;
    window.__SPLEEN_CLIENT_TOKEN__ = b.clientToken;
    window.__SPLEEN_HOME__ = b.home;
    window.__SPLEEN_PLATFORM__ = 'win32';
    window.__SPLEEN_DESKTOP_RUNTIME__ = {{ runtime: 'tauri', arch: b.arch, trayEnabled: true, nativeFrame: false }};
    window.__SPLEEN_DESKTOP_BOOT_OUTCOME__ = {{ target: 'local', status: 'ok', localAvailable: true }};
  }} catch (error) {{ console.error('[spleen] bootstrap globals failed', error); }}

  var tauri = window.__TAURI__;
  function invoke(cmd, args) {{
    if (!tauri || !tauri.core) return Promise.reject(new Error('tauri ipc unavailable'));
    return tauri.core.invoke('spleen_desktop_invoke', {{ cmd: cmd, args: args || {{}} }});
  }}
  window.__SPLEEN_DESKTOP__ = {{
    invoke: invoke,
    openExternal: function (url) {{ return invoke('desktop_open_external_url', {{ url: url }}); }},
    openDialog: function (options) {{
      if (!tauri || !tauri.core) return Promise.reject(new Error('tauri ipc unavailable'));
      return tauri.core.invoke('spleen_desktop_open_dialog', {{ options: options || {{}} }});
    }},
    grantFileAccess: function (filePath) {{ return Promise.resolve({{ granted: true, path: filePath }}); }},
    pathForFile: function (file) {{ return file && typeof file.path === 'string' ? file.path : ''; }},
    listen: function (event, handler) {{
      if (!tauri || !tauri.event) return Promise.resolve(function () {{}});
      return tauri.event.listen(event, function (e) {{ handler({{ payload: e.payload }}); }});
    }},
    pickThemeFile: function () {{ return invoke('desktop_pick_theme_file', {{}}); }}
  }};
}})();"#
    )
}

pub fn create_splash(app: &AppHandle) -> tauri::Result<()> {
    let _ = WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("index.html".into()))
        .title("Spleen")
        .inner_size(420.0, 260.0)
        .resizable(false)
        .decorations(false)
        .center()
        .skip_taskbar(false)
        .build()?;
    Ok(())
}

pub fn create_main(app: &AppHandle, bootstrap: &Bootstrap) -> Result<(), String> {
    let url = url::Url::parse(&bootstrap.origin).map_err(|e| e.to_string())?;
    let script = init_script(bootstrap);
    let app_for_load = app.clone();
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Spleen")
        .inner_size(1280.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .decorations(false)
        .visible(false)
        .initialization_script(&script)
        .on_page_load(move |_window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                if let Some(splash) = app_for_load.get_webview_window("splash") {
                    let _ = splash.close();
                }
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
