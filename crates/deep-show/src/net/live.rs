//! #549, #278: this copy's live match in the app. A person's click on Join opens the one
//! connection the piece declares, and the copy keeps it as its room: `lobby` plays the Join out
//! until so many copies have joined, the app's own Start, which only the first player's click
//! presses, starts a room's match with whoever is there, and `play_match` plays one match on the
//! room's connection, which a finished match leaves open for the next.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use deep_canvas::scope::Event;
use deep_net::card;
use deep_net::prompt::{self, State};
use deep_net::{Config, Copy, End, Planted, FLICKS};
use deep_play::net::Logic;
use deep_relay::direct::{random16, Listener, Peer};
use deep_relay::macos::{check_hello_as, Connection, Event as Arrived};
use deep_relay::wire;
use serde_json::{json, Map, Value};

use super::{since, PlayCall, Setup, DIRECT, SEATING};
use crate::hub::Hub;

/// How often the first player's copy repeats its Start to the relay until the match starts.
const BEGIN_EVERY: Duration = Duration::from_millis(250);

/// The room a copy sits in: its connection to the relay, kept from the Join on.
pub struct Room {
    conn: Connection,
    /// The match ID its copies joined by.
    game: wire::MatchId,
    /// This copy's player, from 1, and the first player's link.
    me: u8,
    link: String,
    /// The seats taken, from 0, as the relay last said.
    seated: Vec<u8>,
    /// The relay's `start` for a match this copy hasn't played yet, and the frames since.
    start: Option<Value>,
    early: Vec<Vec<u8>>,
    /// A person's press on the app's Start: down on its button, and released there.
    down: bool,
    pressed: bool,
    /// The matches this copy played here.
    played: u32,
    /// A copy left before a match started.
    closed: bool,
}

impl Room {
    /// What the relay tells a room between matches: who is seated, a start, a copy that left.
    fn take(&mut self, m: &Value) {
        if let Some(seats) = m.pointer("/seated/seats").and_then(Value::as_array) {
            self.seated = seats
                .iter()
                .filter_map(|s| s.as_u64().map(|s| s as u8))
                .collect();
        } else if let Some(start) = m.get("start") {
            // Frames before a start are the last match's.
            self.early.clear();
            self.start = Some(start.clone());
        } else if m.get("closed").is_some() {
            self.closed = true;
        }
    }

    /// Reads what arrived within `wait`.
    fn pump(&mut self, wait: Duration) -> Result<(), String> {
        let until = Instant::now() + wait;
        loop {
            match self
                .conn
                .next(until.saturating_duration_since(Instant::now()))?
            {
                Some(Arrived::Frame(f)) => self.early.push(f),
                Some(Arrived::Control(m)) => self.take(&m),
                None => return Ok(()),
            }
            if Instant::now() >= until {
                return Ok(());
            }
        }
    }

    /// Whether this copy is the room's first player: the lowest seat taken.
    fn first(&self) -> bool {
        self.seated.first() == Some(&(self.me - 1))
    }

    /// Whether the first player's Start starts this room's next match: a room that starts
    /// within a range of players, or one that has played a match already.
    fn by_start(&self, cfg: &Config) -> bool {
        cfg.ranged || self.played > 0
    }
}

/// `{"call": "lobby", "panel", "until": {"joined"}, "link_to"?}`: this copy's Join, played out
/// until `joined` copies have joined its room.
pub struct LobbyCall {
    panel: String,
    joined: usize,
    link_to: Option<PathBuf>,
}

pub fn parse_lobby(c: &Map<String, Value>) -> Option<LobbyCall> {
    Some(LobbyCall {
        panel: c.get("panel")?.as_str()?.to_string(),
        joined: c
            .get("until")?
            .get("joined")?
            .as_u64()
            .filter(|n| (1..=8).contains(n))? as usize,
        link_to: match c.get("link_to") {
            None => None,
            Some(p) => Some(PathBuf::from(p.as_str()?)),
        },
    })
}

