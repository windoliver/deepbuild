//! Issue #1477: long lists and tables, measured, and the table we built because the kit's missed 4 ms.
//!
//! `lists_1477 arm <blank|kit|panel|list-10k|list-100k|ours>` runs one arm in a real 1,200 × 700 window, two rows
//! (64 px) of scroll a frame, and prints one JSON line. `measure --out <file> [--arms a,b]` runs each arm in a process
//! of its own and writes the record, which ends in its stop-or-build line. `offsets`, `remeasure` and `back` print one
//! line each from GPUI's headless window; `sort --data <file>`, `soak` and `access` read one JSON command a line.
//! An arm that can't draw in a real window (a locked screen, a hidden window) reads INCONCLUSIVE with the reason.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::RefCell;
use std::io::{BufRead, Write};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering::Relaxed};
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_app::table::view::{TableView, LINE, LINE_TOP, ROW};
use deep_app::table::{Rows, Value};
use gpui_kit::component::table::{Column, DataTable, TableDelegate, TableState};
use gpui_kit::test::TestWindowExt;
use gpui_kit::*;
use serde_json::{json, Value as Json};

// ---------------------------------------------------------------------------------------------------------------
// Counting: allocations on every thread, process CPU, the physical footprint, the load and the fingerprint.

struct Counting;
static ALLOCS: AtomicU64 = AtomicU64::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Relaxed);
        System.alloc(l)
    }
    unsafe fn alloc_zeroed(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Relaxed);
        System.alloc_zeroed(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Relaxed);
        System.realloc(p, l, n)
    }
}
#[global_allocator]
static COUNTING: Counting = Counting;

fn allocations() -> u64 {
    ALLOCS.load(Relaxed)
}

extern "C" {
    fn clock_gettime(clock: u32, out: *mut [i64; 2]) -> i32;
    fn getloadavg(out: *mut f64, n: i32) -> i32;
    fn proc_pid_rusage(pid: i32, flavor: i32, out: *mut [u64; 64]) -> i32;
}

/// Process CPU time in ns (CLOCK_PROCESS_CPUTIME_ID).
fn cpu_ns() -> i64 {
    let mut t = [0i64; 2];
    unsafe { clock_gettime(12, &mut t) };
    t[0] * 1_000_000_000 + t[1]
}

/// The process's physical footprint, as Activity Monitor's Memory column reads it (rusage_info_v2).
fn footprint() -> u64 {
    let mut out = [0u64; 64];
    // rusage_info_v2: a 16-byte UUID, then u64s; ri_phys_footprint is the 8th u64.
    if unsafe { proc_pid_rusage(std::process::id() as i32, 2, &mut out) } != 0 {
        return 0;
    }
    out[2 + 7]
}

fn load() -> f64 {
    let mut l = [0f64; 3];
    unsafe { getloadavg(l.as_mut_ptr(), 3) };
    l[0]
}

/// The lane's fingerprint, from scripts/benchmark.mjs itself, so the record and the lane read one machine the same way.
fn fingerprint() -> Json {
    let out = std::process::Command::new("node")
        .args([
            "--input-type=module",
            "-e",
            "import { fingerprint } from './scripts/benchmark.mjs'; console.log(JSON.stringify(fingerprint()))",
        ])
        .current_dir(repo())
        .output();
    out.ok()
        .and_then(|o| serde_json::from_slice(&o.stdout).ok())
        .unwrap_or(Json::Null)
}

fn repo() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn pct(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.;
    }
    sorted[((sorted.len() as f64 - 1.) * p).round() as usize]
}

// ---------------------------------------------------------------------------------------------------------------
// The data.

const WINDOW: (f32, f32) = (1200., 700.);
const COLUMNS: usize = 8;
const TABLE_ROWS: usize = 100_000;
const SECONDS: u64 = 8;
const MIN_FRAMES: usize = 480;
const WARM_FRAMES: usize = 60;
const STEP: f32 = 64.;
const RETURN_FRAMES: usize = 120;
const WIDTH: f32 = 148.;

fn cell_text(r: usize, c: usize) -> String {
    format!(
        "r{r} c{c} {:08x}",
        (r as u32).wrapping_mul(2_654_435_761) ^ c as u32
    )
}

/// 100,000 × 8 cells of text, the same for every table arm.
struct Grid {
    cells: Vec<Box<str>>,
    rows: usize,
}

impl Grid {
    fn new(rows: usize) -> Self {
        Self {
            cells: (0..rows * COLUMNS)
                .map(|i| cell_text(i / COLUMNS, i % COLUMNS).into())
                .collect(),
            rows,
        }
    }
    fn bytes(&self) -> u64 {
        self.cells.iter().map(|c| c.len() as u64 + 16).sum()
    }
}

impl Rows for Grid {
    fn len(&self) -> usize {
        self.rows
    }
    fn columns(&self) -> usize {
        COLUMNS
    }
    fn cell(&self, row: usize, column: usize) -> Value<'_> {
        self.cells
            .get(row * COLUMNS + column)
            .map_or(Value::Empty, |t| Value::Text(t))
    }
}

/// A variable-height list: each row 1 to 3 lines, its height from its own record.
struct List {
    lines: Vec<AtomicU8>,
    text: Vec<Box<str>>,
}

impl List {
    fn new(rows: usize) -> Self {
        Self {
            lines: (0..rows)
                .map(|r| AtomicU8::new(1 + ((r.wrapping_mul(2_654_435_761) >> 7) % 3) as u8))
                .collect(),
            text: (0..rows * 3)
                .map(|i| {
                    format!(
                        "row {} line {} {:08x} a transcript turn",
                        i / 3,
                        i % 3,
                        (i as u32).wrapping_mul(2_654_435_761)
                    )
                    .into()
                })
                .collect(),
        }
    }
    fn bytes(&self) -> u64 {
        self.lines.len() as u64 + self.text.iter().map(|t| t.len() as u64 + 16).sum::<u64>()
    }
    fn set_lines(&self, row: usize, n: u8) {
        self.lines[row].store(n, Relaxed);
    }
}

