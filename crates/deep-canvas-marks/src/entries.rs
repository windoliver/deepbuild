//! Issue #297: entry texts (Text `text@1`: entries). A text, or a mark set's text column, shows
//! the latest entry a player committed to a text control at or before t, read from the input
//! track the played form carries under `track`, while logic only picks the player's number
//! through the core's column view; the string never passes through logic. The bytes show in
//! their NFC form and stay on the track as typed. Two seats whose latest entries share a UTS #39
//! skeleton each show their player number after it, ` (n)`. A text control an entry text shows
//! takes only graphemes the text's faces draw with ink, none standing alone with no ink but white
//! space, at least one with ink, and no base with more than 4 combining marks.
//!
//! Fields: `text: {entry: <control>, player: u8 | <array path>, widest}`; a mark set's text
//! column `{entry: <control>, player: <column>, widest}`.

use deep_canvas::columns::{element_at, element_path, element_steps};
use deep_canvas::document::Issue;
use serde_json::{json, Map, Value};
use unicode_normalization::UnicodeNormalization;

/// The issue a player number with no seat raises, and the codes the check refuses with.
pub const MISSING: &str = "entry.missing";
pub const NO_WIDEST: &str = "entry.widest_missing";
pub const FIT: &str = "entry.fit";
pub const BAD_PLAYER: &str = "entry.player";
pub const BAD_CONTROL: &str = "entry.control";

/// The most combining marks one base takes.
pub const MOST_MARKS: usize = 4;

/// Where an entry text takes its player number.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Player<'a> {
    /// A seat written as a number.
    Seat(i64),
    /// A logic array's element (a text) or a column of the set (a mark set).
    Path(&'a str),
}

/// An entry text's fields.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spec<'a> {
    pub control: &'a str,
    pub player: Player<'a>,
    pub widest: Option<&'a str>,
}

/// The entry text `v` writes (`{entry, player, widest}`), or the field it fails at.
pub fn spec(v: &Value) -> Result<Spec<'_>, &'static str> {
    let control = v["entry"]
        .as_str()
        .filter(|c| !c.is_empty())
        .ok_or("entry")?;
    let player = match &v["player"] {
        Value::Number(n) => Player::Seat(n.as_i64().ok_or("player")?),
        Value::String(p) if !p.is_empty() => Player::Path(p),
        _ => return Err("player"),
    };
    let widest = match v.get("widest") {
        None | Some(Value::Null) => None,
        Some(w) => Some(w.as_str().ok_or("widest")?),
    };
    Ok(Spec {
        control,
        player,
        widest,
    })
}

/// Whether `v` is an entry text's or an entry column's value.
pub fn is_entry(v: &Value) -> bool {
    v.get("entry").is_some()
}

/// A text showing an entry.
pub fn is_entry_text(item: &Value) -> bool {
    item["kind"] == "text@1" && item.pointer("/params/text").is_some_and(is_entry)
}

/// A set's entry columns, by name.
pub fn entry_columns(set: &Value) -> Vec<(&str, &Value)> {
    let columns = set.pointer("/params/columns").and_then(Value::as_object);
    columns
        .into_iter()
        .flatten()
        .filter(|(_, c)| is_entry(c))
        .map(|(n, c)| (n.as_str(), c))
        .collect()
}

/// A mark set holding an entry column.
pub fn has_entry_column(item: &Value) -> bool {
    item["kind"] == "marks@1" && !entry_columns(item).is_empty()
}

/// The document's net item, which seats a match.
fn net(doc: &Map<String, Value>) -> Option<&Value> {
    let items = doc.get("items")?.as_object()?;
    items.values().find(|i| i["kind"] == "net@1")
}

/// The match's seats: its net item's `players`, or 1 for a piece played alone.
pub fn seats(doc: &Map<String, Value>) -> i64 {
    net(doc).map_or(1, |i| {
        i.pointer("/params/players")
            .and_then(Value::as_f64)
            .map_or(2, |p| p as i64)
    })
}

