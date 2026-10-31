//! The efficiency bar's two hub-side readings (#854): a patch's arrival to the settled frame it
//! causes, and deep_query's summary and paged read of a document. The perf lane
//! (`benchmarks/canvas.mjs`) drives both on a release build.
//!
//! `settle` sends each patch through the shared document's one patch path, has the document's
//! session take the revision it makes, runs the session's frame and presents the frame's marks
//! in a headless window through GPUI's Metal renderer: the process's CPU from the patch's arrival
//! to that frame, the GPU time of the frame's command buffers, and the nodes it ran by operator.
//!
//! `deep_query` answers what an agent reads back: a summary of the current revision, sized for an
//! agent's context, or one page of its items in document order, with a cursor to the next.

use std::collections::BTreeMap;
use std::time::Instant;

use serde_json::{json, Map, Value};

use crate::hub::{Body, Hub, PatchCall, Planted, Via};

/// One `settle` call: patches for a shared document, each sent as `via`.
pub struct Settle {
    pub via: Via,
    pub doc: String,
    pub patches: Vec<Value>,
}

/// One `deep_query` call: the summary, or a page of `limit` rows after `cursor`.
pub struct Query {
    pub doc: String,
    pub page: Option<(usize, Option<String>)>,
}

/// The rows a page holds at most.
pub const PAGE_MAX: usize = 1_000;

/// This process's CPU time, every thread's, in ns: a frame's nodes run on the pool too.
fn process_cpu_ns() -> u64 {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `t` is a valid timespec for the call to fill.
    unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut t) };
    t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
}

impl Hub<'_> {
    pub fn settle_patches(&mut self, s: &Settle) -> Value {
        let refused =
            |code: &str, what: String| json!({"outcome": "refused", "code": code, "what": what});
        if !self.shared.contains_key(&s.doc) {
            return refused("ref_unresolved", format!("no shared document {}", s.doc));
        }
        let Some(size) = self.shared[&s.doc].doc["size"]
            .as_array()
            .and_then(|a| Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?]))
        else {
            return refused("bad_input", "the document has no size".into());
        };
        let mut painter = match gpu::Painter::open(size) {
            Ok(p) => p,
            Err(why) => return refused("no_window", why),
        };
        if !self.sessions.contains_key(&s.doc) {
            let fresh = self.new_session();
            self.sessions.insert(s.doc.clone(), fresh);
        }
        // The board as shown before the first patch: its first frame, uncounted.
        let view = crate::frames::session_view(&self.sessions[&s.doc], &Map::new());
        {
            let session = self.sessions.get_mut(&s.doc).expect("made above");
            session.load(&mut self.sched, &self.shared[&s.doc].doc);
            session.frame(&mut self.sched, 0, &view);
        }
        if let Err(why) = self.present_frame(&s.doc, &mut painter) {
            return refused("unfit", why);
        }
        painter.wait();
        let mut samples = Vec::with_capacity(s.patches.len());
        for (k, patch) in s.patches.iter().enumerate() {
            let arrived = process_cpu_ns();
            let call = PatchCall {
                via: s.via.clone(),
                doc: s.doc.clone(),
                body: Body::Patch(patch.clone()),
            };
            let reply = self.patch(&call, None, self.now);
            if reply["outcome"] != "applied" {
                return json!({"outcome": "refused", "code": "not_applied", "patch": k + 1, "reply": reply});
            }
            // The session takes the revision: only the items the patch touched, when that is all
            // it changed, else the whole document.
            let ids: Vec<&str> = patch["ops"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|op| op["id"].as_str())
                .collect();
            let session = self.sessions.get_mut(&s.doc).expect("made above");
            let doc = &self.shared[&s.doc].doc;
            if session.revise_items(&mut self.sched, doc, &ids).is_none() {
                session.load(&mut self.sched, doc);
            }
            session.frame(&mut self.sched, 0, &view);
            if let Err(why) = self.present_frame(&s.doc, &mut painter) {
                return refused("unfit", why);
            }
            // The frame is handed to the GPU; waiting for it isn't the CPU's work.
            let cpu_ms = (process_cpu_ns() - arrived) as f64 / 1e6;
            let gpu_ms = painter.wait() as f64 / 1e6;
            let ran = self.sessions[&s.doc].ran_by_operator(&self.sched);
            let item = patch["ops"][0]["id"].clone();
            samples.push(json!({"patch": k + 1, "item": item, "frame": painter.presented,
                                "cpu_ms": cpu_ms, "gpu_ms": gpu_ms, "ms": cpu_ms + gpu_ms, "ran": ran}));
        }
        json!({"outcome": "settled", "samples": samples})
    }

    /// The session's frame presented.
    fn present_frame(&self, doc: &str, painter: &mut gpu::Painter) -> Result<(), String> {
        let painted = crate::frames::drawing_of(&self.sched, &self.sessions[doc])
            .ok_or_else(|| "the frame drew nothing".to_string())?;
        let drawing = painted
            .drawing
            .ok_or_else(|| "the frame has no 2D drawing".to_string())?;
        painter.present(&drawing.frame)
    }

    pub fn query(&mut self, q: &Query) -> Value {
        let started = Instant::now();
        let doc = match self.shared.get(&q.doc) {
            Some(shared) => &shared.doc,
            None => match self.current(&q.doc) {
                Some(row) => &row.doc,
                None => return json!({"outcome": "refused", "code": "ref_unresolved"}),
            },
        };
        let empty = Map::new();
        let items = doc["items"].as_object().unwrap_or(&empty);
        let result = match &q.page {
            None => summary(&q.doc, doc, items),
            Some((limit, cursor)) => {
                let from = match cursor {
                    None => 0,
                    Some(c) => match c.strip_prefix('i').and_then(|n| n.parse::<usize>().ok()) {
                        Some(n) if n <= items.len() => n,
                        _ => return json!({"outcome": "refused", "code": "bad_cursor"}),
                    },
                };
                // The planted query answers every row, unpaged.
                let (from, to) = if self.scenario.planted == Some(Planted::Unpaged) {
                    (0, items.len())
                } else {
                    (from, (from + (*limit).min(PAGE_MAX)).min(items.len()))
                };
                let rows: Vec<Value> = items.values().skip(from).take(to - from).map(row).collect();
                let next = (to < items.len()).then(|| format!("i{to}"));
                json!({"doc": q.doc, "rows": rows, "next": next})
            }
        };
        // What the agent is sent is the reply's text, made inside the time.
        std::hint::black_box(result.to_string());
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        json!({"outcome": "answered", "ms": ms, "result": result})
    }
}