impl Rows for List {
    fn len(&self) -> usize {
        self.lines.len()
    }
    fn columns(&self) -> usize {
        3
    }
    fn cell(&self, row: usize, column: usize) -> Value<'_> {
        if column < usize::from(self.lines[row].load(Relaxed)) {
            Value::Text(&self.text[row * 3 + column])
        } else {
            Value::Empty
        }
    }
    fn height(&self, row: usize) -> Option<f64> {
        Some(f64::from(
            2. * LINE_TOP + LINE * f32::from(self.lines[row].load(Relaxed)),
        ))
    }
    fn stacked(&self) -> bool {
        true
    }
}

/// Rows made from their index, at any count up to `usize::MAX`: the soak's hostile sizes and the offsets' million.
struct Counted(usize);

impl Rows for Counted {
    fn len(&self) -> usize {
        self.0
    }
    fn columns(&self) -> usize {
        COLUMNS
    }
    fn cell(&self, row: usize, column: usize) -> Value<'_> {
        Value::Number((row * COLUMNS + column) as f64)
    }
}

/// The kit's table with a Rust delegate.
struct KitRows {
    cells: Vec<SharedString>,
}

impl TableDelegate for KitRows {
    fn columns_count(&self, _: &App) -> usize {
        COLUMNS
    }
    fn rows_count(&self, _: &App) -> usize {
        self.cells.len() / COLUMNS
    }
    fn column(&self, c: usize, _: &App) -> Column {
        Column::new(format!("c{c}"), format!("c{c}")).width(px(WIDTH))
    }
    fn render_td(
        &mut self,
        r: usize,
        c: usize,
        _: &mut Window,
        _: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        self.cells[r * COLUMNS + c].clone()
    }
}

/// The panel arm's script: the same rows through gpui-shell's DataTable and its `render_cell`.
const PANEL: &str = r#"import { View, div } from "gpui-kit";
import { DataTableState, DataTable } from "gpui-component";
const KEYS = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"];
const ROWS = [];
for (let r = 0; r < 100000; r++) {
  const row = {};
  for (let c = 0; c < 8; c++) row[KEYS[c]] = `r${r} c${c} ${((Math.imul(r, 2654435761) >>> 0) ^ c).toString(16).padStart(8, "0")}`;
  ROWS.push(row);
}
export default class App extends View {
  render() {
    return new DataTable(DataTableState(KEYS), () => ROWS, (row, column) => div().child(row[column]));
  }
}
"#;

// ---------------------------------------------------------------------------------------------------------------
// An arm in a real window.

enum Body {
    Blank,
    Kit(Entity<TableState<KitRows>>),
    Panel(AnyView),
    Ours(Entity<TableView>),
}

#[derive(Default)]
struct Run {
    frame: usize,
    started: Option<(Instant, u64, i64)>,
    ended: Option<(Duration, u64, i64, u64)>,
    /// When this frame's scroll was applied: an update runs from there through layout, prepaint and paint.
    applied: Option<Instant>,
    times: Vec<f64>,
    returning: usize,
    shaped_down: u64,
    shaped_back: u64,
    seen_problem: Option<String>,
}

/// What an arm does once its frames are counted.
type Done = Rc<dyn Fn(&mut Window, &mut App)>;

struct Bench {
    body: Body,
    run: Rc<RefCell<Run>>,
    list: bool,
    done: Done,
}

