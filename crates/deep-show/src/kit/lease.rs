//! The machine's one GPU lease (#3219; design: Lease, Export, Render-back). With a hub answering,
//! deep-show holds the lease table's `gpu` lease while it draws on the GPU: shared for a kit and
//! for render-back, exclusive for an export and a timing reading, the modes #1015 set. It asks as
//! `deep lease` does, in the hub's one queue (`lease.gpu`), which serves waiters in the order they
//! asked, and shows the hub's line once a minute while it waits. Under a `deep lease` whose command
//! holds the GPU it draws under that lease, which the hub reads from the process table; the
//! environment alone never counts. With no hub, the file `~/.cache/deepbuild-gpu/lease` is the
//! lease, as before, and the reply says the lease was the file's. A kit that holds neither once
//! its wait ends answers its GPU cases BLOCKED (#2133).

use std::io::{BufRead, BufReader, Write as _};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// #3219's wrong programs, chosen by a scenario's `planted`: a deep-show that takes the file
/// beside a live hub; one that trusts `DEEP_LEASED` and draws with no lease; and an export whose
/// receipt writes a lease record of its own instead of the table's.
pub const FILE_BESIDE_HUB: &str = "kit_takes_file_beside_hub";
pub const TRUSTS_ENVIRONMENT: &str = "trusts_leased_env";
pub const OWN_RECORD: &str = "receipt_writes_own_lease";
pub const PLANTED: [&str; 3] = [FILE_BESIDE_HUB, TRUSTS_ENVIRONMENT, OWN_RECORD];

/// How long a kit waits for the lease: 600 tries 500 ms apart before #3219.
const KIT_WAIT: Duration = Duration::from_secs(300);
/// How often a waiter asks again, and how often it shows the hub's line: `deep lease`'s.
const POLL: Duration = Duration::from_millis(250);
const LINE_EVERY: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Shared,
    Exclusive,
}

impl Mode {
    fn name(self) -> &'static str {
        match self {
            Mode::Shared => "shared",
            Mode::Exclusive => "exclusive",
        }
    }
}

/// Set while a kit's GPU cases run with no GPU lease held: each answers BLOCKED instead of drawing.
static UNLEASED: AtomicBool = AtomicBool::new(false);

/// Whether the kit's GPU cases run with no lease held, so each answers BLOCKED.
pub fn unleased() -> bool {
    UNLEASED.load(Ordering::Relaxed)
}

/// #231: set while the kit's laws part exports under the lease the kit holds: an export's lease
/// is then the kit's, so it never waits for its own process.
static WITHIN: AtomicBool = AtomicBool::new(false);

/// Until it is dropped, an export of this process draws under the kit's own lease.
pub struct Within(());

/// The kit's lease covers the exports made until the answer is dropped.
pub fn within() -> Within {
    WITHIN.store(true, Ordering::Relaxed);
    Within(())
}

impl Drop for Within {
    fn drop(&mut self) {
        WITHIN.store(false, Ordering::Relaxed);
    }
}

/// The kit's GPU lease, shared, for `wait`: while it isn't held, `unleased` says so.
pub fn kit(planted: Option<&str>) -> GpuLease {
    let lease = GpuLease::take(Mode::Shared, "deep-show kit", Some(KIT_WAIT), planted);
    UNLEASED.store(!lease.held(), Ordering::Relaxed);
    lease
}

/// The GPU lease this process holds, until it is released or dropped.
pub struct GpuLease {
    held: Held,
    /// When it was asked for, in ms since the Unix epoch.
    asked: u64,
}

enum Held {
    /// The table's lease, this process's until it lets it go: `{id, resource, mode, holder, asked, granted}`.
    Table {
        hub: Hub,
        ticket: Value,
        secret: Value,
        lease: Value,
    },
    /// The lease a `deep lease` above this process holds, as the hub read it; that command lets it go.
    Above { lease: Value, command: Value },
    /// No hub answered: the file is the lease.
    File { path: PathBuf, acquired: u64 },
    /// Neither was held once the wait ended.
    Nothing { why: String },
    /// The planted program that takes `DEEP_LEASED` at its word and holds nothing.
    Trusted,
    /// #231: the kit's lease, which this process holds already.
    Within,
    /// Let go.
    Released,
}

