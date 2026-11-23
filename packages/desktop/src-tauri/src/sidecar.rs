use crate::paths::SpleenPaths;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct ServerProcess {
    pub child: Child,
    pub origin: String,
    pub client_token: String,
    #[cfg(windows)]
    job: Option<isize>,
}

#[cfg(windows)]
unsafe impl Send for ServerProcess {}

impl ServerProcess {
    /// Stops the owned backend through its own shutdown route, then closes the
    /// job object so any surviving child (terminals, managed OpenCode) is
    /// terminated. Never touches processes this app did not start.
    pub async fn shutdown(mut self) {
        let client = reqwest::Client::new();
        let url = format!("{}/api/system/shutdown", self.origin);
        let _ = client
            .post(&url)
            .bearer_auth(&self.client_token)
            .timeout(Duration::from_secs(10))
            .send()
            .await;
        for _ in 0..80 {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        #[cfg(windows)]
        if let Some(job) = self.job.take() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(job as _);
            }
        }
    }
}

#[cfg(windows)]
fn create_kill_on_close_job() -> Option<isize> {
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            log::warn!("CreateJobObject failed");
            return None;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            log::warn!("SetInformationJobObject failed");
        }
        Some(job as isize)
    }
}

#[cfg(windows)]
fn assign_to_job(job: isize, child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
    unsafe {
        let handle = child.as_raw_handle() as isize;
        if AssignProcessToJobObject(job as _, handle as _) == 0 {
            log::warn!("AssignProcessToJobObject failed for pid {}", child.id());
        }
    }
}

