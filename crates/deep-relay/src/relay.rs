//! The relay DeepBuild ships, for you to run on one of your own hosts: it keeps only each match's
//! open connections and forwards each frame to that match's other copies, and keeps nothing once a
//! match's last copy leaves. DeepBuild runs no relay and no service. It speaks relay@1, and relay@2
//! (#277) to a copy that asks for it by the WebSocket subprotocol: then it also hands a copy's
//! `holds`, `seat` and `catch_up` on to its match's other copies, naming the sender. A match
//! whose opening join names `min` is a room (#278): the relay tells its copies who is seated,
//! starts it on the first player's `begin` with whoever is there, hands a Join that comes after
//! the start to the copies (`knock`) and seats it once one says the lobby is open (`admit`), and
//! after a copy says the match `finished` starts the next on the same connections.

use std::collections::btree_map::Entry;
use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rustls::{ServerConfig, ServerConnection, StreamOwned};
use serde_json::{json, Value};
use tungstenite::Message;

use crate::wire::{self, MatchId};

/// A wrong relay reachable only through `deep-relay --planted <name>`, which also prints each
/// message it receives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// Forwards one frame to another match's copies too.
    ForwardsToOtherMatch,
    /// Its hello names relay@2.
    HelloOtherProtocol,
    /// Its hello names relay@1 with another digest.
    HelloOtherDigest,
}

impl Planted {
    pub fn named(name: &str) -> Option<Planted> {
        Some(match name {
            "forwards_to_other_match" => Planted::ForwardsToOtherMatch,
            "hello_other_protocol" => Planted::HelloOtherProtocol,
            "hello_other_digest" => Planted::HelloOtherDigest,
            _ => return None,
        })
    }
}

/// A match the relay holds: its seats, each an open connection's outbox, and whether a frame went.
struct Held {
    players: u8,
    seats: Vec<Option<Sender<Message>>>,
    forwarded: bool,
    /// #278: a room's `min`, the copies its match needs before the first player's Start.
    min: Option<u8>,
    /// The match ID its frames carry: the room's, or the one its last `begin` drew.
    game: MatchId,
    /// The seats its running match started with; empty in the lobby. And the seats whose copies
    /// said that match finished.
    started: Vec<u8>,
    finished: Vec<u8>,
    /// Joins made after the start, each waiting for a copy's word on the lobby, by seat, with
    /// its connection's number.
    knocking: BTreeMap<u8, (u64, Sender<Message>)>,
}

impl Held {
    fn taken(&self) -> Vec<u8> {
        let seats = self.seats.iter().enumerate();
        seats
            .filter_map(|(p, s)| s.as_ref().map(|_| p as u8))
            .collect()
    }

    fn tell(&self, message: &Value) {
        for tx in self.seats.iter().flatten() {
            let _ = tx.send(Message::text(message.to_string()));
        }
    }

    /// The match starts with the seats taken now; a room's start names them and its match ID.
    fn start(&mut self) {
        self.started = self.taken();
        let mut start = json!({"players": self.players});
        if self.min.is_some() {
            start["seats"] = json!(self.started);
            start["match"] = json!(wire::hex(&self.game));
        }
        self.tell(&json!({ "start": start }));
    }
}

#[derive(Default)]
struct State {
    matches: Mutex<BTreeMap<MatchId, Held>>,
    planted: Option<Planted>,
    crossed: AtomicBool,
    connections: AtomicU64,
}

/// How long a connection's read waits before its outbox is written.
const POLL: Duration = Duration::from_millis(2);
const HANDSHAKE: Duration = Duration::from_secs(10);
/// Seconds running past frames_per_s that close a connection.
const RATE_SECONDS: u32 = 3;

