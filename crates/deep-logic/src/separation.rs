//! separation@1's built table and its kind rules (#1255; canvas primitives: Logic: library
//! interfaces): the movers and minima a logic item's `separation` declares, checked and refused
//! naming a by-pair row that carries no basis; their bytes, the item's asset 0, which a
//! separation@1 library reads (packs/separation-1.0.0/LAYOUT.md); and the judge's reading of a
//! run, `separation.clear` and `separation.exact`. The rules read the movers as the library's
//! state holds them flown and solve every pair in closed form themselves, never from a window a
//! library found, so they hold any library, a planted one included.

use serde_json::{json, Value};

/// The most movers a table holds, by-pair rows, and fixes a route (a state keeps 8 slots a mover).
pub const MOVERS: usize = 64;
const ROWS: usize = 64;
pub const SLOTS: usize = 8;
/// A row's basis as a window names it: cited, or invented (0: the table's own minimum, no row).
const CITED: i32 = 1;
const INVENTED: i32 = 2;

/// A fix of a mover's route: where it is, the speed given from it (0 at the last), and the band
/// its speed may be given in there.
#[derive(Clone, Debug)]
pub struct Fix {
    pub name: String,
    pub at: [f64; 3],
    pub speed: f64,
    pub band: Option<[f64; 2]>,
}

#[derive(Clone, Debug)]
pub struct Mover {
    pub id: String,
    pub class: String,
    pub route: Vec<Fix>,
    pub start: f64,
}

/// A by-pair row: the lateral minimum behind a leader of one class for a follower of another,
/// measured when the leader passes the fix `at` names, or always (None).
#[derive(Clone, Debug)]
pub struct Row {
    pub leader: String,
    pub follower: String,
    pub min: f64,
    pub at: Option<String>,
    pub basis: i32,
}

/// The movers and minima an item declares, and the bytes a separation@1 library reads.
#[derive(Clone, Debug)]
pub struct Table {
    pub movers: Vec<Mover>,
    pub lateral: f64,
    pub vertical: f64,
    pub rows: Vec<Row>,
    pub bytes: Vec<u8>,
}

fn refusal(what: String, extra: Value) -> Value {
    let mut out = json!({"rule": "separation", "what": what});
    if let (Some(o), Value::Object(e)) = (out.as_object_mut(), extra) {
        o.extend(e);
    }
    out
}

fn number(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|x| x.is_finite())
}

fn positive(v: Option<&Value>) -> Option<f64> {
    number(v).filter(|x| *x > 0.0)
}

/// The first key of `v` that isn't one of `known`.
fn unknown<'a>(v: &'a Value, known: &[&str]) -> Option<&'a String> {
    v.as_object()?.keys().find(|k| !known.contains(&k.as_str()))
}

fn mover_of(v: &Value, i: usize) -> Result<Mover, Value> {
    let id = v.get("id").and_then(Value::as_str).unwrap_or_default();
    let bad = |what: String| {
        refusal(
            format!("separation.movers[{i}] {what}"),
            json!({"mover": if id.is_empty() { json!(i) } else { json!(id) }}),
        )
    };
    if let Some(k) = unknown(v, &["id", "class", "route", "speed", "band", "start"]) {
        return Err(bad(format!("has no field {k}")));
    }
    if id.is_empty() {
        return Err(bad("has an id".into()));
    }
    let class = v
        .get("class")
        .and_then(Value::as_str)
        .ok_or_else(|| bad("has a class key".into()))?;
    let start = number(v.get("start")).ok_or_else(|| bad("gives start in seconds".into()))?;
    let mut route: Vec<Fix> = Vec::new();
    for f in v
        .get("route")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = f.get("fix").and_then(Value::as_str);
        let at = f.get("at").and_then(Value::as_array).and_then(|a| {
            let p: Vec<f64> = a.iter().filter_map(|x| number(Some(x))).collect();
            (a.len() == 3 && p.len() == 3).then(|| [p[0], p[1], p[2]])
        });
        match (name, at) {
            (Some(n), Some(at)) if !route.iter().any(|x| x.name == n) => route.push(Fix {
                name: n.into(),
                at,
                speed: 0.0,
                band: None,
            }),
            _ => return Err(bad("gives each fix once as {fix, at: [m, m, m]}".into())),
        }
    }
    if route.len() < 2 || route.len() > SLOTS {
        return Err(bad(format!("has a route of 2 to {SLOTS} fixes")));
    }
    let slot = |name: Option<&Value>, route: &[Fix]| {
        let n = name.and_then(Value::as_str)?;
        route.iter().position(|x| x.name == n)
    };
    let mut given = vec![None; route.len()];
    for s in v
        .get("speed")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        match (slot(s.get("from_fix"), &route), positive(s.get("speed"))) {
            (Some(j), Some(x)) => given[j] = Some(x),
            _ => {
                return Err(bad(
                    "gives each speed as {from_fix, speed: m/s} from a fix of its route".into(),
                ))
            }
        }
    }
    // The speed given from a fix holds until the next one given; none is given from the last.
    let mut v_now = given[0].ok_or_else(|| bad(format!("has no speed from {}", route[0].name)))?;
    let last = route.len() - 1;
    for (j, f) in route.iter_mut().enumerate().take(last) {
        v_now = given[j].unwrap_or(v_now);
        f.speed = v_now;
    }
    for b in v
        .get("band")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let (min, max) = (positive(b.get("min")), positive(b.get("max")));
        match (slot(b.get("fix"), &route), min, max) {
            (Some(j), Some(min), Some(max)) if min <= max => route[j].band = Some([min, max]),
            _ => {
                return Err(bad(
                    "gives each band as {fix, min: m/s, max: m/s} at a fix of its route".into(),
                ))
            }
        }
    }
    Ok(Mover {
        id: id.into(),
        class: class.into(),
        route,
        start,
    })
}

