//! A scale whose domain a channel keys (issue #226; canvas primitives: Scale and encode, "ticks
//! enter and leave by opacity as their values enter and leave the domain"): its ticks follow the
//! two keys around its domain at t, as a domain that follows periods does, so a 2D axis and 3D
//! axes on the scale fade the same ticks by the same amount.

use serde_json::{json, Map, Value};

use crate::data::{Follows, Scale, ScaleKind};

/// `scale`, read from scale item `id` as it is at t (`item`), with the keys of the channels on
/// its domain (the pair, or each end) to follow: the two keyed domains its domain lies between
/// and how far along. A scale no channel keys, or one that already follows periods, is returned
/// as it is.
pub fn keyed(
    scale: Scale,
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    channels: Option<&Value>,
) -> Scale {
    if scale.follows.is_some() || matches!(scale.kind, ScaleKind::Ordinal | ScaleKind::Quantize) {
        return scale;
    }
    let Some(now) = pair(item.pointer("/params/domain")) else {
        return scale;
    };
    let rests = rests(id, now, channels);
    // The two rests in a row the domain lies between: the nearest of their segments.
    let mut best: Option<(f64, [f64; 2], [f64; 2], f64)> = None;
    for w in rests.windows(2) {
        let (a, b) = (w[0], w[1]);
        let d = [b[0] - a[0], b[1] - a[1]];
        let len2 = d[0] * d[0] + d[1] * d[1];
        if len2 <= 0.0 {
            continue;
        }
        let f = (((now[0] - a[0]) * d[0] + (now[1] - a[1]) * d[1]) / len2).clamp(0.0, 1.0);
        let off = [a[0] + d[0] * f - now[0], a[1] + d[1] * f - now[1]];
        let miss = off[0] * off[0] + off[1] * off[1];
        if best.is_none_or(|b| miss < b.0) {
            best = Some((miss, a, b, f));
        }
    }
    let Some((_, a, b, fraction)) = best else {
        return scale;
    };
    // Each rest's domain as the scale reads it there, made nice as any domain is.
    let rest = |d: [f64; 2]| {
        let mut at = item.clone();
        at["params"]["domain"] = json!(d);
        Scale::read(id, &at, items).ok().map(|s| s.domain)
    };
    let (Some(a), Some(b)) = (rest(a), rest(b)) else {
        return scale;
    };
    Scale {
        follows: Some(Follows {
            domains: vec![a, b],
            period: 0,
            fraction,
        }),
        ..scale
    }
}

/// The keyed domains of scale `id`, in key time order: a channel's on the whole domain, or the
/// ends' channels zipped key by key, an end no channel keys held at `now`.
fn rests(id: &str, now: [f64; 2], channels: Option<&Value>) -> Vec<[f64; 2]> {
    let keys = |target: String| -> Vec<&Value> {
        let mut keys: Vec<(f64, &Value)> = channels
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|c| c.values())
            .filter(|c| c.get("target").and_then(Value::as_str) == Some(target.as_str()))
            .filter_map(|c| c.get("keys").and_then(Value::as_object))
            .flat_map(|k| k.values())
            .filter_map(|k| Some((seconds(k.get("t")?)?, k.get("value")?)))
            .collect();
        keys.sort_by(|a, b| a.0.total_cmp(&b.0));
        keys.into_iter().map(|k| k.1).collect()
    };
    let whole = keys(format!("items/{id}/params/domain"));
    if !whole.is_empty() {
        return whole.into_iter().filter_map(|v| pair(Some(v))).collect();
    }
    let ends = [0, 1].map(|e| keys(format!("items/{id}/params/domain/{e}")));
    let n = ends[0].len().max(ends[1].len());
    if n == 0 || (!ends[0].is_empty() && !ends[1].is_empty() && ends[0].len() != ends[1].len()) {
        return Vec::new();
    }
    (0..n)
        .filter_map(|k| {
            let end = |e: usize| match ends[e].get(k) {
                Some(v) => v.as_f64(),
                None => ends[e].is_empty().then_some(now[e]),
            };
            Some([end(0)?, end(1)?])
        })
        .collect()
}

/// A key's time in seconds, for its order: `"<n>s"`, `"<n>ms"` or flicks.
fn seconds(t: &Value) -> Option<f64> {
    if let Some(n) = t.as_f64() {
        return Some(n / deep_canvas::camera::FLICKS_PER_SECOND as f64);
    }
    let s = t.as_str()?;
    match s.strip_suffix("ms") {
        Some(ms) => ms.parse::<f64>().ok().map(|v| v / 1000.0),
        None => s.strip_suffix('s')?.parse().ok(),
    }
}

fn pair(v: Option<&Value>) -> Option<[f64; 2]> {
    match v?.as_array()?.as_slice() {
        [a, b] => Some([a.as_f64()?, b.as_f64()?]),
        _ => None,
    }
}
