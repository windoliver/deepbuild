//! Data that changes with time (canvas primitives: Scale and encode, the transforms): a mark set's
//! `transforms` play periods of its rows, rank them, reveal them up to a channel and dim the rows
//! a beat doesn't name. Every result is a pure function of the rows and the channels' values at t,
//! so seeking equals playing, and where `at` rests on a period each row is that period's own.
//!
//! Periods compile once into a table of (period, key) → row, with each period ranked; a frame only
//! mixes the two periods around `at`.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use serde_json::{Map, Value};

use crate::data::Column;
use crate::scene::{object_or_empty, refuse, Refused};

const NONE: u32 = u32::MAX;
const TOP: u64 = 10;
const OTHERS: f64 = 0.3;

/// A mark set's rows as a frame sees them, after its transforms.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Rows {
    pub keys: Vec<String>,
    pub columns: BTreeMap<String, Column>,
    /// What the transforms leave of each row's opacity; empty without a transform that sets it.
    pub opacity: Vec<f64>,
    /// The decimals a mixed number column may show (Honest numbers).
    pub precision: BTreeMap<String, u32>,
    /// `#period`: the period at or before `at`, with its `by` value.
    pub period: Option<Anchor>,
    /// `#head`: the revealed end, a row of `keys`.
    pub head: Option<usize>,
    /// The rows a bound value or the column view hides, before any transform.
    pub hidden: BTreeSet<usize>,
}

/// The `#period` anchor: the name of the `by` column and its value.
#[derive(Clone, Debug, PartialEq)]
pub struct Anchor {
    pub column: String,
    pub value: f64,
}

impl Rows {
    /// These rows without the hidden ones, which a transform must never mix from.
    pub fn without_hidden(mut self) -> Rows {
        if self.hidden.is_empty() {
            return self;
        }
        let hidden = std::mem::take(&mut self.hidden);
        let keep = |i: &usize| !hidden.contains(i);
        let kept: Vec<usize> = (0..self.keys.len()).filter(keep).collect();
        self.keys = kept.iter().map(|i| self.keys[*i].clone()).collect();
        for c in self.columns.values_mut() {
            match c {
                Column::Numbers(v) => *v = kept.iter().map(|i| v[*i]).collect(),
                Column::Texts(v) => *v = kept.iter().map(|i| v[*i].clone()).collect(),
                Column::Const(_) => {}
            }
        }
        self
    }

    pub fn opacity_of(&self, i: usize) -> f64 {
        self.opacity.get(i).copied().unwrap_or(1.0)
    }

    /// A number of row `i` as a label shows it: at no more precision than its source carries.
    pub fn shown(&self, column: &str, i: usize) -> Option<String> {
        let c = self.columns.get(column)?;
        match (c.number(i), self.precision.get(column)) {
            (Some(v), Some(p)) => Some(fixed(v, *p)),
            _ => c.text(i),
        }
    }

    /// What an anchor path shows: `period/by`, or `head/<column>`, as a number and its decimals.
    pub fn anchor(&self, name: &str, field: &str) -> Option<(f64, Option<u32>)> {
        match name {
            "period" => {
                let a = self.period.as_ref()?;
                (field == "by").then_some((a.value, self.precision.get(&a.column).copied()))
            }
            "head" => {
                let v = self.columns.get(field)?.number(self.head?)?;
                Some((v, self.precision.get(field).copied()))
            }
            _ => None,
        }
    }
}

/// `v` at `p` decimals, a tie away from zero, so a mixed label doesn't flicker between two
/// rounding rules as it passes through a half.
pub fn fixed(v: f64, p: u32) -> String {
    let scale = deep_canvas::ops::powi(10.0, p as i32);
    format!("{:.*}", p as usize, (v * scale).round() / scale)
}

/// A number at the decimals its source carries, or in its shortest form.
pub fn number(v: f64, precision: Option<u32>) -> String {
    precision.map_or_else(|| format!("{v}"), |p| fixed(v, p))
}

