//! Issue #491: the occurrence-list functions of the closed function list (canvas primitives: The
//! closed function list, Occurrence lists). A driver var binds a list with an optional filter
//! (`kinds`, `a`, `b`, `tags`, `where`), filtered once at check; `count`, `last`, `since`, `next`,
//! `rank` and `inside` read the matches at or before t, and a payload field reads as
//! `last(list).field` or `next(list).field`. Times read in seconds from the transport's start,
//! held to its span, as a driver's `time` does.
//!
//! Each read is written into the driver's expression as one var the core evaluates, so the core's
//! closed function list and its interval forms are unchanged.

use deep_canvas::expr::{Expr, Nothing};
use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::interval::Iv;
use serde_json::Value;

/// A driver var's list and filter, as written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Filter {
    /// `markers.<kind>` or `input.<control>`.
    pub list: String,
    pub kinds: Option<Vec<String>>,
    pub a: Option<String>,
    pub b: Option<String>,
    pub tags: Vec<String>,
    pub where_: Option<String>,
}

/// One occurrence: its flick, its span's end, its stable ID, its kind, tags and payload.
#[derive(Clone, Debug, PartialEq)]
pub struct Occurrence {
    pub t: i64,
    pub end: i64,
    pub a: Option<String>,
    pub b: Option<String>,
    pub kind: String,
    pub tags: Vec<String>,
    pub payload: Value,
}

/// #1918: a world's list as its host baked it into the document's `occurrences` under `list`, once
/// the core's column view resolved its form: each row's tags, and every field beside `t`, `step`,
/// `kind`, `a`, `b` and `tags` as its payload. A document no host baked reads it empty.
pub fn baked(doc: &serde_json::Map<String, Value>, list: &str) -> Vec<Occurrence> {
    let rows = doc
        .get("occurrences")
        .and_then(|o| o.get(list))
        .and_then(Value::as_array);
    let row = |r: &serde_json::Map<String, Value>| {
        let id = |k: &str| r.get(k).and_then(Value::as_str).map(String::from);
        let strings = |v: &Value| {
            v.as_array().map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(String::from)
                    .collect()
            })
        };
        let t = r.get("t")?.as_i64()?;
        let own = ["t", "step", "kind", "a", "b", "tags"];
        let payload = r
            .iter()
            .filter(|(k, _)| !own.contains(&k.as_str()))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let tags = r.get("tags").and_then(strings).unwrap_or_default();
        Some(Occurrence {
            t,
            end: t,
            a: id("a"),
            b: id("b"),
            kind: id("kind")?,
            tags,
            payload: Value::Object(payload),
        })
    };
    rows.into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .filter_map(row)
        .collect()
}

/// What a read takes from the matches at or before t.
#[derive(Clone, Debug, PartialEq)]
pub enum How {
    Count,
    /// `count(list, a, b)`: those between the entries with stable IDs a and b, by index.
    Between(usize, usize),
    Last,
    Since,
    Next,
    Rank,
    Inside,
    /// `last(list).field…`: the payload field's number on each match.
    LastField(Vec<f64>),
    NextField(Vec<f64>),
}

/// One read over one filtered list, sorted by time.
#[derive(Clone, Debug, PartialEq)]
pub struct Read {
    pub how: How,
    pub times: Vec<i64>,
    /// The latest end of the matches up to each, so `inside` reads one entry.
    pub ends: Vec<i64>,
}

const F: f64 = FLICKS_PER_SECOND as f64;

impl Read {
    /// The read at `t` on the driver's clock, or `None` where no match gives one (the driver then
    /// takes its fallback).
    pub fn at(&self, t: i64) -> Option<f64> {
        let n = self.times.partition_point(|&x| x <= t);
        let latest = n.checked_sub(1);
        match &self.how {
            How::Count => Some(n as f64),
            How::Between(lo, hi) => Some(n.min(hi + 1).saturating_sub(*lo) as f64),
            How::Inside => Some(if latest.is_some_and(|i| t < self.ends[i]) {
                1.0
            } else {
                0.0
            }),
            How::Last => latest.map(|i| self.times[i] as f64 / F),
            How::Since => latest.map(|i| (t - self.times[i]) as f64 / F),
            How::Rank => latest.map(|i| i as f64),
            How::LastField(v) => latest.map(|i| v[i]).filter(|v| v.is_finite()),
            How::Next => self.times.get(n).map(|&x| x as f64 / F),
            How::NextField(v) => v.get(n).copied().filter(|v| v.is_finite()),
        }
    }

    /// Whether the read needs the driver's fallback where nothing matches.
    pub fn needs_fallback(&self) -> bool {
        !matches!(self.how, How::Count | How::Between(..) | How::Inside)
    }

