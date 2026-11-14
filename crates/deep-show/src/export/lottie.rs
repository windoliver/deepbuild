//! #162: the export module's Lottie target (canvas primitives: Export: Lottie). The writer is
//! deep-canvas-export's; this file refuses what it can't keep before anything is written, writes
//! the file under its temporary name, reads it back with the pinned reference renderer in a
//! process of its own at 20 sampled export frames, compares each with the raw frame at that time
//! under the export.fidelity floor (outside the boxes of the items it lists as ones Lottie can't
//! hold), and renames it only when whole.

use std::collections::BTreeMap;
use std::ops::Range;
use std::path::Path;
use std::process::{Command, Stdio};

use deep_canvas::schedule::{Scheduler, Session as DocSession};
use deep_canvas_export::lottie::{self as writer, Frames, Plant, Refusal, Written};
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::Mark;
use deep_canvas_media::export_checks as rules;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::{stopped, Job};
use crate::hub::Hub;

/// An item and the box it covers in document units, `None` when it has none.
type Boxed = (String, Option<[f64; 4]>);

/// One export frame's turned items, each with the box it covers drawn and turned.
type Turned = Vec<(String, [f64; 4])>;

/// The helper role the reader runs as: a copy of this binary, apart from the writer's process.
pub const READER_ROLE: &str = "lottie-reader";

/// The frames the fidelity check reads: export frames ⌊i × n ÷ 20⌋ for i from 0 to 19.
pub fn sampled(n: usize) -> Vec<usize> {
    let mut out: Vec<usize> = (0..20).map(|i| i * n / 20).collect();
    out.dedup();
    out
}

/// `lottie: {container: json | dotlottie, images: embed | none}`, defaults json and embed.
fn options(job: &Job) -> Result<(String, bool), Value> {
    let o = &job.lottie;
    let word = |k: &str, d: &str| o.get(k).and_then(Value::as_str).unwrap_or(d).to_string();
    let container = word("container", "json");
    let images = word("images", "embed");
    if !matches!(container.as_str(), "json" | "dotlottie")
        || !matches!(images.as_str(), "embed" | "none")
        || !(o.is_null() || o.is_object())
    {
        return Err(json!({"code": "bad_lottie", "lottie": o,
            "why": "lottie is {container: json | dotlottie, images: embed | none}"}));
    }
    Ok((container, images == "embed"))
}

/// The refusal a document with a status binding takes, before anything is written.
pub fn refused(doc: &Value) -> Option<Value> {
    let r = writer::status_refusal(doc.as_object()?)?;
    Some(refusal(&r))
}

fn refusal(r: &Refusal) -> Value {
    json!({"outcome": "refused", "code": r.code, "path": r.path, "why": r.what, "issues": [r.json()]})
}

/// A stored (uncompressed) zip of `files`, at a fixed time, so the same bytes go in each time.
fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    fn crc32(data: &[u8]) -> u32 {
        let mut c = !0u32;
        for &b in data {
            c ^= u32::from(b);
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    0xEDB8_8320 ^ (c >> 1)
                } else {
                    c >> 1
                };
            }
        }
        !c
    }
    let (mut out, mut central) = (Vec::new(), Vec::new());
    // 1980-01-01 00:00, the zip format's first date.
    let (time, date) = (0u16, 0x21u16);
    for (name, data) in files {
        let (crc, len, offset) = (crc32(data), data.len() as u32, out.len() as u32);
        let header = |sig: u32, central: bool| {
            let mut h = Vec::new();
            h.extend(sig.to_le_bytes());
            if central {
                h.extend(20u16.to_le_bytes());
            }
            h.extend(20u16.to_le_bytes());
            h.extend([0u8; 4]);
            h.extend(time.to_le_bytes());
            h.extend(date.to_le_bytes());
            h.extend(crc.to_le_bytes());
            h.extend(len.to_le_bytes());
            h.extend(len.to_le_bytes());
            h.extend((name.len() as u16).to_le_bytes());
            h.extend(0u16.to_le_bytes());
            if central {
                // Comment length, disk number, internal and external attributes.
                h.extend([0u8; 10]);
                h.extend(offset.to_le_bytes());
            }
            h.extend(name.as_bytes());
            h
        };
        out.extend(header(0x0403_4b50, false));
        out.extend(*data);
        central.extend(header(0x0201_4b50, true));
    }
    let (at, size, n) = (out.len() as u32, central.len() as u32, files.len() as u16);
    out.extend(central);
    out.extend(0x0605_4b50u32.to_le_bytes());
    out.extend([0u8; 4]);
    out.extend(n.to_le_bytes());
    out.extend(n.to_le_bytes());
    out.extend(size.to_le_bytes());
    out.extend(at.to_le_bytes());
    out.extend(0u16.to_le_bytes());
    out
}

