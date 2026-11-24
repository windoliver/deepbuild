//! Object: hidden view (#290; canvas primitives: Object: hidden view): an item's
//! `hidden_view: {opacity: channel = 0, color: role | base = base}` as a frame reads it at t.
//! Above opacity 0 the renderer draws the item again where nearer surfaces hide it; at 0 it
//! reads nothing here and draws nothing more.

use std::collections::BTreeMap;

use deep_canvas::document::STATUS_ROLE;
use deep_canvas_motion::eval;
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

use crate::look::Look3;
use crate::scene::{Items, Layer3, Refused};

/// #290's wrong programs, each reachable only through a proof surface's `planted`: a hidden view
/// that draws every live row of an instancer, whether or not its `seen` column holds this copy's
/// bit; and a hidden view's opacity that takes its largest value over every player's `match.me`.
pub const IGNORES_SEEN: &str = "hidden_view_ignores_seen";
pub const IGNORES_ME: &str = "hidden_view_opacity_ignores_match_me";

/// The planted opacities: each item's hidden view's, the largest the document's channels and
/// drivers write at `t` as any player of its match reads `match.me`.
fn over_players(map: &Map<String, Value>, t: i64) -> BTreeMap<String, f64> {
    let items = map.get("items").and_then(Value::as_object);
    let net = items
        .into_iter()
        .flatten()
        .find(|(_, i)| i["kind"] == "net@1");
    let players = net.and_then(|(_, i)| i["params"]["players"].as_u64());
    let mut most: BTreeMap<String, f64> = BTreeMap::new();
    for me in 1..=players.unwrap_or(1) {
        let mut doc = map.clone();
        doc.insert("match.me".into(), json!(me));
        let Ok(program) = Program::compile(&doc) else {
            continue;
        };
        let mut state = program.state();
        program.evaluate_local(t, eval::Validity::Full, &mut state);
        for (id, item) in eval::written(&doc, &program, &state) {
            if let Some(o) = item.pointer("/hidden_view/opacity").and_then(Value::as_f64) {
                let held = most.entry(id).or_insert(o);
                *held = held.max(o);
            }
        }
    }
    most
}

/// An item's hidden view above opacity 0: how opaque it draws where a nearer surface hides it,
/// and the look role its shading is tinted toward, linear RGB; none for `base`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HiddenView {
    pub opacity: f64,
    pub tint: Option<[f64; 3]>,
}

/// Item `id`'s hidden view as evaluated: none without one or at opacity 0. A status role is
/// refused here as the check refuses it, since only a status binding reaches one.
pub fn view(look: &Look3, id: &str, item: &Value) -> Result<Option<HiddenView>, Refused> {
    let Some(given) = item.get("hidden_view") else {
        return Ok(None);
    };
    let refuse = |code, field: &str| Refused {
        code,
        path: format!("items/{id}/hidden_view{field}"),
    };
    let fields = given
        .as_object()
        .ok_or_else(|| refuse("out_of_range", ""))?;
    if let Some(name) = fields.keys().find(|k| *k != "opacity" && *k != "color") {
        return Err(refuse("unknown_field", &format!("/{name}")));
    }
    let opacity = match fields.get("opacity") {
        None => 0.0,
        Some(o) => o
            .as_f64()
            .filter(|o| (0.0..=1.0).contains(o))
            .ok_or_else(|| refuse("out_of_range", "/opacity"))?,
    };
    let tint = match fields.get("color").map(Value::as_str) {
        None | Some(Some("base")) => None,
        Some(Some(role)) if role.starts_with(STATUS_ROLE) => {
            return Err(refuse("status_color_unbound", "/color"))
        }
        Some(Some(role)) => {
            let c = look
                .role(role)
                .ok_or_else(|| refuse("ref_unresolved", "/color"))?;
            Some(c.map(|v| deep_canvas::color::srgb_decode(f64::from(v) / 255.0)))
        }
        Some(None) => return Err(refuse("out_of_range", "/color")),
    };
    Ok((opacity > 0.0).then_some(HiddenView { opacity, tint }))
}

