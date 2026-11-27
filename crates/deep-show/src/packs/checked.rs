//! A pack check's result, kept (#3611; canvas primitives: Pack: a check's result, kept). The
//! core that checks a pack version writes a row in the store the hub names, marked under the
//! hub's launch key. A later core of the same hub takes the row when the mark verifies and the
//! pack's bytes, the versions it requires, the build and the planted programs are the row's,
//! and then runs no part of the check. Any other row runs the check, which replaces it.

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use deep_canvas::document::Packs;
use deep_canvas::schedule::{canonical, sha256_hex};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// The planted cores of #3611's criteria, each a core that takes a row it must not.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fault {
    /// Takes a row whose digest isn't the digest of the bytes it read.
    AnyDigest,
    /// Takes a row another build wrote.
    AnyBuild,
    /// Reads a file it can't read as text as installed, with nothing its check left.
    AdmitsUnreadable,
}

/// The scenario `planted` names of [`Fault`]'s cores.
pub const PLANTED: [(&str, Fault); 3] = [
    ("takes_row_of_another_digest", Fault::AnyDigest),
    ("takes_row_of_another_build", Fault::AnyBuild),
    ("admits_on_unreadable_row", Fault::AdmitsUnreadable),
];

/// The store's folder and the launch key, as the world's `pack_checks` gives them, with what
/// this core's rows name beside a pack: the build and the wrong programs it was started with.
pub struct Store {
    dir: PathBuf,
    key: [u8; 32],
    planted: String,
    fault: Option<Fault>,
}

/// The wrong programs a build was compiled with, by Cargo feature (`build.rs`): none for the
/// shipped set.
const FEATURES: &str = env!("DEEP_FEATURES");

thread_local! {
    /// The wrong program this process was started with (`--planted <name>`), or none.
    static STARTED: RefCell<String> = const { RefCell::new(String::new()) };
    /// What this process's pack checks have run since it started: kits, field checks, rewrites,
    /// program runs and compiles.
    static RAN: Cell<[u64; 5]> = const { Cell::new([0; 5]) };
}

/// Notes the wrong program this process was started with, which its rows then name.
pub fn started(planted: &str) {
    STARTED.with(|s| *s.borrow_mut() = planted.to_string());
}

/// A scenario's `pack_checks: {dir, key}`: the key 32 bytes in hex. `planted` is the scenario's
/// own wrong program. `Some(None)` for a scenario that names no store, `None` for a bad one.
pub fn given(input: &Map<String, Value>) -> Option<Option<Store>> {
    let Some(named) = input.get("pack_checks") else {
        return Some(None);
    };
    let hex = named.get("key")?.as_str().filter(|k| k.len() == 64)?;
    let mut key = [0u8; 32];
    for (i, byte) in key.iter_mut().enumerate() {
        *byte = u8::from_str_radix(hex.get(2 * i..2 * i + 2)?, 16).ok()?;
    }
    let planted = input.get("planted").and_then(Value::as_str);
    let fault = PLANTED.iter().find(|(name, _)| planted == Some(*name));
    let started = STARTED.with(|s| s.borrow().clone());
    let all = [FEATURES, started.as_str(), planted.unwrap_or_default()];
    Some(Some(Store {
        dir: PathBuf::from(named.get("dir")?.as_str()?),
        key,
        planted: all
            .iter()
            .filter(|p| !p.is_empty())
            .copied()
            .collect::<Vec<_>>()
            .join(" "),
        fault: fault.map(|(_, f)| *f),
    }))
}

/// What a pack check has run so far, as [`ran`] takes it before and after one: the core's kits
/// and field checks, the host's kits, and the process's rewrites, runs and compiles.
pub fn reading(packs: &Packs, host: &crate::sandbox::Host) -> [u64; 5] {
    let (rewrites, runs) = deep_sandbox_wasmtime::rewrites_and_runs();
    let compiles = deep_sandbox_wasmtime::compiles();
    [
        packs.ran.kits + host.kits,
        packs.ran.fields,
        rewrites,
        runs,
        compiles,
    ]
}

/// Adds what one pack check ran, between two readings, to the process's counts.
pub fn ran(before: [u64; 5], after: [u64; 5]) {
    RAN.with(|r| {
        let mut all = r.get();
        for (i, n) in all.iter_mut().enumerate() {
            *n += after[i].saturating_sub(before[i]);
        }
        r.set(all);
    });
}

/// `counts` on the `packs` reply: what this process's pack checks have run since it started.
pub fn counts() -> Value {
    let [kits, fields, rewrites, runs, compiles] = RAN.with(Cell::get);
    json!({"kits": kits, "fields": fields, "rewrites": rewrites, "runs": runs, "compiles": compiles})
}

/// A row this core may take: the check's verdict and what it left.
pub struct Kept {
    /// A planted core's row, which the shipped core wouldn't take: its verdict stands whatever
    /// the bytes read admit.
    pub forced: bool,
    pub refused: bool,
    pub issues: Vec<Value>,
    pub layouts: Vec<Value>,
    pub left: Value,
}

/// One pack version as its row names it: `owner/name@version`, the digest of the manifest as
/// this core read it and the digest of each version it requires, as this core holds it.
pub struct Bound<'s> {
    store: &'s Store,
    pack: String,
    version: String,
    digest: String,
    requires: BTreeMap<String, String>,
}

