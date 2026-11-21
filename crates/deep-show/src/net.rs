//! #549: the net module in the app (canvas primitives: Shared play over a relay). The app's own
//! Join prompt, which only a person's click answers; `match`, every copy of a document's match in
//! this process over the test relay, with the net check kinds; `play_match`, this copy's live
//! match through the relay the piece declares, opened by the Join and going straight to the other
//! copy where the network allows; and `sockets`, every connection a match opened in this run.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant};

use deep_canvas::canon::sha256_hex;
use deep_canvas::scope::Event;
use deep_logic::piece::Piece;
use deep_logic::world::rollback::Plant;
use deep_net::card::{self, Card};
use deep_net::play::{Ask, Deliver, Fate, Faults, Held, Hold, Play, Withhold};
use deep_net::prompt::{self, State};
use deep_net::{checks, Change, Config, Copy, Defect, End, Planted, Stepper, FLICKS};
use deep_play::net::Logic;
use deep_relay::direct::{random16, Listener, Peer};
use deep_relay::macos::{check_hello_as, Connection, Event as Arrived};
use deep_relay::wire;
use serde_json::{json, Map, Value};

use crate::hub::{Call, Hub};

/// A panel's Join, held with its scope: where its prompt stands, the press of a person's click
/// on its button, and every connection and request its match opened, each a capability call
/// whose grant is the one host it names.
#[derive(Default)]
pub struct Join {
    state: Option<State>,
    pressed: bool,
    log: Vec<Value>,
    /// #552: the copy `match`'s `on_panel` put on the panel: its drawn form, through its own
    /// `match.me`, and the time it stood at after the match's last step.
    pub(crate) shown: Option<(Value, i64)>,
}

/// What a scenario gives a match: the link each document was opened through (`docs.<id>.link`),
/// and the PEM authority the app's network backend trusts for this run beside the platform's
/// own (`relay_ca`).
pub struct Given {
    links: BTreeMap<String, String>,
    relay_ca: Option<PathBuf>,
}

pub fn given(input: &Map<String, Value>) -> Option<Given> {
    let mut links = BTreeMap::new();
    let docs = input.get("docs").and_then(Value::as_object);
    for (doc, d) in docs.into_iter().flatten() {
        if let Some(link) = d.get("link") {
            links.insert(doc.clone(), link.as_str()?.to_string());
        }
    }
    let relay_ca = match input.get("relay_ca") {
        None => None,
        Some(c) => Some(PathBuf::from(c.as_str()?)),
    };
    Some(Given { links, relay_ca })
}

/// The net module, on logic: a build that leaves logic out leaves it out too.
pub fn module() -> Option<deep_canvas::registry::Module> {
    cfg!(not(feature = "test-leave-out-logic")).then(|| {
        // #550: its check kinds run copies of a document's logic items.
        deep_net::kind::bind(deep_play::net::RUNS);
        deep_net::kind::module()
    })
}

/// The net module's calls: `match`, `play_match`, `sockets` and `replay`.
pub enum NetCall {
    Match(MatchCall),
    Play(PlayCall),
    Sockets,
    Replay(ReplayCall),
}

pub fn parse(name: &str, c: &Map<String, Value>) -> Option<Call> {
    let call = match name {
        "match" => NetCall::Match(parse_match(c)?),
        "play_match" => NetCall::Play(parse_play(c)?),
        "replay" => NetCall::Replay(ReplayCall {
            doc: c.get("doc")?.as_str()?.to_string(),
            track: c.get("track")?.as_array()?.clone(),
            steps: c
                .get("steps")?
                .as_i64()
                .filter(|n| (1..=100_000).contains(n))?,
            hash_every: c
                .get("hash_every")
                .map_or(Some(1), Value::as_i64)
                .filter(|n| *n >= 1)?,
        }),
        _ => NetCall::Sockets,
    };
    Some(Call::Net(Box::new(call)))
}

/// #551: `{"call": "replay", "doc", "track", "steps", "hash_every"}`: the document played alone
/// from its start on `track`, a record's merged track, with no relay and no peer, every canvas
/// module stepped as a match's copy steps it; its full-state hash every `hash_every` steps.
pub struct ReplayCall {
    doc: String,
    track: Vec<Value>,
    steps: i64,
    hash_every: i64,
}

/// `{"call": "match", "doc", "steps", "plays"?, "relay"?, "check"?, "render_back"?}`.
pub struct MatchCall {
    doc: String,
    steps: i64,
    plays: BTreeMap<u8, Vec<Play>>,
    faults: Faults,
    log: bool,
    check: Option<String>,
    /// net.desync's seed: where its planted change lands (#550).
    seed: u64,
    /// #550: a planted change one copy makes, `{player, step, field, add? | flip?, at?}`.
    plant: Option<(u8, Defect)>,
    /// `(player, seconds)` on the relay's clock.
    renders: Vec<(u8, f64)>,
    /// #551: net.budget's hosts (`on`), the seeks after the match (`seek: [{player, step}]`) and
    /// whether logic's rollback ring keeps whole copies (`ring: "full"`).
    on: Vec<String>,
    seeks: Vec<(u8, i64)>,
    full: bool,
    /// #552: the seed of each copy's test source in place of its secure one, the copies' views
    /// asked for, and the copy the document's panel shows after the match.
    secure: Option<u64>,
    views: Vec<crate::matched::ViewAsk>,
    on_panel: Option<u8>,
}

