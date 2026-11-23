use crate::paths::SpleenPaths;
use crate::settings::{read_json_or_default, write_json_atomic};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const MAX_LOG_LINES: usize = 400;
const STATUS_EVENT_NAME: &str = "spleen:ssh-instance-status";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshStatus {
    pub id: String,
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_port: Option<u16>,
    pub started_by_us: bool,
    pub retry_attempt: u32,
    pub requires_user_action: bool,
    pub updated_at_ms: u64,
}

impl SshStatus {
    fn idle(id: &str) -> Self {
        Self {
            id: id.to_string(),
            phase: "idle".to_string(),
            detail: None,
            local_url: None,
            local_port: None,
            remote_port: None,
            started_by_us: false,
            retry_attempt: 0,
            requires_user_action: false,
            updated_at_ms: now_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshImportCandidate {
    pub host: String,
    pub pattern: bool,
    pub source: String,
    pub ssh_command: String,
}

struct ActiveTunnel {
    generation: u64,
    child: Arc<Mutex<Option<Child>>>,
}

#[derive(Default)]
struct SshInner {
    statuses: HashMap<String, SshStatus>,
    logs: HashMap<String, VecDeque<String>>,
    tunnels: HashMap<String, ActiveTunnel>,
    next_generation: u64,
}

#[derive(Clone)]
pub struct SshManager {
    paths: SpleenPaths,
    inner: Arc<Mutex<SshInner>>,
}

impl SshManager {
    pub fn new(paths: SpleenPaths) -> Self {
        Self {
            paths,
            inner: Arc::new(Mutex::new(SshInner::default())),
        }
    }

    pub fn instances_get(&self) -> Value {
        let raw: Value = read_json_or_default(&self.paths.ssh_instances_file());
        if let Some(arr) = raw.get("instances").and_then(Value::as_array) {
            json!({ "instances": arr })
        } else {
            json!({ "instances": [] })
        }
    }

    pub fn instances_set(&self, config: Value) -> Result<Value, String> {
        let instances = config
            .get("instances")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let payload = json!({ "instances": instances });
        write_json_atomic(&self.paths.ssh_instances_file(), &payload).map_err(|e| e.to_string())?;
        Ok(json!(true))
    }

    pub fn import_hosts(&self) -> Vec<SshImportCandidate> {
        let mut candidates = Vec::new();
        let mut seen = HashSet::new();
        let mut roots = Vec::new();

        let home = crate::paths::home_dir();
        if !home.is_empty() {
            roots.push(PathBuf::from(&home).join(".ssh").join("config"));
        }
        #[cfg(windows)]
        {
            roots.push(PathBuf::from(r"C:\ProgramData\ssh\ssh_config"));
        }
        #[cfg(not(windows))]
        {
            roots.push(PathBuf::from("/etc/ssh/ssh_config"));
        }

        for root in roots {
            if root.exists() {
                parse_ssh_config_file(&root, 0, &mut seen, &mut candidates);
            }
        }
        candidates
    }

    pub fn status(&self, id: Option<&str>) -> Vec<SshStatus> {
        let guard = self.inner.lock().unwrap();
        if let Some(target_id) = id {
            if let Some(existing) = guard.statuses.get(target_id) {
                return vec![existing.clone()];
            }
            return vec![SshStatus::idle(target_id)];
        }

        let mut map = guard.statuses.clone();
        drop(guard);

        let persisted = self.instances_get();
        if let Some(list) = persisted.get("instances").and_then(Value::as_array) {
            for item in list {
                if let Some(inst_id) = item.get("id").and_then(Value::as_str) {
                    map.entry(inst_id.to_string())
                        .or_insert_with(|| SshStatus::idle(inst_id));
                }
            }
        }

        let mut values: Vec<SshStatus> = map.into_values().collect();
        values.sort_by(|a, b| a.id.cmp(&b.id));
        values
    }

    pub fn logs(&self, id: &str, limit: Option<usize>) -> Vec<String> {
        let guard = self.inner.lock().unwrap();
        let Some(entries) = guard.logs.get(id) else {
            return Vec::new();
        };
        let cap = limit.unwrap_or(200).clamp(1, MAX_LOG_LINES);
        let skip = entries.len().saturating_sub(cap);
        entries.iter().skip(skip).cloned().collect()
    }

    pub fn logs_clear(&self, id: &str) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(entries) = guard.logs.get_mut(id) {
            entries.clear();
        }
    }

    fn append_log(&self, id: &str, line: impl Into<String>) {
        let line = line.into();
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            return;
        }
        let mut guard = self.inner.lock().unwrap();
        let buf = guard.logs.entry(id.to_string()).or_default();
        if buf.len() >= MAX_LOG_LINES {
            buf.pop_front();
        }
        buf.push_back(trimmed.to_string());
    }

    fn set_status(&self, app: &AppHandle, status: SshStatus) {
        {
            let mut guard = self.inner.lock().unwrap();
            guard.statuses.insert(status.id.clone(), status.clone());
        }
        let _ = app.emit(STATUS_EVENT_NAME, &status);
    }

    pub fn disconnect(&self, app: &AppHandle, id: &str) {
        let removed = {
            let mut guard = self.inner.lock().unwrap();
            guard.tunnels.remove(id)
        };
        if let Some(tunnel) = removed {
            kill_child_slot(&tunnel.child);
            self.append_log(id, "[spleen] Disconnected SSH tunnel.");
        }
        self.set_status(app, SshStatus::idle(id));
    }

    pub fn shutdown_all(&self) {
        let tunnels: Vec<ActiveTunnel> = {
            let mut guard = self.inner.lock().unwrap();
            guard.tunnels.drain().map(|(_, t)| t).collect()
        };
        for tunnel in tunnels {
            kill_child_slot(&tunnel.child);
        }
    }

    pub fn connect(&self, app: AppHandle, id: String) -> Result<(), String> {
        let persisted = self.instances_get();
        let instance = persisted
            .get("instances")
            .and_then(Value::as_array)
            .and_then(|arr| {
                arr.iter()
                    .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
            })
            .cloned()
            .ok_or_else(|| format!("SSH instance '{id}' not found"))?;

        // Tear down any previous tunnel for this instance before starting a new one.
        let generation = {
            let mut guard = self.inner.lock().unwrap();
            if let Some(prev) = guard.tunnels.remove(&id) {
                kill_child_slot(&prev.child);
            }
            guard.next_generation = guard.next_generation.wrapping_add(1).max(1);
            guard.next_generation
        };

        let manager = self.clone();
        std::thread::spawn(move || {
            manager.run_connect_pipeline(app, id, instance, generation);
        });
        Ok(())
    }

    fn is_generation_current(&self, id: &str, generation: u64) -> bool {
        let guard = self.inner.lock().unwrap();
        guard
            .tunnels
            .get(id)
            .map(|t| t.generation == generation)
            .unwrap_or(false)
    }

    fn run_connect_pipeline(&self, app: AppHandle, id: String, instance: Value, generation: u64) {
        let child_slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
        {
            let mut guard = self.inner.lock().unwrap();
            guard.tunnels.insert(
                id.clone(),
                ActiveTunnel {
                    generation,
                    child: Arc::clone(&child_slot),
                },
            );
        }

        let fail_status = |phase_detail: String, needs_user: bool| {
            self.append_log(&id, format!("[spleen] Error: {phase_detail}"));
            self.set_status(
                &app,
                SshStatus {
                    id: id.clone(),
                    phase: "error".to_string(),
                    detail: Some(phase_detail),
                    local_url: None,
                    local_port: None,
                    remote_port: None,
                    started_by_us: false,
                    retry_attempt: 0,
                    requires_user_action: needs_user,
                    updated_at_ms: now_ms(),
                },
            );
        };

        let ssh_args = extract_ssh_args(&instance);
        if ssh_args.is_empty() {
            fail_status("Missing SSH command or destination host.".into(), true);
            return;
        }

        let timeout_sec = instance
            .get("connectionTimeoutSec")
            .and_then(Value::as_u64)
            .unwrap_or(30)
            .clamp(5, 180);

        let remote_cfg = instance
            .get("remoteSpleen")
            .or_else(|| instance.get("remote_spleen"));
        let remote_mode = remote_cfg
            .and_then(|r| r.get("mode"))
            .and_then(Value::as_str)
            .unwrap_or("managed");
        let preferred_remote_port = remote_cfg
            .and_then(|r| r.get("preferredPort").or_else(|| r.get("preferred_port")))
            .and_then(Value::as_u64)
            .and_then(|p| u16::try_from(p).ok())
            .filter(|&p| p > 0)
            .unwrap_or(3000);
        let remote_bind_host = remote_cfg
            .and_then(|r| r.get("bindHost").or_else(|| r.get("bind_host")))
            .and_then(Value::as_str)
            .unwrap_or("127.0.0.1");

        let local_cfg = instance
            .get("localForward")
            .or_else(|| instance.get("local_forward"));
        let local_bind_host = local_cfg
            .and_then(|l| l.get("bindHost").or_else(|| l.get("bind_host")))
            .and_then(Value::as_str)
            .unwrap_or("127.0.0.1")
            .to_string();
        let preferred_local_port = local_cfg
            .and_then(|l| {
                l.get("preferredLocalPort")
                    .or_else(|| l.get("preferred_local_port"))
            })
            .and_then(Value::as_u64)
            .and_then(|p| u16::try_from(p).ok())
            .filter(|&p| p > 0);

        let local_port = match pick_local_port(&local_bind_host, preferred_local_port) {
            Ok(p) => p,
            Err(err) => {
                fail_status(format!("Could not reserve local port: {err}"), false);
                return;
            }
        };

        self.append_log(
            &id,
            format!(
                "[spleen] Connecting (mode={remote_mode}, local={local_bind_host}:{local_port} -> remote=127.0.0.1:{preferred_remote_port})"
            ),
        );
        self.set_status(
            &app,
            SshStatus {
                id: id.clone(),
                phase: "config_resolved".to_string(),
                detail: Some(format!("Resolved target via {}", ssh_args.join(" "))),
                local_url: None,
                local_port: Some(local_port),
                remote_port: Some(preferred_remote_port),
                started_by_us: false,
                retry_attempt: 0,
                requires_user_action: false,
                updated_at_ms: now_ms(),
            },
        );

        if !self.is_generation_current(&id, generation) {
            return;
        }

        self.set_status(
            &app,
            SshStatus {
                id: id.clone(),
                phase: "master_connecting".to_string(),
                detail: Some("Checking SSH connectivity and authentication…".into()),
                local_url: None,
                local_port: Some(local_port),
                remote_port: Some(preferred_remote_port),
                started_by_us: false,
                retry_attempt: 0,
                requires_user_action: false,
                updated_at_ms: now_ms(),
            },
        );

        let ssh_bin = resolve_ssh_binary();
        let mut probe_cmd = build_ssh_command(&ssh_bin);
        probe_cmd
            .args([
                "-o",
                "BatchMode=yes",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                &format!("ConnectTimeout={timeout_sec}"),
            ])
            .args(&ssh_args)
            .arg("echo SPLEEN_SSH_OK");

        let probe_output = match probe_cmd.output() {
            Ok(out) => out,
            Err(err) => {
                fail_status(
                    format!("Failed to run OpenSSH client ({ssh_bin}): {err}. Ensure Windows OpenSSH Client is installed."),
                    true,
                );
                return;
            }
        };

        if !self.is_generation_current(&id, generation) {
            return;
        }

        if !probe_output.status.success() {
            let stderr = String::from_utf8_lossy(&probe_output.stderr).trim().to_string();
            if !stderr.is_empty() {
                self.append_log(&id, format!("[ssh] {stderr}"));
            }
            let auth_hint = stderr.to_lowercase().contains("permission denied")
                || stderr.to_lowercase().contains("host key")
                || stderr.to_lowercase().contains("passphrase");
            let detail = if stderr.is_empty() {
                format!("SSH probe exited with status {}", probe_output.status)
            } else {
                stderr
            };
            fail_status(detail, auth_hint);
            return;
        }

        self.append_log(&id, "[spleen] SSH authentication succeeded.");

        let mut started_by_us = false;
        let remote_port = preferred_remote_port;

        if remote_mode == "managed" {
            self.set_status(
                &app,
                SshStatus {
                    id: id.clone(),
                    phase: "server_detecting".to_string(),
                    detail: Some(format!("Checking remote Spleen server on port {remote_port}…")),
                    local_url: None,
                    local_port: Some(local_port),
                    remote_port: Some(remote_port),
                    started_by_us: false,
                    retry_attempt: 0,
                    requires_user_action: false,
                    updated_at_ms: now_ms(),
                },
            );

            let check_script = format!(
                "if (command -v curl >/dev/null 2>&1 && curl -fsS http://127.0.0.1:{remote_port}/health >/dev/null 2>&1); then echo RUNNING; \
                 elif command -v spleen >/dev/null 2>&1; then nohup spleen serve --port {remote_port} --host {remote_bind_host} >/tmp/spleen-remote-{remote_port}.log 2>&1 </dev/null & echo STARTED; \
                 else echo NOT_INSTALLED; fi"
            );
            let mut detect_cmd = build_ssh_command(&ssh_bin);
            detect_cmd
                .args([
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    &format!("ConnectTimeout={timeout_sec}"),
                ])
                .args(&ssh_args)
                .arg(check_script);

            if let Ok(out) = detect_cmd.output() {
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                if !stderr.is_empty() {
                    self.append_log(&id, format!("[remote] {stderr}"));
                }
                if stdout.contains("STARTED") {
                    started_by_us = true;
                    self.append_log(&id, format!("[spleen] Started remote Spleen server on port {remote_port}."));
                    self.set_status(
                        &app,
                        SshStatus {
                            id: id.clone(),
                            phase: "server_starting".to_string(),
                            detail: Some(format!("Starting remote Spleen server on port {remote_port}…")),
                            local_url: None,
                            local_port: Some(local_port),
                            remote_port: Some(remote_port),
                            started_by_us: true,
                            retry_attempt: 0,
                            requires_user_action: false,
                            updated_at_ms: now_ms(),
                        },
                    );
                    std::thread::sleep(Duration::from_millis(1200));
                } else if stdout.contains("RUNNING") {
                    self.append_log(&id, format!("[spleen] Detected running remote server on port {remote_port}."));
                } else {
                    self.append_log(
                        &id,
                        format!("[spleen] Remote CLI not found in PATH; forwarding directly to 127.0.0.1:{remote_port}."),
                    );
                }
            }
        }

        if !self.is_generation_current(&id, generation) {
            return;
        }

        self.set_status(
            &app,
            SshStatus {
                id: id.clone(),
                phase: "forwarding".to_string(),
                detail: Some(format!(
                    "Opening tunnel {local_bind_host}:{local_port} -> 127.0.0.1:{remote_port}…"
                )),
                local_url: None,
                local_port: Some(local_port),
                remote_port: Some(remote_port),
                started_by_us,
                retry_attempt: 0,
                requires_user_action: false,
                updated_at_ms: now_ms(),
            },
        );

        let mut tunnel_cmd = build_ssh_command(&ssh_bin);
        tunnel_cmd
            .args([
                "-N",
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "ServerAliveInterval=15",
                "-o",
                "ServerAliveCountMax=3",
                "-o",
                &format!("ConnectTimeout={timeout_sec}"),
                "-L",
                &format!("{local_bind_host}:{local_port}:127.0.0.1:{remote_port}"),
            ]);

        // Attach extra user-configured port forwards (-L, -R, -D)
        if let Some(forwards) = instance
            .get("portForwards")
            .or_else(|| instance.get("port_forwards"))
            .and_then(Value::as_array)
        {
            for fwd in forwards {
                if fwd.get("enabled").and_then(Value::as_bool) == Some(false) {
                    continue;
                }
                let kind = fwd.get("type").and_then(Value::as_str).unwrap_or("local");
                let l_host = fwd
                    .get("localHost")
                    .or_else(|| fwd.get("local_host"))
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("127.0.0.1");
                let l_port = fwd
                    .get("localPort")
                    .or_else(|| fwd.get("local_port"))
                    .and_then(Value::as_u64);
                let r_host = fwd
                    .get("remoteHost")
                    .or_else(|| fwd.get("remote_host"))
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("127.0.0.1");
                let r_port = fwd
                    .get("remotePort")
                    .or_else(|| fwd.get("remote_port"))
                    .and_then(Value::as_u64);
                match kind {
                    "local" => {
                        if let (Some(lp), Some(rp)) = (l_port, r_port) {
                            tunnel_cmd.args(["-L", &format!("{l_host}:{lp}:{r_host}:{rp}")]);
                        }
                    }
                    "remote" => {
                        if let (Some(lp), Some(rp)) = (l_port, r_port) {
                            tunnel_cmd.args(["-R", &format!("{r_host}:{rp}:{l_host}:{lp}")]);
                        }
                    }
                    "dynamic" => {
                        if let Some(lp) = l_port {
                            tunnel_cmd.args(["-D", &format!("{l_host}:{lp}")]);
                        }
                    }
                    _ => {}
                }
            }
        }

        tunnel_cmd
            .args(&ssh_args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = match tunnel_cmd.spawn() {
            Ok(child) => child,
            Err(err) => {
                fail_status(format!("Failed to launch SSH tunnel: {err}"), false);
                return;
            }
        };

        if let Some(stdout) = child.stdout.take() {
            let log_mgr = self.clone();
            let log_id = id.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    log_mgr.append_log(&log_id, format!("[ssh] {line}"));
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let log_mgr = self.clone();
            let log_id = id.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    log_mgr.append_log(&log_id, format!("[ssh!] {line}"));
                }
            });
        }