/// The decimals a column's values carry: none for an integer type, else the most any value in
/// its shortest form shows, or a table cell's raw text.
pub fn precision_of(raw: &Value, values: &[f64]) -> u32 {
    let decimals = |s: &str| s.split_once('.').map_or(0, |(_, f)| f.len()) as u32;
    if let Some(Value::Array(cells)) = raw.get("trace").and_then(|t| t.get("cells")) {
        return cells
            .iter()
            .filter_map(|c| c.get("raw").and_then(Value::as_str))
            .map(|s| decimals(s.trim()))
            .max()
            .unwrap_or(0);
    }
    match raw.get("dtype").and_then(Value::as_str) {
        Some("f32") => values
            .iter()
            .map(|v| decimals(&format!("{}", *v as f32)))
            .max()
            .unwrap_or(0),
        Some("f64") => values
            .iter()
            .map(|v| decimals(&format!("{v}")))
            .max()
            .unwrap_or(0),
        _ => 0,
    }
}

/// A channel's value at `name` in a transform, `default` where it names none.
fn channel(
    t: &Map<String, Value>,
    name: &str,
    default: Option<f64>,
    path: &str,
) -> Result<f64, Refused> {
    match t.get(name).map(Value::as_f64) {
        Some(Some(v)) if v.is_finite() => Ok(v),
        Some(_) => refuse("bad_transform", format!("{path}/{name}")),
        None => default.ok_or(Refused {
            code: "bad_transform",
            path: format!("{path}/{name}"),
        }),
    }
}

fn name_of<'a>(t: &'a Map<String, Value>, field: &str, path: &str) -> Result<&'a str, Refused> {
    t.get(field).and_then(Value::as_str).ok_or(Refused {
        code: "bad_transform",
        path: format!("{path}/{field}"),
    })
}

/// A numeric column of `rows`, or a refusal naming it.
fn numbers<'a>(rows: &'a Rows, name: &str, path: &str) -> Result<&'a [f64], Refused> {
    match rows.columns.get(name) {
        Some(Column::Numbers(v)) => Ok(v),
        Some(_) => refuse("bad_transform", path),
        None => refuse("ref_unresolved", path),
    }
}

/// Periods compiled at check: each (period, key)'s row, and each row's standing and its share of
/// opacity. Ranking is O(periods × keys log keys); [`Periods::at`] is O(keys).
#[derive(Clone, Debug)]
pub struct Periods {
    pub by_column: String,
    /// The periods' `by` values, ascending.
    pub by: Vec<f64>,
    keys: Vec<String>,
    /// periods × keys → the row, or [`NONE`].
    table: Vec<u32>,
    /// `into` and each row's standing, with what fades a row past `top`.
    standing: Option<(String, Vec<f64>, Vec<f64>)>,
    hold: bool,
}

/// The period at or before `at` and the fraction to the next.
pub fn span(by: &[f64], at: f64, hold: bool) -> (usize, f64) {
    let after = by.partition_point(|b| *b <= at);
    if after == 0 {
        return (0, 0.0);
    }
    let j = after - 1;
    match by.get(after) {
        Some(next) if !hold => (j, (at - by[j]) / (next - by[j])),
        _ => (j, 0.0),
    }
}