/// An item as a row: its ID, kind, name, layer, order and where it is.
fn row(item: &Value) -> Value {
    let mut r = Map::new();
    for key in ["id", "kind", "name", "layer", "order"] {
        if let Some(v) = item.get(key) {
            r.insert(key.into(), v.clone());
        }
    }
    if let Some(pos) = item.pointer("/at/pos") {
        r.insert("pos".into(), pos.clone());
    }
    if let Some(b) = item.pointer("/params/box") {
        r.insert("box".into(), b.clone());
    }
    Value::Object(r)
}

/// The summary: what the document is, how many items of each kind and layer it holds, the
/// extent of their positions, and how to page its rows.
fn summary(id: &str, doc: &Value, items: &Map<String, Value>) -> Value {
    let mut kinds: BTreeMap<&str, usize> = BTreeMap::new();
    let mut layers: BTreeMap<&str, usize> = BTreeMap::new();
    let mut extent: Option<[f64; 4]> = None;
    for item in items.values() {
        *kinds
            .entry(item["kind"].as_str().unwrap_or(""))
            .or_default() += 1;
        *layers
            .entry(item["layer"].as_str().unwrap_or(""))
            .or_default() += 1;
        if let (Some(x), Some(y)) = (
            item.pointer("/at/pos/0").and_then(Value::as_f64),
            item.pointer("/at/pos/1").and_then(Value::as_f64),
        ) {
            let e = extent.get_or_insert([x, y, x, y]);
            *e = [e[0].min(x), e[1].min(y), e[2].max(x), e[3].max(y)];
        }
    }
    let layers: Vec<Value> = layers
        .into_iter()
        .map(|(layer, n)| {
            let writer = doc.pointer(&format!("/layers/{layer}/writer")).cloned();
            json!({"layer": layer, "writer": writer, "items": n})
        })
        .collect();
    json!({
        "doc": id, "title": doc["title"], "profile": doc["profile"], "size": doc["size"],
        "items": items.len(), "kinds": kinds, "layers": layers, "extent": extent,
        "pages": items.len().div_ceil(PAGE_MAX), "page_rows": PAGE_MAX,
    })
}

/// A headless window that paints a frame's marks through GPUI's Metal renderer.
#[cfg(target_os = "macos")]
mod gpu {
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::time::{Duration, Instant};