impl GpuLease {
    /// Waits for the GPU lease in `mode` as `what` (a kit, an export), for `wait` or, with none, as long as it takes.
    pub fn take(mode: Mode, what: &str, wait: Option<Duration>, planted: Option<&str>) -> GpuLease {
        let asked = now_ms();
        let deadline = wait.map(|w| Instant::now() + w);
        let held = if WITHIN.load(Ordering::Relaxed) {
            Held::Within
        } else if planted == Some(TRUSTS_ENVIRONMENT) && std::env::var_os("DEEP_LEASED").is_some() {
            Held::Trusted
        } else {
            let hub = (planted != Some(FILE_BESIDE_HUB)).then(Hub::find).flatten();
            // A hub that can't lease the GPU, or that stops answering, leaves the file as the lease.
            match hub.map(|h| table(h, mode, what, deadline)) {
                Some(Ok(held)) => held,
                _ => file(deadline),
            }
        };
        GpuLease { held, asked }
    }

    /// Whether it holds the GPU, by the table's lease, an ancestor's or the file.
    pub fn held(&self) -> bool {
        !matches!(self.held, Held::Nothing { .. } | Held::Released)
    }

    /// What a kit's reply says of it: whether it holds the GPU, and whose lease it is.
    pub fn reply(&self) -> Value {
        match &self.held {
            Held::Table { lease, .. } => {
                json!({"gpu": true, "from": "table", "id": lease["id"], "mode": lease["mode"]})
            }
            Held::Above { lease, command } => {
                json!({"gpu": true, "from": "table", "id": lease["id"], "mode": lease["mode"], "above": command})
            }
            Held::File { .. } => json!({"gpu": true, "from": "file"}),
            Held::Trusted => json!({"gpu": true, "from": "environment"}),
            Held::Within => json!({"gpu": true, "from": "kit"}),
            Held::Nothing { why } => json!({"gpu": false, "why": why}),
            Held::Released => json!({"gpu": false}),
        }
    }

    /// Lets it go: the record an export's receipt keeps. The table's lease is named by its ID with
    /// the table's three times; the file's, or the planted program's own, by this process's clock.
    pub fn release(mut self, holder: &str, planted: Option<&str>) -> Value {
        let held = std::mem::replace(&mut self.held, Held::Released);
        let (asked, now) = (self.asked, now_ms());
        let own = |from: &str, acquired: u64| {
            json!({"from": from, "resource": {"host": "local", "kind": "gpu", "key": "gpu"}, "holder": holder,
                "asked": asked, "acquired": acquired, "waited_ms": acquired.saturating_sub(asked), "released": now})
        };
        match held {
            Held::Table {
                hub,
                ticket,
                secret,
                lease,
            } => {
                let released = hub
                    .call("lease.release", json!({"ticket": ticket, "secret": secret}))
                    .ok()
                    .and_then(|r| r["released"].as_u64());
                if planted == Some(OWN_RECORD) {
                    let mut record = own("table", asked);
                    record["id"] = json!(format!("lease:{}", std::process::id()));
                    return record;
                }
                table_record(&lease, "table", released)
            }
            Held::Above { lease, .. } => table_record(&lease, "above", None),
            Held::File { path, acquired } => {
                let _ = std::fs::remove_file(path);
                own("file", acquired)
            }
            Held::Trusted => own("environment", now_ms()),
            Held::Within => own("kit", asked),
            Held::Nothing { .. } | Held::Released => json!({"from": "none"}),
        }
    }
}

