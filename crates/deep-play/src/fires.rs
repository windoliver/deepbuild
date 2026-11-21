//! #194: what a document's logic items fire into its worlds, as far as #1834's `fires` is built
//! (canvas primitives: Check input: logic kinds, As built (#194)). At check each fired input must
//! be one the world declares with `on: {logic: <item>}`, and each such input one the item's `fires`
//! lists; an item that both fires into a world and reads it is refused until #1834. The piece the
//! logic module checks takes each input's number fields, in its kind's order, so the program's slot
//! holds them after its count. The fires are baked before the worlds that take them, and kept in
//! the form as `logic_fires`, which the shared derivation (derive.rs) reads.

use std::rc::Rc;

use deep_canvas::document::Issue;
use deep_canvas_physics::doc::number_fields;
use deep_logic::piece::Piece;
use deep_logic::world::{track_of, Entry, Record, World};
use serde_json::{json, Map, Value};

use crate::logic::refused;

/// Whether any logic item of `form` fires.
pub fn any(form: &Value) -> bool {
    items(form).any(|(_, fires)| fires.as_object().is_some_and(|o| !o.is_empty()))
}

fn items(form: &Value) -> impl Iterator<Item = (&String, &Value)> {
    form.get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i["kind"] == "logic@1")
        .filter_map(|(id, i)| Some((id, i.pointer("/params/fires")?)))
}

fn refusal(item: &str, input: &str, what: String) -> Box<Issue> {
    Box::new(refused(
        json!({"ok": false, "code": "logic_refused", "item": item,
        "refusals": [{"rule": "fires", "what": what, "field": "fires", "input": input}]}),
    ))
}

/// `piece`, the logic module's piece of `form`, with each fired input's number fields written
/// (`{world: {input: [field]}}`), or the refusal naming the item and the input.
pub fn expand(form: &Value, piece: &mut Value) -> Result<(), Box<Issue>> {
    let worlds = form.get("worlds").and_then(Value::as_object);
    for (item, fires) in items(form) {
        let mut out = Map::new();
        for (world, list) in fires.as_object().into_iter().flatten() {
            let declared = worlds
                .and_then(|w| w.get(world))
                .and_then(|w| w.get("inputs"));
            let mut inputs = Map::new();
            for input in list
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                let Some(i) = declared.and_then(|d| d.get(input)) else {
                    let what = format!(
                        "{item} fires {world}.{input}, which world {world} doesn't declare"
                    );
                    return Err(refusal(item, input, what));
                };
                if i.pointer("/on/logic").and_then(Value::as_str) != Some(item.as_str()) {
                    let what = format!(
                        "{world}.{input} isn't on {{logic: {item}}}, so {item} can't fire it"
                    );
                    return Err(refusal(item, input, what));
                }
                let kind = i.get("kind").and_then(Value::as_str).unwrap_or_default();
                inputs.insert(input.into(), json!(number_fields(kind)));
            }
            out.insert(world.clone(), Value::Object(inputs));
        }
        let reads = form["items"][item.as_str()]
            .pointer("/params/reads")
            .and_then(Value::as_array);
        if let Some(world) = out.keys().find(|w| {
            reads
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .any(|r| r.starts_with(&format!("{w}.")))
        }) {
            let what =
                format!("{item} both fires into world {world} and reads it, which waits on #1834");
            return Err(Box::new(refused(
                json!({"ok": false, "code": "logic_refused", "item": item,
                "refusals": [{"rule": "fires_and_reads", "what": what, "field": "fires", "world": world}]}),
            )));
        }
        piece["items"][item.as_str()]["params"]["fires"] = Value::Object(out);
    }
    // Each world input on a logic item that item's `fires` lists.
    for (world, w) in worlds.into_iter().flatten() {
        for (input, i) in w
            .get("inputs")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let Some(item) = i.pointer("/on/logic").and_then(Value::as_str) else {
                continue;
            };
            let listed = form["items"][item].pointer(&format!("/params/fires/{world}"));
            let named = listed
                .and_then(Value::as_array)
                .is_some_and(|l| l.iter().any(|x| x == input));
            if !named {
                let what = format!(
                    "{world}.{input} takes what {item} fires, and {item}'s fires doesn't list it"
                );
                return Err(refusal(item, input, what));
            }
        }
    }
    Ok(())
}

/// `form`'s logic fires, baked from `piece` on `track` over the transport's span, kept in the
/// form as `logic_fires`: `[{item, step, t, world, input, data}]`, `t` in flicks.
pub fn inline(form: &mut Value, piece: Piece, track: &[Value]) -> Result<(), Box<Issue>> {
    let entries: Vec<Entry> = track
        .iter()
        .filter(|e| e.get("present").is_none())
        .filter_map(Entry::parse)
        .collect();
    let span = deep_canvas_media::doc::time(form, form.pointer("/transport/span"))
        .unwrap_or(0)
        .max(0);
    let steps = piece
        .items
        .iter()
        .map(|i| (span + i.step - 1) / i.step.max(1))
        .max()
        .unwrap_or(0);
    let piece = Rc::new(piece);
    let mut rec = Record::default();
    let mut world = World::new(
        piece.clone(),
        track_of(&entries),
        false,
        Default::default(),
        &mut rec,
        None,
    )
    .map_err(refused)?;
    world.run(steps, &mut rec, &mut |_, _| {});
    let fires = deep_logic::piece::fires::of(&rec, &piece.items);
    if let Some(doc) = form.as_object_mut() {
        doc.insert("logic_fires".into(), Value::Array(fires));
    }
    Ok(())
}
