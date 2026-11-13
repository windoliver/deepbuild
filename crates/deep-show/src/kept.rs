//! Issue #1901 (canvas primitives: Content key, Determinism class): the GPU output a process keeps
//! across processes, and content keys from declared fields.
//!
//! **Kept output.** A frame, capture or final this binary draws is kept in the `--cache` folder
//! under an entry keyed by the output, the revision's hash, the time and the machine fingerprint,
//! which names the build: the digest of the sources this binary was built from (`build.rs`). So
//! a rebuild from changed sources keys every entry afresh and reads nothing its predecessor drew,
//! while a rebuild from the same sources reads them all. An entry is read only whole, its bytes
//! matching their digest and its fingerprint this process's.
//!
//! **Padded key input.** A key input held in a struct with padding enters a key by its declared
//! fields ([`Canonical`]), never by its memory, so bytes the program never wrote can't reach a key.

use std::mem::{offset_of, size_of, MaybeUninit};
use std::path::Path;

use deep_canvas::schedule::{Canonical, Hasher, Scheduler, Session as DocSession};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::hub::{EvalTime, Hub, Planted};

/// The digest of the sources this binary was built from (`build.rs`).
pub const BUILD: &str = env!("DEEP_SOURCE_DIGEST");

/// What a `draw` keeps: a frame as the view keeps it, a capture as a snapshot keeps it, a final
/// as an export keeps a final's frame.
pub const OUTPUTS: [&str; 3] = ["frame", "capture", "final"];

impl Hub<'_> {
    /// The machine fingerprint the kept output of `backend` is keyed by: the environment a
    /// backend renders in and the build. The planted fingerprint leaves the build out.
    fn fingerprint_of(&self, backend: &str) -> Value {
        let (_, environment) = crate::kit::goldens::environment(self, backend);
        let mut print = json!({"backend": backend, "environment": environment, "build": BUILD});
        if self.planted(Planted::FingerprintWithoutSources) {
            print.as_object_mut().expect("an object").remove("build");
        }
        print
    }

    /// `fingerprint`: the one a 2D document's kept output is keyed by.
    pub fn fingerprint_reply(&self) -> Value {
        json!({"fingerprint": self.fingerprint_of("vello_cpu")})
    }

    /// `draw`: the document's current revision at `t` as `output`, read from the cache when an
    /// entry holds it, else drawn as a still at `t` draws it and kept.
    pub fn draw_reply(&mut self, doc: &str, t: &EvalTime, output: &str) -> Value {
        let refused = |code: &str| json!({"outcome": "refused", "code": code});
        let Some(dir) = self.startup.cache.clone() else {
            return refused("no_cache");
        };
        let t = match self.resolve_time(doc, t) {
            Ok(t) => t,
            Err(code) => return refused(code),
        };
        let Some(row) = self.current(doc) else {
            return refused("no_revision");
        };
        let (document, hash) = (row.doc.clone(), row.hash.clone());
        let backend = if deep_canvas_scene3d::scene::has_3d(&document) {
            "gpu"
        } else {
            "vello_cpu"
        };
        let fingerprint = self.fingerprint_of(backend);
        let entry = Hasher::new("kept@1")
            .text(output)
            .text(&hash)
            .int(t)
            .bytes(&deep_canvas::schedule::canonical(&fingerprint))
            .finish()
            .hex();
        if read(&dir, &entry, &fingerprint) {
            return json!({"output": output, "entry": entry, "read": true});
        }
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, &document);
        let (rgba, size) =
            match self.export_frame(&mut sched, &mut session, &document, t, None, true) {
                Ok(drawn) => drawn,
                Err(unfit) => {
                    return json!({"outcome": "refused", "code": unfit.code, "path": unfit.path})
                }
            };
        if keep(&dir, &entry, &fingerprint, size, &rgba).is_err() {
            return refused("cache_unwritable");
        }
        json!({"output": output, "entry": entry, "read": false})
    }

    /// `padded_key`: the padded fixture with fields from `fields`, built twice with its padding
    /// filled from each seed, and each build's content key.
    pub fn padded_key_reply(&self, fields: u64, seeds: [u64; 2]) -> Value {
        let value = PaddedInput::from_seed(fields);
        let raw_keys = self.planted(Planted::KeyHashesRawBytes);
        let version = self.sched.hash();
        let mut raw = Vec::new();
        let mut keys = Vec::new();
        for seed in seeds {
            let built = value.built(seed);
            let bytes = built.bytes();
            let mut h = Hasher::of(version, "outside");
            if raw_keys {
                h.bytes(&bytes);
            } else {
                h.bytes(&built.value().canonical_bytes());
            }
            raw.push(deep_canvas::canon::hex(&bytes));
            keys.push(h.finish().hex());
        }
        json!({
            "struct": "PaddedInput",
            "size": size_of::<PaddedInput>(),
            "padding": PaddedInput::padding(),
            "raw": raw,
            "keys": keys,
        })
    }
}