fn plays_of(v: &Value) -> Option<Vec<Play>> {
    v.as_array()?
        .iter()
        .map(|p| {
            Some(Play {
                step: p.get("step")?.as_i64().filter(|s| *s >= 0)?,
                control: p.get("control")?.as_str()?.to_string(),
                value: p.get("value")?.clone(),
                // #550: the players whose copies it goes to, over a direct path.
                to: match p.get("to") {
                    None => None,
                    Some(to) => Some(
                        to.as_array()?
                            .iter()
                            .map(|q| q.as_u64().filter(|q| (1..=8).contains(q)).map(|q| q as u8))
                            .collect::<Option<_>>()?,
                    ),
                },
            })
        })
        .collect()
}

fn flicks(seconds: f64) -> i64 {
    (seconds * FLICKS as f64).round() as i64
}

fn parse_match(c: &Map<String, Value>) -> Option<MatchCall> {
    let player = |v: &Value| v.as_u64().filter(|p| (1..=8).contains(p)).map(|p| p as u8);
    let plays = match c.get("plays") {
        None => BTreeMap::new(),
        Some(p) => p
            .as_object()?
            .iter()
            .map(|(who, list)| {
                Some((
                    who.parse().ok().filter(|p| (1..=8).contains(p))?,
                    plays_of(list)?,
                ))
            })
            .collect::<Option<_>>()?,
    };
    let relay = c.get("relay");
    let holds = match relay.and_then(|r| r.get("hold")) {
        None => Vec::new(),
        Some(h) => h
            .as_array()?
            .iter()
            .map(|h| {
                Some(Hold {
                    player: player(h.get("player")?)?,
                    at: flicks(h.get("at")?.as_f64().filter(|t| *t >= 0.0)?),
                    len: flicks(h.get("for")?.as_f64().filter(|t| *t >= 0.0)?),
                })
            })
            .collect::<Option<_>>()?,
    };
    // #277: `kill`, `freeze` (`[{player, step}]`) and `hide` (`[{player, step, for}]`, seconds).
    let mut fates = Vec::new();
    for (name, list) in ["kill", "freeze", "hide"]
        .iter()
        .filter_map(|n| Some((*n, c.get(*n)?)))
    {
        for f in list.as_array()? {
            let (player, step) = (
                player(f.get("player")?)?,
                f.get("step")?.as_i64().filter(|s| *s >= 0)?,
            );
            fates.push(match name {
                "kill" => Fate::Kill { player, step },
                "freeze" => Fate::Freeze { player, step },
                _ => Fate::Hide {
                    player,
                    step,
                    len: flicks(f.get("for")?.as_f64().filter(|t| *t >= 0.0)?),
                },
            });
        }
    }
    let withhold = match relay.and_then(|r| r.get("withhold")) {
        None => Vec::new(),
        Some(w) => w
            .as_array()?
            .iter()
            .map(|w| {
                Some(Withhold {
                    player: player(w.get("player")?)?,
                    to: player(w.get("to")?)?,
                    last: w.get("last")?.as_i64().filter(|n| *n >= 0)?,
                })
            })
            .collect::<Option<_>>()?,
    };
    let renders = match c.get("render_back") {
        None => Vec::new(),
        Some(r) => r
            .as_array()?
            .iter()
            .map(|r| {
                Some((
                    player(r.get("player")?)?,
                    r.get("t")?.as_f64().filter(|t| *t >= 0.0)?,
                ))
            })
            .collect::<Option<_>>()?,
    };
    Some(MatchCall {
        doc: c.get("doc")?.as_str()?.to_string(),
        steps: c
            .get("steps")?
            .as_i64()
            .filter(|n| (1..=100_000).contains(n))?,
        plays,
        faults: Faults {
            seed: relay
                .and_then(|r| r.get("seed"))
                .map_or(Some(0), Value::as_u64)?,
            drop: relay
                .and_then(|r| r.get("drop"))
                .map_or(Some(0.0), |d| d.as_f64().filter(|d| (0.0..1.0).contains(d)))?,
            holds,
            back: 0,
            // #551: `{up_to: n}` or `{exactly: n}` match steps.
            held: match relay.and_then(|r| r.get("back")) {
                None => None,
                Some(b) => Some(match (b.get("up_to"), b.get("exactly")) {
                    (Some(n), None) => Held::UpTo(n.as_i64().filter(|n| *n >= 0)?),
                    (None, Some(n)) => Held::Exactly(n.as_i64().filter(|n| *n >= 0)?),
                    _ => return None,
                }),
            },
            deliver: match relay.and_then(|r| r.get("deliver")) {
                None => Vec::new(),
                Some(d) => d
                    .as_array()?
                    .iter()
                    .map(|d| {
                        Some(Deliver {
                            player: player(d.get("player")?)?,
                            step: d.get("step")?.as_i64()?,
                            to: player(d.get("to")?)?,
                            at: d.get("at")?.as_i64()?,
                        })
                    })
                    .collect::<Option<_>>()?,
            },
            // #551: each player's one-way latency to the relay, in ms.
            latency: match relay.and_then(|r| r.get("latency")) {
                None => Vec::new(),
                Some(l) => l
                    .as_array()?
                    .iter()
                    .map(|ms| Some(flicks(ms.as_f64().filter(|m| *m >= 0.0)? / 1000.0)))
                    .collect::<Option<_>>()?,
            },
            direct: relay.and_then(|r| r.get("direct")).and_then(Value::as_bool) == Some(true),
            fates,
            withhold,
        },
        log: relay.and_then(|r| r.get("log")).and_then(Value::as_bool) == Some(true),
        check: match c.get("check") {
            None => None,
            Some(k) => Some(k.as_str()?.to_string()),
        },
        seed: c.get("seed").map_or(Some(0), Value::as_u64)?,
        plant: match c.get("plant") {
            None => None,
            Some(p) => Some((
                player(p.get("player")?)?,
                Defect {
                    step: p.get("step")?.as_i64().filter(|s| *s >= 0)?,
                    field: p.get("field")?.as_str()?.to_string(),
                    at: match p.get("at") {
                        None => None,
                        Some(a) => Some(u32::try_from(a.as_u64()?).ok()?),
                    },
                    change: match (p.get("flip"), p.get("add")) {
                        (Some(b), None) => Change::Flip(b.as_u64().filter(|b| *b < 64)? as u32),
                        (None, add) => Change::Add(add.map_or(Some(1.0), Value::as_f64)?),
                        _ => return None,
                    },
                },
            )),
        },
        renders,
        on: match c.get("on") {
            None => vec!["app".to_string()],
            Some(on) => on
                .as_array()?
                .iter()
                .map(|h| {
                    h.as_str()
                        .filter(|h| ["app", "web"].contains(h))
                        .map(str::to_string)
                })
                .collect::<Option<_>>()?,
        },
        seeks: match c.get("seek") {
            None => Vec::new(),
            Some(s) => s
                .as_array()?
                .iter()
                .map(|s| {
                    Some((
                        player(s.get("player")?)?,
                        s.get("step")?.as_i64().filter(|k| *k >= 0)?,
                    ))
                })
                .collect::<Option<_>>()?,
        },
        full: match c.get("ring") {
            None => false,
            Some(r) => r
                .as_str()
                .filter(|r| *r == "full")
                .is_some()
                .then_some(true)?,
        },
        secure: match c.get("secure") {
            None => None,
            Some(s) => Some(s.get("seed")?.as_u64()?),
        },
        views: match c.get("views") {
            None => Vec::new(),
            Some(v) => crate::matched::views_of(v)?,
        },
        on_panel: match c.get("on_panel") {
            None => None,
            Some(p) => Some(player(p)?),
        },
    })
}

