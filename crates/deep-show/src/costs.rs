//! The cost model's micro-benchmark (issue #379; canvas primitives: The cost model, "Coefficients
//! come from micro-benchmarks on the reference Mac"): the `costs` call times every operator the
//! build seals over three generated boards, a base, one whose paths have 40 times the vertices
//! and one whose texts have 30 times the glyphs, each on a fresh scheduler, and fits each
//! operator's nanoseconds per item, per vertex and per glyph. `benchmarks/canvas.mjs costs`
//! adds the GPU passes' terms and, on a reference Mac with `--write`, writes them as the
//! build's coefficients. The canvas core reads no clock; its scheduler calls the hook here.
//! Issue #856: each board is read cold, the shaped-run cache emptied before each run and each
//! text distinct, and then warm, its runs already shaped, for shaping's `ns_per_glyph_warm`.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::time::Instant;

use deep_canvas::cost::counts;
use deep_canvas::schedule::{default_view, Options, Scheduler, Session as DocSession};
use deep_canvas::show::{stamp, Writer, WriterKind};
use serde_json::{json, Map, Value};

use crate::hub::Startup;

/// Runs over each board; the median of their means is the board's reading.
const RUNS: usize = 5;
const ITEMS: usize = 60;
/// The one shaper's operator, whose runs the shaped-run cache keeps: timed warm apart from cold.
const SHAPE: &str = "text.shape";

/// One finished node: its operator, its item and its ns.
type Timed = (usize, Option<String>, u64);

thread_local! {
    /// The node running now, and every finished node.
    static CLOCK: RefCell<(Option<Instant>, Vec<Timed>)> = const { RefCell::new((None, Vec::new())) };
}

fn timing(op: usize, item: Option<&str>, done: bool) {
    CLOCK.with(|c| {
        let mut c = c.borrow_mut();
        if !done {
            c.0 = Some(Instant::now());
        } else if let Some(started) = c.0.take() {
            let ns = started.elapsed().as_nanos() as u64;
            c.1.push((op, item.map(str::to_string), ns));
        }
    });
}

/// A board of rects, circles, paths of `segments` segments, texts of `glyphs` characters, each
/// its own, and frames, with a channel that moves one rect.
fn board(segments: usize, glyphs: usize) -> Value {
    let mut items = Map::new();
    let paint = json!({"fill": {"role": "muted"}});
    let letter = |n: usize| char::from(b'a' + (n % 26) as u8);
    for i in 0..ITEMS {
        let text: String = [letter(i / 26), letter(i)]
            .into_iter()
            .chain("abcdefghij".chars().cycle())
            .take(glyphs)
            .collect();
        let y = (i * 11 % 700) as f64;
        let mut d = format!("M0 {y}");
        for s in 1..=segments {
            d.push_str(&format!(
                " L{:.2} {}",
                (s * 1200) as f64 / segments as f64,
                y + if s % 2 == 1 { 8.0 } else { 0.0 }
            ));
        }
        let order = |k: usize| format!("a{:04}", i * 5 + k);
        items.insert(format!("r{i}"), json!({"id": format!("r{i}"), "kind": "rect@1", "name": format!("R{i}"), "order": order(0),
            "params": {"box": [0, 0, 8, 8], "paint": paint}, "at": {"pos": [i * 7 % 1200, y, 0]}}));
        items.insert(format!("c{i}"), json!({"id": format!("c{i}"), "kind": "circle@1", "name": format!("C{i}"), "order": order(1),
            "params": {"center": [i * 9 % 1200, y], "r": 4, "paint": paint}}));
        items.insert(format!("p{i}"), json!({"id": format!("p{i}"), "kind": "path@1", "name": format!("P{i}"), "order": order(2),
            "params": {"d": d, "paint": {"stroke": {"role": "ink", "width": 2}}}}));
        items.insert(format!("t{i}"), json!({"id": format!("t{i}"), "kind": "text@1", "name": format!("T{i}"), "order": order(3),
            "params": {"text": text, "font": "body", "size": 13, "box": {"w": 400, "h": 20}}, "at": {"pos": [0, y, 0]}}));
        items.insert(format!("f{i}"), json!({"id": format!("f{i}"), "kind": "frame@1", "name": format!("F{i}"), "order": order(4),
            "params": {"box": [0, 0, 40, 20]}, "at": {"pos": [i * 13 % 1200, y, 0]}}));
    }
    json!({
        "format": 1, "profile": "board", "title": "Cost bench", "description": "The cost model's micro-benchmark board.",
        "size": [1280, 720], "transport": {"span": "2s"}, "items": items,
        "channels": {"slide": {"target": "items/r0/at/pos/0", "type": "f32",
            "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"}, "k1": {"t": "2s", "value": 600, "interp": "linear"}}}},
    })
}