/// Serves relay@1 on `listener` until the process is stopped.
pub fn serve(listener: TcpListener, tls: ServerConfig, planted: Option<Planted>) {
    let tls = Arc::new(tls);
    let state = Arc::new(State {
        planted,
        ..State::default()
    });
    for stream in listener.incoming().flatten() {
        let (tls, state) = (tls.clone(), state.clone());
        std::thread::spawn(move || connection(stream, tls, &state));
    }
}

fn hello(planted: Option<Planted>, two: bool) -> Value {
    let (protocol, digest) = match planted {
        _ if two => (
            wire::PROTOCOL2.to_string(),
            wire::digest_of(wire::PROTOCOL2),
        ),
        Some(Planted::HelloOtherProtocol) => ("relay@2".to_string(), wire::digest()),
        Some(Planted::HelloOtherDigest) => (
            "relay@1".to_string(),
            format!("d1:{}", "0123456789abcdef".repeat(4)),
        ),
        _ => (wire::PROTOCOL.to_string(), wire::digest()),
    };
    json!({"hello": {"protocol": protocol, "digest": digest,
        "limits": {"frames_per_s": wire::FRAMES_PER_S, "frame_bytes": wire::FRAME_BYTES}}})
}

/// Frames counted per whole second since the connection's first frame.
#[derive(Default)]
struct Rate {
    start: Option<Instant>,
    second: u64,
    count: u64,
    over: u32,
}

impl Rate {
    /// Counts one frame; true once frames_per_s was passed in each of 3 seconds running.
    fn passed(&mut self) -> bool {
        let start = *self.start.get_or_insert_with(Instant::now);
        self.count_at(start.elapsed().as_secs())
    }

    fn count_at(&mut self, second: u64) -> bool {
        if second != self.second {
            // A quiet second, or one with no frame at all, ends the run.
            if second != self.second + 1 || self.count <= wire::FRAMES_PER_S {
                self.over = 0;
            }
            self.second = second;
            self.count = 0;
        }
        self.count += 1;
        if self.count == wire::FRAMES_PER_S + 1 {
            self.over += 1;
        }
        self.over >= RATE_SECONDS
    }
}

fn connection(stream: TcpStream, tls: Arc<ServerConfig>, state: &State) {
    let n = state.connections.fetch_add(1, Ordering::Relaxed);
    let _ = stream.set_read_timeout(Some(HANDSHAKE));
    let _ = stream.set_nodelay(true);
    let Ok(tls) = ServerConnection::new(tls) else {
        return;
    };
    // #277: a copy that asks for relay@2 by the WebSocket subprotocol gets it.
    let mut two = false;
    let asked = |req: &tungstenite::handshake::server::Request,
                 mut res: tungstenite::handshake::server::Response| {
        let offered = req.headers().get_all("Sec-WebSocket-Protocol");
        let offers = offered.iter().filter_map(|v| v.to_str().ok());
        if offers
            .flat_map(|v| v.split(','))
            .any(|p| p.trim() == wire::SUBPROTOCOL2)
        {
            if let Ok(v) = wire::SUBPROTOCOL2.parse() {
                res.headers_mut().insert("Sec-WebSocket-Protocol", v);
                two = true;
            }
        }
        Ok(res)
    };
    let Ok(mut ws) = tungstenite::accept_hdr(StreamOwned::new(tls, stream), asked) else {
        return;
    };
    if ws
        .send(Message::text(hello(state.planted, two).to_string()))
        .is_err()
        || ws.get_ref().sock.set_read_timeout(Some(POLL)).is_err()
    {
        return;
    }
    let (outbox, inbox) = channel();
    let mut seat: Option<(MatchId, u8)> = None;
    // #278: the room this connection knocked at, until a copy admits or refuses it.
    let mut knocked: Option<MatchId> = None;
    let mut rate = Rate::default();
    let reason = 'conn: loop {
        match ws.read() {
            Ok(Message::Text(text)) => {
                log(state, n, &text, text.as_bytes());
                if let Ok(message) = serde_json::from_str::<Value>(&text) {
                    control(state, &message, (n, &outbox), &mut seat, &mut knocked, two);
                }
            }
            Ok(Message::Binary(frame)) => {
                log(state, n, r#"{"forward":0}"#, &frame);
                if frame.len() as u64 > wire::FRAME_BYTES {
                    break "size";
                }
                if rate.passed() {
                    break "rate";
                }
                if let Some((game, player)) = seat {
                    forward(state, game, player, &frame);
                }
            }
            Ok(Message::Close(_)) => break "left",
            Ok(_) => {}
            Err(tungstenite::Error::Io(e))
                if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => break "left",
        }
        while let Ok(message) = inbox.try_recv() {
            answered(&message, &mut seat, &mut knocked);
            if ws.send(message).is_err() {
                break 'conn "left";
            }
        }
    };
    // A knock answered as its connection ended still took, or freed, its seat.
    while let Ok(message) = inbox.try_recv() {
        answered(&message, &mut seat, &mut knocked);
    }
    if let Some(game) = knocked {
        let mut matches = state.matches.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(held) = matches.get_mut(&game) {
            held.knocking.retain(|_, (conn, _)| *conn != n);
        }
    }
    if let Some((game, player)) = seat {
        leave(state, game, player, reason);
    }
    // A copy that left gets the relay's close back once its seat is gone; one closed for its
    // limits is closed here.
    if reason != "left" {
        let _ = ws.close(None);
    }
    let _ = ws.flush();
}

