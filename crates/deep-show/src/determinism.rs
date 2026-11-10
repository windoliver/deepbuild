//! Issue #1897: the determinism check by hash (canvas primitives: Determinism). `pixel_hash`, the
//! GPU pixel hash of frames from the evidence store beside its CPU twin on the bytes read back;
//! the GPU pixel hash of a canonical render, which `determinism`'s same-machine sides carry; and
//! `determinism`'s cross-machine form: a record of each time's Vello CPU raster and evaluated
//! data, compared with another machine's only when every raster on both sides is the f32
//! pipeline's at the scalar SIMD level. GPU pixels are never cross-machine evidence.

use std::collections::BTreeMap;

use deep_gpu::pixel_hash::{self, Format, PixelHash};
use deep_marks_vello::level_name;
use serde_json::{json, Value};
use vello_cpu::{Level, RasterizerSettings, RenderMode, RenderSettings};

use crate::evidence;
use crate::export::hex;
use crate::hub::{Hub, Planted};

/// A SIMD level as a request names it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Simd {
    #[default]
    Scalar,
    Neon,
    Detected,
}

/// What a cross-machine record draws its rasters with: the reference unless asked otherwise.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Raster2d {
    pub simd: Simd,
    /// The u8 pipeline rather than f32.
    pub u8: bool,
}

impl Raster2d {
    /// `raster_2d`'s fields, each defaulting to the reference; `None` is `bad_input`.
    pub fn parse(v: Option<&Value>) -> Option<Raster2d> {
        let Some(v) = v else {
            return Some(Raster2d::default());
        };
        let field = |k: &str| v.get(k).map(Value::as_str);
        Some(Raster2d {
            simd: match field("simd") {
                None | Some(Some("scalar")) => Simd::Scalar,
                Some(Some("neon")) => Simd::Neon,
                Some(Some("detected")) => Simd::Detected,
                Some(_) => return None,
            },
            u8: match field("pipeline") {
                None | Some(Some("f32")) => false,
                Some(Some("u8")) => true,
                Some(_) => return None,
            },
        })
    }
}

/// What `determinism` compares (`compare`).
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Compare {
    /// Seeking against playing on this machine, by the GPU pixel hash.
    #[default]
    SameMachine,
    /// This machine's record, compared with `against` when given.
    CrossMachine {
        raster_2d: Raster2d,
        against: Option<Value>,
    },
    /// The document exported with 1 shard and with 3, their frame and PCM hashes compared.
    Shards,
}