fn row_of(v: &Value, i: usize) -> Result<Row, Value> {
    let bad = |what: String| {
        refusal(
            format!("separation.minima.by_pair[{i}] {what}"),
            json!({"row": i}),
        )
    };
    if let Some(k) = unknown(v, &["leader", "follower", "min", "at", "basis"]) {
        return Err(bad(format!("has no field {k}")));
    }
    let text = |k: &str| v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let (Some(leader), Some(follower), Some(min), Some(at)) = (
        text("leader"),
        text("follower"),
        positive(v.get("min")),
        text("at"),
    ) else {
        return Err(bad(
            "is {leader, follower, min: m, at: fix | always, basis}".into(),
        ));
    };
    let cited = |c: &Value| {
        let part = |k: &str| {
            c.get(k)
                .and_then(Value::as_str)
                .is_some_and(|s| !s.is_empty())
        };
        part("source") && part("section")
    };
    let basis = match v.get("basis") {
        Some(Value::String(s)) if s == "invented" => INVENTED,
        Some(b) if b.get("cited").is_some_and(cited) => CITED,
        _ => {
            return Err(bad(
                "carries no basis: each row is cited {source, section} or invented".into(),
            ))
        }
    };
    Ok(Row {
        leader: leader.into(),
        follower: follower.into(),
        min,
        at: (at != "always").then(|| at.into()),
        basis,
    })
}

/// The table `separation` declares, or every refusal.
pub fn build(sep: &Value) -> Result<Table, Vec<Value>> {
    let field = |what: &str| vec![refusal(what.into(), json!({"field": "separation"}))];
    if let Some(k) = unknown(sep, &["movers", "minima"]) {
        return Err(field(&format!("separation has no field {k}")));
    }
    let (Some(movers_v), Some(minima)) = (
        sep.get("movers").and_then(Value::as_array),
        sep.get("minima").filter(|m| m.is_object()),
    ) else {
        return Err(field("separation is {movers, minima}"));
    };
    if let Some(k) = unknown(minima, &["lateral", "vertical", "by_pair"]) {
        return Err(field(&format!("separation.minima has no field {k}")));
    }
    let (Some(lateral), Some(vertical)) = (
        positive(minima.get("lateral")),
        positive(minima.get("vertical")),
    ) else {
        return Err(field(
            "separation.minima gives lateral and vertical in metres",
        ));
    };
    let rows_v = match minima.get("by_pair") {
        None => &[][..],
        Some(r) => r
            .as_array()
            .ok_or_else(|| field("separation.minima.by_pair is a list of rows"))?,
    };
    if movers_v.is_empty() || movers_v.len() > MOVERS || rows_v.len() > ROWS {
        return Err(field(&format!(
            "separation holds 1 to {MOVERS} movers and at most {ROWS} by-pair rows"
        )));
    }
    let mut refused = Vec::new();
    let mut movers: Vec<Mover> = Vec::new();
    for (i, v) in movers_v.iter().enumerate() {
        match mover_of(v, i) {
            Ok(m) if movers.iter().any(|x| x.id == m.id) => refused.push(refusal(
                format!(
                    "separation.movers[{i}] has the id of an earlier mover, {}",
                    m.id
                ),
                json!({"mover": m.id}),
            )),
            Ok(m) => movers.push(m),
            Err(r) => refused.push(r),
        }
    }
    let mut rows = Vec::new();
    for (i, v) in rows_v.iter().enumerate() {
        match row_of(v, i) {
            Ok(r) => rows.push(r),
            Err(r) => refused.push(r),
        }
    }
    if !refused.is_empty() {
        return Err(refused);
    }
    let mut table = Table {
        movers,
        lateral,
        vertical,
        rows,
        bytes: Vec::new(),
    };
    table.bytes = bytes(&table);
    Ok(table)
}

