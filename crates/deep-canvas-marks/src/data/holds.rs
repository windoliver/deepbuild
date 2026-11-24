//! #3236 (Mark set, scale and encode; Rules every primitive follows: Accessible): what a mark set
//! or a series holds, as its accessibility node says it, computed from the rows it draws and its
//! evaluated scales the way legend rows are, never typed; and the stops a reading focus walks over
//! its drawn rows. A row that doesn't draw is in neither.

use super::*;

/// Past this many drawn rows a set is walked by buckets, so no key press walks a million rows.
pub const WALK_ROWS: usize = 1_000;
/// The equal ranges of its first encoded column a mark set past [`WALK_ROWS`] is walked by.
const RANGES: usize = 100;
/// Flicks in a second: a series' `t` is in flicks and is said in seconds.
const FLICKS: f64 = 705_600_000.0;

/// One encoded column as the node says it: its name and unit, the least and greatest value its
/// drawn rows hold, and how many rows draw nothing for want of a value in it.
#[derive(Clone, Debug, PartialEq)]
pub struct Held {
    pub name: String,
    pub unit: Option<String>,
    pub extent: Option<[f64; 2]>,
    pub missing: usize,
    form: Form,
}

/// The scale's own number form: a time scale's calendar labels, else the value's shortest form
/// at the width its column stores.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Form {
    Shortest,
    Single,
    Time(f64),
    /// At most this many decimals, without trailing zeros.
    Decimals(usize),
}

impl Held {
    /// `v` in the scale's own number form.
    fn number(&self, v: f64) -> String {
        match self.form {
            Form::Time(step) => crate::ticks::time_label(v as i64, step),
            Form::Single => format!("{}", v as f32),
            Form::Shortest => format!("{v}"),
            Form::Decimals(digits) => {
                let n = format!("{v:.digits$}");
                match n.contains('.') {
                    true => n.trim_end_matches('0').trim_end_matches('.').to_string(),
                    false => n,
                }
            }
        }
    }

    /// `v` in the scale's own number form, with the column's unit.
    pub fn says(&self, v: f64) -> String {
        match &self.unit {
            Some(u) => format!("{} {u}", self.number(v)),
            None => self.number(v),
        }
    }

    /// The column as the node says it: `y metres 2 to 40, 1 missing`.
    fn text(&self) -> String {
        let mut out = self.name.clone();
        if let Some(u) = &self.unit {
            out.push_str(&format!(" {u}"));
        }
        match self.extent {
            Some([a, b]) => out.push_str(&format!(" {} to {}", self.number(a), self.number(b))),
            None => out.push_str(" none drawn"),
        }
        if self.missing > 0 {
            out.push_str(&format!(", {} missing", self.missing));
        }
        out
    }
}

/// What a set holds: how many rows draw, each encoded column, and, where a column of categories
/// is encoded, that column with each category's count of drawn rows, in the scale's order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Holds {
    pub drawn: usize,
    pub columns: Vec<Held>,
    pub categories: Option<(String, Vec<(String, usize)>)>,
}

impl Holds {
    /// The node's value, the words an assistive client reads: `11 rows drawn, x seconds 0 to 11,
    /// y metres 2 to 40, 1 missing`, and a column of categories as `series North 4, South 4`.
    pub fn text(&self) -> String {
        let mut parts = vec![format!("{} rows drawn", self.drawn)];
        parts.extend(self.columns.iter().map(Held::text));
        if let Some((column, counts)) = &self.categories {
            let each: Vec<String> = counts
                .iter()
                .map(|(n, rows)| format!("{n} {rows}"))
                .collect();
            parts.push(format!("{column} {}", each.join(", ")));
        }
        parts.join(", ")
    }