/// The flicks of one step a frame names in `entry.missing`: the net item's match step, else a
/// 60 Hz step, the net item's default.
pub fn step_len(doc: &Map<String, Value>) -> i64 {
    const FLICKS: f64 = deep_canvas::camera::FLICKS_PER_SECOND as f64;
    let rate = net(doc)
        .and_then(|i| i.pointer("/params/step_rate")?.as_f64())
        .unwrap_or(60.0);
    (FLICKS / rate).round().max(1.0) as i64
}

/// One committed entry to a text control: when, by which player, and its bytes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Commit<'a> {
    pub t: i64,
    pub player: i64,
    pub value: &'a str,
}

/// Every entry to `control` the track holds, in its order: an entry with no player is player 1's,
/// as a piece played alone.
pub fn commits<'a>(doc: &'a Map<String, Value>, control: &'a str) -> Vec<Commit<'a>> {
    let track = doc.get("track").and_then(Value::as_array);
    track
        .into_iter()
        .flatten()
        .filter(|e| e["control"] == control)
        .filter_map(|e| {
            Some(Commit {
                t: e["t"].as_i64()?,
                player: e.get("player").map_or(Some(1), Value::as_i64)?,
                value: e["value"].as_str()?,
            })
        })
        .collect()
}

/// The planted wrong programs of entry texts, reachable only through a proof surface.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    /// A text shows the control's latest entry by any player.
    AnyPlayer,
    /// A text with no seat for its player shows player 1's entry.
    FallsBackToFirst,
    /// Look-alike names compared by code points, not by skeleton.
    ComparesCodePoints,
}

/// The planted names of entry texts, each reachable only through a proof surface.
pub const PLANTED: [(&str, Planted); 3] = [
    ("entry_any_player", Planted::AnyPlayer),
    ("entry_falls_back_to_player_1", Planted::FallsBackToFirst),
    ("entry_compare_code_points", Planted::ComparesCodePoints),
];

/// The planted fit check that leaves entry texts out.
pub const FIT_SKIPS_ENTRIES: &str = "fit_skips_entries";

/// The plant a scenario's `planted` name chooses, if it names one of entry texts'.
pub fn planted(name: Option<&str>) -> Planted {
    PLANTED
        .iter()
        .find(|(n, _)| Some(*n) == name)
        .map_or(Planted::None, |(_, p)| *p)
}

/// What entry texts read at a frame.
pub struct Frame<'a> {
    pub doc: &'a Map<String, Value>,
    pub t: i64,
    pub planted: Planted,
}

/// A player number with no seat: the control, the player and the frame's step.
#[derive(Clone, Debug, PartialEq)]
pub struct Missing {
    pub control: String,
    pub player: i64,
    pub step: i64,
}