/// A class key's or a fix name's number: its place among those named so far.
fn id<'a>(list: &mut Vec<&'a str>, s: &'a str) -> i32 {
    let at = list.iter().position(|x| *x == s).unwrap_or_else(|| {
        list.push(s);
        list.len() - 1
    });
    at as i32
}

/// The table's bytes (packs/separation-1.0.0/LAYOUT.md: The built table).
fn bytes(t: &Table) -> Vec<u8> {
    // Class keys and fix names as numbers, in the order the movers, then the rows, first name them.
    let mut classes: Vec<&str> = Vec::new();
    let mut names: Vec<&str> = Vec::new();
    let (off_movers, row) = (64, 16 + 56 * SLOTS);
    let off_rows = off_movers + row * t.movers.len();
    let mut b = vec![0u8; off_rows + 24 * t.rows.len()];
    let i32_at = |b: &mut [u8], o: usize, x: i32| b[o..o + 4].copy_from_slice(&x.to_le_bytes());
    let f64_at = |b: &mut [u8], o: usize, x: f64| b[o..o + 8].copy_from_slice(&x.to_le_bytes());
    i32_at(&mut b, 0, 1);
    i32_at(&mut b, 4, t.movers.len() as i32);
    i32_at(&mut b, 8, t.rows.len() as i32);
    f64_at(&mut b, 16, t.lateral);
    f64_at(&mut b, 24, t.vertical);
    i32_at(&mut b, 32, off_movers as i32);
    i32_at(&mut b, 36, off_rows as i32);
    for (i, m) in t.movers.iter().enumerate() {
        let o = off_movers + row * i;
        i32_at(&mut b, o, id(&mut classes, &m.class));
        i32_at(&mut b, o + 4, m.route.len() as i32);
        f64_at(&mut b, o + 8, m.start);
        for (j, f) in m.route.iter().enumerate() {
            let o = o + 16 + 56 * j;
            let band = f.band.unwrap_or([0.0, f64::MAX]);
            for (k, x) in [f.at[0], f.at[1], f.at[2], f.speed, band[0], band[1]]
                .iter()
                .enumerate()
            {
                f64_at(&mut b, o + 8 * k, *x);
            }
            i32_at(&mut b, o + 48, id(&mut names, &f.name));
        }
    }
    for (i, r) in t.rows.iter().enumerate() {
        let o = off_rows + 24 * i;
        i32_at(&mut b, o, id(&mut classes, &r.leader));
        i32_at(&mut b, o + 4, id(&mut classes, &r.follower));
        i32_at(
            &mut b,
            o + 8,
            r.at.as_deref().map_or(-1, |a| id(&mut names, a)),
        );
        i32_at(&mut b, o + 12, r.basis);
        f64_at(&mut b, o + 16, r.min);
    }
    b
}

// ---------------------------------------------------------------------------------------------
// The judge: separation.clear and separation.exact, read from the movers as a run's last step
// left them in the item's arrays.

/// A slot of a mover as flown: the fix of its route it is (its index there; −1 the off-route
/// point a stretch added), where it is, the speed from it and its time.
#[derive(Clone, Debug)]
pub struct Slot {
    pub fix: i32,
    pub at: [f64; 3],
    pub speed: f64,
    pub time: f64,
}

/// The movers as flown, and for each the delay asked of it and applied with the fix it was wanted
/// at (−1: none).
pub struct Flown {
    pub movers: Vec<Vec<Slot>>,
    pub delays: Vec<(f64, i32)>,
}

/// The stretch of time from `from` to `to` on which two movers each keep one velocity: where the
/// second is from the first at its start, and how fast that changes.
struct Stretch {
    from: f64,
    to: f64,
    p: [f64; 3],
    v: [f64; 3],
}

/// Whether a is strictly below b: false at equality, and when a state gave no number for one.
fn below(a: f64, b: f64) -> bool {
    a < b
}

fn leg(s: &[Slot], t: f64) -> usize {
    (1..s.len() - 1).take_while(|j| s[*j].time <= t).count()
}

fn velocity(s: &[Slot], j: usize) -> [f64; 3] {
    let dt = s[j + 1].time - s[j].time;
    [0, 1, 2].map(|c| {
        if dt > 0.0 {
            (s[j + 1].at[c] - s[j].at[c]) / dt
        } else {
            0.0
        }
    })
}