/// What the reader rendered of each sampled frame, from the written file.
fn read_back(path: &Path, size: [u16; 2], frames: &[usize]) -> Result<Vec<Vec<u8>>, Value> {
    let exe = std::env::current_exe()
        .map_err(|e| json!({"code": "reader_unstarted", "why": e.to_string()}))?;
    let list = frames
        .iter()
        .map(|f| f.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let out = Command::new(exe)
        .args([READER_ROLE, &path.to_string_lossy(), &size[0].to_string(), &size[1].to_string(), &list])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| json!({"code": "reader_unstarted", "why": format!("the reference Lottie renderer didn't start: {e}")}))?;
    let one = usize::from(size[0]) * usize::from(size[1]) * 4;
    if !out.status.success() || out.stdout.len() != one * frames.len() {
        return Err(
            json!({"outcome": "failed", "code": "export.fidelity", "issues": [{"check": "export.fidelity", "code": "export.fidelity",
            "severity": "error", "what": format!("the reference Lottie renderer couldn't read the written file: {}", String::from_utf8_lossy(&out.stderr).trim())}]}),
        );
    }
    Ok(out.stdout.chunks(one).map(<[u8]>::to_vec).collect())
}

/// Encoded luma of straight RGBA over `ground`.
fn luma(px: &[u8], ground: [u8; 3]) -> f64 {
    let a = f64::from(px[3]) / 255.0;
    let c = |k: usize| f64::from(px[k]) * a + f64::from(ground[k]) * (1.0 - a);
    0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2)
}

/// Two frames compared on luma over the pixels outside `skip` (pixel boxes): PSNR-Y, mean SSIM
/// over 8 × 8 windows 4 apart whose centre is compared (two renderers draw sub-pixel edges apart,
/// which export.fidelity's floor allows for: PSNR-Y ≥ 40 dB or SSIM ≥ 0.98), and how many pixels
/// it read.
fn compare(
    a: &[u8],
    b: &[u8],
    size: [u16; 2],
    ground: [u8; 3],
    skip: &[[f64; 4]],
) -> (f64, f64, usize) {
    let (w, h) = (usize::from(size[0]), usize::from(size[1]));
    let skipped = |x: usize, y: usize| {
        let (cx, cy) = (x as f64 + 0.5, y as f64 + 0.5);
        skip.iter()
            .any(|b| cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3])
    };
    let la: Vec<f64> = (0..w * h)
        .map(|i| luma(&a[i * 4..i * 4 + 4], ground))
        .collect();
    let lb: Vec<f64> = (0..w * h)
        .map(|i| {
            if skipped(i % w, i / w) {
                la[i]
            } else {
                luma(&b[i * 4..i * 4 + 4], ground)
            }
        })
        .collect();
    let (mut sum, mut n) = (0.0, 0usize);
    for i in 0..w * h {
        if !skipped(i % w, i / w) {
            sum += (la[i] - lb[i]) * (la[i] - lb[i]);
            n += 1;
        }
    }
    let psnr = if n == 0 || sum == 0.0 {
        f64::INFINITY
    } else {
        10.0 * deep_canvas::ops::log10(255.0 * 255.0 / (sum / n as f64))
    };
    let (c1, c2) = (
        (0.01 * 255.0_f64) * (0.01 * 255.0),
        (0.03 * 255.0_f64) * (0.03 * 255.0),
    );
    let (mut total, mut windows) = (0.0, 0usize);
    let mut y = 0;
    while y + 8 <= h {
        let mut x = 0;
        while x + 8 <= w {
            if !skipped(x + 4, y + 4) {
                let (mut ma, mut mb) = (0.0, 0.0);
                for v in 0..8 {
                    for u in 0..8 {
                        ma += la[(y + v) * w + x + u];
                        mb += lb[(y + v) * w + x + u];
                    }
                }
                ma /= 64.0;
                mb /= 64.0;
                let (mut va, mut vb, mut cov) = (0.0, 0.0, 0.0);
                for v in 0..8 {
                    for u in 0..8 {
                        let (da, db) = (la[(y + v) * w + x + u] - ma, lb[(y + v) * w + x + u] - mb);
                        va += da * da;
                        vb += db * db;
                        cov += da * db;
                    }
                }
                let (va, vb, cov) = (va / 63.0, vb / 63.0, cov / 63.0);
                total += ((2.0 * ma * mb + c1) * (2.0 * cov + c2))
                    / ((ma * ma + mb * mb + c1) * (va + vb + c2));
                windows += 1;
            }
            x += 4;
        }
        y += 4;
    }
    let ssim = if windows == 0 {
        1.0
    } else {
        total / windows as f64
    };
    (psnr, ssim, n)
}