impl Periods {
    /// The periods of `rows`, each row one (period, key); two rows of one key in a period are
    /// refused, since nothing says which to mix.
    pub fn compile(rows: &Rows, spec: &Map<String, Value>, path: &str) -> Result<Periods, Refused> {
        let by_column = name_of(spec, "by", path)?;
        let by_values = numbers(rows, by_column, &format!("{path}/by"))?;
        let mut by = by_values.to_vec();
        by.sort_by(f64::total_cmp);
        by.dedup();
        let mut index = BTreeMap::new();
        let mut keys = Vec::new();
        let key_names = match spec.get("key").and_then(Value::as_str) {
            Some(k) => {
                let Some(c) = rows.columns.get(k) else {
                    return refuse("ref_unresolved", format!("{path}/key"));
                };
                (0..by_values.len())
                    .map(|i| c.text(i).unwrap_or_default())
                    .collect()
            }
            None => rows.keys.clone(),
        };
        let ids: Vec<usize> = key_names
            .iter()
            .map(|k| {
                *index.entry(k.clone()).or_insert_with(|| {
                    keys.push(k.clone());
                    keys.len() - 1
                })
            })
            .collect();
        let mut table = vec![NONE; by.len() * keys.len()];
        for (row, (b, id)) in by_values.iter().zip(&ids).enumerate() {
            let j = by.partition_point(|x| x < b);
            let cell = &mut table[j * keys.len() + id];
            if *cell != NONE {
                return refuse("key_not_unique", format!("{path}/key: {}", keys[*id]));
            }
            *cell = row as u32;
        }
        let hold = match spec.get("mix").and_then(Value::as_str) {
            None | Some("linear") => false,
            Some("hold") => true,
            Some(_) => return refuse("bad_transform", format!("{path}/mix")),
        };
        Ok(Periods {
            by_column: by_column.to_string(),
            by,
            keys,
            table,
            standing: None,
            hold,
        })
    }

    /// Ranks each period at check: rank 1 first, ties by key; rows past `top` take `top` + 1 and
    /// no opacity, so they slide below the last bar as they fade.
    pub fn rank(
        &mut self,
        rows: &Rows,
        spec: &Map<String, Value>,
        path: &str,
    ) -> Result<(), Refused> {
        let values = numbers(rows, name_of(spec, "by", path)?, &format!("{path}/by"))?;
        let desc = spec.get("desc").and_then(Value::as_bool).unwrap_or(true);
        let top = match spec.get("top") {
            None => TOP,
            Some(t) => match t.as_u64().filter(|t| *t <= u64::from(u16::MAX)) {
                Some(t) => t,
                None => return refuse("bad_transform", format!("{path}/top")),
            },
        } as usize;
        let into = spec
            .get("into")
            .and_then(Value::as_str)
            .unwrap_or("standing");
        // Each key's place in key order, so a tie compares two integers.
        let mut order: Vec<usize> = (0..self.keys.len()).collect();
        order.sort_by(|a, b| self.keys[*a].cmp(&self.keys[*b]));
        let (mut standing, mut alpha) = (vec![0.0; values.len()], vec![1.0; values.len()]);
        let mut ranked: Vec<(f64, u32)> = Vec::with_capacity(self.keys.len());
        for cells in self.table.chunks_exact(self.keys.len().max(1)) {
            ranked.clear();
            ranked.extend(order.iter().filter_map(|k| {
                let row = cells[*k];
                (row != NONE).then(|| (values[row as usize], row))
            }));
            // Stable, so a tie stays in key order.
            ranked.sort_by(|a, b| {
                if desc {
                    b.0.total_cmp(&a.0)
                } else {
                    a.0.total_cmp(&b.0)
                }
            });
            for (r, (_, row)) in ranked.iter().enumerate() {
                let (row, past) = (*row as usize, r >= top);
                standing[row] = (r.min(top) + 1) as f64;
                alpha[row] = if past { 0.0 } else { 1.0 };
            }
        }
        self.standing = Some((into.to_string(), standing, alpha));
        Ok(())
    }