impl Frame<'_> {
    /// The latest entry `seat` committed to `control` at or before the frame, as typed; `any`
    /// is the planted text that takes the latest by any player.
    fn latest<'c>(&self, commits: &[Commit<'c>], seat: i64, any: bool) -> Option<&'c str> {
        commits
            .iter()
            .rev()
            .find(|c| c.t <= self.t && (any || c.player == seat))
            .map(|c| c.value)
    }

    /// What `control` shows for `seat` at the frame: its latest entry in NFC, or before one the
    /// control's default or nothing; with ` (n)` when another seat's latest entry shares its
    /// skeleton; the seat it misses, for a seat the match lacks.
    pub fn shown(&self, control: &str, seat: i64) -> Result<String, Missing> {
        let seats = seats(self.doc);
        let seat = match (seat, self.planted) {
            (s, _) if (1..=seats).contains(&s) => s,
            (_, Planted::FallsBackToFirst) => 1,
            (s, _) => {
                return Err(Missing {
                    control: control.into(),
                    player: s,
                    step: self.t.div_euclid(step_len(self.doc)),
                })
            }
        };
        let commits = commits(self.doc, control);
        let Some(own) = self.latest(&commits, seat, self.planted == Planted::AnyPlayer) else {
            let default = self
                .doc
                .get("controls")
                .and_then(|c| c.get(control))
                .and_then(|c| c.get("default"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            return Ok(default.nfc().collect());
        };
        let own: String = own.nfc().collect();
        let look = |s: &str| match self.planted {
            Planted::ComparesCodePoints => s.to_string(),
            _ => deep_text::unicode::skeleton(s),
        };
        // Look-alikes are seats' own latest entries, whatever the text shows.
        let mine = self
            .latest(&commits, seat, false)
            .map(|e| look(&e.nfc().collect::<String>()));
        let alike = (1..=seats).filter(|s| *s != seat).any(|other| {
            self.latest(&commits, other, false)
                .is_some_and(|e| Some(look(&e.nfc().collect::<String>())) == mine)
        });
        Ok(if alike {
            format!("{own} ({seat})")
        } else {
            own
        })
    }

    /// The seat an entry text's player reads at the frame: a written seat, or a logic array's
    /// element through the core's view; NaN where the array isn't baked.
    fn seat(&self, player: Player<'_>) -> f64 {
        match player {
            Player::Seat(s) => s as f64,
            Player::Path(p) => element_path(p)
                .and_then(|(form, i)| element_at(self.doc.get("arrays")?.get(form)?, i, self.t))
                .map_or(f64::NAN, |(v, _)| v),
        }
    }

    /// What an entry text shows at the frame, or the seat it misses.
    pub fn text(&self, s: &Spec<'_>) -> Result<String, Missing> {
        let seat = self.seat(s.player);
        self.shown(s.control, as_seat(seat))
    }

    /// Each entry column of `set` as the str column it shows at the frame, and the rows whose
    /// player has no seat.
    #[allow(clippy::type_complexity)]
    pub fn columns(&self, set: &Value) -> Vec<(String, Value, Vec<(usize, Missing)>)> {
        let mut out = Vec::new();
        let n = set.pointer("/params/n").and_then(Value::as_u64);
        for (name, c) in entry_columns(set) {
            let Ok(s) = spec(c) else { continue };
            let Player::Path(column) = s.player else {
                continue;
            };
            let Some(players) = set.pointer("/params/columns").and_then(|c| c.get(column)) else {
                continue;
            };
            let numbers = column_numbers(players, n, self.t);
            let mut data = Vec::with_capacity(numbers.len());
            let mut missed = Vec::new();
            for (row, p) in numbers.iter().enumerate() {
                match self.shown(s.control, as_seat(*p)) {
                    Ok(text) => data.push(text),
                    Err(m) => {
                        data.push(String::new());
                        missed.push((row, m));
                    }
                }
            }
            out.push((
                name.to_string(),
                json!({"dtype": "str", "len": data.len(), "data": data}),
                missed,
            ));
        }
        out
    }
}

/// A player number as a seat: a whole number, else 0, which no match has.
fn as_seat(v: f64) -> i64 {
    if v.is_finite() && v.fract() == 0.0 {
        v as i64
    } else {
        0
    }
}

/// A set's player column as numbers at `t`: a logic array folded through the core's view, else
/// a data column as written.
fn column_numbers(c: &Value, n: Option<u64>, t: i64) -> Vec<f64> {
    if c.get("steps").is_some() {
        return deep_canvas::columns::map(c, t, None, false).map_or_else(Vec::new, |m| {
            m.values
                .iter()
                .zip(&m.hidden)
                .map(|(v, h)| if *h { f64::NAN } else { *v })
                .collect()
        });
    }
    let n = n
        .or_else(|| c.get("len").and_then(Value::as_u64))
        .unwrap_or(0) as usize;
    crate::data::column_of(c, n, "").map_or_else(
        |_| Vec::new(),
        |col| (0..n).map(|i| col.number(i).unwrap_or(f64::NAN)).collect(),
    )
}

/// `entry.missing {control, player, step}` for the reader `id` at `path`; for a mark set, `row`.
pub fn missing_issue(id: &str, path: &str, m: &Missing, row: Option<usize>) -> Issue {
    let mut actual = json!({"control": m.control, "player": m.player, "step": m.step});
    if let Some(r) = row {
        actual["row"] = json!(r);
    }
    Issue {
        severity: "warning",
        ..Issue::error(
            MISSING,
            id,
            path.to_string(),
            actual,
            "the entry text's player has no seat in the match; it shows nothing while it lasts",
        )
    }
}

/// `items` with each entry text's string and each entry column's rows as a frame at `t` shows
/// them; `None` where no item shows an entry.
pub fn apply(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    t: i64,
    planted: Planted,
) -> Option<Map<String, Value>> {
    let shows = |i: &Value| is_entry_text(i) || has_entry_column(i);
    if !items.values().any(shows) {
        return None;
    }
    let frame = Frame { doc, t, planted };
    let mut out = items.clone();
    for (_, item) in out.iter_mut().filter(|(_, i)| shows(i)) {
        if let Some(Ok(s)) = item
            .pointer("/params/text")
            .filter(|v| is_entry(v))
            .map(spec)
        {
            let text = frame.text(&s).unwrap_or_default();
            item["params"]["text"] = json!(text);
        }
        for (name, column, _) in frame.columns(item) {
            item["params"]["columns"][name] = column;
        }
    }
    Some(out)
}

/// Each entry text's `entry.missing` a frame at `t` raises; at check (`t` none) every one its
/// player's values over the baked steps raise, each at the step it begins.
pub fn raised_at(doc: &Map<String, Value>, t: Option<i64>) -> Vec<Issue> {
    let mut out = Vec::new();
    let seats = seats(doc);
    let items = doc.get("items").and_then(Value::as_object);
    for (id, item) in items.into_iter().flatten() {
        if is_entry_text(item) {
            let Ok(s) = spec(&item["params"]["text"]) else {
                continue;
            };
            let path = format!("items/{id}/params/text");
            let steps: Vec<(i64, f64)> = match (s.player, t) {
                (_, Some(t)) => {
                    let f = Frame {
                        doc,
                        t,
                        planted: Planted::None,
                    };
                    let step = t.div_euclid(step_len(doc));
                    vec![(step, f.seat(s.player))]
                }
                (Player::Seat(p), None) => vec![(0, p as f64)],
                (Player::Path(p), None) => element_path(p)
                    .and_then(|(form, i)| Some(element_steps(doc.get("arrays")?.get(form)?, i)))
                    .unwrap_or_default(),
            };
            let mut was = true;
            for (step, v) in steps {
                let seat = as_seat(v);
                let now = (1..=seats).contains(&seat);
                if !now && (was || t.is_some()) {
                    let m = Missing {
                        control: s.control.into(),
                        player: seat,
                        step,
                    };
                    out.push(missing_issue(id, &path, &m, None));
                }
                was = now;
            }
        }
        if has_entry_column(item) {
            let Some(t) = t else { continue };
            let f = Frame {
                doc,
                t,
                planted: Planted::None,
            };
            for (name, _, missed) in f.columns(item) {
                let path = format!("items/{id}/params/columns/{name}");
                for (row, m) in missed {
                    out.push(missing_issue(id, &path, &m, Some(row)));
                }
            }
        }
    }
    out
}

/// Why a text control an entry text shows refuses a value: a grapheme its faces can't draw, a
/// grapheme that isn't white space and draws no ink, no grapheme with ink, or a base with more
/// than [`MOST_MARKS`] combining marks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    Glyph(String),
    Hidden(String),
    Blank,
    MarkStack(String),
}