/// #278: the relay's answer to a knock, as it goes out: `joined` seats the connection, `refused`
/// ends the knock.
fn answered(message: &Message, seat: &mut Option<(MatchId, u8)>, knocked: &mut Option<MatchId>) {
    let (Some(game), Message::Text(text)) = (*knocked, message) else {
        return;
    };
    let Ok(m) = serde_json::from_str::<Value>(text) else {
        return;
    };
    if let Some(player) = m.pointer("/joined/player").and_then(Value::as_u64) {
        *seat = Some((game, player as u8));
        *knocked = None;
    } else if m.get("refused").is_some() {
        *knocked = None;
    }
}

/// With --planted, one stdout line per message received: its name and bytes.
fn log(state: &State, n: u64, text: &str, bytes: &[u8]) {
    if state.planted.is_none() {
        return;
    }
    let name = serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|v| v.as_object().and_then(|o| o.keys().next().cloned()))
        .unwrap_or_else(|| "unknown".into());
    println!(
        "{}",
        json!({"conn": n, "received": name, "bytes": wire::hex(bytes)})
    );
}

fn control(
    state: &State,
    message: &Value,
    (conn, outbox): (u64, &Sender<Message>),
    seat: &mut Option<(MatchId, u8)>,
    knocked: &mut Option<MatchId>,
    two: bool,
) {
    let text = |v: Value| Message::text(v.to_string());
    if let Some(join) = message.get("join") {
        let game = join["match"].as_str().and_then(wire::match_id);
        let players = join["players"].as_u64().filter(|p| (2..=8).contains(p));
        let (Some(game), Some(players), None, None) = (game, players, *seat, *knocked) else {
            return;
        };
        // #278: a room's opening join names `min`, on relay@2 alone.
        let min = join["min"]
            .as_u64()
            .filter(|m| two && (1..=players).contains(m))
            .map(|m| m as u8);
        let mut matches = state.matches.lock().unwrap_or_else(|e| e.into_inner());
        let held = match matches.entry(game) {
            Entry::Occupied(held) => held.into_mut(),
            Entry::Vacant(_) if join["open"] != Value::Bool(true) => {
                let _ = outbox.send(text(json!({"refused": "unknown"})));
                return;
            }
            Entry::Vacant(at) => at.insert(Held {
                players: players as u8,
                seats: (0..players).map(|_| None).collect(),
                forwarded: false,
                min,
                game,
                started: Vec::new(),
                finished: Vec::new(),
                knocking: BTreeMap::new(),
            }),
        };
        let free = (0..held.players)
            .find(|p| held.seats[*p as usize].is_none() && !held.knocking.contains_key(p));
        let running = match held.min {
            Some(_) => !held.started.is_empty(),
            None => held.forwarded,
        };
        let player = match (free, running) {
            (Some(player), false) => player as usize,
            // #278: a Join to a room's running match waits for a copy's word on its lobby.
            (Some(player), true) if two && held.min.is_some() => {
                held.knocking.insert(player, (conn, outbox.clone()));
                *knocked = Some(game);
                let knock = json!({"knock": {"match": wire::hex(&held.game), "player": player}});
                held.tell(&knock);
                return;
            }
            _ => {
                let why = if running { "started" } else { "full" };
                let _ = outbox.send(text(json!({"refused": why})));
                return;
            }
        };
        held.seats[player] = Some(outbox.clone());
        *seat = Some((game, player as u8));
        let _ = outbox.send(text(json!({"joined": {"player": player}})));
        match held.min {
            // A room tells its copies who is seated; one of a single count starts when full.
            Some(min) => {
                held.tell(&json!({"seated": {"match": wire::hex(&game), "seats": held.taken()}}));
                if min == held.players && held.seats.iter().all(Option::is_some) {
                    held.start();
                }
            }
            None if held.seats.iter().all(Option::is_some) => held.start(),
            None => {}
        }
    } else if let (true, Some((game, from)), Some(room)) = (
        two,
        *seat,
        ["begin", "admit", "finished"]
            .into_iter()
            .find(|k| message.get(*k).is_some()),
    ) {
        let mut matches = state.matches.lock().unwrap_or_else(|e| e.into_inner());
        let Some(held) = matches.get_mut(&game).filter(|h| h.min.is_some()) else {
            return;
        };
        let m = &message[room];
        match room {
            // #278: the first player's Start: the match starts with the seats taken, under the
            // match ID that copy drew for it.
            "begin" => {
                let first = held.taken().first() == Some(&from);
                let enough = held.taken().len() >= held.min.unwrap_or(held.players) as usize;
                if first && enough && held.started.is_empty() {
                    if let Some(next) = m["next"].as_str().and_then(wire::match_id) {
                        held.game = next;
                    }
                    held.start();
                }
            }
            // A copy's word on a knock: the lobby is open, and the Join takes its seat and the
            // running match's start, or it is refused as a Join after the start is.
            "admit" => {
                let player = m["player"].as_u64().unwrap_or(u64::MAX) as u8;
                let Some((_, tx)) = held.knocking.remove(&player) else {
                    return;
                };
                if m["open"] != Value::Bool(true) {
                    let _ = tx.send(text(json!({"refused": "started"})));
                    return;
                }
                let _ = tx.send(text(json!({"joined": {"player": player}})));
                let start = json!({"players": held.players, "seats": held.started,
                                   "match": wire::hex(&held.game), "late": true, "at": m["at"]});
                let _ = tx.send(text(json!({ "start": start })));
                held.seats[player as usize] = Some(tx);
            }
            // The match finished: once every copy still seated says so, the room is a lobby
            // again, on the same connections, and forwards no more of that match's frames.
            _ => {
                if m["match"].as_str() != Some(&wire::hex(&held.game)) || held.started.is_empty() {
                    return;
                }
                held.finished.push(from);
                if held.taken().iter().all(|p| held.finished.contains(p)) {
                    held.started.clear();
                    held.finished.clear();
                    let seated = json!({"match": wire::hex(&game), "seats": held.taken()});
                    held.tell(&json!({ "seated": seated }));
                }
            }
        }
    } else if let (true, Some((game, from)), Some(key)) = (
        two,
        *seat,
        ["holds", "seat", "catch_up"]
            .into_iter()
            .find(|k| message.get(*k).is_some()),
    ) {
        // #277: relay@2's messages go to the match's other copies, naming the sender, and
        // nowhere else.
        let mut handed = message[key].clone();
        handed["sender"] = json!(from);
        let text = json!({ key: handed }).to_string();
        let matches = state.matches.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(held) = matches.get(&game) {
            for (player, tx) in held.seats.iter().enumerate() {
                if let (Some(tx), true) = (tx, player != from as usize) {
                    let _ = tx.send(Message::text(text.clone()));
                }
            }
        }
    } else if let (Some(signal), Some((game, from))) = (message.get("signal"), *seat) {
        let to = signal["to"].as_u64().unwrap_or(u64::MAX) as usize;
        let mut handed = signal.clone();
        handed["from"] = json!(from);
        if let Some(map) = handed.as_object_mut() {
            map.remove("to");
        }
        let matches = state.matches.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(Some(tx)) = matches.get(&game).and_then(|h| h.seats.get(to)) {
            let _ = tx.send(text(json!({"signal": handed})));
        }
    }
}