impl Drop for GpuLease {
    fn drop(&mut self) {
        UNLEASED.store(false, Ordering::Relaxed);
        match std::mem::replace(&mut self.held, Held::Released) {
            Held::Table {
                hub,
                ticket,
                secret,
                ..
            } => {
                let _ = hub.call("lease.release", json!({"ticket": ticket, "secret": secret}));
            }
            Held::File { path, .. } => {
                let _ = std::fs::remove_file(path);
            }
            _ => {}
        }
    }
}

/// A table lease's record: its ID, resource, mode and holder, and when it was asked for, granted and released.
fn table_record(lease: &Value, from: &str, released: Option<u64>) -> Value {
    let (asked, granted) = (lease["asked"].as_u64(), lease["granted"].as_u64());
    json!({"from": from, "id": lease["id"], "resource": lease["resource"], "mode": lease["mode"], "holder": lease["holder"],
        "asked": asked, "acquired": granted, "waited_ms": granted.zip(asked).map(|(g, a)| g.saturating_sub(a)),
        "released": released})
}

/// The table's lease, through the hub's queue; `Err` when the hub can't lease the GPU or stops answering.
fn table(hub: Hub, mode: Mode, what: &str, deadline: Option<Instant>) -> Result<Held, ()> {
    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let mut reply = hub.call(
        "lease.gpu",
        json!({"mode": mode.name(), "what": what, "cwd": cwd}),
    )?;
    let mut shown: Option<Instant> = None;
    loop {
        match reply["status"].as_str() {
            Some("granted") if reply["above"].is_object() => {
                return Ok(Held::Above {
                    lease: reply["lease"].clone(),
                    command: reply["above"]["command"].clone(),
                })
            }
            Some("granted") => {
                return Ok(Held::Table {
                    ticket: reply["ticket"].clone(),
                    secret: reply["secret"].clone(),
                    lease: reply["lease"].clone(),
                    hub,
                })
            }
            Some("waiting") => {}
            _ => return Err(()),
        }
        let place = json!({"ticket": reply["ticket"], "secret": reply["secret"]});
        let line = reply["line"].as_str().unwrap_or_default().to_string();
        if deadline.is_some_and(|d| Instant::now() >= d) {
            let _ = hub.call("lease.release", place);
            return Ok(Held::Nothing {
                why: format!("no GPU lease after the wait: {line}"),
            });
        }
        if shown.is_none_or(|s| s.elapsed() >= LINE_EVERY) {
            eprintln!("{line}");
            shown = Some(Instant::now());
        }
        std::thread::sleep(POLL);
        reply = hub.call("lease.gpu", place)?;
    }
}

/// The file as the lease, with no hub to ask: created new and holding this process's ID.
fn file(deadline: Option<Instant>) -> Held {
    let dir = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(".cache")
        .join("deepbuild-gpu");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("lease");
    loop {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut f) => {
                let _ = write!(f, "{}", std::process::id());
                return Held::File {
                    path,
                    acquired: now_ms(),
                };
            }
            Err(_) => {
                // A lease whose holder is gone was left by a killed run.
                let holder: Option<i32> = std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|s| s.trim().parse().ok());
                let alive = holder.is_some_and(|pid| unsafe { libc::kill(pid, 0) } == 0);
                if !alive {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
                if deadline.is_some_and(|d| Instant::now() >= d) {
                    return Held::Nothing {
                        why: format!(
                            "no GPU lease after the wait: {} is held by process {}",
                            path.display(),
                            holder.unwrap_or_default()
                        ),
                    };
                }
                std::thread::sleep(Duration::from_millis(if deadline.is_some() {
                    500
                } else {
                    50
                }));
            }
        }
    }
}

/// The hub this process's HOME names, as deep-hook and the deep commands find it.
struct Hub {
    socket: PathBuf,
    token: String,
}