/// Each layer's hidden views, by the item its solids draw for (an element's is its
/// instancer's), once every item's is read: a field the item can't hold refuses the frame
/// whether or not the item draws. `map` is the document the frame draws and `t` its time, which
/// only the planted opacity reads.
pub(crate) fn read(
    look: &Look3,
    items: &Items<'_>,
    layers: &mut [Layer3],
    (map, t): (&Map<String, Value>, i64),
) -> Result<(), Refused> {
    let planted = map.get("planted").and_then(Value::as_str) == Some(IGNORES_ME);
    let most = if planted {
        over_players(map, t)
    } else {
        BTreeMap::new()
    };
    let mut views = BTreeMap::new();
    for (id, item) in items.iter() {
        let mut seen = view(look, id, item)?;
        if let (Some(o), true) = (most.get(id), item.get("hidden_view").is_some()) {
            let mut every = item.clone();
            every["hidden_view"]["opacity"] = json!(o);
            seen = view(look, id, &every)?;
        }
        if let Some(v) = seen {
            views.insert(id.as_str(), v);
        }
    }
    if views.is_empty() {
        return Ok(());
    }
    for layer in layers {
        for s in &layer.solids {
            let owner = s.id.split('#').next().unwrap_or(&s.id);
            if let (Some(v), false) = (views.get(owner), layer.hidden.contains_key(owner)) {
                layer.hidden.insert(owner.to_string(), *v);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn look() -> Look3 {
        Look3::read(&json!({"roles": {"ghost": "#ff0000"}})).expect("a look")
    }

    #[test]
    fn a_hidden_view_reads_its_opacity_and_its_role_and_nothing_at_zero() {
        let at = |v: Value| view(&look(), "a", &json!({"hidden_view": v}));
        assert_eq!(at(json!({})), Ok(None));
        assert_eq!(at(json!({"opacity": 0, "color": "ghost"})), Ok(None));
        let base = HiddenView {
            opacity: 0.4,
            tint: None,
        };
        assert_eq!(at(json!({"opacity": 0.4})), Ok(Some(base)));
        assert_eq!(at(json!({"opacity": 0.4, "color": "base"})), Ok(Some(base)));
        let red = at(json!({"opacity": 1, "color": "ghost"})).expect("read");
        assert_eq!(red.map(|v| v.tint), Some(Some([1.0, 0.0, 0.0])));
        assert_eq!(view(&look(), "a", &json!({"kind": "mark.box@1"})), Ok(None));
    }

    #[test]
    fn a_hidden_view_refuses_a_status_role_and_what_its_fields_cant_hold() {
        let refused = |v: Value| {
            let r = view(&look(), "a", &json!({"hidden_view": v})).expect_err("refused");
            (r.code, r.path)
        };
        let at = |f: &str| format!("items/a/hidden_view{f}");
        assert_eq!(
            refused(json!({"opacity": 0.4, "color": "status.fail"})),
            ("status_color_unbound", at("/color"))
        );
        // At opacity 0 too: the field is refused, not the frame it would draw.
        assert_eq!(
            refused(json!({"color": "status.pass"})),
            ("status_color_unbound", at("/color"))
        );
        assert_eq!(
            refused(json!({"opacity": 1.5})),
            ("out_of_range", at("/opacity"))
        );
        assert_eq!(
            refused(json!({"opacity": "0.4"})),
            ("out_of_range", at("/opacity"))
        );
        assert_eq!(
            refused(json!({"opacity": 0.4, "color": "nobody"})),
            ("ref_unresolved", at("/color"))
        );
        assert_eq!(refused(json!({"color": 3})), ("out_of_range", at("/color")));
        assert_eq!(
            refused(json!({"opacity": 0.4, "blur": 2})),
            ("unknown_field", at("/blur"))
        );
        assert_eq!(refused(json!(0.4)), ("out_of_range", at("")));
    }
}