/// A frame of the sender's match goes to that match's other copies, and nowhere else.
fn forward(state: &State, game: MatchId, from: u8, frame: &[u8]) {
    if frame.len() < wire::HEADER {
        return;
    }
    let mut matches = state.matches.lock().unwrap_or_else(|e| e.into_inner());
    // #278: a room's frames carry the ID of the match it plays now, and none crosses its lobby.
    let running = |h: &Held| h.min.is_none() || !h.started.is_empty();
    let Some(held) = (matches.get_mut(&game)).filter(|h| frame[..16] == h.game && running(h))
    else {
        return;
    };
    held.forwarded = true;
    for (player, tx) in held.seats.iter().enumerate() {
        if let (Some(tx), true) = (tx, player != from as usize) {
            let _ = tx.send(Message::binary(frame.to_vec()));
        }
    }
    if state.planted == Some(Planted::ForwardsToOtherMatch)
        && !state.crossed.load(Ordering::Relaxed)
    {
        if let Some((_, other)) = matches
            .iter()
            .find(|(id, h)| **id != game && h.seats.iter().any(Option::is_some))
        {
            for tx in other.seats.iter().flatten() {
                let _ = tx.send(Message::binary(frame.to_vec()));
            }
            state.crossed.store(true, Ordering::Relaxed);
        }
    }
}