impl Store {
    /// `manifest`'s version as a row of this store names it, beside the versions `packs` holds.
    pub fn bound(&self, manifest: &Value, packs: &Packs) -> Bound<'_> {
        let text = |key: &str| manifest[key].as_str().unwrap_or_default().to_string();
        Bound {
            store: self,
            pack: text("id"),
            version: text("version"),
            digest: deep_canvas::document::packs::digest(manifest),
            requires: deep_canvas::document::packs::deps::reached(packs, manifest),
        }
    }

    /// HMAC-SHA-256 (RFC 2104) of `line` under the launch key, in hex.
    fn mark(&self, line: &[u8]) -> String {
        let mut block = [0u8; 64];
        block[..32].copy_from_slice(&self.key);
        let inner = Sha256::new()
            .chain_update(block.map(|b| b ^ 0x36))
            .chain_update(line)
            .finalize();
        let outer = Sha256::new()
            .chain_update(block.map(|b| b ^ 0x5c))
            .chain_update(inner)
            .finalize();
        deep_canvas::canon::hex(&outer)
    }
}

impl Bound<'_> {
    fn file(&self) -> PathBuf {
        let named = sha256_hex(format!("{}@{}", self.pack, self.version).as_bytes());
        self.store.dir.join(format!("{named}.json"))
    }

    /// The store's row of this version, when this core may take it: its mark verifies, it
    /// names this pack's bytes, the versions it requires as held, this build and this core's
    /// planted programs, what it left hashes to the hash it kept, and every hash that kept in
    /// the evidence store is still there.
    pub fn read(&self, evidence: &Path) -> Option<Kept> {
        let fault = self.store.fault;
        let file = std::fs::read(self.file()).ok();
        let Some(file) = file.filter(|bytes| std::str::from_utf8(bytes).is_ok()) else {
            // The planted core reads a file that is there, and whose bytes it can't read as
            // text, as installed.
            let admits = fault == Some(Fault::AdmitsUnreadable) && self.file().exists();
            return admits.then(|| Kept {
                forced: true,
                refused: false,
                issues: Vec::new(),
                layouts: Vec::new(),
                left: Value::Null,
            });
        };
        let row = self.marked(&file)?;
        let is = |key: &str, value: &str| row[key] == value;
        let requires: Map<String, Value> = (self.requires.iter())
            .map(|(k, v)| (k.clone(), json!(v)))
            .collect();
        let (digest, build) = (is("digest", &self.digest), is("build", crate::kept::BUILD));
        let named = is("pack", &self.pack)
            && is("version", &self.version)
            && (digest || fault == Some(Fault::AnyDigest))
            && row["requires"] == Value::Object(requires)
            && (build || fault == Some(Fault::AnyBuild))
            && is("planted", &self.store.planted);
        let left = row.get("left")?;
        let kept = left.pointer("/programs/kept").and_then(Value::as_array);
        let whole = is("left_sha256", &sha256_hex(&canonical(left)))
            && (kept.into_iter().flatten()).all(|sha| {
                sha.as_str()
                    .is_some_and(|sha| crate::evidence::has(evidence, sha))
            });
        (named && whole).then(|| {
            Some(Kept {
                forced: !(digest && build),
                refused: row["outcome"] == "refused",
                issues: row.get("issues")?.as_array()?.clone(),
                layouts: row.get("layouts")?.as_array()?.clone(),
                left: left.clone(),
            })
        })?
    }

    /// The row of a file whose second line is the mark of its first under the launch key.
    fn marked(&self, file: &[u8]) -> Option<Value> {
        let at = file.iter().position(|b| *b == b'\n')?;
        let (line, rest) = (&file[..at], &file[at + 1..]);
        let mark = rest.strip_suffix(b"\n").unwrap_or(rest);
        let made = self.store.mark(line);
        // Every byte compared, so how long it takes says nothing of where two marks differ.
        let differs = (made.bytes().zip(mark))
            .fold(made.len() ^ mark.len(), |d, (a, b)| d | usize::from(a ^ b));
        (differs == 0)
            .then(|| serde_json::from_slice(line).ok())
            .flatten()
    }

    /// Keeps a check's verdict and what it left as this version's row, written whole under
    /// another name and renamed into place. A row that can't be written is no row: the next
    /// core checks.
    pub fn write(&self, refused: bool, issues: &[Value], layouts: &[Value], left: &Value) {
        let row = json!({
            "pack": self.pack, "version": self.version, "digest": self.digest,
            "requires": self.requires, "build": crate::kept::BUILD, "planted": self.store.planted,
            "outcome": if refused { "refused" } else { "installed" },
            "issues": issues, "layouts": layouts, "left": left,
            "left_sha256": sha256_hex(&canonical(left)),
        });
        let line = row.to_string();
        let file = self.file();
        let part = file.with_extension(format!("part{}", std::process::id()));
        let written = std::fs::create_dir_all(&self.store.dir)
            .and_then(|()| {
                std::fs::write(
                    &part,
                    format!("{line}\n{}\n", self.store.mark(line.as_bytes())),
                )
            })
            .and_then(|()| std::fs::rename(&part, &file));
        if written.is_err() {
            let _ = std::fs::remove_file(&part);
        }
    }
}
