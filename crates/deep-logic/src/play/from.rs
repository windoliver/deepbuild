//! #1047: a play's `from` (canvas primitives: Check input: playtest), `{save: asset ID}`: the run
//! starts at the save's step. logic.layout first checks the save against the piece, and a save it
//! doesn't pass is refused before any step, naming what it found. Then the piece's own items are
//! restored as opening a save does, and a logic bot's item starts fresh beside them, at its first
//! step at or after the save's time. A replay names the same save, so it starts from it too.

use std::rc::Rc;

use serde_json::{json, Map, Value};

use super::{refused, BOT};
use crate::checks::layout::layout;
use crate::piece::Piece;
use crate::world::{track_of, Entry, Record, World};
use crate::Planted;

/// The save a play starts from: its asset ID, the step it was written at, its bytes, and the
/// piece it is of, which is the piece played without a logic bot's item.
pub(super) struct Saved {
    pub save: String,
    pub step: i64,
    bytes: Vec<u8>,
    own: Rc<Piece>,
}

/// The save `call.from` names, once logic.layout has passed it against `piece` without a logic
/// bot's item; none without a `from`. `checked` is a piece's JSON as the play checks it.
pub(super) fn of(
    call: &Value,
    piece: &Value,
    checked: &dyn Fn(&Value) -> Result<Rc<Piece>, Value>,
    stored: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Option<Saved>, Value> {
    let Some(from) = call.get("from").filter(|f| !f.is_null()) else {
        return Ok(None);
    };
    let save = from
        .get("save")
        .and_then(Value::as_str)
        .ok_or_else(|| refused("bad_input", json!("from: {save: asset ID}")))?;
    let mut bare = piece.clone();
    if call.pointer("/bot/logic").is_some() {
        if let Some(items) = bare.get_mut("items").and_then(Value::as_object_mut) {
            items.shift_remove(BOT);
        }
    }
    let own = checked(&bare)?;
    // The piece under the programs that wrote a save, each by its asset ID.
    let mut old_of = |programs: &Map<String, Value>| {
        let mut old = bare.clone();
        for (id, sha) in programs {
            old["items"][id]["params"]["program"] = sha.clone();
        }
        checked(&old)
    };
    let report = layout(
        own.clone(),
        &mut old_of,
        stored,
        &json!({"saves": [save]}),
        Planted::default(),
        &crate::adapter(call),
    );
    let Some(bytes) = stored(save).filter(|_| report["verdict"] == "PASS") else {
        return Err(refused("logic.layout", json!(said(save, &report))));
    };
    let step = bytes
        .split(|b| *b == b'\n')
        .next()
        .and_then(|line| serde_json::from_slice::<Value>(line).ok())
        .and_then(|header| header["step"].as_i64())
        .unwrap_or(0);
    Ok(Some(Saved {
        save: save.to_string(),
        step,
        bytes,
        own,
    }))
}

/// What logic.layout found against the save: both layouts when its state layout isn't the
/// piece's, what the piece doesn't carry when it's BLOCKED, else its failures.
fn said(save: &str, report: &Value) -> String {
    let failures = report["failures"].as_array().into_iter().flatten();
    let layouts = failures
        .flat_map(|f| f["refused"]["differs"].as_array().into_iter().flatten())
        .find(|d| d["what"] == "layout");
    match (layouts, report["ask"].as_str()) {
        (Some(d), _) => format!(
            "the save {save}'s state layout {} isn't the piece's, {}, and the piece declares no migration from it",
            d["save"].as_str().unwrap_or("?"),
            d["piece"].as_str().unwrap_or("?")
        ),
        (None, Some(ask)) => format!("BLOCKED on the save {save}: {ask}"),
        (None, None) => format!("the save {save} fails it: {}", report["failures"]),
    }
}

impl Saved {
    /// The world at the save's step, the opened state `rec`'s first checkpoint: the piece's own
    /// items as opening the save restores them, on the run's `entries`, and with `bot`, the index
    /// of a logic bot's item in `piece`, that item fresh. Like a play from step 0, it keeps no
    /// saves.
    pub(super) fn world(
        &self,
        piece: &Rc<Piece>,
        bot: Option<usize>,
        entries: &[Entry],
        adapter: &str,
        rec: &mut Record,
    ) -> Result<World, Value> {
        let (mut opened, _) =
            crate::saves::open_held(&self.own, &self.save, &self.bytes, entries, adapter, rec)?;
        opened.held = None;
        let Some(b) = bot else {
            return Ok(opened);
        };
        // The bot's item as a play from step 0 starts it: only its own trap is this run's.
        let mut scratch = Record::default();
        let mut fresh = World::new(
            piece.clone(),
            track_of(entries),
            false,
            Planted::default(),
            &mut scratch,
            None,
        )?;
        let id = json!(piece.items[b].id);
        rec.traps
            .extend(scratch.traps.into_iter().filter(|t| t["item"] == id));
        let mut live = fresh.lives.swap_remove(b);
        // Its first step: the first at or after the save's time.
        let at = self.step * self.own.items.first().map_or(0, |i| i.step);
        live.next = (at + piece.items[b].step - 1).div_euclid(piece.items[b].step);
        live.last = live.next - 1;
        let mut lives = std::mem::take(&mut opened.lives);
        lives.insert(b, live);
        let mut world = World::of(
            piece.clone(),
            track_of(entries),
            lives,
            Planted::default(),
            opened.seen,
        );
        world.adapter = adapter.to_string();
        world.branches = opened.branches;
        Ok(world)
    }
}