/// Where a mover is at t, or None off its route.
fn position(s: &[Slot], t: f64) -> Option<[f64; 3]> {
    (s.len() >= 2 && t >= s[0].time && t <= s[s.len() - 1].time).then(|| {
        let (j, v) = (leg(s, t), velocity(s, leg(s, t)));
        [0, 1, 2].map(|c| s[j].at[c] + v[c] * (t - s[j].time))
    })
}

/// The stretches of the time both movers are on their routes within the span, cut wherever
/// either passes a slot.
fn stretches(a: &[Slot], b: &[Slot], span: [f64; 2]) -> Vec<Stretch> {
    if a.len() < 2 || b.len() < 2 {
        return Vec::new();
    }
    let lo = span[0].max(a[0].time).max(b[0].time);
    let hi = span[1].min(a[a.len() - 1].time).min(b[b.len() - 1].time);
    if !below(lo, hi) {
        return Vec::new();
    }
    let mut cuts: Vec<f64> = a
        .iter()
        .chain(b)
        .map(|s| s.time)
        .filter(|t| *t > lo && *t < hi)
        .collect();
    cuts.extend([lo, hi]);
    cuts.sort_by(f64::total_cmp);
    cuts.dedup();
    cuts.windows(2)
        .map(|w| {
            let (pa, pb) = (
                position(a, w[0]).unwrap_or_default(),
                position(b, w[0]).unwrap_or_default(),
            );
            let (va, vb) = (velocity(a, leg(a, w[0])), velocity(b, leg(b, w[0])));
            Stretch {
                from: w[0],
                to: w[1],
                p: [0, 1, 2].map(|c| pb[c] - pa[c]),
                v: [0, 1, 2].map(|c| vb[c] - va[c]),
            }
        })
        .collect()
}

/// The part of a stretch on which the pair is laterally (x and z) under `lateral` and vertically
/// (y) under `vertical`, both strictly: between the roots of |p + vτ|² = lateral² and between the
/// two times |p + vτ| = vertical.
fn under(s: &Stretch, lateral: f64, vertical: f64) -> Option<[f64; 2]> {
    let (mut lo, mut hi) = (0.0f64, s.to - s.from);
    let vv = s.v[0] * s.v[0] + s.v[2] * s.v[2];
    let pv = s.p[0] * s.v[0] + s.p[2] * s.v[2];
    let c = s.p[0] * s.p[0] + s.p[2] * s.p[2] - lateral * lateral;
    if vv > 0.0 {
        let disc = pv * pv - vv * c;
        if !below(0.0, disc) {
            return None;
        }
        // The root that adds like signs first, the other from the product of the two, c ÷ vv.
        let q = -(pv + disc.sqrt().copysign(pv));
        let (r1, r2) = (q / vv, if q == 0.0 { 0.0 } else { c / q });
        lo = lo.max(r1.min(r2));
        hi = hi.min(r1.max(r2));
    } else if !below(c, 0.0) {
        return None;
    }
    if s.v[1] != 0.0 {
        let (r1, r2) = ((-vertical - s.p[1]) / s.v[1], (vertical - s.p[1]) / s.v[1]);
        lo = lo.max(r1.min(r2));
        hi = hi.min(r1.max(r2));
    } else if !below(s.p[1].abs(), vertical) {
        return None;
    }
    (lo < hi).then_some([s.from + lo, s.from + hi])
}

/// A window a pair is under its minimum: the pair by index, its ends, the minimum that applied
/// and its row (None: the table's own).
struct Window {
    pair: [usize; 2],
    span: [f64; 2],
    min: f64,
    row: Option<usize>,
}