    /// The read's bound over a span of `span` seconds.
    pub fn bound(&self, span: f64) -> Iv {
        let hull = |vals: &mut dyn Iterator<Item = f64>| {
            let (lo, hi) = vals.fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), v| {
                (l.min(v), h.max(v))
            });
            if lo <= hi {
                Iv::new(lo, hi)
            } else {
                Iv::ENTIRE
            }
        };
        let n = self.times.len() as f64;
        match &self.how {
            How::Count => Iv::new(0.0, n),
            How::Between(lo, hi) => Iv::new(0.0, (hi + 1 - lo) as f64),
            How::Inside => Iv::new(0.0, 1.0),
            How::Rank => Iv::new(0.0, (n - 1.0).max(0.0)),
            // The latest since is from the first match to the span's end.
            How::Since => Iv::new(
                0.0,
                (span - self.times.first().map_or(0.0, |&x| x as f64 / F)).max(0.0),
            ),
            How::Last | How::Next => hull(&mut self.times.iter().map(|&x| x as f64 / F)),
            How::LastField(v) | How::NextField(v) => {
                hull(&mut v.iter().copied().filter(|v| v.is_finite()))
            }
        }
    }
}

/// Why a list or a read is refused: the code and what it names.
#[derive(Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub why: String,
}

fn refuse<T>(code: &'static str, why: impl Into<String>) -> Result<T, Refusal> {
    Err(Refusal {
        code,
        why: why.into(),
    })
}

/// The list's entries that pass the filter, in time order.
pub fn filtered(filter: &Filter, list: Vec<Occurrence>) -> Result<Vec<Occurrence>, Refusal> {
    let mut matched = Vec::new();
    let test = match &filter.where_ {
        None => None,
        Some(text) => Some(
            Expr::compile(text, &Nothing, crate::program::DRIVER_OPS).map_err(|r| Refusal {
                code: "bad_doc",
                why: format!("where `{text}`: {}", r.why),
            })?,
        ),
    };
    for o in list {
        let keep = filter.kinds.as_ref().is_none_or(|k| k.contains(&o.kind))
            && filter.a.as_ref().is_none_or(|a| o.a.as_ref() == Some(a))
            && filter.b.as_ref().is_none_or(|b| o.b.as_ref() == Some(b))
            && filter.tags.iter().all(|t| o.tags.contains(t))
            && test.as_ref().is_none_or(|e| {
                let vals: Vec<f64> = e
                    .vars
                    .iter()
                    .map(|v| field(&o.payload, std::slice::from_ref(v)))
                    .collect();
                let v = e.eval_num(&vals);
                v.is_finite() && v != 0.0
            });
        if keep {
            matched.push(o);
        }
    }
    matched.sort_by_key(|o| o.t);
    Ok(matched)
}

/// A payload field's number, NaN where the occurrence lacks one.
fn field(payload: &Value, path: &[String]) -> f64 {
    path.iter()
        .try_fold(payload, |v, k| v.get(k))
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN)
}

const FUNCTIONS: [&str; 6] = ["count", "last", "since", "next", "rank", "inside"];

/// One read the rewrite found: the var name it stands for, the list var it reads, the function,
/// the stable IDs `count` takes and the payload path after it.
#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    pub name: String,
    pub list: String,
    pub function: String,
    pub between: Option<(String, String)>,
    pub field: Vec<String>,
}

/// Writes each occurrence read over a list var in `text` as one var, `_occ<k>`, and returns the
/// rewritten text with what each stands for. A list var read any other way is refused.
pub fn rewrite(text: &str, lists: &[&str]) -> Result<(String, Vec<Found>), Refusal> {
    let chars: Vec<char> = text.chars().collect();
    let ident = |i: usize| -> (String, usize) {
        let mut j = i;
        while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '_') {
            j += 1;
        }
        (chars[i..j].iter().collect(), j)
    };
    let skip = |mut i: usize| {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        i
    };
    let (mut out, mut found, mut i) = (String::new(), Vec::new(), 0);
    while i < chars.len() {
        let c = chars[i];
        let starts = (c.is_alphabetic() || c == '_')
            && (i == 0
                || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_' || chars[i - 1] == '.'));
        if !starts {
            out.push(c);
            i += 1;
            continue;
        }
        let (name, after) = ident(i);
        if lists.contains(&name.as_str()) {
            return refuse("bad_doc", format!("the list `{name}` is read only through count, last, since, next, rank or inside"));
        }
        let open = skip(after);
        if !FUNCTIONS.contains(&name.as_str()) || chars.get(open) != Some(&'(') {
            out.push_str(&name);
            i = after;
            continue;
        }
        let (list, mut j) = ident(skip(open + 1));
        if !lists.contains(&list.as_str()) {
            out.push_str(&name);
            i = after;
            continue;
        }
        j = skip(j);
        let mut between = None;
        if name == "count" && chars.get(j) == Some(&',') {
            let (a, k) = ident(skip(j + 1));
            let k = skip(k);
            if chars.get(k) != Some(&',') {
                return refuse(
                    "bad_doc",
                    format!("count({list}, a, b) takes two stable IDs"),
                );
            }
            let (b, k) = ident(skip(k + 1));
            between = Some((a, b));
            j = skip(k);
        }
        if chars.get(j) != Some(&')')
            || between
                .as_ref()
                .is_some_and(|(a, b)| a.is_empty() || b.is_empty())
        {
            return refuse("bad_doc", format!("{name}({list}…) is not closed"));
        }
        j += 1;
        let mut field = Vec::new();
        while chars.get(j) == Some(&'.') && matches!(name.as_str(), "last" | "next") {
            let (f, k) = ident(j + 1);
            if f.is_empty() {
                break;
            }
            field.push(f);
            j = k;
        }
        let var = format!("_occ{}", found.len());
        out.push_str(&var);
        found.push(Found {
            name: var,
            list,
            function: name,
            between,
            field,
        });
        i = j;
    }
    Ok((out, found))
}