/// A grapheme's code points, each `U+XXXX`.
pub fn code_points(g: &str) -> String {
    g.chars().map(code_point).collect::<Vec<_>>().join(" ")
}

/// The planted controls and checks of an entry's range.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Lax {
    /// Takes a grapheme its faces can't draw.
    pub glyphs: bool,
    /// Takes a grapheme that draws no ink.
    pub hidden: bool,
    /// Takes any number of combining marks.
    pub marks: bool,
}

impl Refusal {
    pub fn reason(&self) -> &'static str {
        match self {
            Refusal::Glyph(_) => "glyph_missing",
            Refusal::Hidden(_) => "hidden_character",
            Refusal::Blank => "blank",
            Refusal::MarkStack(_) => "mark_stack",
        }
    }

    /// What it names: the grapheme that broke the rule (none for a blank entry) and its code
    /// points as `U+XXXX`.
    pub fn named(&self) -> Value {
        match self {
            Refusal::Glyph(g) | Refusal::Hidden(g) | Refusal::MarkStack(g) => {
                json!({"grapheme": g, "code_points": code_points(g)})
            }
            Refusal::Blank => json!({"grapheme": null}),
        }
    }

    /// The notice a typed refusal shows.
    pub fn notice(&self, control: &str) -> String {
        match self {
            Refusal::Glyph(g) => format!(
                "`{g}` ({}) can't be drawn by the fonts that show {control}",
                code_points(g)
            ),
            Refusal::Hidden(g) => {
                format!("{} draws nothing and can't go in {control}", code_points(g))
            }
            Refusal::Blank => format!("{control} takes a name with something to see"),
            Refusal::MarkStack(g) => format!(
                "`{g}` ({}) stacks more than {MOST_MARKS} combining marks, which {control} refuses",
                code_points(g)
            ),
        }
    }
}