pub fn random_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn pick_server_port(lan_access_active: bool) -> std::io::Result<u16> {
    if lan_access_active {
        // Prefer a consistent port when LAN access is enabled so paired devices keep the same URL across restarts.
        if let Ok(listener) = std::net::TcpListener::bind("0.0.0.0:3721") {
            let port = listener.local_addr()?.port();
            drop(listener);
            return Ok(port);
        }
        let listener = std::net::TcpListener::bind("0.0.0.0:0")?;
        let port = listener.local_addr()?.port();
        drop(listener);
        return Ok(port);
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

pub struct SpawnOptions<'a> {
    pub server_binary: &'a Path,
    pub opencode_dir: &'a Path,
    pub web_dist_dir: &'a Path,
    pub built_in_extensions_dir: &'a Path,
    pub paths: &'a SpleenPaths,
    pub password: &'a str,
    pub lan_access_active: bool,
    pub lan_access_blocked_reason: Option<&'a str>,
}

pub fn spawn(options: SpawnOptions<'_>) -> Result<ServerProcess, String> {
    let port = pick_server_port(options.lan_access_active)
        .map_err(|e| format!("no available server port: {e}"))?;
    let bind_host = if options.lan_access_active {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };
    let origin = format!("http://127.0.0.1:{port}");
    if !options.server_binary.exists() {
        return Err(format!(
            "backend sidecar missing: {}",
            options.server_binary.display()
        ));
    }

    let log_path = options.paths.server_log();
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("cannot open {}: {e}", log_path.display()))?;

    let mut injected = vec![
        "SPLEEN_DATA_DIR",
        "SPLEEN_DIST_DIR",
        "SPLEEN_BUILTIN_EXTENSIONS_DIR",
        "SPLEEN_OPENCODE_CWD",
        "SPLEEN_BUNDLED_OPENCODE_CLI_DIR",
        "SPLEEN_RUNTIME",
        "SPLEEN_DESKTOP_NOTIFY",
        "SPLEEN_SKIP_API_COMPRESSION",
        "SPLEEN_RELAY_HOST",
        "SPLEEN_DESKTOP_LAN_ACCESS_ACTIVE",
    ];
    if options.lan_access_blocked_reason.is_some() {
        injected.push("SPLEEN_DESKTOP_LAN_ACCESS_BLOCKED_REASON");
    }

    let mut command = Command::new(options.server_binary);
    command
        .arg("serve")
        .arg("--port")
        .arg(port.to_string())
        .arg("--host")
        .arg(bind_host)
        .arg("--ui-password")
        .arg(options.password)
        .current_dir(&options.paths.data_dir)
        .env("SPLEEN_DATA_DIR", options.paths.data_dir.to_string_lossy().to_string())
        .env("SPLEEN_DIST_DIR", options.web_dist_dir.to_string_lossy().to_string())
        .env(
            "SPLEEN_BUILTIN_EXTENSIONS_DIR",
            options.built_in_extensions_dir.to_string_lossy().to_string(),
        )
        .env("SPLEEN_OPENCODE_CWD", crate::paths::home_dir())
        .env(
            "SPLEEN_BUNDLED_OPENCODE_CLI_DIR",
            options.opencode_dir.to_string_lossy().to_string(),
        )
        .env("SPLEEN_RUNTIME", "desktop")
        .env("SPLEEN_DESKTOP_NOTIFY", "true")
        .env("SPLEEN_SKIP_API_COMPRESSION", "true")
        .env("SPLEEN_RELAY_HOST", "off")
        .env(
            "SPLEEN_DESKTOP_LAN_ACCESS_ACTIVE",
            if options.lan_access_active { "true" } else { "false" },
        )
        .env("NO_PROXY", "localhost,127.0.0.1")
        .env("no_proxy", "localhost,127.0.0.1")
        .env("SPLEEN_INJECTED_ENV", crate::paths::spawn_env_list(&injected))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(reason) = options.lan_access_blocked_reason {
        command.env("SPLEEN_DESKTOP_LAN_ACCESS_BLOCKED_REASON", reason);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("cannot start backend sidecar: {e}"))?;

    #[cfg(windows)]
    let job = create_kill_on_close_job();
    #[cfg(windows)]
    if let Some(job) = job {
        assign_to_job(job, &child);
    }

    if let Some(stdout) = child.stdout.take() {
        pump(stdout, log_file.try_clone().map_err(|e| e.to_string())?, "server");
    }
    if let Some(stderr) = child.stderr.take() {
        pump(stderr, log_file, "server!");
    }

    log::info!("backend sidecar pid={} origin={origin}", child.id());
    Ok(ServerProcess {
        child,
        origin,
        client_token: String::new(),
        #[cfg(windows)]
        job,
    })
}

fn pump<R: std::io::Read + Send + 'static>(
    stream: R,
    mut file: std::fs::File,
    prefix: &'static str,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            let _ = writeln!(file, "[{prefix}] {line}");
            let _ = file.flush();
        }
    });
}

pub async fn wait_for_health(origin: &str, timeout: Duration) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    let deadline = tokio::time::Instant::now() + timeout;
    let mut last = String::new();
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(format!("backend did not become ready: {last}"));
        }
        match client.get(format!("{origin}/health")).send().await {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => last = format!("HTTP {}", response.status()),
            Err(error) => last = error.to_string(),
        }
        tokio::time::sleep(Duration::from_millis(350)).await;
    }
}

/// Exchanges the per-launch UI password for a bearer client token, exactly as
/// the packaged client does. The token never leaves this process except into
/// the window's initialization script.
pub async fn login(origin: &str, password: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let body = serde_json::json!({
        "password": password,
        "trustDevice": true,
        "issueClientToken": true,
        "clientLabel": "Spleen Desktop",
        "clientKind": "desktop-local",
        "dedupeKey": "desktop-local",
    });
    let response = client
        .post(format!("{origin}/auth/session"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("login request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("login rejected: HTTP {}", response.status()));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|e| format!("login response invalid: {e}"))?;
    payload
        .get("clientToken")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "login response carried no client token".to_string())
}

pub fn shared() -> Arc<Mutex<Option<ServerProcess>>> {
    Arc::new(Mutex::new(None))
}