    /// What a stop says: a row's category and each column's value with its unit; a bucket's count
    /// and the least and greatest value of each column but the first, which it is walked by.
    pub fn says(&self, stop: &Stop) -> String {
        let mut parts = Vec::new();
        match stop {
            Stop::Row {
                category, values, ..
            } => {
                parts.extend(category.clone());
                for (c, v) in self.columns.iter().zip(values) {
                    if let Some(v) = v {
                        parts.push(format!("{} {}", c.name, c.says(*v)));
                    }
                }
            }
            Stop::Bucket { count, extents, .. } => {
                parts.push(format!("{count} rows"));
                // The column it is walked by is the bucket's place, not what it holds.
                for (c, e) in self.columns.iter().zip(extents).skip(1) {
                    if let Some([a, b]) = e {
                        parts.push(format!("{} {} to {}", c.name, c.says(*a), c.says(*b)));
                    }
                }
            }
        }
        parts.join(", ")
    }
}

/// One stop of a reading focus's walk: a drawn row by its key, with its category and each held
/// column's value; or, past [`WALK_ROWS`], a bucket of drawn rows with its count and each held
/// column's least and greatest value.
#[derive(Clone, Debug, PartialEq)]
pub enum Stop {
    Row {
        key: String,
        /// The centre of what the row draws, in the set's own u, as #539 orders rows by.
        centre: [f64; 2],
        category: Option<String>,
        values: Vec<Option<f64>>,
    },
    Bucket {
        /// The keys of its first and last rows, in row order.
        keys: [String; 2],
        count: usize,
        extents: Vec<Option<[f64; 2]>>,
    },
}

impl Stop {
    /// The stop's ID in its set `set`: a row's `<set>#<key>`, a bucket's `<set>#<first>..<last>`.
    pub fn id(&self, set: &str) -> String {
        match self {
            Stop::Row { key, .. } => format!("{set}#{key}"),
            Stop::Bucket { keys: [a, b], .. } => format!("{set}#{a}..{b}"),
        }
    }
}

/// #3236's wrong programs, chosen only by a proof scenario's `planted`: a walk in row order and a
/// walk that stops on every row; and a tree whose value is the one its first check computed.
pub const WALK_IN_ROW_ORDER: &str = "reading_walk_row_order";
pub const WALK_ON_EVERY_ROW: &str = "reading_walk_every_row";
pub const TREE_KEEPS_VALUE: &str = "tree_keeps_old_value";
/// And a walk whose every landing appends a pick entry for its row (deep-show's track).
pub const WALK_WRITES_ENTRY: &str = "reading_walk_writes_entry";
pub const PLANTED: [&str; 4] = [
    WALK_IN_ROW_ORDER,
    WALK_ON_EVERY_ROW,
    TREE_KEEPS_VALUE,
    WALK_WRITES_ENTRY,
];

/// How a reading focus walks a set. The planted ones are wrong programs a proof surface reaches
/// only through its `planted` field.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Walk {
    /// Each category's rows whole in the scale's order, in reading order; buckets past
    /// [`WALK_ROWS`].
    #[default]
    Reading,
    /// Every drawn row in row order, whatever its category.
    RowOrder,
    /// Every drawn row, never a bucket.
    EveryRow,
}

/// What item `id` holds and the walk over what it draws, `bound` its cells' bound readings: a mark
/// set's or a series'; `None` for any other kind.
pub fn holds(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    bound: &BoundRows,
    walk: Walk,
) -> Option<Result<(Holds, Vec<Stop>), Refused>> {
    match item.get("kind").and_then(Value::as_str) {
        Some("marks@1") => Some(mark_set_holds(id, item, items, bound, walk)),
        Some("series@1") => Some(series_holds(id, item, walk)),
        _ => None,
    }
}

/// The least and greatest of `values`, `None` for none.
fn extent(values: impl Iterator<Item = f64>) -> Option<[f64; 2]> {
    values.fold(None, |e, v| match e {
        None => Some([v, v]),
        Some([a, b]) => Some([a.min(v), b.max(v)]),
    })
}

/// The properties a node names the columns of first, in this order; any other after, by name.
const FIRST: [&str; 4] = ["x", "x2", "y", "y2"];