impl Table {
    /// Every window within `span`, by start, then pair: for each pair, the stretches of time it
    /// is under its minima, pieces that meet joined, its lateral minimum the table's or the
    /// `always` row's that asks the most of its two classes, whichever of the two leads; and for
    /// each row measured at a fix, the instant its leader passes the fix with a follower, yet to
    /// pass it, under the row's minimum there.
    fn windows(&self, flown: &[Vec<Slot>], span: [f64; 2]) -> Vec<Window> {
        let mut out = Vec::new();
        for a in 0..flown.len() {
            for b in a + 1..flown.len() {
                let (ca, cb) = (&self.movers[a].class, &self.movers[b].class);
                let fits = |r: &Row| {
                    (r.leader == *ca && r.follower == *cb) || (r.leader == *cb && r.follower == *ca)
                };
                let (min, row) = self
                    .rows
                    .iter()
                    .enumerate()
                    .filter(|(_, r)| r.at.is_none() && fits(r))
                    .fold((self.lateral, None), |best, (i, r)| {
                        if r.min > best.0 {
                            (r.min, Some(i))
                        } else {
                            best
                        }
                    });
                let mut open: Option<[f64; 2]> = None;
                for s in stretches(&flown[a], &flown[b], span) {
                    let u = under(&s, min, self.vertical);
                    match (&mut open, u) {
                        (Some(o), Some(u)) if u[0] - o[1] <= 1e-9 => o[1] = u[1],
                        _ => {
                            out.extend(open.map(|o| Window {
                                pair: [a, b],
                                span: o,
                                min,
                                row,
                            }));
                            open = u;
                        }
                    }
                }
                out.extend(open.map(|o| Window {
                    pair: [a, b],
                    span: o,
                    min,
                    row,
                }));
            }
        }
        for (r, row) in self.rows.iter().enumerate() {
            let Some(at) = &row.at else { continue };
            let passes = |m: usize| {
                let k = self.movers[m].route.iter().position(|f| f.name == *at)?;
                flown[m].iter().find(|s| s.fix == k as i32).map(|s| s.time)
            };
            for (i, lead) in self.movers.iter().enumerate() {
                for (j, follow) in self.movers.iter().enumerate() {
                    if i == j || lead.class != row.leader || follow.class != row.follower {
                        continue;
                    }
                    let (Some(ti), Some(tj)) = (passes(i), passes(j)) else {
                        continue;
                    };
                    if !(ti < tj && ti >= span[0] && ti <= span[1]) {
                        continue;
                    }
                    let (Some(p), Some(q)) = (position(&flown[i], ti), position(&flown[j], ti))
                    else {
                        continue;
                    };
                    if (q[0] - p[0]).hypot(q[2] - p[2]) < row.min
                        && (q[1] - p[1]).abs() < self.vertical
                    {
                        out.push(Window {
                            pair: [i.min(j), i.max(j)],
                            span: [ti, ti],
                            min: row.min,
                            row: Some(r),
                        });
                    }
                }
            }
        }
        out.sort_by(|x, y| x.span[0].total_cmp(&y.span[0]).then(x.pair.cmp(&y.pair)));
        out
    }

    /// separation.clear over `span`: a fail for each window, naming its pair, its ends, the
    /// minimum that applied and its row.
    pub fn clear(&self, flown: &Flown, span: [f64; 2]) -> Vec<Value> {
        self.windows(&flown.movers, span)
            .iter()
            .map(|w| {
                json!({"pair": w.pair.map(|m| self.movers[m].id.clone()), "window": w.span, "min": w.min, "row": w.row})
            })
            .collect()
    }

    /// separation.exact within `tolerance` seconds: a fail for each mover whose applied delay
    /// moved its time at the fix it was wanted at by another amount than asked, naming the mover,
    /// the fix and the time off; and for each speed outside the band at the fix it is given from
    /// (an off-route point's, at the fix before it), naming the mover, the fix and the speed.
    pub fn exact(&self, flown: &Flown, tolerance: f64) -> Vec<Value> {
        let mut out = Vec::new();
        for (m, mover) in self.movers.iter().enumerate() {
            let (slots, (asked, fix)) = (&flown.movers[m], flown.delays[m]);
            if let Some(f) = usize::try_from(fix)
                .ok()
                .and_then(|f| mover.route.get(f).map(|x| (f, x)))
            {
                // The fix's time as the document flies the mover: its start, then each leg's length ÷ its speed.
                let planned = mover.start
                    + mover.route[..=f.0]
                        .windows(2)
                        .map(|w| {
                            [0, 1, 2]
                                .map(|c| (w[1].at[c] - w[0].at[c]).powi(2))
                                .iter()
                                .sum::<f64>()
                                .sqrt()
                                / w[0].speed
                        })
                        .sum::<f64>();
                let off = slots
                    .iter()
                    .find(|s| s.fix == fix)
                    .map(|s| s.time - planned - asked);
                if !off.is_some_and(|o| o.abs() <= tolerance) {
                    out.push(json!({"mover": mover.id, "fix": f.1.name, "time": off}));
                }
            }
            let mut from = 0;
            for s in slots.iter().take(slots.len().saturating_sub(1)) {
                from = usize::try_from(s.fix).unwrap_or(from);
                let Some(f) = mover.route.get(from) else {
                    continue;
                };
                if f.band.is_some_and(|b| s.speed < b[0] || s.speed > b[1]) {
                    out.push(json!({"mover": mover.id, "fix": f.name, "speed": s.speed}));
                }
            }
        }
        out
    }
}