    /// `rows` at `at`: each key's row in the period at or before it, mixed with its row in the
    /// next by the fraction between them. A key missing from one of the two takes the other's
    /// values at opacity 0, and a key in neither stays listed at opacity 0.
    pub fn at(&self, rows: &Rows, at: f64) -> Rows {
        let (j, f) = span(&self.by, at, self.hold);
        let width = self.keys.len();
        let next = (j + 1).min(self.by.len().saturating_sub(1));
        let (from, to) = (
            &self.table[j * width..][..width],
            &self.table[next * width..][..width],
        );
        let alpha = self.standing.as_ref().map_or(&[][..], |s| &s.2);
        let share = |row: u32| match row {
            NONE => 0.0,
            row => alpha.get(row as usize).copied().unwrap_or(1.0),
        };
        // The nearest row of a key in neither period, for the place it holds at opacity 0.
        let nearest = |k: usize| {
            let earlier = (0..=j).rev().map(|p| self.table[p * width + k]);
            let later = (j + 1..self.by.len()).map(|p| self.table[p * width + k]);
            earlier.chain(later).find(|r| *r != NONE).unwrap_or(0)
        };
        let pairs: Vec<(usize, usize, f64, f64)> = (0..width)
            .map(|k| {
                let (a, b) = (from[k], to[k]);
                let (x, y) = match (a, b) {
                    (NONE, NONE) => (nearest(k), nearest(k)),
                    (NONE, b) => (b, b),
                    (a, NONE) => (a, a),
                    (a, b) => (a, b),
                };
                (x as usize, y as usize, share(a), share(b))
            })
            .collect();
        let mix = |v: &[f64], x: usize, y: usize| {
            if f == 0.0 {
                v[x]
            } else {
                v[x] + (v[y] - v[x]) * f
            }
        };
        let mut columns: BTreeMap<String, Column> = rows
            .columns
            .iter()
            .map(|(name, c)| {
                let c = match c {
                    Column::Numbers(v) => {
                        Column::Numbers(pairs.iter().map(|(x, y, ..)| mix(v, *x, *y)).collect())
                    }
                    Column::Texts(v) => {
                        Column::Texts(pairs.iter().map(|(x, ..)| v[*x].clone()).collect())
                    }
                    Column::Const(v) => Column::Const(v.clone()),
                };
                (name.clone(), c)
            })
            .collect();
        if let Some((into, standing, _)) = &self.standing {
            columns.insert(
                into.clone(),
                Column::Numbers(
                    pairs
                        .iter()
                        .map(|(x, y, ..)| mix(standing, *x, *y))
                        .collect(),
                ),
            );
        }
        let opacity = pairs.iter().map(|(.., p, q)| p + (q - p) * f).collect();
        Rows {
            keys: self.keys.clone(),
            columns,
            opacity,
            precision: rows.precision.clone(),
            // No rows, no period.
            period: self.by.get(j).map(|by| Anchor {
                column: self.by_column.clone(),
                value: *by,
            }),
            ..Rows::default()
        }
    }

    /// Each period's range of `values`, by [`Periods::by`]; every period holds a row.
    pub fn domains(&self, values: &[f64]) -> Vec<[f64; 2]> {
        self.table
            .chunks_exact(self.keys.len().max(1))
            .map(|cells| {
                let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
                for row in cells.iter().filter(|r| **r != NONE) {
                    let v = values[*row as usize];
                    (lo, hi) = (lo.min(v), hi.max(v));
                }
                [lo, hi]
            })
            .collect()
    }

    /// The period at or before `at` and the fraction to the next, as [`Periods::at`] mixes them.
    pub fn span_at(&self, at: f64) -> (usize, f64) {
        span(&self.by, at, self.hold)
    }
}

