//! A piece played headless, a step at a time, with a bot's entries on its input track (#184;
//! canvas primitives: Check input: playtest, Check input: plug-in reads). The replica's play mode
//! (`deep-drive`'s `play`) is this: the piece's own logic items step on the track, and a bot, a
//! policy given as data or a logic item added to this copy of the piece, writes entries with the
//! writer `bot`. It answers the recorded track by hash, the values at the paths asked for at each
//! step, the piece's first trap, the bot's, each step's time, the first step whose fuel passed
//! its class's ceiling, and the piece's full-state hash at every checkpoint and at the end. A
//! replay is the same call with the recorded track and no bot. It judges nothing: the check does.

use std::collections::BTreeMap;
use std::rc::Rc;

use serde_json::{json, Map, Value};
use sha2::Digest as _;

use crate::grid_bot::{Action, Bot as GridBot, Iface};
use crate::piece::{check_in, h64, History};
use crate::world::{track_of, Entry, Given, Record, World};
use crate::Planted;

const F: i64 = 705_600_000;

/// The ID a logic bot takes in the replica's copy of the piece.
const BOT: &str = "bot";

/// The replica's planted faults (#184's twins): its recorded track drops the run's first bot
/// entry; a logic bot's entry made only when its value changes, not its serial; (#1048) the
/// explorer and the descender walk as if the grid had no links.
#[derive(Clone, Copy, Default)]
pub struct Plants {
    pub drops_first_bot_entry: bool,
    pub entry_on_change: bool,
    pub ignores_links: bool,
}

/// A document's logic items as one piece, as the logic module checks one: its seed, its budget
/// class (`/budget/class`, when it names one), controls and items, each program by asset ID with
/// any inlined `wasm` left out; none when it has no logic item.
pub fn piece_of(form: &Value) -> Option<Value> {
    let items: Map<String, Value> = form
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("logic@1"))
        .map(|(id, i)| {
            let mut params = i.get("params").cloned().unwrap_or(json!({}));
            if let Some(p) = params.as_object_mut() {
                p.remove("wasm");
            }
            (id.clone(), json!({"kind": "logic@1", "params": params}))
        })
        .collect();
    if items.is_empty() {
        return None;
    }
    let mut piece = json!({
        "seed": form.get("seed").and_then(Value::as_i64).unwrap_or(0),
        "controls": form.get("controls").cloned().unwrap_or(json!({})),
        "items": items,
    });
    let reads = world_reads(form);
    if !reads.is_empty() {
        piece["world_reads"] = json!(reads);
    }
    if let Some(class) = form.pointer("/budget/class") {
        piece["class"] = class.clone();
    }
    // #192: the libraries the document's pinned packs carry, a provider's library form among
    // them, which its items' `links` reach (#190).
    if let Some(libraries) = form.get("libraries") {
        piece["packs"] = libraries.clone();
    }
    Some(piece)
}

/// #182: each character reading a document's worlds declare as outputs, `<world ID>.<body
/// ID>.<read>` (grounded, sliding or crouched), which a logic item may read; the host steps the
/// worlds and records each one's values on the track.
pub fn world_reads(form: &Value) -> Vec<String> {
    form.get("worlds")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .flat_map(|(w, doc)| {
            doc.get("outputs")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter_map(move |(_, o)| {
                    let read = o.get("read")?.as_str()?;
                    let from = o.get("from")?.as_str()?;
                    matches!(read, "grounded" | "sliding" | "crouched")
                        .then(|| format!("{w}.{from}.{read}"))
                })
        })
        .collect()
}

/// A refusal before any step, naming what.
pub(crate) fn refused(code: &str, what: Value) -> Value {
    json!({"ok": false, "code": code, "what": what})
}

/// A u64 seed, given as a decimal string or a number.
fn seed_of(v: Option<&Value>) -> Option<u64> {
    match v? {
        Value::String(s) => s.parse().ok(),
        Value::Number(n) => n.as_u64(),
        _ => None,
    }
}

/// hash(the run's seed, the control, the step): a policy's pick.
fn pick_hash(seed: u64, control: &str, k: i64) -> u64 {
    let mut b = seed.to_le_bytes().to_vec();
    b.extend(control.as_bytes());
    b.push(0);
    b.extend(k.to_le_bytes());
    h64(&b)
}