/// The code point `c` as `U+XXXX`.
pub fn code_point(c: char) -> String {
    format!("U+{:04X}", u32::from(c))
}

/// Why a value whose graphemes the faces draw as `drawn` is out of the range, if it is: no
/// grapheme with ink, else the first grapheme [`refusal_of`] refuses.
pub fn refusal(drawn: &[deep_text::Drawn], lax: Lax) -> Option<Refusal> {
    if !drawn.iter().any(|d| d.ink || d.missing) {
        return Some(Refusal::Blank);
    }
    drawn.iter().find_map(|d| refusal_of(d, lax))
}

/// Why one grapheme is out of the range: more than [`MOST_MARKS`] combining marks; a face lacks
/// it (it would draw ink, so it is undrawable, never hidden); or it isn't white space and draws
/// no ink.
pub fn refusal_of(d: &deep_text::Drawn, lax: Lax) -> Option<Refusal> {
    if !lax.marks && deep_text::unicode::marks(&d.grapheme) > MOST_MARKS {
        return Some(Refusal::MarkStack(d.grapheme.clone()));
    }
    if d.missing {
        return (!lax.glyphs).then(|| Refusal::Glyph(d.grapheme.clone()));
    }
    let space = d.grapheme.chars().all(char::is_whitespace);
    if !lax.hidden && !d.ink && !space {
        return Some(Refusal::Hidden(d.grapheme.clone()));
    }
    None
}

/// The specs each entry text that shows `control` sets a value in: a text in its own spec, its
/// box and line limit set aside; a mark set's text in the body face its marks take.
fn reader_specs(
    doc: &Map<String, Value>,
    control: &str,
    ty: &crate::scene::Type,
) -> Vec<crate::scene::TextSpec> {
    let mut out = Vec::new();
    let items = doc.get("items").and_then(Value::as_object);
    for (id, item) in items.into_iter().flatten() {
        let shows = |v: &Value| spec(v).is_ok_and(|s| s.control == control);
        if is_entry_text(item) && shows(&item["params"]["text"]) {
            let mut p = item["params"].as_object().cloned().unwrap_or_default();
            p.insert("text".into(), json!(""));
            p.remove("box");
            p.remove("max_lines");
            out.extend(crate::scene::text_spec_in(id, &p, None, ty).ok());
        }
        if has_entry_column(item) && entry_columns(item).iter().any(|(_, c)| shows(c)) {
            let mut p = Map::new();
            p.insert("text".into(), json!(""));
            p.insert("font".into(), json!("body"));
            out.extend(crate::scene::text_spec_in(id, &p, None, ty).ok());
        }
    }
    out
}