/// Shows rows up to `to`, in `by` order: the last row is the point mixed at `to` between the two
/// rows around it, and it is the `#head`. Before the first row nothing shows and there's no head.
fn reveal(rows: &Rows, spec: &Map<String, Value>, path: &str) -> Result<Rows, Refused> {
    let name = name_of(spec, "by", path)?;
    let to = channel(spec, "to", None, path)?;
    let by = numbers(rows, name, &format!("{path}/by"))?;
    let mut order: Vec<usize> = (0..by.len()).collect();
    order.sort_by(|a, b| by[*a].total_cmp(&by[*b]));
    let shown = order.partition_point(|i| by[*i] <= to);
    let kept = &order[..shown];
    let between = match (shown.checked_sub(1).map(|i| order[i]), order.get(shown)) {
        (Some(a), Some(b)) if by[*b] > by[a] && to > by[a] => {
            Some((a, *b, (to - by[a]) / (by[*b] - by[a])))
        }
        _ => None,
    };
    let columns = rows
        .columns
        .iter()
        .map(|(name, c)| {
            let c = match c {
                Column::Numbers(v) => {
                    let mut out: Vec<f64> = kept.iter().map(|i| v[*i]).collect();
                    out.extend(between.map(|(a, b, f)| v[a] + (v[b] - v[a]) * f));
                    Column::Numbers(out)
                }
                Column::Texts(v) => {
                    let mut out: Vec<String> = kept.iter().map(|i| v[*i].clone()).collect();
                    out.extend(between.map(|(a, ..)| v[a].clone()));
                    Column::Texts(out)
                }
                Column::Const(v) => Column::Const(v.clone()),
            };
            (name.clone(), c)
        })
        .collect();
    let mut keys: Vec<String> = kept.iter().map(|i| rows.keys[*i].clone()).collect();
    let opacity = if rows.opacity.is_empty() {
        Vec::new()
    } else {
        let mut out: Vec<f64> = kept.iter().map(|i| rows.opacity_of(*i)).collect();
        out.extend(between.map(|(a, ..)| rows.opacity_of(a)));
        out
    };
    if between.is_some() {
        keys.push("head".into());
    }
    Ok(Rows {
        head: keys.len().checked_sub(1),
        keys,
        columns,
        opacity,
        precision: rows.precision.clone(),
        period: rows.period.clone(),
        hidden: BTreeSet::new(),
    })
}

/// Dims every row `keys` doesn't name to `others`, as `mix` goes from 0 to 1.
fn emphasis(rows: &mut Rows, spec: &Map<String, Value>, path: &str) -> Result<(), Refused> {
    let Some(Value::Array(named)) = spec.get("keys") else {
        return refuse("bad_transform", format!("{path}/keys"));
    };
    let others = channel(spec, "others", Some(OTHERS), path)?;
    let mix = channel(spec, "mix", Some(1.0), path)?;
    if !(0.0..=1.0).contains(&others) || !(0.0..=1.0).contains(&mix) {
        return refuse("out_of_range", path);
    }
    let named: Vec<String> = named
        .iter()
        .map(|k| k.as_str().map_or_else(|| k.to_string(), str::to_string))
        .collect();
    let dim = 1.0 + (others - 1.0) * mix;
    rows.opacity = rows
        .keys
        .iter()
        .enumerate()
        .map(|(i, key)| rows.opacity_of(i) * if named.contains(key) { 1.0 } else { dim })
        .collect();
    Ok(())
}

/// One transform as written: its name, its fields and its path.
type Listed<'a> = (&'a str, &'a Map<String, Value>, String);

/// The transforms of a mark set's `params`, in order.
pub fn listed<'a>(params: &'a Map<String, Value>, path: &str) -> Result<Vec<Listed<'a>>, Refused> {
    let Some(list) = params.get("transforms") else {
        return Ok(Vec::new());
    };
    let Some(list) = list.as_array() else {
        return refuse("bad_transform", format!("{path}/transforms"));
    };
    let mut out = Vec::with_capacity(list.len());
    for (i, t) in list.iter().enumerate() {
        let at = format!("{path}/transforms/{i}");
        let only = t.as_object().filter(|t| t.len() == 1);
        match only.and_then(|t| t.iter().next()) {
            Some((name, Value::Object(fields)))
                if ["periods", "standing", "reveal", "emphasis"].contains(&name.as_str()) =>
            {
                out.push((name.as_str(), fields, format!("{at}/{name}")));
            }
            _ => return refuse("bad_transform", at),
        }
    }
    Ok(out)
}