        {
            let mut slot = child_slot.lock().unwrap();
            *slot = Some(child);
        }

        // Wait up to 8 seconds for the forwarded local port to open while checking process liveness
        let connect_host = if local_bind_host == "0.0.0.0" {
            "127.0.0.1"
        } else {
            local_bind_host.as_str()
        };
        let mut opened = false;
        for _ in 0..32 {
            if !self.is_generation_current(&id, generation) {
                kill_child_slot(&child_slot);
                return;
            }
            let exited = {
                let mut slot = child_slot.lock().unwrap();
                match slot.as_mut() {
                    Some(c) => matches!(c.try_wait(), Ok(Some(_))),
                    None => true,
                }
            };
            if exited {
                let recent = self.logs(&id, Some(3)).join(" | ");
                fail_status(
                    if recent.is_empty() {
                        "SSH tunnel exited before port forwarding became ready.".into()
                    } else {
                        recent
                    },
                    false,
                );
                return;
            }
            if TcpStream::connect_timeout(
                &format!("127.0.0.1:{local_port}").parse().unwrap(),
                Duration::from_millis(200),
            )
            .is_ok()
            {
                opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }

        if !self.is_generation_current(&id, generation) {
            kill_child_slot(&child_slot);
            return;
        }

        let local_url = format!("http://{connect_host}:{local_port}");
        self.append_log(
            &id,
            format!(
                "[spleen] Tunnel ready at {local_url}{}",
                if opened { "" } else { " (waiting for remote service)" }
            ),
        );
        self.set_status(
            &app,
            SshStatus {
                id: id.clone(),
                phase: "ready".to_string(),
                detail: Some(format!("Connected via {local_url}")),
                local_url: Some(local_url),
                local_port: Some(local_port),
                remote_port: Some(remote_port),
                started_by_us,
                retry_attempt: 0,
                requires_user_action: false,
                updated_at_ms: now_ms(),
            },
        );

        // Background liveness monitor for this tunnel
        let monitor_mgr = self.clone();
        let monitor_app = app.clone();
        let monitor_id = id.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(2));
            if !monitor_mgr.is_generation_current(&monitor_id, generation) {
                break;
            }
            let exit_status = {
                let mut slot = child_slot.lock().unwrap();
                match slot.as_mut() {
                    Some(c) => match c.try_wait() {
                        Ok(Some(status)) => Some(status),
                        Ok(None) => None,
                        Err(_) => None,
                    },
                    None => break,
                }
            };
            if let Some(status) = exit_status {
                if !monitor_mgr.is_generation_current(&monitor_id, generation) {
                    break;
                }
                {
                    let mut guard = monitor_mgr.inner.lock().unwrap();
                    if guard
                        .tunnels
                        .get(&monitor_id)
                        .map(|t| t.generation == generation)
                        .unwrap_or(false)
                    {
                        guard.tunnels.remove(&monitor_id);
                    }
                }
                let recent = monitor_mgr.logs(&monitor_id, Some(2)).join(" | ");
                let detail = if recent.is_empty() {
                    format!("SSH tunnel closed ({status})")
                } else {
                    recent
                };
                monitor_mgr.append_log(&monitor_id, format!("[spleen] {detail}"));
                monitor_mgr.set_status(
                    &monitor_app,
                    SshStatus {
                        id: monitor_id.clone(),
                        phase: "error".to_string(),
                        detail: Some(detail),
                        local_url: None,
                        local_port: None,
                        remote_port: Some(remote_port),
                        started_by_us,
                        retry_attempt: 0,
                        requires_user_action: false,
                        updated_at_ms: now_ms(),
                    },
                );
                break;
            }
        });
    }
}