/// A copy's seat goes; the match's other copies hear why, and a match with no copy left is gone.
fn leave(state: &State, game: MatchId, player: u8, reason: &str) {
    let mut matches = state.matches.lock().unwrap_or_else(|e| e.into_inner());
    let Some(held) = matches.get_mut(&game) else {
        return;
    };
    held.seats[player as usize] = None;
    let closed = json!({"closed": {"match": wire::hex(&game), "player": player, "reason": reason}});
    held.tell(&closed);
    // #278: a room's lobby hears who is still seated.
    if held.min.is_some() && held.started.is_empty() {
        held.tell(&json!({"seated": {"match": wire::hex(&game), "seats": held.taken()}}));
    }
    if held.seats.iter().all(Option::is_none) {
        matches.remove(&game);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_seconds_running_past_the_rate_close_a_connection() {
        let flood =
            |rate: &mut Rate, second: u64, frames: u64| (0..frames).any(|_| rate.count_at(second));
        let mut rate = Rate::default();
        assert!(!flood(&mut rate, 0, 300) && !flood(&mut rate, 1, 300));
        assert!(
            flood(&mut rate, 2, 300),
            "the third second running closes it"
        );
        // A quiet second in between starts the run again.
        let mut rate = Rate::default();
        assert!(!flood(&mut rate, 0, 300) && !flood(&mut rate, 1, 300));
        assert!(
            !flood(&mut rate, 2, 100) && !flood(&mut rate, 3, 300) && !flood(&mut rate, 4, 300)
        );
        assert!(flood(&mut rate, 5, 300));
    }
}