impl Render for Bench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let run = self.run.clone();
        let t0 = run.borrow_mut().applied.take().unwrap_or_else(Instant::now);
        {
            let mut r = run.borrow_mut();
            r.frame += 1;
            if r.frame == 20 {
                let seen = deep_app::shown::seen(window);
                if !seen.shown() || seen.session_locked {
                    r.seen_problem = Some(format!(
                        "the real window isn't shown ({seen:?}), so it draws no frames to count"
                    ));
                }
                // A table arm counts only while its table draws rows: the last frame's hit test at the pointer must
                // reach one of its rows. gpui-shell turns a panel's rows it refuses into a line of error text.
                if r.seen_problem.is_none() && matches!(self.body, Body::Kit(_) | Body::Panel(_)) {
                    let at = point(px(WINDOW.0 / 2.), px(WINDOW.1 / 2.));
                    let row = window
                        .hits_at(at)
                        .iter()
                        .any(|hit| format!("{:?}", hit.element).contains("\"row\""));
                    if !row {
                        r.seen_problem = Some(match self.body {
                            Body::Panel(_) => "the panel's table drew no rows: gpui-shell refuses its 100,000 rows of 8 columns (it caps a component's data at 10,000 array items, 4,096 nodes and 1,024 object keys, so a panel's DataTable holds at most 127 such rows) and shows the error instead".into(),
                            _ => "the kit's table drew no row under the pointer".into(),
                        });
                    }
                }
            }
            if r.frame == WARM_FRAMES {
                r.started = Some((Instant::now(), allocations(), cpu_ns()));
            }
            let counting = r.started.is_some() && r.ended.is_none();
            if counting {
                let (at, a, c) = r.started.unwrap();
                let counted = r.times.len();
                if at.elapsed() >= Duration::from_secs(SECONDS) && counted >= MIN_FRAMES {
                    r.ended = Some((at.elapsed(), allocations() - a, cpu_ns() - c, footprint()));
                }
            }
        }
        let (ended, problem) = {
            let r = run.borrow();
            (r.ended.is_some(), r.seen_problem.is_some())
        };
        // After the counted seconds, a list arm goes 120 frames down and 120 back, counting strings shaped.
        let mut dy = STEP;
        if ended && self.list {
            let mut r = run.borrow_mut();
            if let Body::Ours(v) = &self.body {
                // Strings shaped so far; the frames down start at the first return frame, the frames back after 120.
                let shaped = v.read(cx).cache().shaped();
                if r.returning == 0 {
                    r.shaped_down = shaped;
                } else if r.returning == RETURN_FRAMES {
                    r.shaped_down = shaped - r.shaped_down;
                    r.shaped_back = shaped;
                } else if r.returning == 2 * RETURN_FRAMES {
                    r.shaped_back = shaped - r.shaped_back;
                }
            }
            r.returning += 1;
            if r.returning > RETURN_FRAMES {
                dy = -STEP;
            }
        }
        let finish =
            (ended && (!self.list || run.borrow().returning > 2 * RETURN_FRAMES)) || problem;
        if finish {
            let done = self.done.clone();
            window.defer(cx, move |window, cx| done(window, cx));
        } else {
            window.request_animation_frame();
            let at = point(px(WINDOW.0 / 2.), px(WINDOW.1 / 2.));
            let applied = run.clone();
            // The next frame starts by applying its scroll, through GPUI's own dispatch, as a wheel would.
            window.on_next_frame(move |window, cx| {
                applied.borrow_mut().applied = Some(Instant::now());
                window.dispatch_event(
                    PlatformInput::ScrollWheel(ScrollWheelEvent {
                        position: at,
                        delta: ScrollDelta::Pixels(point(px(0.), px(-dy))),
                        modifiers: Modifiers::default(),
                        touch_phase: TouchPhase::Moved,
                    }),
                    cx,
                );
            });
        }
        let record = run.borrow().started.is_some() && !ended;
        let end = canvas(
            |_, _, _| {},
            move |_, _, _, _| {
                if record {
                    run.borrow_mut()
                        .times
                        .push(t0.elapsed().as_secs_f64() * 1e3);
                }
            },
        )
        .absolute()
        .size_0();
        let body: AnyElement = match &self.body {
            Body::Blank => div().into_any_element(),
            Body::Kit(t) => DataTable::new(t).into_any_element(),
            Body::Panel(v) => v.clone().into_any_element(),
            Body::Ours(v) => v.clone().into_any_element(),
        };
        div().size_full().child(body).child(end)
    }
}