/// Per operator: its mean ns per node, and its nodes' mean vertices and glyphs.
type Reading = BTreeMap<usize, (f64, f64, f64)>;

/// A board's reading: `cold` empties the shaped-run cache before each run, so every text is
/// shaped; otherwise the runs the cache holds are reused.
fn read_board(
    startup: &Startup,
    doc: &Value,
    readings: &BTreeMap<String, Value>,
    tokens: &deep_canvas::schedule::Tokens,
    cold: bool,
) -> Result<Reading, String> {
    let items = doc["items"].as_object().cloned().unwrap_or_default();
    let mut runs: Vec<Reading> = Vec::new();
    for _ in 0..RUNS {
        if cold {
            deep_text::cache::clear();
        }
        CLOCK.with(|c| c.borrow_mut().1.clear());
        let mut sched = Scheduler::new(
            &startup.sealed,
            Options {
                timing: Some(timing),
                ..Options::default()
            },
        );
        let mut session = DocSession::new(0, tokens.clone());
        session.set_readings(readings.clone());
        let issues = session.load(&mut sched, doc);
        if let Some(i) = issues.first() {
            return Err(format!(
                "the bench board doesn't load: {} {}",
                i.code, i.path
            ));
        }
        let view = default_view(doc);
        session.frame(&mut sched, 0, &view);
        // A document's node works over every item: its time and counts are shared out per item.
        let all = items
            .values()
            .map(counts)
            .fold((0.0, 0.0), |(v, g), c| (v + c.vertices, g + c.glyphs));
        let n_items = items.len().max(1) as f64;
        let mut sums: BTreeMap<usize, (f64, f64, f64, f64)> = BTreeMap::new();
        CLOCK.with(|c| {
            for (op, item, ns) in &c.borrow().1 {
                let (ns, v, g, k) = match item.as_deref().and_then(|id| items.get(id)) {
                    Some(i) => {
                        let n = counts(i);
                        (*ns as f64, n.vertices, n.glyphs, 1.0)
                    }
                    None => (*ns as f64, all.0, all.1, n_items),
                };
                let e = sums.entry(*op).or_default();
                e.0 += ns;
                e.1 += v;
                e.2 += g;
                e.3 += k;
            }
        });
        runs.push(
            sums.into_iter()
                .map(|(op, (ns, v, g, k))| (op, (ns / k, v / k, g / k)))
                .collect(),
        );
    }
    let mut out = Reading::new();
    for op in runs[0].keys() {
        let mut ns: Vec<f64> = runs.iter().filter_map(|r| r.get(op)).map(|r| r.0).collect();
        ns.sort_by(f64::total_cmp);
        let (_, v, g) = runs[0][op];
        out.insert(*op, (ns[ns.len() / 2], v, g));
    }
    Ok(out)
}

/// The build answering: its Cargo profile and its toolchain, as `rustc -V` prints it, which a
/// coefficient file records (issue #855).
pub fn build() -> Value {
    json!({"profile": env!("DEEP_PROFILE"), "toolchain": env!("DEEP_TOOLCHAIN")})
}