fn sha_hex(bytes: &[u8]) -> String {
    sha2::Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The recorded track by hash: sha256 over its entries as JSON, in the track's order. The run's
/// seed is its own evidence beside it.
fn track_hash(entries: &[Value]) -> String {
    sha_hex(&serde_json::to_vec(entries).expect("entries serialize"))
}

/// The piece's full state as one hash: each of its items' deep hashes, in piece order.
fn full(hashes: &Map<String, Value>, ids: &[String]) -> String {
    let mut b = Vec::new();
    for id in ids {
        b.extend(id.as_bytes());
        b.push(b'=');
        b.extend(
            hashes
                .get(id)
                .and_then(Value::as_str)
                .unwrap_or("")
                .as_bytes(),
        );
        b.push(b'\n');
    }
    sha_hex(&b)
}

/// A step's time at or after `t`: the stamp of an entry written for `t`.
fn stamp(t: i64, step: i64) -> i64 {
    (t + step - 1).div_euclid(step) * step
}

/// A policy value's entries on a control: a number's, or a play interface action's gesture.
type Values<'a> = &'a dyn Fn(&str, &Value) -> Result<Vec<Given>, Value>;

/// The policy's entries over the span, each with the writer `bot`: its keys at their times and
/// each pick every `every` seconds, drawn by hash(the run's seed, the control, the step). A value
/// is a number, or (#555) the name of a play interface's action on that control, put as the
/// entries that action's gesture makes (`values`).
fn policy(
    p: &Value,
    seed: u64,
    step: i64,
    steps: i64,
    values: Values<'_>,
) -> Result<Vec<Entry>, Value> {
    let bad = |what: &str| refused("bad_input", json!(format!("bot.policy: {what}")));
    let mut out = Vec::new();
    let mut entry = |t: i64, control: &str, value: &Value| -> Result<(), Value> {
        for value in values(control, value)? {
            out.push(Entry {
                t,
                seq: 0,
                control: control.to_string(),
                value,
                writer: "bot".into(),
                player: 1,
                as_of: None,
                arrived: 0,
            });
        }
        Ok(())
    };
    let end = steps * step;
    for (control, keys) in p
        .get("keys")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        for k in keys
            .as_array()
            .ok_or_else(|| bad("keys are [t, value] pairs"))?
        {
            let (Some(t), Some(v)) = (
                k.get(0).and_then(Value::as_f64),
                k.get(1).filter(|v| v.is_number() || v.is_string()),
            ) else {
                return Err(bad("keys are [t, value] pairs"));
            };
            let t = stamp((t * F as f64).round() as i64, step);
            if t < end {
                entry(t, control, v)?;
            }
        }
    }
    for (control, pick) in p
        .get("pick")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let from: Vec<Value> = pick
            .get("from")
            .and_then(Value::as_array)
            .filter(|f| !f.is_empty() && f.iter().all(|v| v.is_number() || v.is_string()))
            .cloned()
            .ok_or_else(|| bad("a pick draws from a list of values"))?;
        let every = pick
            .get("every")
            .map_or(Some(0.25), Value::as_f64)
            .filter(|e| *e > 0.0)
            .ok_or_else(|| bad("every is seconds"))?;
        let every = (every * F as f64).round() as i64;
        let mut n = 0;
        loop {
            let t = stamp(n * every, step);
            if t >= end {
                break;
            }
            let k = t / step;
            entry(
                t,
                control,
                &from[(pick_hash(seed, control, k) % from.len() as u64) as usize],
            )?;
            n += 1;
        }
    }
    drop(entry);
    out.sort_by(|a, b| (a.t, &a.control).cmp(&(b.t, &b.control)));
    let mut seq: BTreeMap<String, u32> = BTreeMap::new();
    for e in &mut out {
        let s = seq.entry(e.control.clone()).or_default();
        e.seq = *s;
        *s += 1;
    }
    Ok(out)
}