fn arm(name: &str) -> Json {
    let load_start = load();
    let (rows, data_bytes): (usize, u64);
    let mut list_name: Option<&str> = None;
    enum Made {
        Blank,
        Kit(Vec<SharedString>),
        Panel(std::path::PathBuf),
        Ours(Arc<dyn Rows>),
    }
    let made = match name {
        "blank" => {
            rows = 0;
            data_bytes = 0;
            Made::Blank
        }
        "kit" => {
            let cells: Vec<SharedString> = (0..TABLE_ROWS * COLUMNS)
                .map(|i| cell_text(i / COLUMNS, i % COLUMNS).into())
                .collect();
            rows = TABLE_ROWS;
            data_bytes = cells.iter().map(|c| c.len() as u64 + 32).sum();
            Made::Kit(cells)
        }
        "panel" => {
            let dir = std::env::temp_dir().join(format!("deep-1477-panel-{}", std::process::id()));
            std::fs::create_dir_all(&dir).expect("the panel's folder");
            std::fs::write(dir.join("main.js"), PANEL).expect("the panel's script");
            rows = TABLE_ROWS;
            data_bytes = (0..TABLE_ROWS * COLUMNS)
                .map(|i| cell_text(i / COLUMNS, i % COLUMNS).len() as u64 + 16)
                .sum();
            Made::Panel(dir)
        }
        "ours" => {
            let grid = Grid::new(TABLE_ROWS);
            rows = TABLE_ROWS;
            data_bytes = grid.bytes();
            Made::Ours(Arc::new(grid))
        }
        "list-10k" | "list-100k" => {
            let n = if name == "list-10k" { 10_000 } else { 100_000 };
            let list = List::new(n);
            rows = n;
            data_bytes = list.bytes();
            list_name = Some("deep-app table::view::TableView, variable row heights (#1477's element; the kit's list can't count strings shaped)");
            Made::Ours(Arc::new(list))
        }
        other => {
            return json!({ "arm": other, "status": "INCONCLUSIVE", "reason": format!("no arm named {other}") })
        }
    };
    let run: Rc<RefCell<Run>> = Default::default();
    let out: Rc<RefCell<Option<Json>>> = Default::default();
    let name_owned = name.to_string();
    let is_list = list_name.is_some();
    let list_name = list_name.map(str::to_string);
    deep_app::table::view::ALLOCATIONS.set(allocations).ok();
    let made = RefCell::new(Some(made));
    let run2 = run.clone();
    let out2 = out.clone();
    application().run(move |cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
        cx.activate(true);
        let opts = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(None, size(px(WINDOW.0), px(WINDOW.1)), cx))),
            ..Default::default()
        };
        let run3 = run2.clone();
        let out3 = out2.clone();
        let name = name_owned.clone();
        let list_name = list_name.clone();
        let opened = open_window(opts, cx, move |window, cx| {
            let ours: Rc<RefCell<Option<Entity<TableView>>>> = Default::default();
            let body = match made.borrow_mut().take().expect("made once") {
                Made::Blank => Body::Blank,
                Made::Kit(cells) => Body::Kit(cx.new(|cx| TableState::new(KitRows { cells }, window, cx))),
                Made::Panel(dir) => {
                    let runtime = deep_app::new_runtime().expect("the panel runtime");
                    let loaded = runtime.load_application(&dir, "main.js").expect("the panel loads");
                    let view = runtime.mount_application(&loaded, window, cx).expect("the panel mounts");
                    std::mem::forget(runtime);
                    Body::Panel(view.into())
                }
                Made::Ours(rows) => {
                    let v = cx.new(|cx| TableView::new(rows, vec![WIDTH; COLUMNS], cx));
                    *ours.borrow_mut() = Some(v.clone());
                    Body::Ours(v)
                }
            };
            let run4 = run3.clone();
            let out4 = out3.clone();
            let ours2 = ours.clone();
            let name2 = name.clone();
            let list_name2 = list_name.clone();
            let done: Done = Rc::new(move |_, cx| {
                let r = run4.borrow();
                let json = if let Some(problem) = &r.seen_problem {
                    json!({ "arm": name2, "status": "INCONCLUSIVE", "reason": problem })
                } else {
                    let (elapsed, allocs, cpu, working_set) = r.ended.expect("counted");
                    let frames = r.times.len();
                    let mut sorted = r.times.clone();
                    sorted.sort_by(f64::total_cmp);
                    let mut arm = json!({
                        "arm": name2,
                        "status": "measured",
                        "window": [WINDOW.0 as u32, WINDOW.1 as u32],
                        "seconds": SECONDS,
                        "elapsed_s": elapsed.as_secs_f64(),
                        "frames": frames,
                        "scroll_px_per_frame": STEP,
                        "raw": {
                            "p50_ms": pct(&sorted, 0.5),
                            "p95_ms": pct(&sorted, 0.95),
                            "p99_ms": pct(&sorted, 0.99),
                            "allocations_per_frame": allocs as f64 / frames as f64,
                            "cpu_ms_per_frame": cpu as f64 / 1e6 / frames as f64,
                            "working_set_bytes": working_set,
                            "data_bytes": data_bytes,
                        },
                    });
                    if name2 != "blank" {
                        arm["rows"] = json!(rows);
                    }
                    if matches!(name2.as_str(), "kit" | "panel" | "ours") {
                        arm["columns"] = json!(COLUMNS);
                    }
                    if let Some(v) = ours2.borrow().as_ref() {
                        let counts = v.read(cx).counts;
                        arm["assistive"] = json!(counts.assistive_frames > 0);
                        arm["access_allocations"] = json!(counts.access_allocations);
                        arm["run_cache"] = json!({ "lines": v.read(cx).cache().held().0, "bytes": v.read(cx).cache().held().1, "bound": v.read(cx).cache().bound() });
                    }
                    if let Some(l) = &list_name2 {
                        arm["list"] = json!(l);
                        arm["shaped"] = json!({
                            "frames": RETURN_FRAMES,
                            "down": r.shaped_down as f64 / RETURN_FRAMES as f64,
                            "back": r.shaped_back as f64 / RETURN_FRAMES as f64,
                        });
                    }
                    arm
                };
                *out4.borrow_mut() = Some(json);
                cx.quit();
            });
            cx.new(|_| Bench { body, run: run3.clone(), list: is_list, done })
        });
        if opened.is_err() {
            *out2.borrow_mut() = Some(json!({ "status": "INCONCLUSIVE", "reason": "no window opened" }));
            cx.quit();
        }
        // A window that never draws (a locked screen) is read after 30 s, never waited on forever.
        let out5 = out2.clone();
        let run5 = run2.clone();
        let name5 = name_owned.clone();
        cx.spawn(async move |cx| {
            cx.background_executor().timer(Duration::from_secs(30)).await;
            if run5.borrow().frame < WARM_FRAMES && out5.borrow().is_none() {
                *out5.borrow_mut() = Some(json!({ "arm": name5, "status": "INCONCLUSIVE", "reason": format!("the real window drew {} frames in 30 s; a locked screen or a hidden window draws none", run5.borrow().frame) }));
                cx.update(|cx| cx.quit());
                print_and_exit(&out5, load_start);
            }
        })
        .detach();
        let out6 = out2.clone();
        cx.on_app_quit(move |_| {
            print_and_exit(&out6, load_start);
            async {}
        })
        .detach();
    });
    let _ = run;
    let json = out.borrow().clone().unwrap_or(Json::Null);
    json
}

fn print_and_exit(out: &Rc<RefCell<Option<Json>>>, load_start: f64) {
    let mut json = out.borrow().clone().unwrap_or(
        json!({ "status": "INCONCLUSIVE", "reason": "the arm ended without a reading" }),
    );
    if json["status"] == "measured" {
        json["fingerprint"] = fingerprint();
    }
    json["load"] = json!({ "start": load_start, "end": load() });
    println!("{json}");
    let _ = std::io::stdout().flush();
    std::process::exit(0);
}

// ---------------------------------------------------------------------------------------------------------------
// The record.

const ARMS: [&str; 5] = ["blank", "kit", "panel", "list-10k", "list-100k"];
const RECORD_1433: &str = "docs/spikes/1433/record.json";

