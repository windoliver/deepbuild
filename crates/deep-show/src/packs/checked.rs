use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use deep_canvas::document::Packs;
use deep_canvas::schedule::{canonical, sha256_hex};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fault {
    AnyDigest,
    AnyBuild,
    AdmitsUnreadable,
}

pub const PLANTED: [(&str, Fault); 3] = [
    ("takes_row_of_another_digest", Fault::AnyDigest),
    ("takes_row_of_another_build", Fault::AnyBuild),
    ("admits_on_unreadable_row", Fault::AdmitsUnreadable),
];

pub struct Store {
    dir: PathBuf,
    key: [u8; 32],
    planted: String,
    fault: Option<Fault>,
}

const FEATURES: &str = env!("DEEP_FEATURES");

thread_local! {
    static STARTED: RefCell<String> = const { RefCell::new(String::new()) };
    static RAN: Cell<[u64; 5]> = const { Cell::new([0; 5]) };
}

pub fn started(planted: &str) {
    STARTED.with(|s| *s.borrow_mut() = planted.to_string());
}

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

pub fn ran(before: [u64; 5], after: [u64; 5]) {
    RAN.with(|r| {
        let mut all = r.get();
        for (i, n) in all.iter_mut().enumerate() {
            *n += after[i].saturating_sub(before[i]);
        }
        r.set(all);
    });
}

pub fn counts() -> Value {
    let [kits, fields, rewrites, runs, compiles] = RAN.with(Cell::get);
    json!({"kits": kits, "fields": fields, "rewrites": rewrites, "runs": runs, "compiles": compiles})
}

pub struct Kept {
    pub forced: bool,
    pub refused: bool,
    pub issues: Vec<Value>,
    pub layouts: Vec<Value>,
    pub left: Value,
}

pub struct Bound<'s> {
    store: &'s Store,
    pack: String,
    version: String,
    digest: String,
    requires: BTreeMap<String, String>,
}

impl Store {
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

    pub fn read(&self, evidence: &Path) -> Option<Kept> {
        let fault = self.store.fault;
        let file = std::fs::read(self.file()).ok();
        let Some(file) = file.filter(|bytes| std::str::from_utf8(bytes).is_ok()) else {
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

    fn marked(&self, file: &[u8]) -> Option<Value> {
        let at = file.iter().position(|b| *b == b'\n')?;
        let (line, rest) = (&file[..at], &file[at + 1..]);
        let mark = rest.strip_suffix(b"\n").unwrap_or(rest);
        let made = self.store.mark(line);
        let differs = (made.bytes().zip(mark))
            .fold(made.len() ^ mark.len(), |d, (a, b)| d | usize::from(a ^ b));
        (differs == 0)
            .then(|| serde_json::from_slice(line).ok())
            .flatten()
    }

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