/// The movers of an item's arrays as a step left them: `fix_count`, `fix_ref`, `fix_pos`,
/// `fix_speed`, `fix_time`, `delay_s` and `delay_fix`, each read by `array` as its numbers.
pub fn flown(t: &Table, array: &dyn Fn(&str) -> Option<Vec<f64>>) -> Option<Flown> {
    let n = t.movers.len();
    let (count, fix, pos) = (array("fix_count")?, array("fix_ref")?, array("fix_pos")?);
    let (speed, time) = (array("fix_speed")?, array("fix_time")?);
    let (asked, wanted) = (array("delay_s")?, array("delay_fix")?);
    let sized = count.len() >= n && asked.len() >= n && wanted.len() >= n;
    let slots = SLOTS * n;
    if !sized
        || fix.len() < slots
        || pos.len() < 3 * slots
        || speed.len() < slots
        || time.len() < slots
    {
        return None;
    }
    Some(Flown {
        movers: (0..n)
            .map(|m| {
                (0..(count[m].max(0.0) as usize).min(SLOTS))
                    .map(|q| SLOTS * m + q)
                    .map(|k| Slot {
                        fix: fix[k] as i32,
                        at: [pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]],
                        speed: speed[k],
                        time: time[k],
                    })
                    .collect()
            })
            .collect(),
        delays: (0..n).map(|m| (asked[m], wanted[m] as i32)).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two movers closing at 250 m/s, level, passing √(5,556² − 75²) m apart at 140.5 s: east +x at
    /// 200 m/s from 0, north +z at 150 m/s from 20 s, of classes `east` and `north` name.
    fn crossing(north: &str, rows: Value) -> Value {
        let p = (5556.0f64 * 5556.0 - 75.0 * 75.0).sqrt();
        let (x0, z0) = (-200.0 * 140.5 - 0.6 * p, 0.8 * p - 150.0 * 140.5);
        json!({"movers": [
            {"id": "east", "class": "heavy", "start": 0, "route": [{"fix": "in", "at": [x0, 3000, 0]}, {"fix": "out", "at": [x0 + 80000.0, 3000, 0]}],
             "speed": [{"from_fix": "in", "speed": 200}], "band": [{"fix": "in", "min": 150, "max": 250}]},
            {"id": "north", "class": north, "start": 20, "route": [{"fix": "in", "at": [0, 3000, z0 + 3000.0]}, {"fix": "out", "at": [0, 3000, z0 + 60000.0]}],
             "speed": [{"from_fix": "in", "speed": 150}]}],
            "minima": {"lateral": 5556, "vertical": 300, "by_pair": rows}})
    }

    /// Each mover flown as its document data give it, with no delay asked.
    fn as_given(t: &Table) -> Flown {
        let movers = t.movers.iter().map(|m| {
            let mut time = m.start;
            m.route
                .iter()
                .enumerate()
                .map(|(j, f)| {
                    if j > 0 {
                        let d: f64 = (0..3)
                            .map(|c| (f.at[c] - m.route[j - 1].at[c]).powi(2))
                            .sum();
                        time += d.sqrt() / m.route[j - 1].speed;
                    }
                    Slot {
                        fix: j as i32,
                        at: f.at,
                        speed: f.speed,
                        time,
                    }
                })
                .collect()
        });
        Flown {
            movers: movers.collect(),
            delays: vec![(0.0, -1); t.movers.len()],
        }
    }

    #[test]
    fn a_row_with_no_basis_is_refused_naming_it_and_no_other() {
        let row = |basis: Value| {
            let mut r =
                json!({"leader": "heavy", "follower": "light", "min": 7408, "at": "always"});
            if !basis.is_null() {
                r["basis"] = basis;
            }
            r
        };
        let cited = json!({"cited": {"source": "a rule sheet", "section": "2"}});
        let refused = build(&crossing(
            "light",
            json!([row(cited.clone()), row(Value::Null)]),
        ))
        .unwrap_err();
        assert_eq!(
            refused.iter().map(|r| r["row"].clone()).collect::<Vec<_>>(),
            [json!(1)]
        );
        // A source with no section cites nothing.
        assert!(build(&crossing(
            "light",
            json!([row(json!({"cited": {"source": "a rule sheet"}}))])
        ))
        .is_err());
        let t = build(&crossing(
            "light",
            json!([row(cited), row(json!("invented"))]),
        ))
        .unwrap();
        assert_eq!(
            t.rows.iter().map(|r| r.basis).collect::<Vec<_>>(),
            [CITED, INVENTED]
        );
    }

    #[test]
    fn the_table_holds_each_fix_with_its_speed_band_and_name() {
        let row = json!({"leader": "heavy", "follower": "light", "min": 9000, "at": "out", "basis": "invented"});
        let t = build(&crossing("light", json!([row]))).unwrap();
        let i32_at = |o: usize| i32::from_le_bytes(t.bytes[o..o + 4].try_into().unwrap());
        let f64_at = |o: usize| f64::from_le_bytes(t.bytes[o..o + 8].try_into().unwrap());
        assert_eq!(
            [i32_at(0), i32_at(4), i32_at(8), i32_at(32), i32_at(36)],
            [1, 2, 1, 64, 64 + 2 * 464]
        );
        assert_eq!([f64_at(16), f64_at(24)], [5556.0, 300.0]);
        // East: class 0, two fixes, from 0 s; its first fix flown at 200 m/s in a band of 150 to 250, its last at none.
        assert_eq!([i32_at(64), i32_at(68)], [0, 2]);
        assert_eq!(
            [
                f64_at(80 + 24),
                f64_at(80 + 32),
                f64_at(80 + 40),
                f64_at(80 + 56 + 24)
            ],
            [200.0, 150.0, 250.0, 0.0]
        );
        // North: class 1, from 20 s, no band given; its fixes carry the names east's do.
        let north = 64 + 464;
        assert_eq!(
            [
                i32_at(north),
                i32_at(north + 16 + 48),
                i32_at(north + 16 + 56 + 48)
            ],
            [1, 0, 1]
        );
        assert_eq!(
            [
                f64_at(north + 8),
                f64_at(north + 16 + 32),
                f64_at(north + 16 + 40)
            ],
            [20.0, 0.0, f64::MAX]
        );
        // The row: heavy before light, measured at `out`, invented.
        let r = 64 + 2 * 464;
        assert_eq!(
            [i32_at(r), i32_at(r + 4), i32_at(r + 8), i32_at(r + 12)],
            [0, 1, 1, INVENTED]
        );
        assert_eq!(f64_at(r + 16), 9000.0);
        // A mover with no speed from its first fix can't be flown.
        let mut no_speed = crossing("light", json!([]));
        no_speed["movers"][1]["speed"] = json!([]);
        assert_eq!(build(&no_speed).unwrap_err()[0]["mover"], json!("north"));
    }

    #[test]
    fn clear_finds_a_breach_between_two_whole_seconds_in_closed_form() {
        let t = build(&crossing("heavy", json!([]))).unwrap();
        let fails = t.clear(&as_given(&t), [0.0, 600.0]);
        assert_eq!(fails.len(), 1);
        assert_eq!(
            [&fails[0]["pair"], &fails[0]["row"], &fails[0]["min"]],
            [&json!(["east", "north"]), &Value::Null, &json!(5556.0)]
        );
        let ends: Vec<f64> = fails[0]["window"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_f64)
            .collect();
        assert!(
            (ends[0] - 140.2).abs() < 1e-6 && (ends[1] - 140.8).abs() < 1e-6,
            "{ends:?}"
        );
        // A span that ends inside the window cuts it there; one that ends before it finds none.
        assert_eq!(
            t.clear(&as_given(&t), [0.0, 140.5])[0]["window"][1],
            json!(140.5)
        );
        assert!(t.clear(&as_given(&t), [0.0, 140.0]).is_empty());
        // 200 m more between their levels than the vertical minimum, and the pair is clear.
        let mut high = as_given(&t);
        high.movers[1].iter_mut().for_each(|s| s.at[1] += 500.0);
        assert!(t.clear(&high, [0.0, 600.0]).is_empty());
    }

    #[test]
    fn clear_reads_a_row_that_holds_always_and_one_measured_at_a_fix() {
        // Always, whichever leads: the pair is under 7,408 m for √(7,408² − P²) ÷ 250 s either side of 140.5 s.
        let always = json!({"leader": "light", "follower": "heavy", "min": 7408, "at": "always", "basis": "invented"});
        let t = build(&crossing("light", json!([always]))).unwrap();
        let fails = t.clear(&as_given(&t), [0.0, 600.0]);
        let half = (7408.0f64 * 7408.0 - (5556.0f64 * 5556.0 - 75.0 * 75.0)).sqrt() / 250.0;
        assert_eq!(
            [&fails[0]["row"], &fails[0]["min"]],
            [&json!(0), &json!(7408.0)]
        );
        assert!(
            (fails[0]["window"][0].as_f64().unwrap() - (140.5 - half)).abs() < 1e-6,
            "{fails:?}"
        );
        // The same row between two heavy movers fits no pair, and the table's own minimum stands.
        let t = build(&crossing("heavy", json!([always]))).unwrap();
        assert_eq!(t.clear(&as_given(&t), [0.0, 600.0])[0]["row"], Value::Null);
        // Measured when the leader passes `gate`: 100 s × 80 m/s = 8,000 m behind, under the row's 10,000 m.
        let lane = |id: &str, class: &str, start: f64| {
            json!({"id": id, "class": class, "start": start, "route": [{"fix": "entry", "at": [-20000, 900, 0]}, {"fix": "gate", "at": [0, 900, 0]}],
                "speed": [{"from_fix": "entry", "speed": 80}]})
        };
        let at_gate = json!({"leader": "heavy", "follower": "light", "min": 10000, "at": "gate", "basis": "invented"});
        let sep = |rows: Value| json!({"movers": [lane("leader", "heavy", 0.0), lane("follower", "light", 100.0)], "minima": {"lateral": 5556, "vertical": 300, "by_pair": rows}});
        let t = build(&sep(json!([at_gate]))).unwrap();
        assert_eq!(
            t.clear(&as_given(&t), [0.0, 800.0]),
            [
                json!({"pair": ["leader", "follower"], "window": [250.0, 250.0], "min": 10000.0, "row": 0})
            ]
        );
        assert!(t.clear(&as_given(&t), [0.0, 249.0]).is_empty());
        // The row the other way round: a light mover leads no heavy one here.
        let other = json!({"leader": "light", "follower": "heavy", "min": 10000, "at": "gate", "basis": "invented"});
        let t = build(&sep(json!([other]))).unwrap();
        assert!(t.clear(&as_given(&t), [0.0, 800.0]).is_empty());
    }

    #[test]
    fn exact_holds_a_delay_to_its_seconds_and_every_speed_to_its_band() {
        let t = build(&crossing("heavy", json!([]))).unwrap();
        assert!(t.exact(&as_given(&t), 0.5).is_empty());
        // East held 60 s with 60 s asked at `out` passes; with 61 s asked it is a second off.
        let mut held = as_given(&t);
        held.movers[0].iter_mut().for_each(|s| s.time += 60.0);
        held.delays[0] = (60.0, 1);
        assert!(t.exact(&held, 0.5).is_empty());
        held.delays[0] = (61.0, 1);
        assert_eq!(
            t.exact(&held, 0.5),
            [json!({"mover": "east", "fix": "out", "time": -1.0})]
        );
        assert!(t.exact(&held, 1.0).is_empty());
        // A speed under the band at the fix it is given from; an off-route point takes the fix before it.
        let mut slow = as_given(&t);
        slow.movers[0][0].speed = 149.0;
        assert_eq!(
            t.exact(&slow, 0.5),
            [json!({"mover": "east", "fix": "in", "speed": 149.0})]
        );
        let mut bent = as_given(&t);
        let end = bent.movers[0][1].clone();
        bent.movers[0].insert(
            1,
            Slot {
                fix: -1,
                speed: 251.0,
                ..end
            },
        );
        assert_eq!(
            t.exact(&bent, 0.5),
            [json!({"mover": "east", "fix": "in", "speed": 251.0})]
        );
        // North gives no band, so no speed of its own is outside one.
        let mut fast = as_given(&t);
        fast.movers[1][0].speed = 900.0;
        assert!(t.exact(&fast, 0.5).is_empty());
    }

    #[test]
    fn the_judge_reads_the_movers_from_the_items_arrays() {
        let t = build(&crossing("heavy", json!([]))).unwrap();
        let given = as_given(&t);
        let array = |name: &str| -> Option<Vec<f64>> {
            let slots = |f: &dyn Fn(&Slot) -> Vec<f64>| {
                given
                    .movers
                    .iter()
                    .flat_map(|m| {
                        (0..SLOTS)
                            .flat_map(|q| m.get(q).map_or(vec![0.0; f(&m[0]).len()], f))
                            .collect::<Vec<_>>()
                    })
                    .collect()
            };
            Some(match name {
                "fix_count" => vec![2.0, 2.0],
                "fix_ref" => slots(&|s| vec![f64::from(s.fix)]),
                "fix_pos" => slots(&|s| s.at.to_vec()),
                "fix_speed" => slots(&|s| vec![s.speed]),
                "fix_time" => slots(&|s| vec![s.time]),
                "delay_s" => vec![0.0, 0.0],
                "delay_fix" => vec![-1.0, -1.0],
                _ => return None,
            })
        };
        let read = flown(&t, &array).unwrap();
        assert_eq!(
            read.movers[1]
                .iter()
                .map(|s| (s.fix, s.time))
                .collect::<Vec<_>>(),
            given.movers[1]
                .iter()
                .map(|s| (s.fix, s.time))
                .collect::<Vec<_>>()
        );
        assert_eq!(t.clear(&read, [0.0, 600.0]).len(), 1);
        // An item that writes no slot times can't be judged.
        assert!(flown(&t, &|name| if name == "fix_time" {
            None
        } else {
            array(name)
        })
        .is_none());
    }
}