/// The entry's two files: its meta (the output's size, its bytes' digest and the fingerprint it
/// was keyed by) and its straight RGBA bytes.
fn paths(dir: &Path, entry: &str) -> [std::path::PathBuf; 2] {
    [
        dir.join(format!("{entry}.json")),
        dir.join(format!("{entry}.rgba")),
    ]
}

/// True when the cache holds `entry` whole, kept under this fingerprint.
fn read(dir: &Path, entry: &str, fingerprint: &Value) -> bool {
    let [meta, bytes] = paths(dir, entry);
    let Some(meta) = std::fs::read(meta)
        .ok()
        .and_then(|m| serde_json::from_slice::<Value>(&m).ok())
    else {
        return false;
    };
    let Ok(bytes) = std::fs::read(bytes) else {
        return false;
    };
    meta["fingerprint"] == *fingerprint && meta["sha256"] == hex_sha256(&bytes)
}

/// Keeps `rgba` as `entry`, each file written whole under a temporary name, then renamed.
fn keep(
    dir: &Path,
    entry: &str,
    fingerprint: &Value,
    size: [u16; 2],
    rgba: &[u8],
) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let [meta, bytes] = paths(dir, entry);
    let whole = |path: &Path, data: &[u8]| -> std::io::Result<()> {
        let part = path.with_extension(format!("part{}", std::process::id()));
        std::fs::write(&part, data)?;
        std::fs::rename(&part, path)
    };
    whole(&bytes, rgba)?;
    let m = json!({"size": size, "sha256": hex_sha256(rgba), "fingerprint": fingerprint});
    whole(&meta, m.to_string().as_bytes())
}

fn hex_sha256(bytes: &[u8]) -> String {
    deep_canvas::canon::hex(&Sha256::digest(bytes))
}

/// A key input held in a struct with padding: bytes 1 to 3 sit between `tag` and `count`, and
/// bytes 17 to 23 after `flag`.
#[repr(C)]
struct PaddedInput {
    tag: u8,
    count: u32,
    weight: f64,
    flag: bool,
}

impl Canonical for PaddedInput {
    fn encode(&self, out: &mut Vec<u8>) {
        self.tag.encode(out);
        self.count.encode(out);
        self.weight.encode(out);
        self.flag.encode(out);
    }
}

/// A seeded source of bytes: SplitMix64 (Steele, Lea and Flood 2014).
struct SplitMix(u64);

impl SplitMix {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
}

impl PaddedInput {
    fn from_seed(seed: u64) -> PaddedInput {
        let mut r = SplitMix(seed);
        PaddedInput {
            tag: r.next() as u8,
            count: r.next() as u32,
            weight: (r.next() >> 11) as f64 / (1u64 << 53) as f64 * 1000.0,
            flag: r.next() & 1 == 1,
        }
    }

    /// The offsets of the bytes no field covers.
    fn padding() -> Vec<usize> {
        let fields = [
            (offset_of!(PaddedInput, tag), size_of::<u8>()),
            (offset_of!(PaddedInput, count), size_of::<u32>()),
            (offset_of!(PaddedInput, weight), size_of::<f64>()),
            (offset_of!(PaddedInput, flag), size_of::<bool>()),
        ];
        (0..size_of::<PaddedInput>())
            .filter(|i| !fields.iter().any(|(at, n)| (*at..at + n).contains(i)))
            .collect()
    }

    /// This value built in place in memory whose every byte first came from a source seeded
    /// with `seed`, so its padding holds that source's bytes.
    fn built(&self, seed: u64) -> Built {
        let mut slot = MaybeUninit::<PaddedInput>::uninit();
        let mut r = SplitMix(seed);
        let p = slot.as_mut_ptr();
        // SAFETY: every byte of the slot is written before any is read, and each field is then
        // written in place through its own pointer, which leaves the padding bytes as filled.
        unsafe {
            let bytes = std::slice::from_raw_parts_mut(p.cast::<u8>(), size_of::<PaddedInput>());
            bytes.iter_mut().for_each(|b| *b = r.next() as u8);
            std::ptr::addr_of_mut!((*p).tag).write(self.tag);
            std::ptr::addr_of_mut!((*p).count).write(self.count);
            std::ptr::addr_of_mut!((*p).weight).write(self.weight);
            std::ptr::addr_of_mut!((*p).flag).write(self.flag);
        }
        Built(slot)
    }
}

/// A [`PaddedInput`] as built, kept in its slot so a copy never rewrites its padding.
struct Built(MaybeUninit<PaddedInput>);

impl Built {
    fn value(&self) -> &PaddedInput {
        // SAFETY: `PaddedInput::built` wrote every field.
        unsafe { self.0.assume_init_ref() }
    }

    /// The struct's memory as built, its padding included.
    fn bytes(&self) -> Vec<u8> {
        // SAFETY: every byte of the slot was written in `PaddedInput::built`.
        unsafe {
            std::slice::from_raw_parts(self.0.as_ptr().cast::<u8>(), size_of::<PaddedInput>())
        }
        .to_vec()
    }
}
