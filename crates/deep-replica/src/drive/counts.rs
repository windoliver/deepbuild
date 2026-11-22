//! Issue #1482: what each frame of a dirty-mode replica asked for and drew, reported in `close`'s frames: every frame of
//! the clock, drawn or not, and each frame GPUI drew as input arrived between them, with the entities notified, the
//! views rendered and reused, the rows and elements built, the tiles that changed since the frame before (read back
//! here, in the harness, never in the app) and, in a build with `frame-clocks`, the CPU, GPU and allocations it cost.
//! The replica also takes `refresh` and `accessibility` calls, and its `arm` and `accessibility` launch fields.

use std::collections::BTreeSet;
use std::time::Instant;

use gpui_kit::frame_counts::FrameCounts;
use gpui_kit::EntityId;
use image::RgbaImage;
use serde_json::{json, Value};

use super::{arms, clocks, fail, Fail, Plant, Replica};

/// A tile of the read-back, in device pixels.
const TILE: (u32, u32) = (64, 32);

/// The mode's counts, beside [`super::frames::Dirty`]'s own.
pub(super) struct Counts {
    pub(super) arm: String,
    /// What the launch asked for: `tiles` or `off`.
    pub(super) read_back: &'static str,
    /// Whether any read-back failed.
    pub(super) failed: bool,
    pub(super) accessibility: bool,
    pub(super) root: EntityId,
    /// The step being taken, which each frame names.
    pub(super) step: usize,
    /// The frame read back last, which the next is compared with.
    previous: Option<RgbaImage>,
    list: Vec<Value>,
    seen: BTreeSet<EntityId>,
    /// What the input delivered since the last frame cost.
    input: Option<clocks::Cost>,
    /// The accessibility tree after the last frame GPUI drew on request.
    tree: Option<gpui_kit::TappedTree>,
}

impl Counts {
    pub(super) fn new(
        arm: String,
        read_back: &'static str,
        accessibility: bool,
        root: EntityId,
    ) -> Counts {
        Counts {
            arm,
            read_back,
            failed: false,
            accessibility,
            root,
            step: 0,
            previous: None,
            list: Vec::new(),
            seen: BTreeSet::new(),
            input: None,
            tree: None,
        }
    }

    /// Input was delivered: what it cost belongs to the frame that draws it.
    pub(super) fn input_cost(&mut self, cost: Option<clocks::Cost>) {
        self.input = match (self.input, cost) {
            (Some(a), Some(b)) => Some(a.plus(b)),
            (a, b) => a.or(b),
        };
    }

    pub(super) fn take_input(&mut self) -> Option<clocks::Cost> {
        self.input.take()
    }
}

/// An entity's name: an arm's, a shipped view's, else its Rust type's.
fn name_of(entity: EntityId) -> String {
    arms::named(entity)
        .or_else(|| deep_app::views::view_name(entity))
        .or_else(|| gpui_kit::frame_counts::type_of(entity))
        .unwrap_or("entity")
        .to_owned()
}

fn ids(entities: &[EntityId]) -> Vec<String> {
    entities.iter().map(|e| e.as_u64().to_string()).collect()
}

impl Replica {
    /// The frames GPUI drew since the last call, then, with `clock`, the frame of the replica's clock they were drawn
    /// for: whether it drew and what its draw cost. The step's frames in order, each with what it cost and drew.
    pub(super) fn count_frames(&mut self, clock: Option<(bool, Option<clocks::Cost>)>) -> usize {
        let window = self.window.window_id();
        let mut drawn: Vec<FrameCounts> = gpui_kit::frame_counts::take_frame_counts()
            .into_iter()
            .filter(|f| f.window == window)
            .collect();
        let reused: Vec<&'static str> = drawn
            .iter()
            .flat_map(|f| f.reused.iter())
            .filter_map(|e| deep_app::views::view_name(*e))
            .collect();
        deep_app::views::keep_drawn(&reused);
        let pending = gpui_kit::frame_counts::take_notified();
        let rows = deep_app::views::take_rows_built();
        let (drew, cost) = clock.map_or((false, None), |(drew, cost)| (drew, cost));
        let input = self.counts_mut().take_input();
        let last = drawn.len().saturating_sub(1);
        let had = !drawn.is_empty();
        let count = drawn.len();
        for (at, f) in drawn.drain(..).enumerate() {
            // Only the newest scene is left to read, so the frames before it, rare, have no tiles.
            let (tiles, gpu_ms) = if at == last {
                self.read_tiles()
            } else {
                (None, None)
            };
            let cost = if at == last && drew { cost } else { input };
            let rows = if at == last { rows } else { 0 };
            self.push_frame(Some(f), pending.clone(), rows, tiles, gpu_ms, cost);
        }
        if clock.is_some() && !drew {
            let cost = cost.map(|c| input.map_or(c, |i| c.plus(i))).or(input);
            self.push_frame(None, pending, 0, None, None, cost);
        }
        if had && self.counts().accessibility {
            let tree = gpui_kit::accessibility_tree();
            self.counts_mut().tree = tree;
        }
        count
    }