/// The values a player's gesture on a listed row's action writes (Play interface `game.play@1`):
/// on an actions control, its named action's index there with repeat 0; a cell on a point
/// control, a press and a release of its first button there; on a pick on rows, the key in its
/// first set; otherwise the row's first argument, an option's index.
pub(crate) fn gesture(controls: &Value, action: &Action, [_, a, b]: [i32; 3]) -> Vec<Given> {
    let control = &controls[&action.control];
    match control.get("kind").and_then(Value::as_str) {
        Some("actions") => {
            let index = action
                .action
                .as_deref()
                .and_then(|name| {
                    control
                        .get("actions")
                        .and_then(Value::as_object)?
                        .keys()
                        .position(|k| k == name)
                })
                .unwrap_or(0);
            vec![Given::Number(index as f64)]
        }
        Some("point") => {
            let button = control
                .pointer("/buttons/0")
                .and_then(Value::as_str)
                .unwrap_or("primary");
            ["press", "release"]
                .iter()
                .filter_map(|phase| {
                    crate::point::Point::parse(
                        &json!({"phase": phase, "button": button, "cell": [a, b]}),
                    )
                    .map(Given::Point)
                })
                .collect()
        }
        _ if control.get("verb").and_then(Value::as_str) == Some("pick")
            && control.get("rows").is_some() =>
        {
            vec![Given::Pick {
                set: 0,
                key: [i64::from(a), i64::from(b)],
            }]
        }
        _ => vec![Given::Number(f64::from(a))],
    }
}

/// The call's seed, and the piece with the run's seed in place of its own under `piece_seed: run`.
pub(crate) fn seeded(piece: &Value, call: &Value) -> Result<(Value, u64), Value> {
    let seed =
        seed_of(call.get("seed")).ok_or_else(|| refused("bad_input", json!("seed: a u64")))?;
    let mut piece = piece.clone();
    match call
        .get("piece_seed")
        .and_then(Value::as_str)
        .unwrap_or("own")
    {
        "own" => {}
        "run" => piece["seed"] = json!(seed as i64),
        other => {
            return Err(refused(
                "bad_input",
                json!(format!("piece_seed is own or run, not {other}")),
            ))
        }
    }
    Ok((piece, seed))
}

/// Every control a bot names that the piece doesn't declare: refused before any run.
fn undeclared(bot: &Value, declared: &dyn Fn(&str) -> bool) -> Option<String> {
    let names: Vec<String> = if let Some(p) = bot.get("policy") {
        ["keys", "pick"]
            .iter()
            .flat_map(|k| {
                p.get(*k)
                    .and_then(Value::as_object)
                    .into_iter()
                    .flatten()
                    .map(|(c, _)| c.clone())
            })
            .collect()
    } else if let Some(l) = bot.get("logic") {
        l.get("plays")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(_, c)| c.as_str().map(str::to_string))
            .collect()
    } else {
        Vec::new()
    };
    names.into_iter().find(|c| !declared(c))
}