/// One set's periods as they compiled: its rows before the transforms, ranked. A frame finds this
/// and only mixes, so ranking stays a cost of the check, not of each frame.
#[derive(Debug)]
pub struct Compiled {
    columns: Value,
    specs: Vec<Value>,
    pub rows: Rows,
    pub periods: Periods,
    /// How many transforms the periods took: one, or two with a standing after them.
    taken: usize,
}

thread_local! {
    static COMPILED: RefCell<BTreeMap<String, Rc<Compiled>>> = const { RefCell::new(BTreeMap::new()) };
}

/// The most sets a thread keeps compiled; past it they compile again.
const KEPT: usize = 64;

/// What in a periods or standing transform a compile depends on: all of it but `at`.
fn compiled_spec(spec: &Map<String, Value>) -> Value {
    let mut spec = spec.clone();
    spec.remove("at");
    Value::Object(spec)
}

/// The set's leading periods, and the standing right after them, compiled once per content; a
/// document's columns compare byte for byte, so a changed cell compiles again.
pub fn compiled(
    id: &str,
    params: &Map<String, Value>,
    path: &str,
    base: impl FnOnce() -> Result<Rows, Refused>,
) -> Result<Option<Rc<Compiled>>, Refused> {
    let list = listed(params, path)?;
    let Some((_, spec, at)) = list.first().filter(|t| t.0 == "periods") else {
        return Ok(None);
    };
    let rank = list.get(1).filter(|t| t.0 == "standing");
    let specs: Vec<Value> = std::iter::once(*spec)
        .chain(rank.map(|t| t.1))
        .map(compiled_spec)
        .collect();
    let columns = params.get("columns").unwrap_or(&Value::Null);
    let kept = COMPILED.with(|c| c.borrow().get(id).cloned());
    if let Some(kept) = kept.filter(|k| k.specs == specs && k.columns == *columns) {
        return Ok(Some(kept));
    }
    let rows = base()?;
    let mut periods = Periods::compile(&rows, spec, at)?;
    if let Some((_, standing, at)) = rank {
        periods.rank(&rows, standing, at)?;
    }
    let made = Rc::new(Compiled {
        columns: columns.clone(),
        specs,
        rows,
        periods,
        taken: 1 + usize::from(rank.is_some()),
    });
    COMPILED.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() >= KEPT {
            c.clear();
        }
        c.insert(id.to_string(), Rc::clone(&made));
    });
    Ok(Some(made))
}

/// `at` in a set's leading periods, its first period where it names none.
pub fn at_of(params: &Map<String, Value>, periods: &Periods, path: &str) -> Result<f64, Refused> {
    let list = listed(params, path)?;
    let (_, spec, at) = &list[0];
    channel(spec, "at", periods.by.first().copied(), at)
}

/// The rows of a set after its transforms, in order, its periods compiled once.
pub fn played(
    id: &str,
    params: &Map<String, Value>,
    path: &str,
    bound: bool,
    base: impl Fn() -> Result<Rows, Refused>,
) -> Result<Rows, Refused> {
    let list = listed(params, path)?;
    let (mut rows, mut i) = match compiled(id, params, path, &base)?.filter(|_| !bound) {
        Some(c) => (
            c.periods.at(&c.rows, at_of(params, &c.periods, path)?),
            c.taken,
        ),
        None => (base()?, 0),
    };
    while let Some((name, spec, at)) = list.get(i) {
        i += 1;
        match *name {
            "periods" => {
                let mut periods = Periods::compile(&rows, spec, at)?;
                if let Some(("standing", rank, at)) = list.get(i).map(|t| (t.0, t.1, &t.2)) {
                    periods.rank(&rows, rank, at)?;
                    i += 1;
                }
                let first = periods.by.first().copied();
                rows = periods.at(&rows, channel(spec, "at", first, at)?);
            }
            "reveal" => rows = reveal(&rows, spec, at)?,
            "emphasis" => emphasis(&mut rows, spec, at)?,
            _ => return refuse("bad_transform", at.clone()),
        }
    }
    Ok(rows)
}