/// The read a found call makes over `list`, the filtered entries.
pub fn read_of(found: &Found, list: &[Occurrence]) -> Result<Read, Refusal> {
    let index = |id: &str| {
        list.iter()
            .position(|o| o.a.as_deref() == Some(id))
            .ok_or_else(|| Refusal {
                code: "ref_unresolved",
                why: format!("count({}, …): no match has the stable ID {id}", found.list),
            })
    };
    let values = || {
        list.iter()
            .map(|o| field(&o.payload, &found.field))
            .collect()
    };
    let how = match (found.function.as_str(), found.field.is_empty()) {
        ("count", _) => match &found.between {
            None => How::Count,
            Some((a, b)) => {
                let (a, b) = (index(a)?, index(b)?);
                How::Between(a.min(b), a.max(b))
            }
        },
        ("last", true) => How::Last,
        ("last", false) => How::LastField(values()),
        ("next", true) => How::Next,
        ("next", false) => How::NextField(values()),
        ("since", _) => How::Since,
        ("rank", _) => How::Rank,
        _ => How::Inside,
    };
    Ok(Read {
        how,
        times: list.iter().map(|o| o.t).collect(),
        ends: list
            .iter()
            .scan(i64::MIN, |end, o| {
                *end = (*end).max(o.end);
                Some(*end)
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn kick(t: f64, gain: f64, tag: &str) -> Occurrence {
        let t = (t * F) as i64;
        Occurrence {
            t,
            end: t,
            a: None,
            b: None,
            kind: "beat".into(),
            tags: vec![tag.into()],
            payload: json!({"gain": gain}),
        }
    }

    #[test]
    fn reads_rewrite_to_vars_and_fields() {
        let (text, found) =
            rewrite("last(k).gain * 2 + count(k) + next (k) + lastly", &["k"]).unwrap();
        assert_eq!(text, "_occ0 * 2 + _occ1 + _occ2 + lastly");
        assert_eq!(found[0].field, vec!["gain".to_string()]);
        assert_eq!(found[2].function, "next");
        assert!(rewrite("k + 1", &["k"]).is_err());
    }

    #[test]
    fn a_filter_keeps_the_tag_and_the_where() {
        let list = vec![
            kick(1.0, 0.6, "kick"),
            kick(2.0, 0.3, "snare"),
            kick(2.5, 0.8, "kick"),
        ];
        let mut f = Filter {
            list: "markers.beat".into(),
            kinds: None,
            a: None,
            b: None,
            tags: vec!["kick".into()],
            where_: None,
        };
        assert_eq!(filtered(&f, list.clone()).unwrap().len(), 2);
        f.where_ = Some("gain > 0.7".into());
        let kept = filtered(&f, list).unwrap();
        assert_eq!(kept.len(), 1);
        let found = &rewrite("last(k).gain", &["k"]).unwrap().1[0];
        let read = read_of(found, &kept).unwrap();
        assert_eq!(read.at((3.0 * F) as i64), Some(0.8));
        assert_eq!(read.at(0), None);
    }

    #[test]
    fn inside_holds_while_any_span_is_open() {
        let span = |t: f64, end: f64| Occurrence {
            end: (end * F) as i64,
            ..kick(t, 0.0, "kick")
        };
        let list = vec![span(1.0, 5.0), span(2.0, 2.5)];
        let found = &rewrite("inside(k)", &["k"]).unwrap().1[0];
        let read = read_of(found, &list).unwrap();
        let at = |s: f64| read.at((s * F) as i64);
        assert_eq!(
            [at(0.5), at(1.0), at(3.0), at(5.0)],
            [Some(0.0), Some(1.0), Some(1.0), Some(0.0)]
        );
    }
}