    use deep_canvas_marks::scene::{Fill, Frame, Mark, Rgb};
    use gpui_apple::metal_renderer::gpu_ledger;
    use gpui_kit::*;

    fn hsla(c: Rgb) -> Hsla {
        Rgba {
            r: f32::from(c[0]) / 255.,
            g: f32::from(c[1]) / 255.,
            b: f32::from(c[2]) / 255.,
            a: 1.,
        }
        .into()
    }

    fn rect(b: [f64; 4]) -> Bounds<Pixels> {
        Bounds {
            origin: point(px(b[0] as f32), px(b[1] as f32)),
            size: size(px(b[2] as f32), px(b[3] as f32)),
        }
    }

    struct Canvas {
        quads: Rc<RefCell<Vec<PaintQuad>>>,
    }

    impl Render for Canvas {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let quads = self.quads.clone();
            div().size_full().child(
                canvas(
                    |_, _, _| {},
                    move |_, _, window, _| {
                        for q in quads.borrow().iter() {
                            window.paint_quad(q.clone());
                        }
                    },
                )
                .size_full(),
            )
        }
    }

    pub struct Painter {
        cx: HeadlessAppContext,
        handle: AnyWindowHandle,
        quads: Rc<RefCell<Vec<PaintQuad>>>,
        /// Frames presented so far.
        pub presented: u64,
        /// The ledger's GPU time before the last frame.
        before: u64,
    }

    impl Painter {
        pub fn open(at: [f64; 2]) -> Result<Painter, String> {
            let mut cx = deep_replica::headless_context();
            let quads = Rc::new(RefCell::new(Vec::new()));
            let view = Canvas {
                quads: quads.clone(),
            };
            let (handle, _) = cx
                .update(|cx| {
                    open_window(
                        WindowOptions {
                            window_bounds: Some(WindowBounds::Windowed(Bounds {
                                origin: Point::default(),
                                size: size(px(at[0] as f32), px(at[1] as f32)),
                            })),
                            focus: false,
                            show: false,
                            ..Default::default()
                        },
                        cx,
                        |_, cx| cx.new(|_| view),
                    )
                })
                .map_err(|e| e.to_string())?;
            cx.simulate_scale_factor_change(handle, 1.);
            Ok(Painter {
                cx,
                handle,
                quads,
                presented: 0,
                before: 0,
            })
        }

        /// Paints `frame` and hands its command buffers to the GPU.
        pub fn present(&mut self, frame: &Frame) -> Result<(), String> {
            {
                let mut quads = self.quads.borrow_mut();
                quads.clear();
                quads.push(fill(
                    rect([0., 0., frame.size[0], frame.size[1]]),
                    hsla(frame.ground),
                ));
                for drawn in frame.layers.iter().flat_map(|l| l.marks.iter()) {
                    match &drawn.mark {
                        Mark::Rect {
                            bounds,
                            radius,
                            fill: Fill::Solid(c),
                            ..
                        } => quads
                            .push(fill(rect(*bounds), hsla(*c)).corner_radii(px(*radius as f32))),
                        Mark::Circle {
                            center, r, color, ..
                        } => quads.push(
                            fill(
                                rect([center[0] - r, center[1] - r, 2. * r, 2. * r]),
                                hsla(*color),
                            )
                            .corner_radii(px(*r as f32)),
                        ),
                        other => {
                            return Err(format!(
                                "the bench window paints solid rects and circles, not {}",
                                other.item()
                            ))
                        }
                    }
                }
            }
            self.before = settled().gpu_ns;
            self.cx.present_frame(self.handle);
            self.presented += 1;
            Ok(())
        }

        /// Waits for the last frame's command buffers: their GPU time, in ns.
        pub fn wait(&mut self) -> u64 {
            settled().gpu_ns - self.before
        }
    }

    /// Waits for every committed frame command buffer to complete, then reads the ledger.
    fn settled() -> gpu_ledger::Ledger {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let ledger = gpu_ledger::read();
            if ledger.completed >= ledger.committed || Instant::now() > deadline {
                return ledger;
            }
            std::thread::sleep(Duration::from_micros(50));
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod gpu {
    use deep_canvas_marks::scene::Frame;

    pub struct Painter {
        pub presented: u64,
    }

    impl Painter {
        pub fn open(_: [f64; 2]) -> Result<Painter, String> {
            Err("the bench window draws through Metal, on macOS only".into())
        }

        pub fn present(&mut self, _: &Frame) -> Result<(), String> {
            Err("no window".into())
        }

        pub fn wait(&mut self) -> u64 {
            0
        }
    }
}
