//! The relay DeepBuild ships, for you to run on one of your own hosts: it keeps only each match's
//! open connections and forwards each frame to that match's other copies, and keeps nothing once a
//! match's last copy leaves. DeepBuild runs no relay and no service.

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

fn hello(planted: Option<Planted>) -> Value {
    let (protocol, digest) = match planted {
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
    let Ok(mut ws) = tungstenite::accept(StreamOwned::new(tls, stream)) else {
        return;
    };
    if ws
        .send(Message::text(hello(state.planted).to_string()))
        .is_err()
        || ws.get_ref().sock.set_read_timeout(Some(POLL)).is_err()
    {
        return;
    }
    let (outbox, inbox) = channel();
    let mut seat: Option<(MatchId, u8)> = None;
    let mut rate = Rate::default();
    let reason = 'conn: loop {
        match ws.read() {
            Ok(Message::Text(text)) => {
                log(state, n, &text, text.as_bytes());
                if let Ok(message) = serde_json::from_str::<Value>(&text) {
                    control(state, &message, &outbox, &mut seat);
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
            if ws.send(message).is_err() {
                break 'conn "left";
            }
        }
    };
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
    outbox: &Sender<Message>,
    seat: &mut Option<(MatchId, u8)>,
) {
    let text = |v: Value| Message::text(v.to_string());
    if let Some(join) = message.get("join") {
        let game = join["match"].as_str().and_then(wire::match_id);
        let players = join["players"].as_u64().filter(|p| (2..=8).contains(p));
        let (Some(game), Some(players), None) = (game, players, *seat) else {
            return;
        };
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
            }),
        };
        let free = held.seats.iter().position(Option::is_none);
        let (Some(player), false) = (free, held.forwarded) else {
            let why = if held.forwarded { "started" } else { "full" };
            let _ = outbox.send(text(json!({"refused": why})));
            return;
        };
        held.seats[player] = Some(outbox.clone());
        *seat = Some((game, player as u8));
        let _ = outbox.send(text(json!({"joined": {"player": player}})));
        if held.seats.iter().all(Option::is_some) {
            for tx in held.seats.iter().flatten() {
                let _ = tx.send(text(json!({"start": {"players": held.players}})));
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
    if frame.len() < wire::HEADER || frame[..16] != game {
        return;
    }
    let mut matches = state.matches.lock().unwrap_or_else(|e| e.into_inner());
    let Some(held) = matches.get_mut(&game) else {
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
    for tx in held.seats.iter().flatten() {
        let _ = tx.send(Message::text(closed.to_string()));
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