/// `{"call": "play_match", "panel", "steps", "plays"?, "link_to"?}`.
pub struct PlayCall {
    panel: String,
    steps: i64,
    plays: Vec<Play>,
    link_to: Option<PathBuf>,
}

fn parse_play(c: &Map<String, Value>) -> Option<PlayCall> {
    Some(PlayCall {
        panel: c.get("panel")?.as_str()?.to_string(),
        steps: c
            .get("steps")?
            .as_i64()
            .filter(|n| (1..=1_000_000).contains(n))?,
        plays: match c.get("plays") {
            None => Vec::new(),
            Some(p) => plays_of(p)?,
        },
        link_to: match c.get("link_to") {
            None => None,
            Some(p) => Some(PathBuf::from(p.as_str()?)),
        },
    })
}

/// A document's match as this copy would play it.
struct Setup {
    cfg: Config,
    card: Card,
    piece: Rc<Piece>,
    track: Vec<Value>,
    /// #551: the document as presented, whose worlds a copy steps beside its logic items.
    doc: Value,
}

/// How long a copy waits for the other's half of a direct path before it plays through the relay.
const DIRECT: Duration = Duration::from_secs(15);
/// How long a copy waits for its seat, and for the match's other copies.
const SEATING: Duration = Duration::from_secs(3600);

/// The host's time since `start`, in flicks.
fn since(start: Instant) -> i64 {
    (start.elapsed().as_nanos() * FLICKS as u128 / 1_000_000_000) as i64
}