    fn push_frame(
        &mut self,
        drawn: Option<FrameCounts>,
        pending: Vec<EntityId>,
        rows: u64,
        tiles: Option<(u64, u64)>,
        gpu_ms: Option<f64>,
        cost: Option<clocks::Cost>,
    ) {
        let drops = self.plant == Some(Plant::DropsNotifyRecord);
        let (notified, refreshed, rendered, reused, elements) = match &drawn {
            Some(f) => (
                f.notified.clone(),
                f.refreshed,
                f.rendered.clone(),
                f.reused.clone(),
                f.elements,
            ),
            None => (pending, false, Vec::new(), Vec::new(), 0),
        };
        let notified = if drops { Vec::new() } else { notified };
        let t = self.clock.t;
        let counts = self.counts_mut();
        for e in notified.iter().chain(&rendered).chain(&reused) {
            counts.seen.insert(*e);
        }
        let frame = counts.list.len() + 1;
        let step = counts.step;
        counts.list.push(json!({
            "frame": frame, "step": step, "t": t, "drawn": drawn.is_some(),
            "notified": ids(&notified), "refreshed": refreshed,
            "rendered": ids(&rendered), "reused": ids(&reused),
            "rows": rows, "elements": elements,
            "tiles": tiles.map(|(changed, total)| json!({"changed": changed, "total": total})),
            "cpu_ms": cost.map(|c| c.cpu_ms), "gpu_ms": gpu_ms.filter(|_| drawn.is_some()),
            "allocations": cost.map(|c| c.allocations),
        }));
    }

    /// The window's pixels now against the frame read back before, in tiles: the tiles that differ and the tiles the
    /// window has; and how long the render took, in a build with the clocks.
    pub(super) fn read_tiles(&mut self) -> (Option<(u64, u64)>, Option<f64>) {
        if self.counts().read_back == "off" {
            return (None, None);
        }
        let glyphs = self.glyphs.clone();
        let _ = self
            .cx
            .update_window(self.window, |_, window, _| glyphs.keep_scene(window));
        let started = Instant::now();
        let read = match self.plant {
            Some(Plant::ReadBackFails) => None,
            _ => self.cx.capture_screenshot(self.window).ok(),
        };
        let took = cfg!(feature = "frame-clocks").then(|| started.elapsed().as_secs_f64() * 1000.);
        let counts = self.counts_mut();
        let Some(image) = read else {
            counts.failed = true;
            counts.previous = None;
            return (None, None);
        };
        let tiles = counts
            .previous
            .replace(image)
            .zip(counts.previous.as_ref())
            .map(|(before, now)| tiles_changed(&before, now));
        (tiles, took)
    }

    /// `refresh`: the window refreshes, so every view renders at the next frame; then one frame of the clock.
    pub(super) fn refresh(&mut self) -> Result<Value, Fail> {
        let _ = self
            .cx
            .update_window(self.window, |_, window, _| window.refresh());
        self.tick();
        Ok(json!({}))
    }