/// Whether an entry text shows `control`.
pub fn shown_control(doc: &Map<String, Value>, control: &str) -> bool {
    let items = doc.get("items").and_then(Value::as_object);
    let shows = |v: &Value| spec(v).is_ok_and(|s| s.control == control);
    items.into_iter().flatten().any(|(_, i)| {
        (is_entry_text(i) && shows(&i["params"]["text"]))
            || (has_entry_column(i) && entry_columns(i).iter().any(|(_, c)| shows(c)))
    })
}

/// Why `value` is out of the range of `control`, which entry texts show: the first refusal any
/// of their faces gives; `None` where it is in range, or no entry text shows the control.
pub fn refused(
    doc: &Map<String, Value>,
    control: &str,
    value: &str,
    ty: &crate::scene::Type,
    shaper: &mut deep_text::Shaper,
    lax: Lax,
) -> Option<Refusal> {
    for mut spec in reader_specs(doc, control, ty) {
        spec.text = value.to_string();
        let Some(s) = spec.shaper_spec() else {
            continue;
        };
        if let Some(r) = refusal(&shaper.drawn(&s, value), lax) {
            return Some(r);
        }
    }
    None
}

/// The widest an entry text's fit check sizes: `widest` with the widest ` (n)` any seat adds,
/// in a match of two seats or more.
fn widest_with_seat(
    shaper: &mut deep_text::Shaper,
    spec: &deep_text::Spec<'_>,
    widest: &str,
    seats: i64,
) -> String {
    // One seat never shares a skeleton with another, so it never gains a number.
    let mut best = (f32::MIN, widest.to_string());
    for n in (1..=seats).filter(|_| seats > 1) {
        let text = format!("{widest} ({n})");
        let width = shaper.fit(spec, Some(&text)).width;
        if width > best.0 {
            best = (width, text);
        }
    }
    best.1
}

/// The fit check over entry texts (Text `text@1`: entries): an entry text with no `widest` is
/// refused, naming it; one whose `widest`, with the widest ` (n)` a seat may add, doesn't fit its
/// box and line limit fails, naming it. It runs for every locale the document carries alike, since
/// an entry is the same bytes in each. A mark set's entry column has no box, so it is sized by
/// its `widest` alone. `skip` is the planted check that leaves entry texts out.
pub fn fit_issues(
    doc: &Map<String, Value>,
    ty: &crate::scene::Type,
    skip: bool,
    issues: &mut Vec<Issue>,
) {
    if skip {
        return;
    }
    let mut shaper: Option<deep_text::Shaper> = None;
    let seats = seats(doc);
    let items = doc.get("items").and_then(Value::as_object);
    for (id, item) in items.into_iter().flatten() {
        let mut fields: Vec<(String, &Value)> = Vec::new();
        if is_entry_text(item) {
            fields.push((format!("items/{id}/params/text"), &item["params"]["text"]));
        }
        if has_entry_column(item) {
            for (name, c) in entry_columns(item) {
                fields.push((format!("items/{id}/params/columns/{name}"), c));
            }
        }
        for (at, v) in fields {
            let Ok(s) = spec(v) else { continue };
            let Some(widest) = s.widest else {
                let what = "an entry text names no widest, so the fit check can't size the names it may show";
                issues.push(Issue::error(
                    NO_WIDEST,
                    id,
                    format!("{at}/widest"),
                    json!({"item": id}),
                    what,
                ));
                continue;
            };
            if !is_entry_text(item) {
                continue;
            }
            let mut p = item["params"].as_object().cloned().unwrap_or_default();
            p.insert("text".into(), json!(""));
            let Ok(mut spec) = crate::scene::text_spec_in(id, &p, None, ty) else {
                continue;
            };
            spec.text = String::new();
            let Some(sh) = spec.shaper_spec() else {
                continue;
            };
            let shaper = shaper.get_or_insert_with(deep_text::Shaper::new);
            let text = widest_with_seat(shaper, &sh, widest, seats);
            let fit = shaper.fit(&sh, Some(&text));
            if !fit.fits {
                let what = "the entry text's widest, with the seat number a look-alike name adds, doesn't fit its box";
                let actual = json!({"item": id, "widest": text, "width": fit.width,
                                    "box": item.pointer("/params/box/w")});
                issues.push(Issue::error(FIT, id, at, actual, what));
            }
        }
    }
}