fn measure(out: &str, only: Option<Vec<String>>) -> i32 {
    let me = std::env::current_exe().expect("this bench");
    let run_arm = |name: &str| -> Json {
        if only.as_ref().is_some_and(|o| !o.iter().any(|a| a == name)) {
            return json!({ "status": "INCONCLUSIVE", "reason": "not run: --arms left it out" });
        }
        let o = std::process::Command::new(&me)
            .args(["arm", name])
            .current_dir(repo())
            .output();
        match o {
            Ok(o) if o.status.success() => serde_json::from_slice::<Json>(o.stdout.trim_ascii())
                .unwrap_or_else(|e| json!({ "status": "INCONCLUSIVE", "reason": format!("the arm printed no JSON: {e}") })),
            Ok(o) => json!({ "status": "INCONCLUSIVE", "reason": format!("the arm exited {}: {}", o.status, String::from_utf8_lossy(&o.stderr).chars().rev().take(600).collect::<String>().chars().rev().collect::<String>()) }),
            Err(e) => json!({ "status": "INCONCLUSIVE", "reason": format!("the arm didn't start: {e}") }),
        }
    };
    let mut arms = serde_json::Map::new();
    for name in ARMS {
        arms.insert(name.into(), run_arm(name));
    }
    let measured = |a: &Json| a["status"] == "measured";
    let net_of = |a: &Json, blank: &Json| -> Json {
        let r = &a["raw"];
        let b = &blank["raw"];
        let f = |k: &str| r[k].as_f64().unwrap_or(f64::NAN) - b[k].as_f64().unwrap_or(f64::NAN);
        json!({
            "p50_ms": f("p50_ms"),
            "p95_ms": f("p95_ms"),
            "p99_ms": f("p99_ms"),
            "allocations_per_frame": f("allocations_per_frame"),
            "cpu_ms_per_frame": f("cpu_ms_per_frame"),
            "working_set_above_data_bytes": r["working_set_bytes"].as_f64().unwrap_or(f64::NAN) - r["data_bytes"].as_f64().unwrap_or(f64::NAN) - b["working_set_bytes"].as_f64().unwrap_or(f64::NAN),
        })
    };
    let tables_ran = ["blank", "kit", "panel"]
        .iter()
        .all(|a| measured(&arms[*a]));
    let mut word = "INCONCLUSIVE";
    let why;
    if tables_ran {
        let blank = arms["blank"].clone();
        let kit = net_of(&arms["kit"], &blank)["p99_ms"]
            .as_f64()
            .unwrap_or(f64::NAN);
        let panel = net_of(&arms["panel"], &blank)["p99_ms"]
            .as_f64()
            .unwrap_or(f64::NAN);
        word = if kit > 4. || panel > 4. {
            "build"
        } else {
            "stop"
        };
        why = format!(
            "kit p99 {kit:.3} ms, panel p99 {panel:.3} ms net of the blank arm, against 4 ms"
        );
    } else {
        let unrun: Vec<&str> = ["blank", "kit", "panel"]
            .into_iter()
            .filter(|a| !measured(&arms[*a]))
            .collect();
        why = format!("{} unrun, so the table arms can't decide", unrun.join(", "));
    }
    if word == "build"
        || only.as_ref().is_none_or(|o| o.iter().any(|a| a == "ours")) && word != "stop"
    {
        arms.insert("ours".into(), run_arm("ours"));
    }
    if measured(&arms["blank"]) {
        let blank = arms["blank"].clone();
        for (name, a) in arms.iter_mut() {
            if name != "blank" && measured(a) {
                a["net"] = net_of(a, &blank);
            }
        }
    }
    let cited = repo().join(RECORD_1433);
    let (at, reading, citation) = match std::fs::read_to_string(&cited)
        .ok()
        .and_then(|t| serde_json::from_str::<Json>(&t).ok())
    {
        Some(rec) => {
            let at = find_fast_list(&rec, String::new());
            let reading = at.as_ref().and_then(|p| rec.pointer(p).cloned());
            let line = format!(
                "#1433's gpui-fast list reading {}: {}",
                at.as_deref().unwrap_or("not found"),
                reading.as_ref().map_or("none".into(), |r| r.to_string())
            );
            (
                at.map(Json::from).unwrap_or(Json::Null),
                reading.unwrap_or(Json::Null),
                line,
            )
        }
        None => (
            Json::Null,
            Json::Null,
            format!("#1433's gpui-fast list reading: none yet ({RECORD_1433} doesn't exist)"),
        ),
    };
    let ours = match arms.get("ours") {
        Some(a) if measured(a) => format!(
            "; ours p99 {:.3} ms, {:.0} allocations a frame net",
            a["net"]["p99_ms"].as_f64().unwrap_or(f64::NAN),
            a["net"]["allocations_per_frame"]
                .as_f64()
                .unwrap_or(f64::NAN)
        ),
        _ => String::new(),
    };
    let decision = format!("{word}: {why}{ours}; {citation}");
    let record = json!({
        "spike": 1477,
        "what": "Long lists and tables in a real 1,200 × 700 window, 32 px rows, 8 columns, two rows (64 px) of scroll a frame, each arm in a process of its own: an empty window (blank), gpui-kit's DataTable with a Rust delegate (kit), the same through a panel's render_cell in gpui-shell (panel), a variable-height list at 10,000 and 100,000 rows, and, when built, ours. Update is the time from the root view's render to the end of its paint; allocations and CPU are the process's over the counted frames, per frame; working set is the physical footprint.",
        "arms": arms,
        "gpui_fast": { "issue": 1433, "record": RECORD_1433, "at": at, "reading": reading },
        "decision": decision,
    });
    std::fs::write(
        out,
        serde_json::to_string_pretty(&record).expect("JSON") + "\n",
    )
    .expect("the record");
    0
}