fn kill_child_slot(slot: &Arc<Mutex<Option<Child>>>) {
    if let Ok(mut guard) = slot.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn resolve_ssh_binary() -> String {
    #[cfg(windows)]
    {
        let sys_ssh = Path::new(r"C:\Windows\System32\OpenSSH\ssh.exe");
        if sys_ssh.exists() {
            return sys_ssh.to_string_lossy().to_string();
        }
        "ssh.exe".to_string()
    }
    #[cfg(not(windows))]
    {
        "ssh".to_string()
    }
}

fn build_ssh_command(bin: &str) -> Command {
    let mut cmd = Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn pick_local_port(bind_host: &str, preferred: Option<u16>) -> std::io::Result<u16> {
    let host = if bind_host == "localhost" {
        "127.0.0.1"
    } else {
        bind_host
    };
    if let Some(port) = preferred {
        if let Ok(listener) = TcpListener::bind(format!("{host}:{port}")) {
            let actual = listener.local_addr()?.port();
            drop(listener);
            return Ok(actual);
        }
    }
    let listener = TcpListener::bind(format!("{host}:0"))?;
    let actual = listener.local_addr()?.port();
    drop(listener);
    Ok(actual)
}

fn extract_ssh_args(instance: &Value) -> Vec<String> {
    if let Some(parsed) = instance.get("sshParsed").and_then(Value::as_object) {
        let dest = parsed
            .get("destination")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if !dest.is_empty() {
            let mut out: Vec<String> = parsed
                .get("args")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            out.push(dest.to_string());
            return out;
        }
    }

    let raw = instance
        .get("sshCommand")
        .or_else(|| instance.get("ssh_command"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut tokens = split_shell_words(raw);
    if let Some(first) = tokens.first() {
        let low = first.to_lowercase();
        if low == "ssh" || low == "ssh.exe" || low.ends_with("\\ssh.exe") || low.ends_with("/ssh") {
            tokens.remove(0);
        }
    }
    tokens
}

fn split_shell_words(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match quote {
            Some(q) => {
                if ch == q {
                    quote = None;
                } else {
                    cur.push(ch);
                }
            }
            None => match ch {
                '\'' | '"' => quote = Some(ch),
                c if c.is_whitespace() => {
                    if !cur.is_empty() {
                        out.push(std::mem::take(&mut cur));
                    }
                }
                _ => cur.push(ch),
            },
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn parse_ssh_config_file(
    path: &Path,
    depth: u8,
    seen: &mut HashSet<String>,
    out: &mut Vec<SshImportCandidate>,
) {
    if depth > 3 {
        return;
    }
    let Ok(content) = std::fs::read_to_string(path) else {
        return;
    };
    let source = path.to_string_lossy().to_string();
    let parent_dir = path.parent().unwrap_or_else(|| Path::new("."));

    for raw_line in content.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(keyword) = parts.next() else {
            continue;
        };
        if keyword.eq_ignore_ascii_case("Include") {
            for target in parts {
                let expanded = if target.starts_with("~/") || target.starts_with("~\\") {
                    PathBuf::from(crate::paths::home_dir()).join(&target[2..])
                } else {
                    let p = PathBuf::from(target);
                    if p.is_absolute() {
                        p
                    } else {
                        parent_dir.join(p)
                    }
                };
                if expanded.is_file() {
                    parse_ssh_config_file(&expanded, depth + 1, seen, out);
                } else if let Some(dir) = expanded.parent() {
                    if dir.is_dir() {
                        if let Ok(entries) = std::fs::read_dir(dir) {
                            for entry in entries.flatten() {
                                let p = entry.path();
                                if p.is_file() {
                                    parse_ssh_config_file(&p, depth + 1, seen, out);
                                }
                            }
                        }
                    }
                }
            }
            continue;
        }
        if keyword.eq_ignore_ascii_case("Host") {
            for token in parts {
                let host = token.trim();
                if host.is_empty() || host.starts_with('!') || host == "*" {
                    continue;
                }
                let is_pattern = host.contains('*') || host.contains('?') || host.contains('[');
                if seen.insert(host.to_lowercase()) {
                    out.push(SshImportCandidate {
                        host: host.to_string(),
                        pattern: is_pattern,
                        source: source.clone(),
                        ssh_command: format!("ssh {host}"),
                    });
                }
            }
        }
    }
}