    /// `accessibility`: the tree the platform holds after the last frame GPUI drew on request, in tree order.
    pub(super) fn accessibility(&mut self) -> Result<Value, Fail> {
        if self.counts.is_none() {
            return Err(fail(
                "refused",
                "accessibility reads a replica launched with frames: \"dirty\"",
            ));
        }
        let scale = self.scale();
        let counts = self.counts();
        let device = |v: f64| (v * scale as f64).round() as i64;
        let tree = counts.tree.as_ref().filter(|_| counts.accessibility);
        Ok(json!({"accessibility": {
            "active": tree.is_some(),
            "focus": tree.map(|t| t.focus.to_string()),
            "nodes": tree.map_or_else(Vec::new, |t| t.nodes.iter().map(|n| json!({
                "id": n.id.to_string(), "role": n.role.to_lowercase(), "name": n.name, "value": n.value,
                "bounds": n.bounds.map(|b| b.map(device)), "actions": n.actions,
                "children": n.children.iter().map(u64::to_string).collect::<Vec<_>>(),
            })).collect()),
        }}))
    }

    /// `close`'s frames report beyond #1546's: the arm, the read-back, the entities and every frame.
    pub(super) fn frames_report(&mut self) -> Value {
        let mut report = self.dirty.as_ref().expect("the dirty mode").report();
        let Some(counts) = self.counts.as_ref() else {
            return report;
        };
        let mut entities = serde_json::Map::new();
        let mut todo: Vec<EntityId> = counts.seen.iter().copied().chain([counts.root]).collect();
        while let Some(e) = todo.pop() {
            let key = e.as_u64().to_string();
            if entities.contains_key(&key) {
                continue;
            }
            let view = gpui_kit::frame_counts::view_of(e);
            let parent = view.and_then(|(_, parent)| parent);
            todo.extend(parent);
            entities.insert(
                key,
                json!({"name": name_of(e), "view": view.is_some(), "parent": parent.map(|p| p.as_u64().to_string())}),
            );
        }
        let drawn: Vec<&Value> = counts.list.iter().filter(|f| f["drawn"] == true).collect();
        let read = drawn.iter().all(|f| !f["tiles"].is_null());
        let sum = |key: &str| {
            drawn
                .iter()
                .map(|f| f["tiles"][key].as_u64().unwrap_or(0))
                .sum::<u64>()
        };
        let zero = drawn.iter().filter(|f| f["tiles"]["changed"] == 0).count();
        let read_back = if counts.failed {
            "failed"
        } else {
            counts.read_back
        };
        report["arm"] = json!(counts.arm);
        report["read_back"] = json!(read_back);
        report["root"] = json!(counts.root.as_u64().to_string());
        report["entities"] = Value::Object(entities);
        report["list"] = json!(counts.list);
        report["zero_tile_frames"] = json!(read.then_some(zero));
        report["changed_area"] =
            json!(read.then(|| sum("changed") as f64 / sum("total").max(1) as f64));
        report
    }

    fn counts(&self) -> &Counts {
        self.counts.as_ref().expect("the dirty mode's counts")
    }

    fn counts_mut(&mut self) -> &mut Counts {
        self.counts.as_mut().expect("the dirty mode's counts")
    }
}

/// How many of the tiles of `now` differ from those of `before`, and how many tiles it has.
fn tiles_changed(before: &RgbaImage, now: &RgbaImage) -> (u64, u64) {
    let (w, h) = now.dimensions();
    let (across, down) = (w.div_ceil(TILE.0), h.div_ceil(TILE.1));
    if before.dimensions() != now.dimensions() {
        return ((across * down) as u64, (across * down) as u64);
    }
    let (a, b) = (before.as_raw(), now.as_raw());
    let mut changed = 0u64;
    for ty in 0..down {
        let (y0, y1) = (ty * TILE.1, ((ty + 1) * TILE.1).min(h));
        for tx in 0..across {
            let (x0, x1) = (
                (tx * TILE.0) as usize * 4,
                (((tx + 1) * TILE.0).min(w)) as usize * 4,
            );
            let differs = (y0..y1).any(|y| {
                let row = y as usize * w as usize * 4;
                a[row + x0..row + x1] != b[row + x0..row + x1]
            });
            changed += u64::from(differs);
        }
    }
    (changed, (across * down) as u64)
}