/// A JSON pointer to #1433's gpui-fast list reading, if its record holds one.
fn find_fast_list(v: &Json, at: String) -> Option<String> {
    let lower = at.to_lowercase();
    if (lower.contains("gpui-fast") || lower.contains("gpui_fast") || lower.contains("gpuifast"))
        && lower.contains("list")
        && !v.is_object()
        && !v.is_array()
    {
        return Some(at);
    }
    match v {
        Json::Object(m) => m.iter().find_map(|(k, x)| {
            find_fast_list(
                x,
                format!("{at}/{}", k.replace('~', "~0").replace('/', "~1")),
            )
        }),
        Json::Array(a) => a
            .iter()
            .enumerate()
            .find_map(|(i, x)| find_fast_list(x, format!("{at}/{i}"))),
        _ => None,
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Headless: GPUI's own frame path with the platform's text system, for the calls that read rows, not time.

struct Root {
    view: Entity<TableView>,
    size: (f32, f32),
}

impl Render for Root {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .w(px(self.size.0))
            .h(px(self.size.1))
            .child(self.view.clone())
    }
}

struct Headless {
    cx: HeadlessAppContext,
    window: AnyWindowHandle,
    root: Entity<Root>,
    view: Entity<TableView>,
}

impl Headless {
    fn new(rows: Arc<dyn Rows>) -> Self {
        let mut cx = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(()),
            gpui_kit::platform::current_headless_renderer,
        );
        cx.update(|cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
        });
        let opts = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds {
                origin: Point::default(),
                size: size(px(WINDOW.0), px(WINDOW.1)),
            })),
            focus: false,
            show: false,
            ..Default::default()
        };
        let mut made = None;
        let w = cx
            .update(|cx| {
                cx.open_window(opts, |_, cx| {
                    let view = cx.new(|cx| TableView::new(rows, vec![WIDTH; COLUMNS], cx));
                    made = Some(view.clone());
                    cx.new(|_| Root { view, size: WINDOW })
                })
            })
            .expect("a headless window");
        let root = cx.update(|cx| w.entity(cx)).expect("the root");
        let mut h = Self {
            cx,
            window: w.into(),
            root,
            view: made.expect("the view"),
        };
        h.frame();
        h
    }

    fn frame(&mut self) {
        let root = self.root.clone();
        self.cx.update(|cx| root.update(cx, |_, cx| cx.notify()));
        self.cx
            .update_window(self.window, |_, window, cx| window.render_frame(cx))
            .expect("a frame");
    }

    fn with<R>(&mut self, f: impl FnOnce(&mut TableView, &mut App) -> R) -> R {
        let view = self.view.clone();
        self.cx.update(|cx| view.update(cx, |v, cx| f(v, cx)))
    }
}

/// A script run in a real window, a step a frame: at frame `n` it sees what frame `n - 1` painted, and the first
/// JSON it returns is printed. A window that isn't shown prints INCONCLUSIVE with the reason.
type Script = Box<dyn FnMut(usize, &mut TableView, &mut Context<TableView>) -> Option<Json>>;

struct Driver {
    view: Entity<TableView>,
    frame: usize,
    script: Script,
}

impl Render for Driver {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.frame += 1;
        if self.frame == 20 {
            let seen = deep_app::shown::seen(window);
            if !seen.shown() || seen.session_locked {
                say(
                    json!({ "status": "INCONCLUSIVE", "reason": format!("the real window isn't shown ({seen:?})") }),
                );
                std::process::exit(0);
            }
        }
        let frame = self.frame;
        let script = &mut self.script;
        if let Some(out) = self.view.update(cx, |v, cx| script(frame, v, cx)) {
            say(out);
            std::process::exit(0);
        }
        window.request_animation_frame();
        div().size_full().child(self.view.clone())
    }
}

fn drive(rows: Arc<dyn Rows>, script: Script) -> i32 {
    application().run(move |cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
        cx.activate(true);
        let opts = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(None, size(px(WINDOW.0), px(WINDOW.1)), cx))),
            ..Default::default()
        };
        let made = cx.open_window(opts, |_, cx| {
            let view = cx.new(|cx| TableView::new(rows, vec![WIDTH; COLUMNS], cx));
            cx.new(|_| Driver { view, frame: 0, script })
        });
        if made.is_err() {
            say(json!({ "status": "INCONCLUSIVE", "reason": "no window opened" }));
            std::process::exit(0);
        }
        cx.spawn(async move |cx| {
            cx.background_executor().timer(Duration::from_secs(60)).await;
            say(json!({ "status": "INCONCLUSIVE", "reason": "the real window drew too few frames in 60 s; a locked screen or a hidden window draws none" }));
            let _ = cx;
            std::process::exit(0);
        })
        .detach();
    });
    0
}

fn offsets() -> i32 {
    let rows = 1_000_000;
    drive(
        Arc::new(Counted(rows)),
        Box::new(move |frame, v, cx| {
            match frame {
                23 => {
                    v.key("end", false, false, cx);
                }
                25 => v.scroll(-0.75),
                27 => {
                    let (top, height) = v.viewport_in_window;
                    let tops: Vec<Json> = v
                        .drawn
                        .iter()
                        .map(|&(i, t)| json!({ "row": i, "top": top + t }))
                        .collect();
                    return Some(
                        json!({ "rows": rows, "viewport": { "top": top, "height": height }, "tops": tops }),
                    );
                }
                _ => {}
            }
            None
        }),
    )
}

fn back() -> i32 {
    let steps = (1000. * ROW / f64::from(STEP)) as usize;
    let mut marks = [0u64; 3];
    drive(
        Arc::new(Grid::new(TABLE_ROWS)),
        Box::new(move |frame, v, _| {
            // After 22 frames to settle, `steps` frames go down a step each; the next `steps` go back up. Each count is read a frame later.
            let k = frame.saturating_sub(23);
            if frame == 23 {
                marks[0] = v.cache().shaped();
            }
            if frame >= 23 && k < steps {
                v.scroll(f64::from(STEP));
            } else if k == steps {
                marks[1] = v.cache().shaped();
                v.scroll(-f64::from(STEP));
            } else if k > steps && k < 2 * steps {
                v.scroll(-f64::from(STEP));
            } else if k == 2 * steps {
                marks[2] = v.cache().shaped();
                return Some(
                    json!({ "rows": TABLE_ROWS, "down_rows": 1000, "shaped_down": marks[1] - marks[0], "shaped_back": marks[2] - marks[1] }),
                );
            }
            None
        }),
    )
}