/// The integer types a player number narrows to.
const SEAT_TYPES: [&str; 4] = ["i32", "u32", "u16", "u8"];

/// The check of each entry text's fields: its control a text control of the document; its
/// player a seat from 1 to 8, a logic array of integers, or (a mark set) a column of the set
/// whose source narrows to an integer; each refusal naming the item and the field.
pub fn check_issues(doc: &Map<String, Value>) -> Vec<Issue> {
    let mut out = Vec::new();
    let items = doc.get("items").and_then(Value::as_object);
    for (id, item) in items.into_iter().flatten() {
        let mut fields: Vec<(String, &Value, bool)> = Vec::new();
        if is_entry_text(item) {
            fields.push((
                format!("items/{id}/params/text"),
                &item["params"]["text"],
                false,
            ));
        }
        if has_entry_column(item) {
            for (name, c) in entry_columns(item) {
                fields.push((format!("items/{id}/params/columns/{name}"), c, true));
            }
        }
        for (at, v, column) in fields {
            let refuse = |code: &'static str, field: &str, actual: Value, what: &str| {
                Issue::error(code, id, format!("{at}/{field}"), actual, what)
            };
            let s = match spec(v) {
                Ok(s) => s,
                Err(field) => {
                    let what = "an entry text is {entry: <text control>, player: <seat or array>, widest: <string>}";
                    out.push(refuse(BAD_CONTROL, field, json!({"item": id}), what));
                    continue;
                }
            };
            let kind = doc
                .get("controls")
                .and_then(|c| c.get(s.control))
                .and_then(|c| c.get("kind"));
            if kind.and_then(Value::as_str) != Some("text") {
                let what = "an entry text shows a text control's entries, and the document has no text control of that ID";
                out.push(refuse(
                    BAD_CONTROL,
                    "entry",
                    json!({"item": id, "control": s.control}),
                    what,
                ));
            }
            if let Some(why) = player_refused(doc, item, s.player, column) {
                out.push(refuse(
                    BAD_PLAYER,
                    "player",
                    json!({"item": id, "player": v["player"], "source": why}),
                    "an entry text's player is a seat's number: a whole number from 1 to 8, or a source that narrows to an integer",
                ));
            }
        }
    }
    out
}