/// The `costs` call: each operator's fitted terms, by key.
pub fn measure(startup: &Startup) -> Value {
    let writer = Writer {
        kind: WriterKind::Agent,
        id: "cost-bench".into(),
    };
    let tokens = deep_canvas_marks::modules::tokens(&crate::hub::shipped_look().light);
    let mut readings = Vec::new();
    let mut warm = Vec::new();
    for (segments, glyphs) in [(10, 4), (400, 4), (10, 120)] {
        let doc = match stamp(
            &board(segments, glyphs),
            "01jb379c057000000000000000",
            &writer,
            "Cost bench",
        ) {
            Ok(d) => d,
            Err(issues) => {
                return json!({"code": "refused", "issues": issues.iter().map(|i| i.to_json()).collect::<Vec<_>>()})
            }
        };
        // Cold, then warm: the cold reading's last run leaves the board's runs in the cache.
        for (cold, out) in [(true, &mut readings), (false, &mut warm)] {
            match read_board(startup, &doc, &BTreeMap::new(), &tokens, cold) {
                Ok(r) => out.push(r),
                Err(e) => return json!({"code": "refused", "reason": e}),
            }
        }
    }
    // An operator no board runs (a counter, a text animator) is timed on the modules' own
    // fixtures, which exercise every one of them, for its per-item term alone.
    let mut fixtures = Reading::new();
    for (_, f) in &startup.sealed.fixtures {
        let Ok(doc) = stamp(
            &f.document,
            "01jb379c057000000000000001",
            &writer,
            "Cost bench",
        ) else {
            continue;
        };
        let record: BTreeMap<String, Value> = f
            .record
            .as_ref()
            .and_then(Value::as_object)
            .map(|r| r.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();
        if let Ok(r) = read_board(startup, &doc, &record, &tokens, true) {
            for (op, x) in r {
                fixtures.entry(op).or_insert(x);
            }
        }
    }
    let (base, vertices, glyphs) = (&readings[0], &readings[1], &readings[2]);
    let mut terms = Map::new();
    for (i, op) in startup.sealed.ops.iter().enumerate() {
        let Some(&(t0, v0, g0)) = base.get(&i) else {
            if let Some(&(t, _, _)) = fixtures.get(&i) {
                terms.insert(op.key.clone(), json!({"ns_per_item": t.round().max(1.0)}));
            }
            continue;
        };
        let slope = |r: &Reading, pick: fn(&(f64, f64, f64)) -> f64| -> f64 {
            r.get(&i).map_or(0.0, |x| {
                let dx = pick(x) - pick(&(t0, v0, g0));
                if dx > 0.0 {
                    ((x.0 - t0) / dx).max(0.0)
                } else {
                    0.0
                }
            })
        };
        let per_vertex = slope(vertices, |x| x.1);
        let per_glyph = slope(glyphs, |x| x.2);
        let per_glyph_warm = (op.key == SHAPE)
            .then(|| {
                let (w0, w1) = (warm[0].get(&i)?, warm[2].get(&i)?);
                let dx = w1.2 - w0.2;
                (dx > 0.0).then(|| ((w1.0 - w0.0) / dx).max(0.0))
            })
            .flatten();
        let per_item = (t0 - per_vertex * v0 - per_glyph * g0).max(1.0);
        let mut t = Map::new();
        t.insert("ns_per_item".into(), json!(per_item.round()));
        if per_vertex >= 0.01 {
            t.insert(
                "ns_per_vertex".into(),
                json!((per_vertex * 100.0).round() / 100.0),
            );
        }
        if per_glyph >= 0.01 {
            t.insert(
                "ns_per_glyph".into(),
                json!((per_glyph * 100.0).round() / 100.0),
            );
        }
        if let Some(warm) = per_glyph_warm {
            // At least 0.01 ns, so a measured warm term is never read as none.
            t.insert(
                "ns_per_glyph_warm".into(),
                json!(((warm * 100.0).round() / 100.0).max(0.01)),
            );
        }
        terms.insert(op.key.clone(), Value::Object(t));
    }
    json!({"terms": terms, "runs": RUNS, "items": ITEMS * 5, "build": build()})
}