fn remeasure() -> i32 {
    let list = Arc::new(List::new(100_000));
    let rows: Arc<dyn Rows> = list.clone();
    let pointer = f64::from(WINDOW.1 / 2.);
    let under = move |v: &TableView| -> (usize, f64, usize) {
        let (top, _) = v.viewport_in_window;
        let first = v.drawn.first().map_or(0, |d| d.0);
        let (i, t) = v
            .drawn
            .iter()
            .copied()
            .find(|&(i, t)| top + t <= pointer && pointer < top + t + v.heights().height(i))
            .expect("a row under the pointer");
        (v.data_row(i), top + t, first)
    };
    let mut before = None;
    drive(
        rows,
        Box::new(move |frame, v, _| {
            match frame {
                // Into the list's middle.
                23 => v.scroll(v.heights().total() / 2.),
                25 => {
                    let (row, top, first) = under(v);
                    // A one-line row above the viewport grows to three lines, and is remeasured.
                    let changed = (first.saturating_sub(10)..first)
                        .rev()
                        .find(|&r| list.height(r) == Some(f64::from(2. * LINE_TOP + LINE)))
                        .expect("a one-line row above");
                    let height_before = list.height(changed).unwrap_or(0.);
                    list.set_lines(changed, 3);
                    v.remeasure(changed);
                    before = Some((row, top, first, changed, height_before));
                }
                27 => {
                    let (row, top, first, changed, height_before) =
                        before.expect("measured before");
                    let (row2, top2, _) = under(v);
                    return Some(json!({
                        "rows": 100_000,
                        "pointer": [WINDOW.0 / 2., WINDOW.1 / 2.],
                        "first_visible": first,
                        "changed": { "row": changed, "height_before": height_before, "height_after": list.height(changed).unwrap_or(0.) },
                        "before": { "row": row, "top": top },
                        "after": { "row": row2, "top": top2 },
                    }));
                }
                _ => {}
            }
            None
        }),
    )
}

// ---------------------------------------------------------------------------------------------------------------
// Sessions.

fn lines() -> impl Iterator<Item = Json> {
    std::io::stdin()
        .lock()
        .lines()
        .map_while(Result::ok)
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(&l).unwrap_or(Json::Null))
}

fn say(v: Json) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

enum Col {
    Number(Vec<f64>),
    Text(Vec<String>),
}

struct Table {
    names: Vec<String>,
    cols: Vec<Col>,
    rows: usize,
}

impl Rows for Table {
    fn len(&self) -> usize {
        self.rows
    }
    fn columns(&self) -> usize {
        self.cols.len()
    }
    fn cell(&self, row: usize, column: usize) -> Value<'_> {
        match &self.cols[column] {
            Col::Number(v) => Value::Number(v[row]),
            Col::Text(v) => Value::Text(&v[row]),
        }
    }
}

fn sort_session(data: &str) -> i32 {
    let text = std::fs::read_to_string(data).expect("the data file");
    let doc: Json = serde_json::from_str(&text).expect("the data file is JSON");
    let mut names = Vec::new();
    let mut cols = Vec::new();
    for c in doc["columns"].as_array().expect("columns") {
        names.push(c["name"].as_str().expect("a name").to_string());
        let values = c["values"].as_array().expect("values");
        cols.push(if c["type"] == "number" {
            Col::Number(
                values
                    .iter()
                    .map(|v| match v {
                        Json::String(s) if s == "NaN" => f64::NAN,
                        Json::String(s) if s == "Infinity" => f64::INFINITY,
                        Json::String(s) if s == "-Infinity" => f64::NEG_INFINITY,
                        v => v.as_f64().unwrap_or(f64::NAN),
                    })
                    .collect(),
            )
        } else {
            Col::Text(
                values
                    .iter()
                    .map(|v| v.as_str().unwrap_or("").to_string())
                    .collect(),
            )
        });
    }
    let rows = cols.first().map_or(0, |c| match c {
        Col::Number(v) => v.len(),
        Col::Text(v) => v.len(),
    });
    let table = Arc::new(Table { names, cols, rows });
    // Ours, its typed cells loaded; a sort runs through the view and reads back its order.
    let mut h = Headless::new(table.clone());
    say(json!({ "ready": true, "rows": rows }));
    for cmd in lines() {
        let s = &cmd["sort"];
        let by = table
            .names
            .iter()
            .position(|n| s["by"] == n.as_str())
            .expect("a column to sort by");
        let filter = s["filter"].as_object().map(|f| {
            let col = table
                .names
                .iter()
                .position(|n| f["column"] == n.as_str())
                .expect("a filter column");
            (col, f["at_least"].as_f64().unwrap_or(f64::NAN))
        });
        let t = table.clone();
        let keep = move |r: usize| match filter {
            Some((col, at_least)) => matches!(t.cell(r, col), Value::Number(n) if n >= at_least),
            None => true,
        };
        let order = h.with(|v, _| {
            v.sort(
                Some(by),
                false,
                filter
                    .is_some()
                    .then_some(&keep as &(dyn Fn(usize) -> bool + Sync)),
            );
            (0..v.shown()).map(|i| v.data_row(i)).collect::<Vec<_>>()
        });
        say(json!({ "sorted": order.len() }));
        say(json!({ "order": order }));
    }
    0
}

