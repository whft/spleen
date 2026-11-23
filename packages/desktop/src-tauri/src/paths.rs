use std::path::PathBuf;

/// Spleen-owned directories. Windows-native locations, no reuse of the base
/// application's data folders.
#[derive(Clone)]
pub struct SpleenPaths {
    pub data_dir: PathBuf,
    pub local_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub downloads_dir: PathBuf,
}

impl SpleenPaths {
    pub fn resolve() -> Self {
        let roaming = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| roaming.clone());
        let data_dir = roaming.join("Spleen");
        let local_dir = local.join("Spleen");
        let logs_dir = local_dir.join("logs");
        let downloads_dir = local_dir.join("downloads");
        for dir in [&data_dir, &local_dir, &logs_dir, &downloads_dir] {
            let _ = std::fs::create_dir_all(dir);
        }
        Self {
            data_dir,
            local_dir,
            logs_dir,
            downloads_dir,
        }
    }

    pub fn settings_file(&self) -> PathBuf {
        self.data_dir.join("desktop.json")
    }

    pub fn hosts_file(&self) -> PathBuf {
        self.data_dir.join("desktop-hosts.json")
    }

    pub fn web_settings_file(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    pub fn ssh_instances_file(&self) -> PathBuf {
        self.data_dir.join("ssh-instances.json")
    }

    pub fn server_log(&self) -> PathBuf {
        self.logs_dir.join("server.log")
    }
}

/// Where a bundled resource lives: next to the executable during development,
/// in the Tauri resource directory once installed.
pub fn resource_path(app: &tauri::AppHandle, relative: &str) -> PathBuf {
    use tauri::Manager;
    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join(relative);
        if candidate.exists() {
            return candidate;
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    dev
}

pub fn home_dir() -> String {
    std::env::var("USERPROFILE").unwrap_or_default()
}

pub fn spawn_env_list(names: &[&str]) -> String {
    names.join(",")
}