/// Plays `piece` (the logic module's piece: seed, class, controls, items) on `call`: `{seed,
/// piece_seed: own | run, span: seconds | {steps}, bot?: {policy} | {logic}, track?: [entry],
/// values?: [path]}`; `stored` reads an asset's bytes by hash. `frame` sees the world after each
/// of the piece's steps and answers the frame it keeps there, if any. It judges nothing and stops
/// at no failure: the check reads what it recorded.
pub fn play(
    piece: &Value,
    stored: &dyn Fn(&str) -> Option<Vec<u8>>,
    call: &Value,
    plants: Plants,
    frame: &mut dyn FnMut(i64, &World) -> Option<Value>,
) -> Result<Value, Value> {
    let (mut piece, seed) = seeded(piece, call)?;
    let controls = piece.get("controls").cloned().unwrap_or(json!({}));
    let bot = call.get("bot").filter(|b| !b.is_null());
    if let Some(c) = bot.and_then(|b| undeclared(b, &|c| controls.get(c).is_some())) {
        return Err(
            json!({"ok": false, "code": "control_undeclared", "control": c,
                          "what": format!("the bot names the control {c}, which the piece doesn't declare")}),
        );
    }
    if piece.pointer(&format!("/items/{BOT}")).is_some()
        && bot.is_some_and(|b| b.get("logic").is_some())
    {
        return Err(refused(
            "bad_input",
            json!(format!(
                "the piece has an item {BOT}, the ID a logic bot takes"
            )),
        ));
    }
    // A logic bot: one more item on this copy of the piece, at 60 Hz, its plays as arrays of a
    // value and a serial.
    let logic = bot.and_then(|b| b.get("logic"));
    let plays: Vec<(String, String)> = logic
        .and_then(|l| l.get("plays"))
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(n, c)| Some((n.clone(), c.as_str()?.to_string())))
        .collect();
    if let Some(l) = logic {
        let writes: Map<String, Value> = plays
            .iter()
            .map(|(n, _)| (n.clone(), json!({"type": "f64", "count": 2})))
            .collect();
        let mut params = json!({"program": l.get("program").cloned().unwrap_or(Value::Null),
                                "reads": l.get("reads").cloned().unwrap_or(json!([])),
                                "writes": writes, "step_rate": 60});
        if let Some(b) = l.get("budget") {
            params["budget"] = b.clone();
        }
        piece["items"][BOT] = json!({"kind": "logic@1", "params": params});
    }
    let piece = Rc::new(
        check_in(
            &piece,
            &Planted::default(),
            &mut History::new(),
            stored,
            &[],
        )
        .map_err(|r| r.0)?,
    );
    // #555: the play interface, checked against the piece before any step, and a first-party bot
    // that plays it.
    let iface = call
        .get("play")
        .filter(|p| !p.is_null())
        .map(|p| Iface::of(p, &piece))
        .transpose()?;
    let mut walker = bot
        .map(|b| GridBot::of(b, iface.as_ref(), seed))
        .transpose()?
        .flatten();
    if let Some(w) = walker.as_mut() {
        w.ignores_links = plants.ignores_links;
    }
    // #1048: a model bot's replies so far (the call's `rows`), each a row it chose after a step,
    // `[step, action, a, b]`; one the piece doesn't list at that step sends no entry.
    let chosen: BTreeMap<i64, [i32; 3]> = bot
        .filter(|b| b.get("model").is_some())
        .and_then(|_| call.get("rows"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let n: Vec<i64> = r.as_array()?.iter().filter_map(Value::as_i64).collect();
            (n.len() == 4).then(|| (n[0], [n[1] as i32, n[2] as i32, n[3] as i32]))
        })
        .collect();
    if bot.is_some_and(|b| b.get("model").is_some()) && iface.is_none() {
        return Err(refused(
            "bad_input",
            json!("a model bot plays a play interface's listed rows, and the play gives none"),
        ));
    }
    let bot_i = piece
        .items
        .iter()
        .position(|i| i.id == BOT && logic.is_some());
    let own: Vec<usize> = (0..piece.items.len())
        .filter(|i| Some(*i) != bot_i)
        .collect();
    let own_ids: Vec<String> = own.iter().map(|i| piece.items[*i].id.clone()).collect();
    let step = own.first().map_or(F / 60, |i| piece.items[*i].step);
    if own.iter().any(|i| piece.items[*i].step != step) {
        return Err(refused(
            "bad_input",
            json!("a play needs the piece's items at one step rate"),
        ));
    }
    let steps = match call.get("span") {
        None => 120 * F / step,
        Some(Value::Number(s)) => {
            ((s.as_f64().unwrap_or(0.0) * F as f64).round() as i64 + step - 1) / step
        }
        Some(s) => s
            .get("steps")
            .and_then(Value::as_i64)
            .ok_or_else(|| refused("bad_input", json!("span: seconds or {steps}")))?,
    };
    // The paths asked for: `<item>.<array>` of the piece's own items.
    let mut paths = Vec::new();
    for p in call
        .get("values")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let p = p
            .as_str()
            .ok_or_else(|| refused("bad_input", json!("values: array paths")))?;
        let (id, name) = p
            .split_once('.')
            .ok_or_else(|| refused("ref_unresolved", json!(p)))?;
        let i = own
            .iter()
            .copied()
            .find(|i| piece.items[*i].id == id)
            .ok_or_else(|| refused("ref_unresolved", json!(p)))?;
        if !piece.items[i].writes.iter().any(|w| w.name == name) {
            return Err(refused("ref_unresolved", json!(p)));
        }
        paths.push((p.to_string(), i, name.to_string()));
    }
    let mut entries: Vec<Entry> = match call.get("track") {
        None | Some(Value::Null) => Vec::new(),
        Some(t) => t
            .as_array()
            .and_then(|a| a.iter().map(Entry::parse).collect::<Option<_>>())
            .ok_or_else(|| refused("bad_input", json!("track: entries")))?,
    };
    if let Some(p) = bot.and_then(|b| b.get("policy")) {
        // A number is the control's value; a name, an action the play interface declares on
        // that control, as its gesture's entries.
        let values = |control: &str, v: &Value| -> Result<Vec<Given>, Value> {
            let Some(name) = v.as_str() else {
                return Ok(vec![Given::Number(v.as_f64().unwrap_or(0.0))]);
            };
            // #1048: on a text control a string is a commit of that string, not an action's name.
            if controls
                .pointer(&format!("/{control}/kind"))
                .and_then(Value::as_str)
                == Some("text")
            {
                return Ok(vec![Given::Text(name.to_string())]);
            }
            let action = iface
                .as_ref()
                .and_then(|i| i.actions.iter().find(|a| a.name == name && a.control == control))
                .ok_or_else(|| {
                    json!({"ok": false, "code": "action_undeclared", "action": name,
                           "what": format!("the policy puts the action {name} on {control}, which the play interface doesn't declare there")})
                })?;
            Ok(gesture(&controls, action, [0, 0, 0]))
        };
        entries.extend(policy(p, seed, step, steps, &values)?);
    }
    let mut rec = Record {
        ns: Some(Vec::new()),
        ..Default::default()
    };
    let mut world = World::new(
        piece.clone(),
        track_of(&entries),
        false,
        Planted::default(),
        &mut rec,
        None,
    )?;
    let mut values: Vec<Vec<Value>> = vec![Vec::new(); paths.len()];
    let mut fuel: Vec<Vec<i64>> = vec![Vec::new(); own.len()];
    let mut step_times = Vec::new();
    let mut frames = Vec::new();
    // Each play's serial and value as the bot's last step left them: 0 before its first.
    let mut serials = vec![0.0; plays.len()];
    let mut last: Vec<Option<f64>> = vec![None; plays.len()];
    let mut bot_ran = -1;
    // #1048: a soak's readings, every `soak.every` steps: the piece's own logic memories' size.
    let every = call
        .pointer("/soak/every")
        .and_then(Value::as_i64)
        .filter(|e| *e > 0);
    let mut memory = Vec::new();
    for k in 0..steps {
        world.run_through(k * step, &mut rec);
        // A bot step that ran: each play whose serial differs from the step before puts its value
        // on the control as one entry, stamped at the bot's next step.
        if let Some(b) = bot_i.filter(|b| world.lives[*b].last > bot_ran) {
            bot_ran = world.lives[b].last;
            let next = (bot_ran + 1) * piece.items[b].step;
            for (j, (name, control)) in plays.iter().enumerate() {
                let Some(a) = world.array(b, name) else {
                    continue;
                };
                let (Some(v), Some(s)) = (
                    a.first().and_then(Value::as_f64),
                    a.get(1).and_then(Value::as_f64),
                ) else {
                    continue;
                };
                let fresh = if plants.entry_on_change {
                    s != 0.0 && last[j] != Some(v)
                } else {
                    s != serials[j]
                };
                serials[j] = s;
                if fresh {
                    last[j] = Some(v);
                    let seq = world.track.get(control).map_or(0, Vec::len) as u32;
                    let e = Entry {
                        t: next,
                        seq,
                        control: control.clone(),
                        value: Given::Number(v),
                        writer: "bot".into(),
                        player: 1,
                        as_of: None,
                        arrived: 0,
                    };
                    world.append(e)?;
                }
            }
        }
        // A first-party bot's row, or a model bot's listed reply, as the entries a player's
        // gesture on its action's control makes, stamped at the next step; none past the span's
        // last step.
        if let Some(iface) = iface.as_ref() {
            let row = match walker.as_mut() {
                Some(b) => b.act(k, &world, iface),
                None => chosen
                    .get(&k)
                    .copied()
                    .filter(|r| iface.listed(&world).contains(r)),
            };
            if k + 1 < steps {
                if let Some(row) = row {
                    for value in gesture(&controls, &iface.actions[row[0] as usize], row) {
                        let control = iface.actions[row[0] as usize].control.clone();
                        let seq = world.track.get(&control).map_or(0, Vec::len) as u32;
                        world.append(Entry {
                            t: (k + 1) * step,
                            seq,
                            control,
                            value,
                            writer: "bot".into(),
                            player: 1,
                            as_of: None,
                            arrived: 0,
                        })?;
                    }
                }
            }
        }
        let ns: u64 = rec
            .ns
            .as_mut()
            .map(std::mem::take)
            .unwrap_or_default()
            .into_iter()
            .filter(|(i, _)| Some(*i) != bot_i)
            .map(|(_, t)| t)
            .sum();
        step_times.push(ns);
        // Each step's record goes once read: a play keeps no bake.
        rec.steps.clear();
        rec.wholes.clear();
        rec.ranges.clear();
        for (j, i) in own.iter().enumerate() {
            let f = rec
                .fuel
                .get(i)
                .and_then(|f| f.iter().find(|(s, _)| *s == k))
                .map_or(0, |(_, f)| *f);
            fuel[j].push(f);
        }
        rec.fuel.clear();
        for ((_, i, name), v) in paths.iter().zip(&mut values) {
            v.push(world.array(*i, name).map_or(Value::Null, Value::Array));
        }
        if let Some(f) = frame(k, &world) {
            frames.push(f);
        }
        // The sandbox lets no memory grow, so a memory's size is read as a save keeps it: its
        // 64 KiB pages that hold a nonzero byte.
        if every.is_some_and(|e| (k + 1) % e == 0 || k + 1 == steps) {
            let bytes: usize = own
                .iter()
                .map(|i| {
                    let m = world.lives[*i].memory();
                    m.chunks(1 << 16)
                        .filter(|p| p.iter().any(|b| *b != 0))
                        .count()
                        << 16
                })
                .sum();
            memory.push(json!({"step": k, "bytes": bytes}));
        }
    }
    let is_bot = |t: &&Value| bot_i.is_some_and(|b| t["item"] == json!(piece.items[b].id));
    let bot_trap = rec
        .traps
        .iter()
        .find(is_bot)
        .cloned()
        .unwrap_or(Value::Null);
    let trap = rec
        .traps
        .iter()
        .find(|t| !is_bot(t))
        .cloned()
        .unwrap_or(Value::Null);
    let end = full(&world.deep_hashes(), &own_ids);
    // The piece's full state at each checkpoint its items took together, step 0 first.
    let mut at: BTreeMap<i64, Map<String, Value>> = BTreeMap::new();
    for id in &own_ids {
        for (s, h) in rec.deep(id) {
            at.entry(s).or_default().insert(id.clone(), json!(h));
        }
    }
    let checkpoints: Vec<Value> = at
        .iter()
        .filter(|(_, h)| h.len() == own_ids.len())
        .map(|(s, h)| json!({"step": s, "hash": full(h, &own_ids)}))
        .collect();
    let mut track: Vec<Value> = world.entries().iter().map(Entry::to_json).collect();
    if plants.drops_first_bot_entry {
        if let Some(i) = track.iter().position(|e| e["writer"] == "bot") {
            track.remove(i);
        }
    }
    let values: Map<String, Value> = paths
        .into_iter()
        .zip(values)
        .map(|((p, _, _), v)| (p, Value::Array(v)))
        .collect();
    let fuel: Map<String, Value> = own_ids
        .iter()
        .cloned()
        .zip(fuel.into_iter().map(|f| json!(f)))
        .collect();
    let ceilings: Map<String, Value> = own
        .iter()
        .map(|i| {
            (
                piece.items[*i].id.clone(),
                json!(crate::budget::held(piece.class, &piece.items[*i], "app")),
            )
        })
        .collect();
    Ok(json!({
        "ok": true,
        "steps": steps,
        "step": step,
        "track": track_hash(&track),
        "entries": track,
        "values": values,
        "trap": trap,
        "bot_trap": bot_trap,
        "step_times": step_times,
        "fuel": fuel,
        "ceilings": ceilings,
        "checkpoints": checkpoints,
        "final": end,
        "frames": frames,
        "memory": memory,
    }))
}