impl Hub<'_> {
    fn hash_planted(&self) -> pixel_hash::Planted {
        pixel_hash::Planted {
            without_position: self.scenario.planted == Some(Planted::HashXorsWithoutPosition),
        }
    }

    /// `pixel_hash`: each frame's bytes from the evidence store put in a GPU texture of its
    /// format and hashed there, the texture read back, kept, and hashed by the CPU's twin.
    pub fn pixel_hash(&mut self, frames: &[([u32; 2], Format, String)]) -> Value {
        let planted = self.hash_planted();
        let Some(dev) = self.gpu3().map(|g| g.device().clone()) else {
            return json!({"outcome": "refused", "code": "gpu_unavailable"});
        };
        let pass = PixelHash::new(&dev.device, planted);
        let mut hashes = Vec::with_capacity(frames.len());
        for (size, format, sha) in frames {
            let Some(bytes) = evidence::read(&self.scenario.evidence, sha) else {
                return json!({"outcome": "refused", "code": "unknown_asset", "asset": sha});
            };
            let len = u64::from(size[0]) * u64::from(size[1]) * u64::from(format.words()) * 4;
            if len == 0 || bytes.len() as u64 != len {
                return json!({"outcome": "refused", "code": "bad_frame", "asset": sha, "size": size});
            }
            let h = pass.hash(&dev.device, &dev.queue, &bytes, *size, *format);
            let cpu = pixel_hash::cpu(&h.readback, *size, *format, planted);
            let Ok(readback) = evidence::put(&self.scenario.evidence, &h.readback) else {
                return json!({"outcome": "refused", "code": "evidence_unwritable"});
            };
            hashes.push(json!({"gpu": hex(h.gpu), "cpu": hex(cpu), "readback": readback}));
        }
        let adapter = dev.adapter.as_ref().map(|a| a.name.clone());
        json!({"outcome": "hashed", "hashes": hashes, "adapter": {"name": adapter, "software": false}})
    }

    /// A canonical render's GPU pixel hash: its RGBA8 rows hashed on the GPU, 16 bytes read back.
    pub(crate) fn render_hash(&mut self, rgba: &[u8], size: [u16; 2]) -> Result<String, String> {
        let planted = self.hash_planted();
        let dev = self
            .gpu3()
            .map(|g| g.device().clone())
            .ok_or_else(|| "gpu_unavailable".to_string())?;
        let size = [u32::from(size[0]), u32::from(size[1])];
        if size[0] * size[1] == 0 {
            return Err("no_drawing".into());
        }
        // One pipeline for every render the hub hashes, so hashing adds only its pass (#405).
        let pass = self.hash_pass.get_or_insert_with(|| PixelHash::new(&dev.device, planted));
        let h = pass.hash(&dev.device, &dev.queue, rgba, size, Format::Rgba8);
        Ok(hex(h.gpu))
    }

    /// `determinism` with `compare: cross_machine`: this machine's record at `at_times`, drawn at
    /// `raster`'s settings; with `against`, the two compared.
    pub(crate) fn cross_machine_check(
        &mut self,
        document: &Value,
        at_times: &[i64],
        raster: Raster2d,
        against: Option<&Value>,
    ) -> Value {
        let mine = match self.machine_record(document, at_times, raster) {
            Ok(r) => r,
            Err(code) => return json!({"outcome": "refused", "code": code}),
        };
        let Some(other) = against else {
            return json!({"outcome": "recorded", "record": mine});
        };
        for record in [&mine, other] {
            for f in list(&record["frames"]) {
                if let Some((setting, value)) = off_reference(&f["raster_2d"]["renderer"]) {
                    return json!({"outcome": "refused", "code": "cross_machine_raster",
                        "setting": setting, "value": value, "t": f["t"]});
                }
            }
        }
        let issues = differences(&mine, other);
        let same = mine["machine"]["arch"] == other["machine"]["arch"];
        let (result, machines) = match (issues.is_empty(), same) {
            (false, _) => ("FAIL", if same { "same" } else { "any" }),
            // One architecture's two runs never satisfy cross_machine (Golden).
            (true, true) => ("INCONCLUSIVE", "same"),
            (true, false) => ("PASS", "any"),
        };
        json!({"outcome": "compared", "result": result, "machines": machines, "issues": issues, "record": mine})
    }

    /// `determinism` with `compare: shards`: the document's current revision exported whole as a
    /// PNG sequence with 1 shard and with 3, an error for the first frame and the first span of
    /// samples whose hashes differ, which catches state that leaks across shard seams.
    pub(crate) fn shards_check(&mut self, doc: &str) -> Value {
        let mut receipts = Vec::with_capacity(2);
        for shards in [1, 3] {
            let out =
                std::env::temp_dir().join(format!("deep-shards-{}-{shards}", std::process::id()));
            let job = crate::export::Job {
                doc: doc.to_string(),
                range: crate::export::Span::Whole,
                size: None,
                frame_rate: None,
                codec: "png_seq".into(),
                alpha: false,
                sample_rate: None,
                audio_codec: "pcm".into(),
                shards,
                timecode: "00:00:00:00".into(),
                drop_frame: false,
                out: out.to_string_lossy().into_owned(),
                software: false,
                readback: false,
            };
            let reply = self.export_run(&job);
            let _ = std::fs::remove_dir_all(&out);
            if reply["outcome"] != "exported" {
                return reply;
            }
            receipts.push(reply["receipt"].clone());
        }
        let mut issues = Vec::new();
        for (key, what) in [("frame_hashes", "frame"), ("pcm_hashes", "span of samples")] {
            let (one, three) = (list(&receipts[0][key]), list(&receipts[1][key]));
            if one != three {
                let k = one.iter().zip(three).take_while(|(a, b)| a == b).count();
                issues.push(json!({"check": "document.determinism", "code": "shards_differ", "severity": "error",
                    "ids": [], "doc": doc, "index": k, "hashes": key,
                    "what": format!("{what} {k} hashes differently with 1 shard and with 3")}));
            }
        }
        let result = if issues.is_empty() { "PASS" } else { "FAIL" };
        json!({"outcome": "compared", "result": result, "machines": "same", "issues": issues})
    }

    /// Per time, a cold evaluation's Vello CPU raster (its raw RGBA by SHA-256, and what drew
    /// it) and its nodes' results, on this machine.
    fn machine_record(
        &mut self,
        document: &Value,
        at_times: &[i64],
        raster: Raster2d,
    ) -> Result<Value, String> {
        let level = match raster.simd {
            Simd::Scalar => deep_marks_vello::settings().level,
            Simd::Neon => neon().ok_or("no_neon")?,
            Simd::Detected => Level::new(),
        };
        let settings = (
            RenderSettings {
                level,
                num_threads: 0,
            },
            RasterizerSettings {
                render_mode: if raster.u8 {
                    RenderMode::OptimizeSpeed
                } else {
                    RenderMode::OptimizeQuality
                },
                ..deep_marks_vello::rasterizer()
            },
        );
        let view = deep_canvas::schedule::default_view(document);
        let mut frames = Vec::with_capacity(at_times.len());
        for &t in at_times {
            let (drawing, nodes, _) = self.evaluate(document, &view, &[t], true)?;
            let pinned = std::mem::replace(&mut self.renderer.raster_2d, settings);
            let drawn = self.canonical_rgba(&drawing, None, true);
            self.renderer.raster_2d = pinned;
            let (rgba, _, _) = drawn.map_err(|u| u.code.to_string())?;
            frames.push(json!({"t": t,
                "raster_2d": {"raw": evidence::sha256_hex(&rgba), "renderer": {"name": "vello_cpu",
                    "version": VELLO_CPU, "pipeline": if raster.u8 { "u8" } else { "f32" }, "simd": level_name(level)}},
                "evaluated": {"nodes": nodes}}));
        }
        Ok(json!({"machine": machine(), "frames": frames}))
    }
}