impl Hub<'_> {
    /// Where the panel's Join stands for a call that needs a person's click on it.
    fn joined(&self, panel: &str) -> Result<(), Value> {
        match self.scopes.get(panel).and_then(|s| s.join.state.as_ref()) {
            Some(State::Joined) => Ok(()),
            Some(State::Refused(refused, why)) => {
                Err(json!({"code": "refused", "refused": refused, "why": why}))
            }
            Some(State::Ended(_)) => Err(json!({"code": "ended"})),
            Some(State::Open) | None => Err(
                json!({"code": "not_joined", "what": "only a person's click on Join joins a match"}),
            ),
        }
    }

    /// The Join's one connection, to the relay the piece declares: its hello is checked before
    /// anything is sent.
    fn relay_conn(
        &mut self,
        panel: &str,
        cfg: &Config,
        game: &wire::MatchId,
    ) -> Result<Connection, Value> {
        let ca = match &self.scenario.net.relay_ca {
            None => Vec::new(),
            Some(path) => std::fs::read(path).map_err(
                |e| json!({"code": "bad_input", "path": "relay_ca", "why": e.to_string()}),
            )?,
        };
        // The Join opens the one connection its grant names: the declared relay.
        self.opened(panel, "relay", &cfg.host, game);
        // #277: a piece whose rules play a changed seat asks for relay@2, as a room does (#278).
        let two = cfg.seats || cfg.room();
        let protocol = match two {
            true => wire::PROTOCOL2,
            false => wire::PROTOCOL,
        };
        let (conn, hello) = Connection::open_for_join(&cfg.relay, &ca, two.then_some(protocol))
            .map_err(|why| self.refuse(panel, json!("unreachable"), why))?;
        let limits = match check_hello_as(&cfg.host, &hello, protocol) {
            Ok(l) => l,
            Err(why) => {
                conn.close();
                return Err(self.refuse(panel, json!("relay"), why));
            }
        };
        if (limits.frames_per_s as i64) < cfg.step_rate {
            conn.close();
            let why = format!(
                "refused the relay {}: its hello allows {} frames a second, and this match needs {}, one a match step",
                cfg.host, limits.frames_per_s, cfg.step_rate
            );
            return Err(self.refuse(panel, json!("relay"), why));
        }
        Ok(conn)
    }

    /// The Join, played out to this copy's seat: the connection, the join, the relay's answer
    /// and, for the copy that opened the match, the first player's link.
    fn open_room(
        &mut self,
        panel: &str,
        doc: &str,
        s: &Setup,
        link_to: Option<&PathBuf>,
    ) -> Result<Room, Value> {
        let cfg = &s.cfg;
        // A copy that joins through the first player's link holds that copy's card: one that
        // differs is refused here, before anything is opened.
        let through = self
            .scenario
            .net
            .links
            .get(doc)
            .and_then(|l| card::parse(l));
        if let Some(m) = through
            .as_ref()
            .and_then(|(_, theirs)| s.card.differs(theirs))
        {
            return Err(self.refuse(panel, m.to_json(), m.text()));
        }
        let (game, open) = match (&through, random16()) {
            (Some((game, _)), _) => (*game, false),
            (None, Ok(game)) => (game, true),
            (None, Err(why)) => return Err(json!({"code": "no_random", "why": why})),
        };
        let mut conn = self.relay_conn(panel, cfg, &game)?;
        let hex = wire::hex(&game);
        let mut join = json!({"match": hex, "players": cfg.players, "open": open});
        // #278: a room's join names the copies its match needs before it starts.
        if cfg.room() {
            join["min"] = json!(cfg.min);
        }
        if let Err(why) = conn.send_control(&json!({ "join": join })) {
            return Err(self.refuse(panel, json!("unreachable"), why));
        }
        let link = format!("deep://piece/{doc}#{}", card::fragment(&game, &s.card));
        let mut room = Room {
            conn,
            game,
            me: 0,
            link,
            seated: Vec::new(),
            start: None,
            early: Vec::new(),
            down: false,
            pressed: false,
            played: 0,
            closed: false,
        };
        let seating = Instant::now() + SEATING;
        while room.me == 0 {
            let arrived = match room
                .conn
                .next(seating.saturating_duration_since(Instant::now()))
            {
                Ok(Some(a)) => a,
                Ok(None) => {
                    let why = format!("the relay {} gave no seat within an hour", cfg.host);
                    return Err(self.refuse(panel, json!("unknown"), why));
                }
                Err(why) => return Err(self.refuse(panel, json!("unreachable"), why)),
            };
            match arrived {
                Arrived::Frame(f) => room.early.push(f),
                Arrived::Control(m) => {
                    if let Some(player) = m.pointer("/joined/player").and_then(Value::as_u64) {
                        room.me = player as u8 + 1;
                        if let (true, Some(to)) = (open, link_to) {
                            let _ = std::fs::write(to, &room.link);
                        }
                    } else if let Some(reason) = m.get("refused").and_then(Value::as_str) {
                        room.conn.close();
                        let State::Refused(refused, why) =
                            prompt::refused_by_relay(&cfg.host, reason)
                        else {
                            return Err(json!({"code": "refused"}));
                        };
                        return Err(self.refuse(panel, refused, why));
                    } else {
                        room.take(&m);
                    }
                }
            }
        }
        Ok(room)
    }

    /// The planted module that starts a room's match on the third join, with no click.
    fn starts_alone(&self, room: &mut Room) {
        if self.net_planted() == Planted::StartsOnThirdJoin
            && room.first()
            && room.seated.len() >= 3
        {
            room.pressed = true;
        }
    }

    /// `lobby`: the Join played out until `joined` copies sit in the room: this copy's player
    /// and how many have joined.
    pub(super) fn lobby(&mut self, l: &LobbyCall) -> Value {
        let Some((doc, _)) = self.join_of(&l.panel) else {
            return json!({"code": "no_match", "what": "the panel's piece declares no relay"});
        };
        if let Err(reply) = self.joined(&l.panel) {
            return reply;
        }
        let taken = self.join_mut(&l.panel).and_then(|j| j.room.take());
        let mut room = match taken {
            Some(room) => room,
            None => {
                let s = match self.match_setup(&doc) {
                    Ok(s) => s,
                    Err(e) => return e,
                };
                match self.open_room(&l.panel, &doc, &s, l.link_to.as_ref()) {
                    Ok(room) => room,
                    Err(reply) => return reply,
                }
            }
        };
        let seating = Instant::now() + SEATING;
        while room.seated.len() < l.joined && Instant::now() < seating {
            if let Err(why) = room.pump(Duration::from_millis(50)) {
                return self.refuse(&l.panel, json!("unreachable"), why);
            }
        }
        self.starts_alone(&mut room);
        let reply = json!({"player": room.me, "joined": room.seated.len(),
                           "match": wire::hex(&room.game), "link": room.link});
        if let Some(join) = self.join_mut(&l.panel) {
            join.room = Some(room);
        }
        reply
    }

    /// The app's own Start for the panel's piece, drawn by the app and never the piece: no
    /// member where the piece's match is no room's, null where the app shows none, else
    /// `{state: open | pressed, button, players, text}`. It shows for the room's first player
    /// once enough copies have joined, and again after a match finished.
    pub(crate) fn start_prompt(&mut self, panel: &str) -> Option<Value> {
        let (_, cfg) = self.join_of(panel)?;
        if !cfg.room() {
            return None;
        }
        let button = self.join_button(panel);
        let Some(room) = self.join_mut(panel).and_then(|j| j.room.as_mut()) else {
            return Some(Value::Null);
        };
        let _ = room.pump(Duration::from_millis(1));
        let (n, enough) = (room.seated.len(), room.seated.len() >= cfg.min as usize);
        if !room.first() || !enough || !room.by_start(&cfg) || room.start.is_some() {
            return Some(Value::Null);
        }
        let state = match room.pressed {
            true => "pressed",
            false => "open",
        };
        let text = format!(
            "{n} of {} players have joined. Click Start to begin the match with them.",
            cfg.players
        );
        Some(json!({"state": state, "button": button, "players": n, "text": text}))
    }

    /// The prompt the app's window draws over the panel, never the piece: a room's Start while
    /// the first player may press it, else the Join while nobody has clicked it. Its words, its
    /// button's word and its button in panel px.
    pub(crate) fn window_prompt(
        &mut self,
        panel: &str,
    ) -> Option<(String, &'static str, [f64; 4])> {
        let start = self.start_prompt(panel).unwrap_or(Value::Null);
        let (shown, word) = match start["state"] == "open" {
            true => (start, "Start"),
            false => (self.join_prompt(panel), "Join"),
        };
        let text = shown["text"]
            .as_str()
            .filter(|_| shown["state"] == "open")?;
        Some((text.to_string(), word, self.join_button(panel)))
    }

    /// An input over the open Start's button is the Start's, never the piece's. Only a person's
    /// click presses it: a press and a release from hardware, which the input router gives a
    /// gesture serial. One a process posts holds none and leaves Start as it was.
    pub(super) fn start_input(
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
        let shown = self.start_prompt(panel)?;
        let [x, y, w, h] = self.join_button(panel);
        let over = (x..=x + w).contains(&pos[0]) && (y..=y + h).contains(&pos[1]);
        if shown["state"] != "open" || !over {
            if !down {
                self.join_mut(panel)?.room.as_mut()?.down = false;
            }
            return None;
        }
        if gesture.synthetic {
            return Some(json!({"serial": null, "reached": ["start"], "start": shown}));
        }
        let (serial, _) = self.route(panel, event);
        let room = self.join_mut(panel)?.room.as_mut()?;
        if down {
            room.down = true;
        } else if std::mem::take(&mut room.down) {
            room.pressed = true;
        }
        Some(json!({"serial": serial, "reached": ["start"], "start": self.start_prompt(panel)}))
    }

    /// The relay's start of the room's next match: at once where it came already, else once
    /// every seat is taken or, in a room the first player starts, once that copy's person
    /// pressed Start and the relay answered. The reply to give where there is none.
    fn wait_start(&mut self, panel: &str, cfg: &Config, room: &mut Room) -> Result<Value, Value> {
        let seating = Instant::now() + SEATING;
        let next = random16().map_err(|why| json!({"code": "no_random", "why": why}))?;
        let mut begun: Option<Instant> = None;
        loop {
            if let Err(why) = room.pump(Duration::from_millis(20)) {
                return Err(self.refuse(panel, json!("unreachable"), why));
            }
            if let Some(start) = room.start.take() {
                return Ok(start);
            }
            // Before a match that starts when every seat is taken, a copy that leaves ends it.
            if room.closed && !room.by_start(cfg) {
                if let Some(join) = self.join_mut(panel) {
                    join.state = Some(State::Ended("left".into()));
                }
                return Err(json!({"code": "ended", "end": "left",
                                  "match": wire::hex(&room.game), "link": room.link}));
            }
            if cfg.room() && room.by_start(cfg) && room.first() {
                self.starts_alone(room);
                if !room.pressed || room.seated.len() < cfg.min as usize {
                    return Err(json!({"code": "not_started",
                        "what": "only the first player's click on Start starts this room's match"}));
                }
                if begun.is_none_or(|at| at.elapsed() >= BEGIN_EVERY) {
                    let begin = json!({"match": wire::hex(&room.game), "next": wire::hex(&next)});
                    if let Err(why) = room.conn.send_control(&json!({ "begin": begin })) {
                        return Err(self.refuse(panel, json!("unreachable"), why));
                    }
                    begun = Some(Instant::now());
                }
            }
            if Instant::now() >= seating {
                let why = format!("the relay {} started no match within an hour", cfg.host);
                return Err(self.refuse(panel, json!("unknown"), why));
            }
        }
    }

    /// `play_match`: this copy's live match, in real time, once a person clicked Join: the
    /// relay's hello checked before anything is sent, the seat, the first player's link, a
    /// direct path where the network allows one, then `steps` match steps, after which this
    /// copy leaves. A room's match (#278) starts with whoever is there on the first player's
    /// Start and, once it finished, leaves the room's connection open for the next. Its reply is
    /// the copy's report with the match's ID and link.
    pub(super) fn play_match(&mut self, p: &PlayCall) -> Value {
        let Some((doc, _)) = self.join_of(&p.panel) else {
            return json!({"code": "no_match", "what": "the panel's piece declares no relay"});
        };
        if let Err(reply) = self.joined(&p.panel) {
            return reply;
        }
        let s = match self.match_setup(&doc) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let taken = self.join_mut(&p.panel).and_then(|j| j.room.take());
        let mut room = match taken {
            Some(room) => room,
            None => match self.open_room(&p.panel, &doc, &s, p.link_to.as_ref()) {
                Ok(room) => room,
                Err(reply) => return reply,
            },
        };
        let start = match self.wait_start(&p.panel, &s.cfg, &mut room) {
            Ok(start) => start,
            Err(reply) => {
                // A room whose Start nobody pressed yet stays as it is.
                match reply["code"] == "not_started" {
                    true => {
                        if let Some(join) = self.join_mut(&p.panel) {
                            join.room = Some(room);
                        }
                    }
                    false => room.conn.close(),
                }
                return reply;
            }
        };
        let (reply, again) = self.play_in(p, &s, &mut room, &start);
        match again {
            true => {
                if let Some(join) = self.join_mut(&p.panel) {
                    join.room = Some(room);
                }
            }
            false => room.conn.close(),
        }
        reply
    }

    /// One match on the room's connection, from the relay's `start` to the copy's report, and
    /// whether the room stays for a next match: only a room whose match finished.
    fn play_in(
        &mut self,
        p: &PlayCall,
        s: &Setup,
        room: &mut Room,
        start: &Value,
    ) -> (Value, bool) {
        let cfg = s.cfg.clone();
        let (me, hex) = (room.me, wire::hex(&room.game));
        // #278: a room's start names the seats taken and the ID of the match it starts.
        let game = start["match"]
            .as_str()
            .and_then(wire::match_id)
            .unwrap_or(room.game);
        let seats: Option<Vec<u8>> = start["seats"].as_array().filter(|_| cfg.ranged).map(|a| {
            a.iter()
                .filter_map(|p| p.as_u64().map(|p| p as u8 + 1))
                .collect()
        });
        let late = start["late"] == Value::Bool(true);
        let conn = &mut room.conn;
        // A direct path to each other copy where the network allows one: the lower-numbered
        // copy listens where it reaches the relay from and says where through the relay. A
        // room's copies come and go, so its frames all cross the relay.
        let mut direct: BTreeMap<u8, Peer> = BTreeMap::new();
        let mut listener = (me < cfg.players && !cfg.room())
            .then(|| conn.local_ip().and_then(|ip| Listener::open(ip).ok()))
            .flatten();
        if let Some(l) = &listener {
            for to in me..cfg.players {
                let signal = json!({"signal": {"match": hex, "to": to, "address": l.address, "offer": l.offer}});
                let _ = conn.send_control(&signal);
            }
        }
        let wanted = match cfg.room() {
            true => 0,
            false => cfg.players as usize - 1,
        };
        let patience = Instant::now() + DIRECT;
        let mut ended = None;
        while direct.len() < wanted && Instant::now() < patience && ended.is_none() {
            if let Some((player, peer)) = listener.as_mut().and_then(|l| l.accept(&room.game)) {
                self.opened(&p.panel, "direct", &peer.host, &room.game);
                direct.insert(player, peer);
                continue;
            }
            match conn.next(Duration::from_millis(5)) {
                Ok(Some(Arrived::Frame(f))) => {
                    // A copy that gave up on a direct path already plays through the relay.
                    room.early.push(f);
                    break;
                }
                Ok(Some(Arrived::Control(m))) => {
                    let sig = &m["signal"];
                    let from = sig["from"].as_u64().map(|f| f as u8 + 1);
                    if let (Some(from), Some(address), Some(offer)) =
                        (from, sig["address"].as_str(), sig["offer"].as_str())
                    {
                        if from < me {
                            if let Ok(peer) = Peer::connect(address, &room.game, offer, me) {
                                self.opened(&p.panel, "direct", &peer.host, &room.game);
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
        let all_direct = direct.len() == wanted && !cfg.room();
        // The match, on this copy's clock from here.
        let sim = match Logic::new(s.piece.clone(), &s.track, false)
            .and_then(|mut l| l.worlds(&s.doc).map(|()| l))
        {
            Ok(sim) => sim,
            Err(e) => return (e, false),
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
        copy.script(
            p.plays
                .iter()
                .map(|q| (q.step, q.control.clone(), q.value.clone(), q.to.clone())),
        );
        if let Some(seats) = &seats {
            copy.seat(seats);
        }
        // #278: a copy the relay seated in a running match joins it from its first step.
        if late {
            copy.join(0, start["at"].as_i64().unwrap_or(0));
        }
        if ended.is_some() {
            copy.closed(0, "left");
        }
        for frame in std::mem::take(&mut room.early) {
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
        // What the relay tells the room while its match runs waits for the match's end.
        let mut told: Vec<Value> = Vec::new();
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
            }
            if now >= next_tick {
                if let Some(frame) = copy.tick(now) {
                    if !send(conn, &mut direct, frame) {
                        copy.leave();
                    }
                }
                next_tick = (next_tick + step).max(now - step);
                sends(&mut copy, conn);
            }
            if copy.done() {
                break;
            }
            let wait = ((next_tick - since(started)).max(0) as u128 * 1_000_000_000
                / FLICKS as u128) as u64;
            match conn.next(Duration::from_nanos(wait).min(Duration::from_millis(4))) {
                Ok(Some(Arrived::Frame(f))) => {
                    copy.receive(&f, since(started));
                    sends(&mut copy, conn);
                }
                Ok(Some(Arrived::Control(m)))
                    if m.get("seated").is_some() || m.get("start").is_some() =>
                {
                    told.push(m);
                }
                // relay@1's `closed`, and #277's and #278's relay@2 messages.
                Ok(Some(Arrived::Control(m))) => {
                    copy.relay(&m, since(started));
                    sends(&mut copy, conn);
                }
                Ok(None) => {}
                Err(_) => copy.leave(),
            }
        }
        // A match this copy ended says how in its last frame; one it only finished, it leaves.
        let finished = copy.end() == Some(End::Finished);
        if !matches!(copy.end(), None | Some(End::Left | End::Finished)) {
            if let Some(frame) = copy.tick(since(started)) {
                send(conn, &mut direct, frame);
            }
        }
        // #278: a finished match leaves the room as it is, for the first player's next Start.
        let again = finished
            && conn
                .send_control(&json!({"finished": {"match": wire::hex(&game)}}))
                .is_ok();
        if !again {
            copy.leave();
        }
        drop(direct);
        let how = copy.end().map_or("left", End::name);
        if let (false, Some(join)) = (again, self.join_mut(&p.panel)) {
            join.state = Some(State::Ended(how.to_string()));
        }
        room.played += 1;
        (room.pressed, room.down) = (false, false);
        for m in &told {
            room.take(m);
        }
        let mut report = copy.report();
        report.insert("match".into(), json!(wire::hex(&game)));
        report.insert("link".into(), json!(room.link));
        report.insert("direct".into(), json!(all_direct));
        (Value::Object(report), again)
    }
}