impl Hub<'_> {
    /// `doc`'s match: its net item, the start card of this build's copy, its logic items and the
    /// input track recorded before the match.
    fn match_setup(&mut self, doc: &str) -> Result<Setup, Value> {
        let (Some(form), Some(rev)) = (self.forms.get(doc).cloned(), self.presented_doc(doc))
        else {
            return Err(json!({"code": "no_revision"}));
        };
        let Some(cfg) = Config::of(&rev) else {
            return Err(json!({"code": "no_match", "what": "the document has no net@1 item"}));
        };
        let track = self.track_read(doc);
        // #860: a rewind would desync the other players, so a match refuses one, naming it.
        if track.iter().any(|e| e.get("rewind").is_some()) {
            let net = deep_net::kind::item(&rev).map(|(_, item)| item);
            return Err(json!({"code": "rewind.in_match", "match": net.and_then(|n| n.get("id"))}));
        }
        // #551: the ring that misses a page `memory.fill` alone wrote is a page tracker that
        // leaves those pages unmarked.
        let fill = self.scenario.module_planted.as_deref() == Some("net_ring_misses_fill");
        let planted = match fill {
            true => deep_logic::Planted::default()
                .and("tracker_skips_memory_fill")
                .unwrap_or_default(),
            false => deep_logic::Planted::default(),
        };
        let piece = match self.logic_piece_with(&form, &track, &planted) {
            Ok(Some(p)) => Rc::new(p),
            Ok(None) => return Err(json!({"code": "no_logic"})),
            Err(i) => return Err(json!({"code": i.code, "issues": [i.to_json()]})),
        };
        // The document as an export writes it, and the track, each by the hash of its bytes.
        let written = self
            .current(doc)
            .map(|r| r.doc.clone())
            .unwrap_or(rev.clone());
        let (drawn, _) = self.drawing_form(&written);
        let hash = |v: &Value| sha256_hex(&serde_json::to_vec(v).unwrap_or_default());
        let card = Card::of(
            &self.startup.sealed,
            &drawn,
            hash(&drawn),
            // The track's bytes as a web export writes them, so a web player's copy agrees (#551).
            crate::track_call::held_bytes(&track)
                .map_or_else(|| hash(&json!(track)), |b| sha256_hex(&b)),
        );
        Ok(Setup {
            cfg,
            card,
            piece,
            track,
            doc: rev,
        })
    }

    /// The net module's wrong copy, when the scenario's `planted` names one.
    fn net_planted(&self) -> deep_net::Planted {
        let name = self.scenario.module_planted.as_deref().unwrap_or_default();
        deep_net::Planted::named(name).unwrap_or_default()
    }

    /// The net module's calls.
    pub(crate) fn net_call(&mut self, call: &NetCall) -> Value {
        match call {
            NetCall::Match(m) => self.match_call(m),
            NetCall::Play(p) => self.play_match(p),
            NetCall::Replay(r) => self.match_replay(r),
            // `sockets`: every connection and request a match opened in this run.
            NetCall::Sockets => {
                let log = self
                    .scopes
                    .values()
                    .flat_map(|s| s.join.log.iter().cloned());
                json!({"log": log.collect::<Vec<_>>()})
            }
        }
    }

    /// Your input on a panel: the Join prompt's when it lands on its open button, else the
    /// piece's own (#210).
    pub(crate) fn join_or_press(
        &mut self,
        panel: &str,
        event: &Event,
        gesture: &crate::points::Gesture,
    ) -> Option<Value> {
        self.join_input(panel, event, gesture)
            .or_else(|| self.piece_press(panel, event))
    }

    fn join_mut(&mut self, panel: &str) -> Option<&mut Join> {
        self.panel_scope(panel).ok().map(|s| &mut s.join)
    }

    fn opened(&mut self, panel: &str, kind: &str, host: &str, game: &wire::MatchId) {
        let entry = json!({"kind": kind, "host": host, "grant": host, "match": wire::hex(game), "opened_by": "join"});
        if let Some(join) = self.join_mut(panel) {
            join.log.push(entry);
        }
    }

    /// `match`: the document's match, as its `net@1` item declares it, every copy run in this
    /// process over the test relay on the relay's own clock, with no network: each copy's
    /// report and its logic items' steps, the relay's report, a net check's, and what each
    /// asked copy showed at each asked time.
    fn match_call(&mut self, m: &MatchCall) -> Value {
        let s = match self.match_setup(&m.doc) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let planted = self.net_planted();
        let ask = Ask {
            steps: m.steps,
            plays: m.plays.clone(),
            faults: m.faults.clone(),
            planted,
            // #550: the planted copy that stamps a peer's entries with its own player is copy 1;
            // #552's guesser, and its copy whose bits are wrong or never come, copy 2.
            planted_on: match planted {
                Planted::StampsOwnPlayer => Some(1),
                Planted::GuessesFromSeed | Planted::RevealsOtherBits | Planted::WithholdsBits => {
                    Some(2)
                }
                _ => None,
            },
            shows: m.renders.iter().map(|(p, t)| (*p, flicks(*t))).collect(),
            log: m.log,
            defect: m.plant.clone(),
            draw_seed: m.secure.unwrap_or(m.faults.seed),
        };
        let (piece, track, doc) = (s.piece.clone(), s.track.clone(), s.doc.clone());
        let rounds = planted == Planted::HashRoundsFloats;
        let first_bits = planted == Planted::DrawsFromFirstBits;
        let name = self.scenario.module_planted.as_deref();
        let ring = match m.full {
            true => Plant::Full,
            false => name.and_then(Plant::named).unwrap_or_default(),
        };
        // #297: every copy checks each entry to a text control an entry text shows alike.
        let form = self.forms.get(&m.doc).cloned().unwrap_or_default();
        let (ty, lax) = (self.entry_type(&form), self.entry_lax());
        // #277: the catch-up that applies missed messages in arrival order: its logic module takes
        // a step's entries in the order the copy entered them.
        let arrival = name == Some("net_catch_up_in_arrival_order");
        let logic = match arrival {
            true => deep_logic::Planted::default()
                .and("read_region_orders_by_arrival")
                .unwrap_or_default(),
            false => deep_logic::Planted::default(),
        };
        let make = &mut |_: u8| {
            let mut l = Logic::planted(piece.clone(), &track, true, logic)?;
            l.rounds = rounds;
            if first_bits {
                l.draws_wrong(deep_logic::draws::Wrong::FirstBits);
            }
            l.plant_ring(ring);
            l.worlds(&doc)?;
            l.range = deep_play::net::Range::of(&form, ty.clone(), lax);
            Ok(l)
        };
        let run = match m.check.as_deref() {
            None => deep_net::play::play(&s.cfg, &s.card, &ask, make).map(|p| (p, None)),
            Some("net.rollback") => {
                checks::rollback(&s.cfg, &s.card, &ask, make).map(|(p, c)| (p, Some(c)))
            }
            Some("net.budget") => {
                let rev = self.presented_doc(&m.doc).unwrap_or_default();
                let frame_ms = deep_canvas::budget::of(&rev)
                    .and_then(|(_, limits)| limits.cpu_ms)
                    .unwrap_or(deep_logic::budget::FRAME_NS / 1e6);
                checks::budget(&s.cfg, &s.card, &ask, make, frame_ms, &m.on)
                    .map(|(p, c)| (p, Some(c)))
            }
            Some("net.desync") => {
                checks::desync(&s.cfg, &s.card, &ask, make, m.seed).map(|(p, c)| (p, Some(c)))
            }
            Some(_) => return json!({"code": "bad_input", "path": "check"}),
        };
        let (mut played, check) = match run {
            Ok(r) => r,
            Err(e) => return e,
        };
        // #551: each seek after the match, in its copy as the match left it.
        let seeks: Vec<Value> = m
            .seeks
            .iter()
            .filter_map(|(p, step)| {
                let c = played.copies.get_mut(*p as usize - 1)?;
                let mut s = c.seek(*step);
                s["player"] = json!(p);
                Some(s)
            })
            .collect();
        // #552: each copy's merged track, which its views and its readers draw from.
        let tracks: BTreeMap<u8, Vec<Value>> = (played.copies.iter())
            .map(|c| {
                (
                    c.me,
                    c.record()["track"].as_array().cloned().unwrap_or_default(),
                )
            })
            .collect();
        let reads = (s.piece.items.iter()).any(|i| !i.emits.is_empty());
        let mut copies = Vec::new();
        for c in &played.copies {
            let mut report = c.report();
            report.insert("steps".into(), json!(c.sim().rows));
            report.insert("track".into(), json!(s.track));
            // #297: a refusal of an entry text's range names its reason and grapheme.
            if let Some(Value::Array(rows)) = report.get_mut("refused") {
                for row in rows.iter_mut() {
                    let why = row["why"].clone();
                    for k in ["reason", "grapheme", "code_points"] {
                        if let Some(v) = why.get(k) {
                            row[k] = v.clone();
                        }
                    }
                }
            }
            // Every burst and voice this copy's readers made, through its own fog.
            if reads {
                let form = self.copy_form(&m.doc, &tracks[&c.me], &json!(c.me));
                let effects = form.map(|f| self.copy_effects(&m.doc, &f));
                report.insert("effects".into(), effects.map_or_else(|e| e, |e| json!(e)));
            }
            copies.push(Value::Object(report));
        }
        let mut reply = json!({"copies": copies, "relay": played.relay(m.log)});
        let len = s.cfg.step();
        if !m.views.is_empty() {
            match self.copy_views(&m.doc, &m.views, &tracks, len) {
                Ok(v) => reply["views"] = json!(v),
                Err(e) => return e,
            }
        }
        if let Some(me) = m.on_panel {
            let last = played
                .copies
                .iter()
                .find(|c| c.me == me)
                .map_or(0, |c| c.ran() - 1);
            let form = match self.copy_form(
                &m.doc,
                &tracks.get(&me).cloned().unwrap_or_default(),
                &json!(me),
            ) {
                Ok(f) => f,
                Err(e) => return e,
            };
            let panel = self.scenario.docs.get(&m.doc).cloned().unwrap_or_default();
            // That copy joined its match: the panel shows it playing, not the Join prompt.
            if let Some(join) = self.join_mut(&panel) {
                join.shown = Some((form, last.max(0) * len));
                join.state = Some(State::Joined);
            }
        }
        if !m.seeks.is_empty() {
            reply["seeks"] = json!(seeks);
        }
        if let Some(check) = check {
            reply["check"] = check;
        }
        if !m.renders.is_empty() {
            let mut renders = Vec::new();
            for shown in &played.shown {
                // The piece's own layer at the step the copy shows, drawn by render-back: the
                // app's notice is the app's own and never in it.
                let at = shown.step.max(0) * s.cfg.step();
                // #297: a piece whose texts show entries draws each copy's frame from its own
                // merged track.
                let copy = played
                    .copies
                    .get(usize::from(shown.player).saturating_sub(1));
                let mut entries = None;
                let drawn = match copy.filter(|_| crate::entries::shows_entries(&form)) {
                    Some(c) => {
                        let track = c.record()["track"].clone();
                        self.copy_frame(&form, track, shown.player, at)
                            .map(|(sha, shown)| {
                                entries = Some(shown);
                                sha
                            })
                    }
                    None => self.piece_layer(&m.doc, at),
                };
                let sha = match drawn {
                    Ok(sha) => sha,
                    Err(e) => return e,
                };
                let notice = shown.notice.map(|(player, waited)| {
                    json!({"player": player, "since": waited as f64 / FLICKS as f64})
                });
                let mut row = json!({"player": shown.player, "t": shown.t as f64 / FLICKS as f64,
                                     "step": shown.step, "sha256": sha, "notice": notice});
                if let Some(e) = entries {
                    row["shown"] = e;
                }
                renders.push(row);
            }
            reply["renders"] = json!(renders);
        }
        reply
    }

    /// `replay`: the piece alone on a record's track, as a copy steps it, with no network.
    fn match_replay(&mut self, r: &ReplayCall) -> Value {
        let s = match self.match_setup(&r.doc) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let mut sim = match Logic::new(s.piece.clone(), &s.track, false)
            .and_then(|mut l| l.worlds(&s.doc).map(|()| l))
        {
            Ok(sim) => sim,
            Err(e) => return e,
        };
        let len = s.cfg.step();
        let key = |e: &Value| {
            (
                e["t"].as_i64().unwrap_or(0),
                e["player"].as_u64().unwrap_or(0),
                e["seq"].as_u64().unwrap_or(0),
            )
        };
        let mut entries = r.track.clone();
        entries.sort_by_key(key);
        let (mut at, mut hashes) = (0, Vec::new());
        for k in 0..r.steps {
            while let Some(e) = entries.get(at).filter(|e| key(e).0 < (k + 1) * len) {
                if let Err(why) = sim.enter(e) {
                    return json!({"code": "bad_input", "path": "track", "entry": e, "why": why});
                }
                at += 1;
            }
            if let Err(trap) = sim.run(k, (k + 1) * len) {
                return json!({"hashes": hashes, "trap": trap, "step": k});
            }
            if k % r.hash_every == 0 {
                hashes.push(json!({"step": k, "hash": format!("{:016x}", sim.hash())}));
            }
        }
        json!({"hashes": hashes})
    }

    /// The SHA-256 of `doc`'s own layer as render-back draws its current revision at `t`.
    fn piece_layer(&mut self, doc: &str, t: i64) -> Result<String, Value> {
        let unavailable = |why: Value| json!({"code": "render_unavailable", "why": why});
        let Some(session) = self.scenario.sessions.keys().next().cloned() else {
            return Err(unavailable(json!("no session to draw a render-back for")));
        };
        let Some(rev) = self.rev_at(doc, i64::MAX) else {
            return Err(json!({"code": "no_revision"}));
        };
        let drawn = self.render_back(&session, doc, t, rev, None, &Default::default());
        match drawn.pointer("/snapshots/0/sha256").and_then(Value::as_str) {
            Some(sha) => Ok(sha.to_string()),
            None => Err(unavailable(drawn)),
        }
    }

    /// The panel's document and its match, where its net item declares a relay.
    fn join_of(&self, panel: &str) -> Option<(String, Config)> {
        let doc = self.panel_doc(panel)?;
        let cfg = Config::of(&self.presented_doc(&doc)?).filter(|c| !c.host.is_empty())?;
        Some((doc, cfg))
    }

    /// The Join button, in panel px: centred, near the panel's foot.
    fn join_button(&self, panel: &str) -> [f64; 4] {
        let [_, _, w, h] = self.slot(panel).unwrap_or([0.0, 0.0, 640.0, 360.0]);
        [(w / 2.0 - 60.0).max(0.0), (h - 56.0).max(0.0), 120.0, 36.0]
    }

    /// The app's own Join prompt for the panel's piece (Net: relay and Join), drawn by the app
    /// and never the piece: null where the piece declares no relay.
    pub(crate) fn join_prompt(&self, panel: &str) -> Value {
        let Some((_, cfg)) = self.join_of(panel) else {
            return Value::Null;
        };
        let state = self.scopes.get(panel).and_then(|s| s.join.state.clone());
        let mut p = prompt::prompt(
            &cfg.host,
            cfg.players,
            cfg.courtesy,
            &state.unwrap_or(State::Open),
        );
        p["button"] = json!(self.join_button(panel));
        p
    }

    /// An input over the open prompt's button is the prompt's, never the piece's. Only a
    /// person's click joins: a press and a release from hardware, which the input router gives
    /// a gesture serial. One a process posts holds none and leaves the prompt as it was.
    fn join_input(
        &mut self,
        panel: &str,
        event: &Event,
        gesture: &crate::points::Gesture,
    ) -> Option<Value> {
        let (pos, down) = match event {
            Event::Down { pos, .. } => (*pos, true),
            Event::Up(pos) => (*pos, false),
            _ => return None,
        };
        self.join_of(panel)?;
        let open = self.join_mut(panel)?.state.is_none();
        let [x, y, w, h] = self.join_button(panel);
        let over = (x..=x + w).contains(&pos[0]) && (y..=y + h).contains(&pos[1]);
        if !open || !over {
            if !down {
                self.join_mut(panel)?.pressed = false;
            }
            return None;
        }
        if gesture.synthetic {
            return Some(
                json!({"serial": null, "reached": ["join"], "join": self.join_prompt(panel)}),
            );
        }
        let (serial, _) = self.route(panel, event);
        let join = self.join_mut(panel)?;
        if down {
            join.pressed = true;
        } else if std::mem::take(&mut join.pressed) {
            join.state = Some(State::Joined);
        }
        Some(json!({"serial": serial, "reached": ["join"], "join": self.join_prompt(panel)}))
    }

    fn refuse(&mut self, panel: &str, refused: Value, why: String) -> Value {
        let reply = json!({"code": "refused", "refused": refused, "why": why});
        if let Some(join) = self.join_mut(panel) {
            join.state = Some(State::Refused(refused, why));
        }
        reply
    }

    /// `play_match`: this copy's live match, in real time, once a person clicked Join: the
    /// relay's hello checked before anything is sent, the seat, the first player's link, a
    /// direct path where the network allows one, then `steps` match steps, after which this
    /// copy leaves. Its reply is the copy's report with the match's ID and link.
    fn play_match(&mut self, p: &PlayCall) -> Value {
        let Some((doc, _)) = self.join_of(&p.panel) else {
            return json!({"code": "no_match", "what": "the panel's piece declares no relay"});
        };
        match self
            .scopes
            .get(&p.panel)
            .and_then(|s| s.join.state.as_ref())
        {
            Some(State::Joined) => {}
            Some(State::Refused(refused, why)) => {
                return json!({"code": "refused", "refused": refused, "why": why})
            }
            Some(State::Ended(_)) => return json!({"code": "ended"}),
            Some(State::Open) | None => {
                return json!({"code": "not_joined", "what": "only a person's click on Join joins a match"})
            }
        }
        let s = match self.match_setup(&doc) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let cfg = s.cfg.clone();
        // A copy that joins through the first player's link holds that copy's card: one that
        // differs is refused here, before anything is opened.
        let through = self
            .scenario
            .net
            .links
            .get(&doc)
            .and_then(|l| card::parse(l));
        if let Some(m) = through
            .as_ref()
            .and_then(|(_, theirs)| s.card.differs(theirs))
        {
            return self.refuse(&p.panel, m.to_json(), m.text());
        }
        let (game, open) = match (&through, random16()) {
            (Some((game, _)), _) => (*game, false),
            (None, Ok(game)) => (game, true),
            (None, Err(why)) => return json!({"code": "no_random", "why": why}),
        };
        let ca = match &self.scenario.net.relay_ca {
            None => Vec::new(),
            Some(path) => match std::fs::read(path) {
                Ok(pem) => pem,
                Err(e) => {
                    return json!({"code": "bad_input", "path": "relay_ca", "why": e.to_string()})
                }
            },
        };
        // The Join opens the one connection its grant names: the declared relay.
        self.opened(&p.panel, "relay", &cfg.host, &game);
        // #277: a piece whose rules play a changed seat asks for relay@2.
        let protocol = match cfg.seats {
            true => wire::PROTOCOL2,
            false => wire::PROTOCOL,
        };
        let asked = cfg.seats.then_some(protocol);
        let (mut conn, hello) = match Connection::open_for_join(&cfg.relay, &ca, asked) {
            Ok(c) => c,
            Err(why) => return self.refuse(&p.panel, json!("unreachable"), why),
        };
        let limits = match check_hello_as(&cfg.host, &hello, protocol) {
            Ok(l) => l,
            Err(why) => {
                conn.close();
                return self.refuse(&p.panel, json!("relay"), why);
            }
        };
        if (limits.frames_per_s as i64) < cfg.step_rate {
            conn.close();
            let why = format!(
                "refused the relay {}: its hello allows {} frames a second, and this match needs {}, one a match step",
                cfg.host, limits.frames_per_s, cfg.step_rate
            );
            return self.refuse(&p.panel, json!("relay"), why);
        }
        let hex = wire::hex(&game);
        let join = json!({"join": {"match": hex, "players": cfg.players, "open": open}});
        if let Err(why) = conn.send_control(&join) {
            return self.refuse(&p.panel, json!("unreachable"), why);
        }
        let link = format!("deep://piece/{doc}#{}", card::fragment(&game, &s.card));
        // Seated, then every seat taken.
        let seating = Instant::now() + SEATING;
        let mut me = None;
        let mut early: Vec<Vec<u8>> = Vec::new();
        let me = loop {
            let arrived = match conn.next(seating.saturating_duration_since(Instant::now())) {
                Ok(Some(a)) => a,
                Ok(None) => {
                    return self.refuse(
                        &doc,
                        json!("unknown"),
                        format!("the relay {} started no match within an hour", cfg.host),
                    )
                }
                Err(why) => return self.refuse(&p.panel, json!("unreachable"), why),
            };
            match arrived {
                Arrived::Frame(f) => early.push(f),
                Arrived::Control(m) => {
                    if let Some(player) = m.pointer("/joined/player").and_then(Value::as_u64) {
                        me = Some(player as u8 + 1);
                        if let (true, Some(to)) = (open, &p.link_to) {
                            let _ = std::fs::write(to, &link);
                        }
                    } else if let Some(reason) = m.get("refused").and_then(Value::as_str) {
                        conn.close();
                        let State::Refused(refused, why) =
                            prompt::refused_by_relay(&cfg.host, reason)
                        else {
                            return json!({"code": "refused"});
                        };
                        return self.refuse(&p.panel, refused, why);
                    } else if m.get("closed").is_some() {
                        conn.close();
                        if let Some(join) = self.join_mut(&p.panel) {
                            join.state = Some(State::Ended("left".into()));
                        }
                        return json!({"code": "ended", "end": "left", "match": hex, "link": link});
                    } else if let (Some(_), Some(me)) = (m.get("start"), me) {
                        break me;
                    }
                }
            }
        };
        // A direct path to each other copy where the network allows one: the lower-numbered
        // copy listens where it reaches the relay from and says where through the relay.
        let mut direct: BTreeMap<u8, Peer> = BTreeMap::new();
        let mut listener = (me < cfg.players)
            .then(|| conn.local_ip().and_then(|ip| Listener::open(ip).ok()))
            .flatten();
        if let Some(l) = &listener {
            for to in me..cfg.players {
                let signal = json!({"signal": {"match": hex, "to": to, "address": l.address, "offer": l.offer}});
                let _ = conn.send_control(&signal);
            }
        }
        let wanted = cfg.players as usize - 1;
        let patience = Instant::now() + DIRECT;
        let mut ended = None;
        while direct.len() < wanted && Instant::now() < patience && ended.is_none() {
            if let Some((player, peer)) = listener.as_mut().and_then(|l| l.accept(&game)) {
                self.opened(&p.panel, "direct", &peer.host, &game);
                direct.insert(player, peer);
                continue;
            }
            match conn.next(Duration::from_millis(5)) {
                Ok(Some(Arrived::Frame(f))) => {
                    // A copy that gave up on a direct path already plays through the relay.
                    early.push(f);
                    break;
                }
                Ok(Some(Arrived::Control(m))) => {
                    let sig = &m["signal"];
                    let from = sig["from"].as_u64().map(|f| f as u8 + 1);
                    if let (Some(from), Some(address), Some(offer)) =
                        (from, sig["address"].as_str(), sig["offer"].as_str())
                    {
                        if from < me {
                            if let Ok(peer) = Peer::connect(address, &game, offer, me) {
                                self.opened(&p.panel, "direct", &peer.host, &game);
                                direct.insert(from, peer);
                            }
                        }
                    } else if m.get("closed").is_some() {
                        ended = Some("left");
                    }
                }
                Ok(None) => {}
                Err(_) => ended = Some("left"),
            }
        }
        drop(listener);
        let all_direct = direct.len() == wanted;
        // The match, on this copy's clock from here.
        let sim = match Logic::new(s.piece.clone(), &s.track, false)
            .and_then(|mut l| l.worlds(&s.doc).map(|()| l))
        {
            Ok(sim) => sim,
            Err(e) => return e,
        };
        let started = Instant::now();
        let mut copy = Copy::new(
            cfg.clone(),
            s.card.clone(),
            me,
            cfg.players,
            game,
            sim,
            self.net_planted(),
            0,
        );
        copy.limit(p.steps);
        // #552: a draw's bits come from the platform's secure random source.
        copy.draw_source(
            Box::new(|| {
                random16().map_or(0, |b| {
                    u64::from_le_bytes(b[..8].try_into().unwrap_or_default())
                })
            }),
            Default::default(),
        );
        copy.script(
            p.plays
                .iter()
                .map(|q| (q.step, q.control.clone(), q.value.clone(), q.to.clone())),
        );
        if ended.is_some() {
            copy.closed(0, "left");
        }
        for frame in early {
            copy.receive(&frame, since(started));
        }
        let step = cfg.step();
        let mut next_tick = 0;
        let send = |conn: &mut Connection, direct: &mut BTreeMap<u8, Peer>, frame: Vec<u8>| {
            let mut lost = Vec::new();
            for (player, peer) in direct.iter_mut() {
                if peer.send(&frame).is_err() {
                    lost.push(*player);
                }
            }
            // A direct path that broke leaves its copy to the relay.
            let via_relay = !all_direct || !lost.is_empty();
            for player in lost {
                direct.remove(&player);
            }
            !via_relay || conn.send_frame(frame).is_ok()
        };
        let mut relayed = !all_direct;
        // #277: relay@2's messages and the frames of other players' messages the copy forwards.
        let sends = |copy: &mut Copy<Logic>, conn: &mut Connection| {
            let (controls, frames) = copy.sends();
            for m in controls {
                let _ = conn.send_control(&m);
            }
            for f in frames {
                let _ = conn.send_frame(f);
            }
        };
        while !copy.done() {
            let now = since(started);
            let mut gone = Vec::new();
            for (player, peer) in direct.iter_mut() {
                match peer.receive() {
                    Ok(frames) => frames.iter().for_each(|f| copy.receive(f, now)),
                    Err(_) => gone.push(*player),
                }
            }
            for player in gone {
                direct.remove(&player);
                relayed = true;
            }
            if now >= next_tick {
                if let Some(frame) = copy.tick(now) {
                    if !send(&mut conn, &mut direct, frame) {
                        copy.leave();
                    }
                }
                next_tick = (next_tick + step).max(now - step);
                sends(&mut copy, &mut conn);
            }
            if copy.done() {
                break;
            }
            let wait = ((next_tick - since(started)).max(0) as u128 * 1_000_000_000
                / FLICKS as u128) as u64;
            match conn.next(Duration::from_nanos(wait).min(Duration::from_millis(4))) {
                Ok(Some(Arrived::Frame(f))) => {
                    copy.receive(&f, since(started));
                    sends(&mut copy, &mut conn);
                }
                // relay@1's `closed`, and #277's relay@2 messages.
                Ok(Some(Arrived::Control(m))) => {
                    copy.relay(&m, since(started));
                    sends(&mut copy, &mut conn);
                }
                Ok(None) => {}
                Err(_) => copy.leave(),
            }
        }
        let _ = relayed;
        // A match this copy ended says how in its last frame; one it only finished, it leaves.
        if !matches!(copy.end(), None | Some(End::Left)) {
            if let Some(frame) = copy.tick(since(started)) {
                send(&mut conn, &mut direct, frame);
            }
        }
        copy.leave();
        drop(direct);
        conn.close();
        let how = copy.end().map_or("left", End::name);
        if let Some(join) = self.join_mut(&p.panel) {
            join.state = Some(State::Ended(how.to_string()));
        }
        let mut report = copy.report();
        report.insert("match".into(), json!(hex));
        report.insert("link".into(), json!(link));
        report.insert("direct".into(), json!(all_direct));
        Value::Object(report)
    }
}
