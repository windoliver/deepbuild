//! A scale's tick step (Scale and encode: `ticks = auto`) and a time axis's labels, which
//! `data.rs` reads.
//!
//! #233: `ticks` is `auto`, about five ticks on a 1, 2, 5 step, or a step in data units, such as
//! a number line's `x_range: [−3, 3, 1]`. Either way the one tick rule holds: a tick sits on each
//! multiple of the step inside the domain, and enters and leaves by opacity as a keyed domain
//! moves.

use serde_json::{Map, Value};

use crate::data::{axis_line, scale_named};
use crate::path;
use crate::scene::{object_or_empty, refuse, Geometry, Mark, Refused};

/// `ticks` on `scale@1` at `path`: `None` for `auto` or unwritten, else the step, a finite
/// number above 0.
pub(crate) fn step_param(ticks: Option<&Value>, path: &str) -> Result<Option<f64>, Refused> {
    match ticks {
        None => Ok(None),
        Some(Value::String(s)) if s == "auto" => Ok(None),
        Some(v) => match v.as_f64() {
            Some(step) if step.is_finite() && step > 0.0 => Ok(Some(step)),
            _ => refuse("out_of_range", format!("{path}/ticks")),
        },
    }
}

/// Where the tick axis item `id` draws at `value` meets its line, its part `tick:<value>`, as an
/// empty box in the frame, read from `items` at t: a label placed beside it follows the tick as
/// the scale's domain moves.
pub fn tick_box(id: &str, items: &Map<String, Value>, part: &str) -> Option<[f64; 4]> {
    let value: f64 = part.strip_prefix("tick:")?.parse().ok()?;
    let item = items.get(id)?;
    let p = object_or_empty(item.get("params"));
    let scale_id = p.get("scale")?.as_str()?;
    let scale = scale_named(items, scale_id, "").ok()?;
    let (_, horizontal, cross) = axis_line(scale_id, p, items, "").ok()?;
    let (_, [x, y]) = crate::relations::place_of(item, None);
    let along = scale.map(value);
    Some(if horizontal {
        [along + x, cross + y, 0.0, 0.0]
    } else {
        [cross + x, along + y, 0.0, 0.0]
    })
}

/// A straight line from `a` to `b` stroked `width` wide: an open path, as a rule a reader
/// measures by its ends (#233).
pub(crate) fn line(item: String, a: [f64; 2], b: [f64; 2], width: f64, color: [u8; 3]) -> Mark {
    let d = format!("M {} {} L {} {}", a[0], a[1], b[0], b[1]);
    let verbs = path::parse(&d).unwrap_or_default();
    let geometry = Geometry {
        verbs,
        stroke: Some(width),
        fill: false,
    };
    Mark::Path {
        item,
        geometry,
        d,
        offset: [0.0, 0.0],
        color,
    }
}

/// An axis's line and tick width in u: `width`, 1 unwritten (#233).
pub(crate) fn width(p: &Map<String, Value>) -> f64 {
    p.get("width").and_then(Value::as_f64).unwrap_or(1.0)
}

/// Where the tick at `value` runs across its axis's line, in u from it: `out` (toward the labels)
/// unwritten; with `tick: {size, both}`, `size` out, or each way when `both`, and `long_size` for
/// the values `long` lists, as a number line's elongated ticks (#233).
pub(crate) fn span(p: &Map<String, Value>, value: f64, out: f64) -> [f64; 2] {
    let Some(tick) = p.get("tick") else {
        return [0.0, out];
    };
    let n = |k: &str| tick.get(k).and_then(Value::as_f64);
    let long = tick.get("long").and_then(Value::as_array);
    let long = long.is_some_and(|l| l.iter().any(|x| x.as_f64() == Some(value)));
    let size = match (long, n("long_size")) {
        (true, Some(l)) => l,
        _ => n("size").unwrap_or(out.abs()),
    };
    let size = size.copysign(out);
    if tick.get("both").and_then(Value::as_bool) == Some(true) {
        [-size, size]
    } else {
        [0.0, size]
    }
}

/// A UTC civil date from days since the epoch (Howard Hinnant's `civil_from_days`).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// A time tick's label at its step: seconds, minutes or the date.
pub(crate) fn time_label(ms: i64, step: f64) -> String {
    let secs = ms.div_euclid(1000);
    let (days, day_secs) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (h, m, s) = (day_secs / 3600, day_secs % 3600 / 60, day_secs % 60);
    if step >= 864e5 {
        let (y, mo, d) = civil(days);
        format!("{y:04}-{mo:02}-{d:02}")
    } else if step >= 6e4 {
        format!("{h:02}:{m:02}")
    } else {
        format!("{h:02}:{m:02}:{s:02}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_written_step_is_kept_and_a_bad_one_refused() {
        assert_eq!(step_param(None, "p").unwrap(), None);
        assert_eq!(step_param(Some(&json!("auto")), "p").unwrap(), None);
        assert_eq!(step_param(Some(&json!(0.5)), "p").unwrap(), Some(0.5));
        for bad in [json!(0), json!(-1), json!("often")] {
            assert_eq!(step_param(Some(&bad), "p").unwrap_err().path, "p/ticks");
        }
    }
}