/// NEON, where the CPU has it.
#[cfg(target_arch = "aarch64")]
fn neon() -> Option<Level> {
    Level::new().as_neon().map(Level::Neon)
}

#[cfg(not(target_arch = "aarch64"))]
fn neon() -> Option<Level> {
    None
}

/// The Vello CPU version Cargo.lock holds (deep-marks-render's `raster` names the same).
const VELLO_CPU: &str = "0.3.0";

fn list(v: &Value) -> &[Value] {
    v.as_array().map_or(&[], Vec::as_slice)
}

/// The setting a raster's renderer has off the reference, and its value: `simd` before
/// `pipeline`, as #385's `golden_config` names them.
fn off_reference(renderer: &Value) -> Option<(&'static str, Value)> {
    if renderer["name"] != "vello_cpu" {
        return Some(("renderer", renderer["name"].clone()));
    }
    if renderer["simd"] != "scalar" {
        return Some(("simd", renderer["simd"].clone()));
    }
    (renderer["pipeline"] != "f32").then(|| ("pipeline", renderer["pipeline"].clone()))
}

/// Where two records differ, by time: a time one lacks, a raster whose raw pixels differ, and
/// the first node whose result differs.
fn differences(mine: &Value, other: &Value) -> Vec<Value> {
    let theirs: BTreeMap<i64, &Value> = list(&other["frames"])
        .iter()
        .filter_map(|f| Some((f["t"].as_i64()?, f)))
        .collect();
    let ours: BTreeMap<i64, &Value> = list(&mine["frames"])
        .iter()
        .filter_map(|f| Some((f["t"].as_i64()?, f)))
        .collect();
    let mut issues = Vec::new();
    for t in ours
        .keys()
        .chain(theirs.keys())
        .collect::<std::collections::BTreeSet<_>>()
    {
        let (Some(a), Some(b)) = (ours.get(t), theirs.get(t)) else {
            issues.push(json!({"code": "time_missing", "severity": "error", "t": t}));
            continue;
        };
        if a["raster_2d"]["raw"] != b["raster_2d"]["raw"] {
            issues.push(json!({"code": "raster_differs", "severity": "error", "t": t,
                "what": format!("the raster at {t} is {} here, {} there", a["raster_2d"]["raw"], b["raster_2d"]["raw"])}));
        }
        let (na, nb) = (
            list(&a["evaluated"]["nodes"]),
            list(&b["evaluated"]["nodes"]),
        );
        if na != nb {
            let k = na.iter().zip(nb).take_while(|(x, y)| x == y).count();
            let node = na
                .get(k)
                .or_else(|| nb.get(k))
                .cloned()
                .unwrap_or(Value::Null);
            issues.push(
                json!({"code": "evaluated_differs", "severity": "error", "t": t,
                "operator": node["operator"], "item": node["item"],
                "what": format!("at {t} the evaluated data first differs at node {k}")}),
            );
        }
    }
    issues
}

/// The machine a record is made on: its OS, CPU architecture and CPU, and whether this build
/// runs translated, as an x86_64 build does under Rosetta on an arm64 Mac (Golden: emulated).
fn machine() -> Value {
    let sysctl = |name: &str| {
        std::process::Command::new("sysctl")
            .args(["-n", name])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    let mut m = json!({"os": std::env::consts::OS, "arch": std::env::consts::ARCH});
    if cfg!(target_os = "macos") && sysctl("sysctl.proc_translated") == "1" {
        m["emulated"] = json!(true);
    }
    m["cpu"] = json!(if cfg!(target_os = "macos") {
        sysctl("machdep.cpu.brand_string")
    } else {
        std::fs::read_to_string("/proc/cpuinfo")
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("model name"))
                    .and_then(|l| l.split(':').nth(1))
                    .map(|m| m.trim().to_string())
            })
            .unwrap_or_default()
    });
    m
}
