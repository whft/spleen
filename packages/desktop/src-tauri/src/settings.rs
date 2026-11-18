use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopSettings {
    pub launch_at_login: bool,
    pub minimize_to_tray: bool,
    pub keep_awake: bool,
    pub update_channel: String,
    pub install_id: String,
    pub locale: String,
    pub close_tab_target: String,
    pub menu_shortcuts: serde_json::Value,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            minimize_to_tray: true,
            keep_awake: false,
            update_channel: "stable".into(),
            install_id: uuid::Uuid::new_v4().to_string(),
            locale: "en".into(),
            close_tab_target: String::new(),
            menu_shortcuts: serde_json::Value::Null,
        }
    }
}

/// Reads a JSON object, never replaces an unreadable file with defaults.
/// A missing file is created with defaults; a corrupt one is preserved as
/// `<name>.corrupt-<timestamp>` and defaults are used for this run only.
pub fn read_json_or_default<T: for<'de> Deserialize<'de> + Serialize + Default>(
    path: &Path,
) -> T {
    match std::fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<T>(&text) {
            Ok(value) => value,
            Err(error) => {
                log::error!("unreadable {}: {error}; keeping the file untouched", path.display());
                let backup = path.with_extension(format!(
                    "corrupt-{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0)
                ));
                let _ = std::fs::rename(path, backup);
                T::default()
            }
        },
        Err(_) => T::default(),
    }
}

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    let text = serde_json::to_vec_pretty(value)?;
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(&text)?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

pub fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let value = format!("\"{}\" --background", exe.display());
        let status = std::process::Command::new("reg")
            .args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "Spleen",
                "/t",
                "REG_SZ",
                "/d",
                &value,
                "/f",
            ])
            .status()
            .map_err(|e| e.to_string())?;
        if enabled && !status.success() {
            return Err("could not register launch at login".into());
        }
        if !enabled {
            let _ = std::process::Command::new("reg")
                .args([
                    "delete",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "Spleen",
                    "/f",
                ])
                .status();
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("launch at login is only implemented for Windows".into())
    }
}

pub fn launch_at_login_enabled() -> bool {
    #[cfg(windows)]
    {
        let output = std::process::Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "Spleen",
            ])
            .output();
        return matches!(output, Ok(out) if out.status.success());
    }
    #[cfg(not(windows))]
    false
}