/// The set whose rows a mark set draws, when it isn't its own.
pub fn rows_of(item: &Value) -> Option<&str> {
    object_or_empty(item.get("params")).get("rows_of")?.as_str()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn race(values: &[(f64, &str, f64)]) -> Rows {
        Rows {
            keys: values.iter().map(|v| v.1.to_string()).collect(),
            columns: BTreeMap::from([
                (
                    "year".to_string(),
                    Column::Numbers(values.iter().map(|v| v.0).collect()),
                ),
                (
                    "value".to_string(),
                    Column::Numbers(values.iter().map(|v| v.2).collect()),
                ),
            ]),
            precision: BTreeMap::from([("value".to_string(), 0)]),
            ..Rows::default()
        }
    }

    fn play(rows: Rows, at: f64, top: u64) -> Rows {
        let params = json!({"transforms": [
            {"periods": {"by": "year", "at": at}},
            {"standing": {"by": "value", "top": top}},
        ]});
        played("set", params.as_object().unwrap(), "p", true, || {
            Ok(rows.clone())
        })
        .unwrap()
    }

    fn numbers_of(rows: &Rows, column: &str) -> Vec<f64> {
        (0..rows.keys.len())
            .map(|i| rows.columns[column].number(i).unwrap())
            .collect()
    }

    #[test]
    fn a_race_mixes_values_and_standings_between_two_periods() {
        let rows = race(&[
            (2000.0, "a", 10.0),
            (2000.0, "b", 20.0),
            (2000.0, "c", 30.0),
            (2001.0, "a", 40.0),
            (2001.0, "b", 25.0),
            (2001.0, "c", 15.0),
        ]);
        let at = play(rows, 2000.25, 10);
        assert_eq!(numbers_of(&at, "value"), [17.5, 21.25, 26.25]);
        assert_eq!(numbers_of(&at, "standing"), [2.5, 2.0, 1.5]);
        let labels: Vec<_> = (0..3).map(|i| at.shown("value", i).unwrap()).collect();
        assert_eq!(labels, ["18", "21", "26"]);
        assert_eq!(at.anchor("period", "by"), Some((2000.0, None)));
    }

    #[test]
    fn a_row_past_top_slides_below_the_last_and_a_missing_key_enters_at_no_opacity() {
        let rows = race(&[
            (1.0, "a", 50.0),
            (1.0, "b", 40.0),
            (1.0, "c", 30.0),
            (1.0, "d", 20.0),
            (2.0, "a", 50.0),
            (2.0, "b", 40.0),
            (2.0, "c", 10.0),
            (2.0, "d", 20.0),
            (2.0, "e", 30.0),
        ]);
        let early = play(rows.clone(), 1.5, 3);
        assert_eq!(early.keys, ["a", "b", "c", "d", "e"]);
        assert_eq!(numbers_of(&early, "standing"), [1.0, 2.0, 3.5, 4.0, 3.0]);
        assert_eq!(early.opacity, [1.0, 1.0, 0.5, 0.0, 0.5]);
        let rest = play(rows, 2.0, 3);
        assert_eq!(numbers_of(&rest, "standing"), [1.0, 2.0, 4.0, 4.0, 3.0]);
        assert_eq!(rest.opacity, [1.0, 1.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn a_tie_ranks_by_key_and_one_key_twice_in_a_period_is_refused() {
        let rows = race(&[(1.0, "b", 5.0), (1.0, "a", 5.0)]);
        assert_eq!(numbers_of(&play(rows, 1.0, 10), "standing"), [2.0, 1.0]);
        let twice = race(&[(1.0, "a", 5.0), (1.0, "a", 6.0)]);
        let spec = json!({"by": "year"});
        let refused = Periods::compile(&twice, spec.as_object().unwrap(), "p").unwrap_err();
        assert_eq!(refused.code, "key_not_unique");
    }

    #[test]
    fn a_reveal_ends_at_the_point_mixed_at_to_and_emphasis_dims_the_rest() {
        let rows = race(&[(1.0, "a", 10.0), (2.0, "b", 30.0), (3.0, "c", 40.0)]);
        let params = json!({"transforms": [
            {"reveal": {"by": "year", "to": 1.5}},
            {"emphasis": {"keys": ["a"], "mix": 0.5}},
        ]});
        let shown = played("line", params.as_object().unwrap(), "p", true, || {
            Ok(rows.clone())
        })
        .unwrap();
        assert_eq!(numbers_of(&shown, "value"), [10.0, 20.0]);
        assert_eq!(shown.anchor("head", "value"), Some((20.0, Some(0))));
        assert_eq!(shown.opacity, [1.0, 0.65]);
    }

    #[test]
    fn hold_keeps_the_earlier_period_until_the_next_one() {
        let rows = race(&[(1.0, "a", 10.0), (2.0, "a", 30.0), (2.0, "b", 5.0)]);
        let params = json!({"transforms": [{"periods": {"by": "year", "at": 1.9, "mix": "hold"}}]});
        let held = played("h", params.as_object().unwrap(), "p", true, || {
            Ok(rows.clone())
        })
        .unwrap();
        assert_eq!(numbers_of(&held, "value")[0], 10.0);
        assert_eq!(held.opacity, [1.0, 0.0]);
    }

    fn board() -> serde_json::Map<String, Value> {
        let column = |v: &[i32]| {
            let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
            json!({"dtype": "i32", "len": v.len(), "data": deep_canvas::base64::encode(&bytes)})
        };
        json!({"items": {
            "race": {"kind": "marks@1", "params": {
                "n": 2, "key": "k",
                "columns": {"year": column(&[2000, 2001]), "v": column(&[1, 3]),
                            "k": {"dtype": "str", "len": 2, "data": ["a", "a"]}},
                "transforms": [{"periods": {"by": "year", "at": 2000.75}}]}},
            "year": {"kind": "text@1",
                     "params": {"template": "Year {items/race#period/by}"}}
        }})
        .as_object()
        .unwrap()
        .clone()
    }

    #[test]
    fn a_template_shows_the_period_at_or_before_at_with_its_source() {
        let doc = board();
        let shown = crate::scene::bound_text(
            &doc,
            "year",
            &doc["items"]["year"],
            &Default::default(),
            "en",
        );
        assert_eq!(shown.unwrap().unwrap().text, "Year 2000");
        let (numbers, _) = crate::check::numbers(&doc);
        assert_eq!(numbers[0]["source"], json!({"column": "year"}));
    }

    #[test]
    fn a_format_raises_its_unit_and_ends_on_an_ellipsis_without_cutting_the_number() {
        let raised = crate::scene::Format {
            unit: Some("m".into()),
            unit_raised: true,
            ellipsis: true,
            ..Default::default()
        };
        assert_eq!(raised.show(Some(1234.0)), "1,234ᵐ…");
    }

    #[test]
    fn a_source_carries_the_decimals_of_its_type_or_its_cells() {
        assert_eq!(precision_of(&json!({"dtype": "i32"}), &[1.0]), 0);
        assert_eq!(precision_of(&json!({"dtype": "f64"}), &[1.5, 2.25]), 2);
        let table = json!({"dtype": "f64", "trace": {"cells": [{"raw": "1.50"}]}});
        assert_eq!(precision_of(&table, &[1.5]), 2);
    }

    #[test]
    fn periods_over_no_rows_play_no_rows_and_no_period() {
        let at = play(race(&[]), 2000.0, 10);
        assert!(at.keys.is_empty());
        assert_eq!(at.anchor("period", "by"), None);
    }
}