fn mark_set_holds(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    bound: &BoundRows,
    how: Walk,
) -> Result<(Holds, Vec<Stop>), Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    let rows = rows(id, item, items, bound)?;
    let props = encoded(p, &rows, items, &path)?;
    let drawn: Vec<usize> = (0..rows.keys.len())
        .filter(|i| !rows.hidden.contains(i) && rows.opacity_of(*i) > 0.0)
        .collect();
    let mut named: Vec<(&String, &Encoded)> = props.iter().collect();
    named.sort_by_key(|(prop, _)| {
        (
            FIRST.iter().position(|f| f == prop).unwrap_or(FIRST.len()),
            (*prop).clone(),
        )
    });
    // Each encoded column of numbers once, and the first column of categories.
    let mut columns: Vec<(Held, &Column)> = Vec::new();
    let mut categories: Option<(&String, &Scale, &Column)> = None;
    for (_, e) in named {
        let Encoded::Column { column, scale } = e else {
            continue;
        };
        let Some(c) = rows.columns.get(column) else {
            continue;
        };
        if let Some(s) = scale.as_ref().filter(|s| s.kind == ScaleKind::Ordinal) {
            categories = categories.or(Some((column, s, c)));
            continue;
        }
        if !matches!(c, Column::Numbers(_)) || columns.iter().any(|(h, _)| &h.name == column) {
            continue;
        }
        let raw = object_or_empty(p.get("columns")).get(column);
        let form = match (
            scale.as_ref().map(|s| s.kind),
            raw.and_then(|r| r.get("dtype")),
        ) {
            (Some(ScaleKind::Time), _) => Form::Time(scale.as_ref().map_or(1e3, |s| s.step)),
            (_, Some(d)) if d == "f32" => Form::Single,
            _ => Form::Shortest,
        };
        // The rows missing a value in it: a NaN, a row its column view hid, or a cell whose
        // bound reading the record doesn't hold.
        let unread = bound
            .iter()
            .filter(|((_, c), reading)| c == column && reading.is_none())
            .filter_map(|((key, _), _)| rows.keys.iter().position(|k| k == key));
        let mut missing: Vec<usize> = raw
            .and_then(|r| r.get("hide"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_u64)
            .map(|r| r as usize)
            .chain((0..rows.keys.len()).filter(|i| c.number(*i).is_some_and(f64::is_nan)))
            .chain(unread)
            .collect();
        missing.sort_unstable();
        missing.dedup();
        let missing = missing.len();
        columns.push((
            Held {
                name: column.clone(),
                unit: raw
                    .and_then(|r| r.get("unit"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                extent: extent(drawn.iter().filter_map(|i| c.number(*i))),
                missing,
                form,
            },
            c,
        ));
    }
    let category = |i: usize| categories.and_then(|(_, _, c)| c.text(i));
    let counted = categories.map(|(column, scale, _)| {
        let mut of: std::collections::BTreeMap<String, usize> = Default::default();
        for name in drawn.iter().filter_map(|i| category(*i)) {
            *of.entry(name).or_default() += 1;
        }
        let counts = scale
            .categories
            .iter()
            .filter_map(|name| Some((name.clone(), *of.get(name)?)))
            .collect();
        (column.clone(), counts)
    });
    let walk = if drawn.len() > WALK_ROWS && how != Walk::EveryRow {
        ranges(&drawn, &rows.keys, &columns)
    } else {
        // Reading order as #539 gives it, by each row's centre as drawn, its category's rows whole
        // in the scale's order first.
        let number = |prop: &str, i: usize| prop_number(&props, &rows, prop, i);
        let bar = matches!(p.get("mark").and_then(Value::as_str), Some("bar" | "area"));
        let centre = |i: usize| -> [f64; 2] {
            let (x, y) = (number("x", i).unwrap_or(0.0), number("y", i).unwrap_or(0.0));
            let base = if bar { base_of(&props) } else { y };
            let (x2, y2) = (
                number("x2", i).unwrap_or(x),
                number("y2", i).unwrap_or(base),
            );
            [(x + x2) / 2.0, (y + y2) / 2.0]
        };
        // A row whose category the scale doesn't name walks after every named one.
        let rank = |i: usize| {
            categories.map_or(0, |(_, s, _)| {
                let at = category(i).and_then(|c| s.categories.iter().position(|n| *n == c));
                at.unwrap_or(s.categories.len())
            })
        };
        let mut order: Vec<(usize, usize, [f64; 2])> =
            drawn.iter().map(|&i| (rank(i), i, centre(i))).collect();
        order.sort_by(|a, b| {
            if how == Walk::RowOrder {
                return a.1.cmp(&b.1);
            }
            a.0.cmp(&b.0)
                .then(a.2[1].total_cmp(&b.2[1]))
                .then(a.2[0].total_cmp(&b.2[0]))
                .then(rows.keys[a.1].cmp(&rows.keys[b.1]))
        });
        order
            .into_iter()
            .map(|(_, i, centre)| Stop::Row {
                key: rows.keys[i].clone(),
                centre,
                category: category(i),
                values: columns.iter().map(|(_, c)| c.number(i)).collect(),
            })
            .collect()
    };
    let holds = Holds {
        drawn: drawn.len(),
        columns: columns.into_iter().map(|(h, _)| h).collect(),
        categories: counted,
    };
    Ok((holds, walk))
}

/// A large set's walk: equal ranges of its first encoded column, each a bucket of the drawn rows
/// in it, in ascending order; empty ranges are no stop.
fn ranges(drawn: &[usize], keys: &[String], columns: &[(Held, &Column)]) -> Vec<Stop> {
    let Some((
        Held {
            extent: Some([lo, hi]),
            ..
        },
        first,
    )) = columns.first()
    else {
        return Vec::new();
    };
    let width = (hi - lo) / RANGES as f64;
    let mut buckets: Vec<Vec<usize>> = vec![Vec::new(); RANGES];
    for &i in drawn {
        let Some(v) = first.number(i) else { continue };
        let k = if width > 0.0 {
            (((v - lo) / width) as usize).min(RANGES - 1)
        } else {
            0
        };
        buckets[k].push(i);
    }
    buckets
        .into_iter()
        .filter(|b| !b.is_empty())
        .map(|b| Stop::Bucket {
            keys: [keys[b[0]].clone(), keys[b[b.len() - 1]].clone()],
            count: b.len(),
            extents: columns
                .iter()
                .map(|(_, c)| extent(b.iter().filter_map(|i| c.number(*i))))
                .collect(),
        })
        .collect()
}

/// A series' rows in its window: `t` in seconds and `v`; past [`WALK_ROWS`] walked by its pixel
/// columns as its decimation keeps them, each with its count and extents.
fn series_holds(id: &str, item: &Value, how: Walk) -> Result<(Holds, Vec<Stop>), Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    let n = series_len(p, &path)?;
    let t = series_numbers(p, "t", n, &path)?.ok_or(Refused {
        code: "bad_column",
        path: format!("{path}/t"),
    })?;
    let Some(v) = series_numbers(p, "v", n, &path)? else {
        return refuse("bad_column", format!("{path}/v"));
    };
    let (t0, t1) = series_window(p, &t, &path)?;
    let [_, _, bw, _] = series_box(p, &path)?;
    let cols = bw.floor().max(1.0) as usize;
    let drawn: Vec<usize> = (0..n).filter(|i| t[*i] >= t0 && t[*i] <= t1).collect();
    let unit = |name: &str| {
        p.get(name)
            .and_then(|c| c.get("unit"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let seconds = |i: usize| t[i] / FLICKS;
    // Two decimals past what a tick over the window would show, so a time reads as one.
    let span = ((t1 - t0) / FLICKS).max(1.0 / FLICKS);
    let digits = (-ops::log10(linear_step(span)).floor()).max(0.0) as usize + 2;
    let held = |name: &str, unit: Option<String>, e, form| Held {
        name: name.into(),
        unit,
        extent: e,
        missing: 0,
        form,
    };
    let holds = Holds {
        drawn: drawn.len(),
        columns: vec![
            held(
                "t",
                Some("s".into()),
                extent(drawn.iter().map(|i| seconds(*i))),
                Form::Decimals(digits),
            ),
            held(
                "v",
                unit("v"),
                extent(drawn.iter().map(|i| v[*i])),
                Form::Shortest,
            ),
        ],
        categories: None,
    };
    let walk = if drawn.len() > WALK_ROWS && how != Walk::EveryRow {
        let mut buckets: Vec<Vec<usize>> = vec![Vec::new(); cols];
        for &i in &drawn {
            buckets[pixel_column(t[i], t0, t1, cols)].push(i);
        }
        buckets
            .into_iter()
            .filter(|b| !b.is_empty())
            .map(|b| Stop::Bucket {
                keys: [b[0].to_string(), b[b.len() - 1].to_string()],
                count: b.len(),
                extents: vec![
                    extent(b.iter().map(|i| seconds(*i))),
                    extent(b.iter().map(|i| v[*i])),
                ],
            })
            .collect()
    } else {
        drawn
            .iter()
            .map(|&i| Stop::Row {
                key: i.to_string(),
                centre: [seconds(i), v[i]],
                category: None,
                values: vec![Some(seconds(i)), Some(v[i])],
            })
            .collect()
    };
    Ok((holds, walk))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scatter of `n` rows, x = i and y = i mod 7, with every 10th row's y missing (NaN).
    fn scatter(n: usize) -> (Value, Map<String, Value>) {
        let col = |v: Vec<f64>, unit: &str| {
            let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
            json!({"dtype": "f64", "len": v.len(), "data": deep_canvas::base64::encode(&bytes), "unit": unit})
        };
        let x = (0..n).map(|i| i as f64).collect();
        let y = (0..n)
            .map(|i| {
                if i % 10 == 0 {
                    f64::NAN
                } else {
                    (i % 7) as f64
                }
            })
            .collect();
        let set = json!({"kind": "marks@1", "params": {"mark": "point", "n": n,
            "columns": {"x": col(x, "s"), "y": col(y, "m")},
            "encode": {"x": {"column": "x"}, "y": {"column": "y"}}}});
        (set, Map::new())
    }

    fn f64s(v: &[f64]) -> Value {
        let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
        json!({"dtype": "f64", "len": v.len(), "data": deep_canvas::base64::encode(&bytes)})
    }

    /// The centers of the circles a point set draws, by key.
    fn drawn(id: &str, items: &Map<String, Value>, bound: &BoundRows) -> Vec<(String, [f64; 2])> {
        let palette: crate::scene::Palette = [("ink".to_string(), [0, 0, 0])].into();
        mark_set(id, &items[id], items, &palette, [0.0, 0.0], bound)
            .unwrap()
            .marks
            .into_iter()
            .map(|m| match m {
                Mark::Circle { item, center, .. } => (item, center),
                m => panic!("{m:?}"),
            })
            .collect()
    }

    #[test]
    fn a_nan_is_missing_only_in_a_column_the_set_encodes() {
        let points = |extra: Value| {
            let set = json!({"kind": "marks@1", "params": {"mark": "point", "n": 3,
                "columns": {"x": f64s(&[1.0, 2.0, 3.0]), "y": f64s(&[4.0, f64::NAN, 6.0]), "extra": extra},
                "encode": {"x": {"column": "x"}, "y": {"column": "y"}}}});
            Map::from_iter([("s".to_string(), set)])
        };
        // The row whose y is missing doesn't draw; the others do.
        let items = points(f64s(&[1.0, 1.0, 1.0]));
        let keys: Vec<String> = drawn("s", &items, &BoundRows::new())
            .into_iter()
            .map(|(k, _)| k)
            .collect();
        assert_eq!(keys, ["s#0", "s#2"]);
        // Nothing encodes `extra`, so a NaN there is out of range, as it always was, and no row
        // is dropped for a value nobody reads.
        let items = points(f64s(&[f64::NAN, 1.0, 1.0]));
        let refused = rows("s", &items["s"], &items, &BoundRows::new()).unwrap_err();
        assert_eq!(
            (refused.code, refused.path.as_str()),
            ("out_of_range", "items/s/params/columns/extra/data")
        );
    }

    #[test]
    fn a_missing_value_in_a_rows_of_set_hides_its_row_and_a_bound_cell_shows_its_reading() {
        let source = json!({"kind": "marks@1", "params": {"mark": "point", "n": 3, "key": "k",
            "columns": {"k": {"dtype": "str", "len": 3, "data": ["a", "b", "c"]},
                "x": f64s(&[1.0, 2.0, 3.0]), "y": f64s(&[4.0, f64::NAN, 6.0])},
            "encode": {"x": {"column": "x"}, "y": {"column": "y"}}}});
        // A cell written as a missing value and bound to a reading draws the reading.
        let mut items = Map::from_iter([("s".to_string(), source)]);
        let bound: BoundRows = [(("b".into(), "y".into()), Some(45.0))].into();
        let keys: Vec<String> = drawn("s", &items, &bound)
            .into_iter()
            .map(|(k, _)| k)
            .collect();
        assert_eq!(keys, ["s#a", "s#b", "s#c"]);
        // A set drawing another's rows with a missing value of its own hides that row.
        items["s"]["params"]["columns"]["y"] = f64s(&[4.0, 5.0, 6.0]);
        let lab = json!({"kind": "marks@1", "params": {"mark": "point", "rows_of": "s",
            "columns": {"z": f64s(&[1.0, f64::NAN, 3.0])},
            "encode": {"x": {"column": "x"}, "y": {"column": "z"}}}});
        items.insert("lab".into(), lab);
        let drew = drawn("lab", &items, &BoundRows::new());
        assert!(
            drew.iter().all(|(_, c)| c.iter().all(|v| v.is_finite())),
            "{drew:?}"
        );
        let keys: Vec<&str> = drew.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["lab#a", "lab#c"]);
    }

    #[test]
    fn a_series_says_its_times_in_seconds_at_a_listeners_precision() {
        let t: Vec<u8> = (0..4_i64)
            .flat_map(|i| (i * 11_760_000).to_le_bytes())
            .collect();
        let series = json!({"kind": "series@1", "params": {"box": [0, 0, 100, 50],
            "t": {"dtype": "i64", "len": 4, "data": deep_canvas::base64::encode(&t)},
            "v": f64s(&[1.5, 2.0, 3.25, 4.0])}});
        let items = Map::new();
        let (held, stops) = holds("s", &series, &items, &BoundRows::new(), Walk::Reading)
            .unwrap()
            .unwrap();
        // 60 Hz samples over 0.05 s: the third is at 0.0333… s, never 0.03333333333333333.
        assert_eq!(held.text(), "4 rows drawn, t s 0 to 0.05, v 1.5 to 4");
        assert_eq!(held.says(&stops[2]), "t 0.0333 s, v 3.25");
    }

    #[test]
    fn a_large_set_is_walked_by_equal_ranges_of_its_first_column_and_a_nan_is_missing() {
        let (set, items) = scatter(5_000);
        let (held, stops) = holds("s", &set, &items, &BoundRows::new(), Walk::Reading)
            .unwrap()
            .unwrap();
        assert_eq!(held.drawn, 4_500);
        assert_eq!(held.columns[1].missing, 500);
        assert_eq!(
            held.text(),
            "4500 rows drawn, x s 1 to 4999, y m 0 to 6, 500 missing"
        );
        assert!(stops.len() <= RANGES, "{} stops", stops.len());
        let counted: usize = stops
            .iter()
            .map(|s| match s {
                Stop::Bucket { count, .. } => *count,
                Stop::Row { .. } => 1,
            })
            .sum();
        assert_eq!(counted, 4_500);
        assert_eq!(held.says(&stops[0]), "45 rows, y 0 m to 6 m");
        // The planted walk stops on every drawn row.
        let (_, every) = holds("s", &set, &items, &BoundRows::new(), Walk::EveryRow)
            .unwrap()
            .unwrap();
        assert_eq!(every.len(), 4_500);
    }
}