fn soak() -> i32 {
    let mut h = Headless::new(Arc::new(Counted(TABLE_ROWS)));
    let state = |h: &mut Headless| -> Json {
        let size = h.cx.update(|cx| h.root.read(cx).size);
        h.with(|v, _| {
            let n = v.shown();
            let span = |r: std::ops::Range<usize>| {
                if r.is_empty() {
                    Json::Null
                } else {
                    json!([r.start.to_string(), (r.end - 1).to_string()])
                }
            };
            let visible = span(v.visible());
            let selected = span(v.selection());
            json!({
                "rows": n.to_string(),
                "viewport": [size.0, size.1],
                "offset": v.anchor.offset(v.heights()),
                "visible": visible,
                "selected": selected,
            })
        })
    };
    let first = state(&mut h);
    say(json!({ "ready": true, "rows": first["rows"], "viewport": first["viewport"] }));
    for e in lines() {
        if let Some(n) = e["rows"].as_str() {
            let n: usize = n.parse().unwrap_or(0);
            h.with(|v, _| v.set_rows(Arc::new(Counted(n))));
        } else if !e["scroll"].is_null() {
            let dy = match &e["scroll"] {
                Json::String(s) if s == "NaN" => f64::NAN,
                Json::String(s) if s == "Infinity" => f64::INFINITY,
                Json::String(s) if s == "-Infinity" => f64::NEG_INFINITY,
                v => v.as_f64().unwrap_or(f64::NAN),
            };
            h.with(|v, _| v.scroll(dy));
        } else if let Some([w, ht]) = e["resize"]
            .as_array()
            .map(|a| [a[0].as_f64().unwrap_or(0.), a[1].as_f64().unwrap_or(0.)])
        {
            let root = h.root.clone();
            h.cx.update(|cx| root.update(cx, |r, _| r.size = (w as f32, ht as f32)));
        } else if let Some(k) = e["key"].as_str() {
            h.with(|v, cx| v.key(k, false, false, cx));
        } else if let Some(s) = e["select"].as_str() {
            let at: Option<usize> = s.parse().ok();
            h.with(|v, _| {
                let n = v.shown();
                v.range_from = None;
                v.cursor = at.filter(|_| n > 0).map(|i| i.min(n - 1));
            });
        }
        h.frame();
        say(state(&mut h));
    }
    0
}

fn access() -> i32 {
    deep_app::table::view::ALLOCATIONS.set(allocations).ok();
    application().run(|cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
        cx.activate(true);
        cx.bind_keys([]);
        let opts = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(None, size(px(WINDOW.0), px(WINDOW.1)), cx))),
            ..Default::default()
        };
        let grid: Arc<dyn Rows> = Arc::new(Grid::new(TABLE_ROWS));
        let window = cx
            .open_window(opts, |window, cx| {
                let v = cx.new(|cx| {
                    let mut v = TableView::new(grid, vec![WIDTH; COLUMNS], cx);
                    v.cursor = Some(0);
                    v
                });
                v.read(cx).focus_handle().clone().focus(window, cx);
                v
            })
            .expect("a window");
        let view = window.entity(cx).expect("the view");
        let (tx, rx) = std::sync::mpsc::channel::<Json>();
        std::thread::spawn(move || {
            for l in lines() {
                if tx.send(l).is_err() {
                    break;
                }
            }
        });
        let w: AnyWindowHandle = window.into();
        cx.spawn(async move |cx| {
            // The first frames: the view's viewport is set when it paints.
            cx.background_executor().timer(Duration::from_millis(500)).await;
            let ready = cx.update(|cx| {
                let v = view.read(cx);
                let vis = v.visible();
                json!({ "ready": true, "pid": std::process::id(), "visible": [vis.start, vis.end.saturating_sub(1)], "selected": [0, 0] })
            });
            say(ready);
            loop {
                match rx.try_recv() {
                    Ok(cmd) => {
                        let key = cmd["key"].as_str().unwrap_or("");
                        let stroke = Keystroke::parse(key).expect("a keystroke");
                        let _ = cx.update_window(w, |_, window, cx| {
                            window.dispatch_event(
                                PlatformInput::KeyDown(KeyDownEvent { keystroke: stroke, is_held: false, prefer_character_input: false }),
                                cx,
                            );
                        });
                        cx.background_executor().timer(Duration::from_millis(50)).await;
                        let answer = cx.update(|cx| {
                            let v = view.read(cx);
                            let s = v.selection();
                            let vis = v.visible();
                            json!({
                                "visible": [vis.start, vis.end.saturating_sub(1)],
                                "selected": [s.start, s.end.saturating_sub(1)],
                                "activated": v.activated,
                            })
                        });
                        say(answer);
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => {
                        cx.background_executor().timer(Duration::from_millis(10)).await;
                    }
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        let n = cx.update(|cx| view.read(cx).counts.access_allocations);
                        say(json!({ "access_allocations": n }));
                        std::process::exit(0);
                    }
                }
            }
        })
        .detach();
    });
    0
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let code = match args.first().map(String::as_str) {
        Some("arm") => {
            let name = args.get(1).cloned().unwrap_or_default();
            let load_start = load();
            let json = arm(&name);
            let out = Rc::new(RefCell::new(Some(json)));
            print_and_exit(&out, load_start);
            0
        }
        Some("measure") => measure(
            &arg("--out").expect("--out <file>"),
            arg("--arms").map(|a| a.split(',').map(str::to_string).collect()),
        ),
        Some("offsets") => offsets(),
        Some("back") => back(),
        Some("remeasure") => remeasure(),
        Some("sort") => sort_session(&arg("--data").expect("--data <file>")),
        Some("soak") => soak(),
        Some("access") => access(),
        // With no call it does nothing, so `cargo test --workspace` stays fast.
        None => 0,
        _ => {
            eprintln!("usage: lists_1477 arm <name> | measure --out <file> [--arms a,b] | offsets | back | remeasure | sort --data <file> | soak | access");
            2
        }
    };
    std::process::exit(code);
}