impl Hub<'_> {
    /// The Lottie export of `doc` (as the frames draw it) over `frames`, at `rate`.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn export_lottie(
        &mut self,
        job: &Job,
        doc: &Value,
        (rate, frame): ((u32, u32), i64),
        frames: Range<i64>,
        out: &Path,
        temp: &Path,
    ) -> Result<Value, Value> {
        let started = std::time::Instant::now();
        let (container, images) = options(job)?;
        let n = (frames.end - frames.start).max(0) as usize;
        let look = self.look_of(doc).unwrap_or_else(|| self.look.clone());
        let dark = doc.pointer("/look/theme").and_then(Value::as_str) == Some("dark");
        let (palette, ty) = if dark {
            (&look.dark, &look.dark_type)
        } else {
            (&look.light, &look.light_type)
        };
        let map = doc.as_object().cloned().unwrap_or_default();
        let texts = self.lottie_texts(doc, frame, &frames);
        let Written {
            lottie,
            warnings,
            boxes,
            turned,
        } = writer::write(
            &map,
            (palette, ty),
            Frames {
                rate,
                frame,
                first: frames.start,
                n,
            },
            (images, texts),
            Plant::named(self.scenario.module_planted.as_deref()),
        )
        .map_err(|r| refusal(&r))?;
        let json_bytes =
            serde_json::to_vec(&lottie).map_err(|_| json!({"code": "export_unwritable"}))?;
        let id = doc
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("animation")
            .to_string();
        let bytes = if container == "dotlottie" {
            let manifest = serde_json::to_vec(&json!({"version": "1", "generator": "deepbuild export", "animations": [{"id": id}]}))
                .map_err(|_| json!({"code": "export_unwritable"}))?;
            zip(&[
                ("manifest.json", &manifest),
                (&format!("animations/{id}.json"), &json_bytes),
            ])
        } else {
            json_bytes.clone()
        };
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|_| json!({"code": "export_unwritable"}))?;
        }
        std::fs::write(temp, &bytes).map_err(|_| json!({"code": "export_unwritable"}))?;
        // The reader reads the JSON it plays; a dotLottie's animation is the same JSON.
        let readable = if container == "dotlottie" {
            let p = temp.with_extension("read.json");
            std::fs::write(&p, &json_bytes).map_err(|_| json!({"code": "export_unwritable"}))?;
            Some(p)
        } else {
            None
        };
        let fidelity = self.lottie_fidelity(
            job,
            doc,
            readable.as_deref().unwrap_or(temp),
            frame,
            &frames,
            (&boxes, &turned),
            palette,
        );
        if let Some(p) = &readable {
            let _ = std::fs::remove_file(p);
        }
        let fidelity = fidelity?;
        std::fs::rename(temp, out).map_err(|_| {
            let _ = std::fs::remove_file(temp);
            json!({"code": "export_unwritable"})
        })?;
        let mut warnings: Vec<Value> = warnings.iter().map(writer::Warning::json).collect();
        warnings.extend(self.left_out(job, doc));
        warnings.extend(self.bound_listed(doc));
        let size = doc.get("size").cloned().unwrap_or(Value::Null);
        Ok(json!({
            "target": "lottie", "size": size, "frame_rate": [rate.0, rate.1], "frames": n,
            "duration": n as i64 * frame, "first_frame": frames.start,
            "encoder": {"writer": "export", "format": "lottie", "version": "1.0.1", "container": container,
                "images": if images { "embed" } else { "none" }},
            "lottie": {"container": container, "images": if images { "embed" } else { "none" }},
            "sha256": hex(&Sha256::digest(&bytes)),
            "bytes": bytes.len(),
            "hidden": [],
            "warnings": warnings,
            "fidelity": fidelity,
            "timing": {"wall": started.elapsed().as_secs_f64()},
        }))
        .map(|mut receipt| {
            // The kept frames leave beside the receipt, as a video export's do.
            if let Some(r) = receipt["fidelity"].as_object_mut().and_then(|f| f.remove("readback")) {
                receipt["readback"] = r;
            }
            receipt
        })
    }

    /// Each item of the revision the drawing form leaves out, a kind no module of this build
    /// draws: the file can't hold it either, so it is listed, never dropped silently.
    fn left_out(&self, job: &Job, drawn: &Value) -> Vec<Value> {
        let Some(revision) = self.current(&job.doc).map(|r| r.doc.clone()) else {
            return Vec::new();
        };
        let kept = drawn.get("items").and_then(Value::as_object);
        revision
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(id, i)| kept.is_none_or(|k| !k.contains_key(*id)) && i.get("visible") != Some(&Value::Bool(false)))
            .map(|(id, i)| {
                let kind = i.get("kind").and_then(Value::as_str).unwrap_or("");
                let what = if kind.starts_with("inset") { format!("an inset ({kind}): Lottie holds no inset") } else { format!("a {kind} item this build doesn't draw: Lottie holds 2D shapes, groups and glyph outlines only") };
                json!({"item": id, "kind": "cannot_hold", "code": writer::CANT_HOLD, "path": format!("items/{id}"), "what": what})
            })
            .collect()
    }

    /// Each bound value, written as the text it shows, named with its source and as-of time:
    /// a Lottie holds the text, never the reading it came from.
    fn bound_listed(&self, doc: &Value) -> Vec<Value> {
        let record = self.record();
        doc.get("bound_values")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(id, b)| {
                let target = b.get("target").and_then(Value::as_str).unwrap_or("");
                let item = target.strip_prefix("items/").and_then(|t| t.split('/').next()).unwrap_or(target);
                let source = b.get("source").and_then(Value::as_str).unwrap_or("");
                let as_of = record.as_of.get(source).copied();
                json!({"item": item, "kind": "sampled", "code": "lottie.bound_value", "path": format!("bound_values/{id}"), "as_of": as_of,
                    "what": format!("bound value {id} written as the text it shows, from {source} as of {}", as_of.map_or("an unknown time".into(), |t| t.to_string()))})
            })
            .collect()
    }

    /// Each export frame's text glyphs as the frame draws them: each text's shaped run at its
    /// origin, each glyph lifted and faded by its animated unit.
    fn lottie_texts(
        &mut self,
        doc: &Value,
        frame: i64,
        frames: &Range<i64>,
    ) -> writer::text::Texts {
        let texts = doc
            .get("items")
            .and_then(Value::as_object)
            .is_some_and(|m| m.values().any(|i| i["kind"] == "text@1"));
        if !texts {
            return Vec::new();
        }
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, doc);
        frames
            .clone()
            .map(|k| {
                let t = k * frame;
                crate::played::load_at(&mut sched, &mut session, doc, t);
                session.frame(&mut sched, t, &deep_canvas::schedule::default_view(doc));
                let mut out = BTreeMap::new();
                let Some(d) = crate::frames::drawing_of(&sched, &session).and_then(|p| p.drawing)
                else {
                    return out;
                };
                for layer in &d.frame.layers {
                    for m in &layer.marks {
                        let Mark::Text {
                            item,
                            origin,
                            color,
                            ..
                        } = &m.mark
                        else {
                            continue;
                        };
                        let Some(run) = d.runs.get(item) else {
                            continue;
                        };
                        let units = d.animated.get(item);
                        let glyphs: Vec<writer::text::Glyph> = run
                            .shaped
                            .glyphs
                            .iter()
                            .enumerate()
                            .map(|(k, g)| {
                                let [lift, opacity] =
                                    units.and_then(|u| u.get(k)).copied().unwrap_or([0.0, 1.0]);
                                writer::text::Glyph {
                                    grapheme: g.grapheme,
                                    outline: outline(g),
                                    at: [
                                        origin[0] + f64::from(g.x),
                                        origin[1] + f64::from(g.y) + lift,
                                    ],
                                    opacity: opacity.clamp(0.0, 1.0),
                                    color: *color,
                                }
                            })
                            .collect();
                        out.insert(item.clone(), glyphs);
                    }
                }
                out
            })
            .collect()
    }

    /// export.fidelity on the written file: the reader's frames against the raw ones.
    #[allow(clippy::too_many_arguments)]
    fn lottie_fidelity(
        &mut self,
        job: &Job,
        doc: &Value,
        path: &Path,
        frame: i64,
        frames: &Range<i64>,
        (boxes, turned): (&[Boxed], &[Turned]),
        palette: &deep_canvas_marks::scene::Palette,
    ) -> Result<Value, Value> {
        let n = (frames.end - frames.start).max(0) as usize;
        let picks = sampled(n);
        let floor = rules::quality_floor(&job.quality).unwrap_or(40.0);
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, doc);
        let mut raws = Vec::with_capacity(picks.len());
        let mut size = [0u16; 2];
        for &j in &picks {
            let k = frames.start + j as i64;
            // #157's test module loses the device at a frame: the export stops there, leaving nothing.
            #[cfg(feature = "test-export-guards")]
            if super::test_guards::loses_device_at(doc, k) {
                return Err(stopped(
                    k,
                    "device_lost",
                    &format!("the GPU device was lost at frame {k}"),
                ));
            }
            let (px, s) = self
                .export_frame(
                    &mut sched,
                    &mut session,
                    doc,
                    k * frame,
                    job.size,
                    !job.alpha,
                )
                .map_err(|u| {
                    stopped(
                        k,
                        u.code,
                        &format!("frame {k} can't be drawn: {} at {}", u.code, u.path),
                    )
                })?;
            size = s;
            raws.push(px);
        }
        let read = read_back(path, size, &picks)?;
        let doc_w = doc
            .pointer("/size/0")
            .and_then(Value::as_f64)
            .unwrap_or(f64::from(size[0]));
        let doc_h = doc
            .pointer("/size/1")
            .and_then(Value::as_f64)
            .unwrap_or(f64::from(size[1]));
        let (sx, sy) = (
            f64::from(size[0]) / doc_w.max(1e-9),
            f64::from(size[1]) / doc_h.max(1e-9),
        );
        let whole = [0.0, 0.0, f64::from(size[0]), f64::from(size[1])];
        let px = |b: [f64; 4]| {
            [
                b[0] * sx - 1.0,
                b[1] * sy - 1.0,
                b[2] * sx + 2.0,
                b[3] * sy + 2.0,
            ]
        };
        let skip: Vec<[f64; 4]> = boxes.iter().map(|(_, b)| b.map_or(whole, px)).collect();
        let ground = palette.get("ground").copied().unwrap_or([255, 255, 255]);
        // `readback: true`: each sampled frame's own render and the reference renderer's frame of the
        // written file, straight RGBA rows, kept in the evidence store.
        let readback = if job.readback {
            let mut kept = Vec::new();
            for (i, j) in picks.iter().enumerate() {
                let put = |b: &[u8]| {
                    crate::evidence::put(&self.scenario.evidence, b)
                        .map_err(|_| json!({"code": "evidence_unwritable"}))
                };
                kept.push(json!({"frame": frames.start + *j as i64, "raw": put(&raws[i])?, "read": put(&read[i])?}));
            }
            Some(json!({"size": size, "format": "rgba8", "frames": kept}))
        } else {
            None
        };
        let mut rows = Vec::new();
        let mut issues = Vec::new();
        let mut worst = f64::INFINITY;
        let mut worst_ssim = 1.0_f64;
        for (i, &j) in picks.iter().enumerate() {
            let mut here = skip.clone();
            here.extend(turned.get(j).into_iter().flatten().map(|(_, b)| px(*b)));
            let (p, ssim, compared) = compare(&raws[i], &read[i], size, ground, &here);
            worst = worst.min(p);
            worst_ssim = worst_ssim.min(ssim);
            let k = frames.start + j as i64;
            rows.push(json!({"frame": k, "psnr_y": if p.is_finite() { json!(p) } else { Value::Null }, "ssim": ssim, "pixels": compared}));
            // export.fidelity's floor: PSNR-Y at the floor, or SSIM 0.98 at the standard floor (40 dB).
            let meets = p >= floor || (floor <= 40.0 && ssim >= 0.98);
            if !meets && issues.is_empty() {
                issues.push(json!({"check": "export.fidelity", "code": "export.fidelity", "severity": "error", "frame": k,
                    "what": format!("export frame {k}: the written Lottie, played by the reference renderer, reads {p:.2} dB luma PSNR and SSIM {ssim:.4} against the raw frame, under the {floor} dB floor (or SSIM 0.98)")}));
            }
        }
        if !issues.is_empty() {
            return Err(json!({"outcome": "failed", "code": "export.delivery", "issues": issues}));
        }
        let mut out = Map::new();
        let finite = |p: f64| if p.is_finite() { json!(p) } else { Value::Null };
        // The worst 1% of the frames compared, at least one: its frame and reading.
        let mut ranked: Vec<(f64, f64, i64)> = rows
            .iter()
            .map(|r| {
                (
                    r["psnr_y"].as_f64().unwrap_or(f64::INFINITY),
                    r["ssim"].as_f64().unwrap_or(1.0),
                    r["frame"].as_i64().unwrap_or(0),
                )
            })
            .collect();
        ranked.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.2.cmp(&b.2)));
        let worst_1pct: Vec<Value> = ranked
            .iter()
            .take(picks.len().div_ceil(100).max(1))
            .map(|(p, s, k)| json!({"frame": k, "psnr_y": finite(*p), "ssim": s}))
            .collect();
        out.insert("check".into(), json!("export.fidelity"));
        out.insert("reader".into(), json!(deep_lottie_reader::ENGINE));
        out.insert("frames".into(), json!(picks.len()));
        out.insert(
            "sampled".into(),
            json!(picks
                .iter()
                .map(|j| frames.start + *j as i64)
                .collect::<Vec<_>>()),
        );
        out.insert("floor".into(), json!({"psnr_y": floor}));
        out.insert("psnr_y".into(), finite(worst));
        out.insert("ssim".into(), json!(worst_ssim));
        out.insert("worst_1pct".into(), Value::Array(worst_1pct));
        let mut excluded: Vec<Value> = boxes
            .iter()
            .map(|(id, b)| json!({"item": id, "box": b, "why": "an item Lottie can't hold"}))
            .collect();
        let mut ids: Vec<&String> = turned.iter().flatten().map(|(id, _)| id).collect();
        ids.sort();
        ids.dedup();
        excluded.extend(ids.into_iter().map(|id| json!({"item": id, "box": "its box at each frame, drawn and turned", "why": "a text's turn, which the 2D frames don't draw yet"})));
        out.insert("excluded".into(), Value::Array(excluded));
        out.insert("samples".into(), Value::Array(rows));
        if let Some(r) = readback {
            out.insert("readback".into(), r);
        }
        Ok(Value::Object(out))
    }
}

/// A glyph's outline about its own origin, as path verbs.
fn outline(g: &deep_text::Glyph) -> Vec<Verb> {
    use deep_text::outlines::Cmd;
    deep_text::outlines::outline_of(g)
        .unwrap_or_default()
        .into_iter()
        .map(|c| match c {
            Cmd::Move(p) => Verb::Move(p),
            Cmd::Line(p) => Verb::Line(p),
            Cmd::Quad(a, p) => Verb::Quad(a, p),
            Cmd::Cubic(a, b, p) => Verb::Cubic(a, b, p),
            Cmd::Close => Verb::Close,
        })
        .collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fidelity_frames_are_floor_i_n_over_20() {
        let n = 168;
        let want: Vec<usize> = (0..20).map(|i| i * n / 20).collect();
        assert_eq!(sampled(n), want);
        assert_eq!(sampled(168)[1], 8);
    }

    #[test]
    fn a_stored_zip_has_its_signatures() {
        let z = zip(&[("a.json", b"{}")]);
        assert_eq!(&z[..4], &[0x50, 0x4b, 0x03, 0x04]);
        assert_eq!(&z[z.len() - 22..z.len() - 18], &[0x50, 0x4b, 0x05, 0x06]);
    }
}