/// Why `player` can't name a seat, with the source's type: a written number outside 1 to 8; an
/// array no logic item writes or of no integer type; a column the set lacks or whose source
/// doesn't narrow to an integer.
fn player_refused(
    doc: &Map<String, Value>,
    set: &Value,
    player: Player<'_>,
    column: bool,
) -> Option<Value> {
    match (player, column) {
        (Player::Seat(s), false) => (!(1..=8).contains(&s)).then(|| json!(s)),
        (Player::Seat(s), true) => Some(json!(s)),
        (Player::Path(p), false) => {
            let ty = element_path(p)
                .and_then(|(form, _)| doc.get("arrays")?.get(form)?.get("type")?.as_str());
            match ty {
                Some("i32") => None,
                other => Some(json!({"array": p, "type": other})),
            }
        }
        (Player::Path(name), true) => {
            let c = set.pointer("/params/columns").and_then(|c| c.get(name));
            let ty = c.and_then(|c| c.get("as").or_else(|| c.get("dtype")));
            let ty = ty.and_then(Value::as_str);
            let from_ok = c
                .and_then(|c| c.get("type"))
                .and_then(Value::as_str)
                .is_none_or(|t| t == "i32");
            match ty {
                Some(t) if SEAT_TYPES.contains(&t) && from_ok => None,
                other => Some(json!({"column": name, "type": other})),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A piece with one entry text showing `name` for seat 1, and `seats` seats.
    fn piece(seats: i64, track: Value) -> Map<String, Value> {
        let mut items = json!({"plate": {"kind": "text@1", "params": {
            "text": {"entry": "name", "player": 1, "widest": "WWWWWW"}, "size": 16}}});
        if seats > 1 {
            items["match"] = json!({"kind": "net@1", "params": {"players": seats}});
        }
        json!({"controls": {"name": {"kind": "text", "default": "Player"}}, "items": items,
               "track": track})
        .as_object()
        .cloned()
        .unwrap_or_default()
    }

    /// The clean look's type: its body face with the CJK, Arabic and emoji fallbacks.
    fn clean() -> crate::scene::Type {
        let def = crate::look::shipped("clean").expect("the clean look ships");
        let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
        crate::look::resolve(&def, &bundled)
            .expect("the clean look resolves")
            .light_type
    }

    #[test]
    fn every_direction_control_and_a_lone_zero_width_is_hidden_and_a_join_inside_ink_is_taken() {
        let (doc, ty) = (piece(1, json!([])), clean());
        let mut shaper = deep_text::Shaper::new();
        let mut why = |v: &str| refused(&doc, "name", v, &ty, &mut shaper, Lax::default());
        for cp in (0x202A..=0x202E)
            .chain(0x2066..=0x2069)
            .filter_map(char::from_u32)
        {
            let r = why(&format!("Ana{cp}xyz"));
            assert_eq!(
                r,
                Some(Refusal::Hidden(cp.to_string())),
                "{}",
                code_point(cp)
            );
        }
        // A zero-width character standing alone: at the start, where it joins no grapheme.
        for cp in (0x200B..=0x200D).filter_map(char::from_u32) {
            let r = why(&format!("{cp}xyz"));
            assert_eq!(
                r,
                Some(Refusal::Hidden(cp.to_string())),
                "{}",
                code_point(cp)
            );
        }
        // A zero-width non-joiner inside a Persian word, and a joiner inside an emoji sequence.
        assert_eq!(
            why("\u{645}\u{6cc}\u{200c}\u{62e}\u{648}\u{627}\u{647}\u{645}"),
            None
        );
        assert_eq!(why("\u{1f468}\u{200d}\u{1f466}"), None);
        // Five enclosing marks (Me) on one base are a stack; four are not.
        let stack = |n: usize| format!("a{}", "\u{20dd}".repeat(n));
        assert_eq!(why(&stack(5)), Some(Refusal::MarkStack(stack(5))));
        assert_eq!(why(&stack(4)), None);
        assert_eq!(why("\u{200b}\u{200b}"), Some(Refusal::Blank));
    }

    #[test]
    fn of_three_seats_only_the_two_whose_names_look_alike_are_numbered() {
        let entry = |player: i64, value: &str| json!({"t": 0, "control": "name", "value": value, "player": player});
        let doc = piece(
            3,
            json!([
                entry(1, "Coco"),
                entry(2, "\u{421}\u{43e}\u{441}\u{43e}"),
                entry(3, "Cocoa")
            ]),
        );
        let f = Frame {
            doc: &doc,
            t: 0,
            planted: Planted::None,
        };
        let shown: Vec<String> = (1..=3)
            .map(|s| f.shown("name", s).unwrap_or_default())
            .collect();
        assert_eq!(
            shown,
            ["Coco (1)", "\u{421}\u{43e}\u{441}\u{43e} (2)", "Cocoa"]
        );
        assert_eq!(
            f.shown("name", 4).map_err(|m| (m.player, m.step)),
            Err((4, 0))
        );
    }
}