impl Hub {
    /// `hub.use`'s dev hub for this folder, else `hub.address`, else `~/.deepbuild/hub.sock`, with
    /// the control token beside it, else the installed hub's; none without a token to present.
    fn find() -> Option<Hub> {
        let root = PathBuf::from(std::env::var_os("HOME")?).join(".deepbuild");
        let config: Value = std::fs::read_to_string(root.join("config.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let hub = &config["hub"];
        let socket = used(&hub["use"])
            .or_else(|| {
                hub["address"]
                    .as_str()?
                    .strip_prefix("unix:")
                    .map(PathBuf::from)
            })
            .unwrap_or_else(|| root.join("hub.sock"));
        let beside = socket.with_file_name("control.token");
        let token = if beside.exists() {
            beside
        } else {
            root.join("control.token")
        };
        let token = std::fs::read_to_string(token).ok()?.trim().to_string();
        Some(Hub { socket, token })
    }

    /// One call as the `cli` role, naming this process as the peer: its result, or `Err` for no answer or a refusal.
    fn call(&self, method: &str, params: Value) -> Result<Value, ()> {
        let stream = UnixStream::connect(&self.socket).map_err(drop)?;
        stream
            .set_read_timeout(Some(Duration::from_secs(60)))
            .map_err(drop)?;
        let mut out = stream.try_clone().map_err(drop)?;
        let mut lines = BufReader::new(stream).lines();
        let mut next = || -> Result<Value, ()> {
            serde_json::from_str(&lines.next().ok_or(())?.map_err(drop)?).map_err(drop)
        };
        if next()?["hello"] != "deep-hub" {
            return Err(());
        }
        let peer = json!({"pid": std::process::id(), "start": started()});
        writeln!(
            out,
            "{}",
            json!({"v": 1, "hello": "cli", "token": self.token, "peer": peer})
        )
        .map_err(drop)?;
        while next()?.get("role").is_none() {}
        writeln!(
            out,
            "{}",
            json!({"v": 1, "id": 1, "method": method, "params": params})
        )
        .map_err(drop)?;
        loop {
            let reply = next()?;
            if reply["id"] == 1 {
                return reply.get("result").cloned().ok_or(());
            }
        }
    }
}

/// The dev hub `hub.use` sends the folder this process runs in to, the longest worktree winning.
fn used(uses: &Value) -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    let real = std::fs::canonicalize(&cwd).unwrap_or_else(|_| cwd.clone());
    uses.as_object()?
        .iter()
        .filter_map(|(worktree, a)| {
            Some((PathBuf::from(worktree), a.as_str()?.strip_prefix("unix:")?))
        })
        .filter(|(worktree, _)| real.starts_with(worktree) || cwd.starts_with(worktree))
        .max_by_key(|(worktree, _)| worktree.as_os_str().len())
        .map(|(_, path)| PathBuf::from(path))
}

/// This process's start as `ps -o lstart=` prints it under LC_ALL=C, which the hub compares with
/// its own reading to find the session above it; read once.
fn started() -> &'static str {
    static STARTED: OnceLock<String> = OnceLock::new();
    STARTED.get_or_init(read_start)
}

#[cfg(target_os = "macos")]
fn read_start() -> String {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let pid = std::process::id() as i32;
    let read =
        unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&raw mut info).cast(), size) };
    if read != size {
        return String::new();
    }
    let at = info.pbi_start_tvsec as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    if unsafe { libc::localtime_r(&at, &mut tm) }.is_null() {
        return String::new();
    }
    // The C locale's `%c`, which this process keeps: it never sets another.
    let mut buf = [0u8; 64];
    let n = unsafe {
        libc::strftime(
            buf.as_mut_ptr().cast(),
            buf.len(),
            c"%a %b %e %H:%M:%S %Y".as_ptr(),
            &tm,
        )
    };
    String::from_utf8_lossy(&buf[..n]).into_owned()
}

#[cfg(not(target_os = "macos"))]
fn read_start() -> String {
    std::process::Command::new("ps")
        .args(["-o", "lstart=", "-p", &std::process::id().to_string()])
        .env("LC_ALL", "C")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}
