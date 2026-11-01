//! Issue #140: the backends every reply names, and the `seam_suite` call for the network seam. The suite plays one match through the
//! seam's local test relay on the correct test backend or the macOS backend (#309), or on a
//! planted backend with one fault, reachable only through the startup argument `--planted`.
//! Issue #309: the `relay_client` call, a test client on the macOS backend joining a match through
//! the relay it is given.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use deep_canvas_seams::network::{self, Reliable, Transport, Wire};
use deep_canvas_seams::Backend;
use deep_relay::macos::{self, check_hello, Connection, Event, Limits};
use deep_relay::wire::{self, Frame, MatchId};
use serde_json::{json, Map, Value};

use crate::hub::Call;

/// The seams' backends that fed a reply: the fonts and the CPU always, and the headless renderer
/// when Vello CPU drew it.
pub fn backends(headless: bool) -> Value {
    let mut fed = vec![
        ("fonts", deep_text::FONTS),
        ("cpu", deep_canvas_seams::cpu(std::env::consts::ARCH)),
    ];
    if headless {
        fed.push(("headless", deep_canvas_seams::HEADLESS));
    }
    deep_canvas_seams::json(&fed)
}

/// A deep_show reply with the backends that fed it.
pub fn named(mut reply: Value) -> Value {
    if let Value::Object(map) = &mut reply {
        map.insert("backends".into(), backends(false));
    }
    reply
}

/// A network backend's one fault.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NetFault {
    DeliversTwice,
    DeliversOutOfOrder,
    SendsBeforeJoin,
    ConnectsUnlistedHost,
    /// #309: the macOS backend handing one message on twice.
    MacosDeliversTwice,
    /// #309: the macOS backend without the hello check.
    SkipsHelloCheck,
    /// #309: the macOS backend writing each frame's `first` big-endian.
    WritesStepBigEndian,
}

impl NetFault {
    pub fn named(name: &str) -> Option<NetFault> {
        Some(match name {
            "net_delivers_twice" => NetFault::DeliversTwice,
            "net_delivers_out_of_order" => NetFault::DeliversOutOfOrder,
            "net_sends_before_join" => NetFault::SendsBeforeJoin,
            "net_connects_unlisted_host" => NetFault::ConnectsUnlistedHost,
            "net_macos_delivers_twice" => NetFault::MacosDeliversTwice,
            "net_skips_hello_check" => NetFault::SkipsHelloCheck,
            "net_writes_step_big_endian" => NetFault::WritesStepBigEndian,
            _ => return None,
        })
    }
}

/// `{"call": "seam_suite", "seam": "network", "messages": n, "seed": n}`, and `"backend":
/// "network.macos"` for the macOS backend.
pub fn parse(c: &Map<String, Value>) -> Option<Call> {
    if c.get("seam")?.as_str()? != "network" {
        return None;
    }
    let macos = match c.get("backend") {
        None => false,
        Some(b) => b.as_str()? == macos::BACKEND.name,
    };
    Some(Call::NetworkSuite {
        macos,
        messages: c
            .get("messages")?
            .as_u64()
            .filter(|n| (1..=1_000_000).contains(n))?,
        seed: c.get("seed")?.as_u64()?,
    })
}

/// A correct backend with one fault planted past the middle of the match.
struct Planted {
    inner: Box<dyn Transport>,
    fault: NetFault,
    handed: u64,
    held: Option<u64>,
    done: bool,
}

/// Messages handed on before a planted fault strikes.
const STRIKE: u64 = 5_000;

impl Transport for Planted {
    fn backend(&self) -> Backend {
        let inner = self.inner.backend();
        Backend {
            name: if inner == macos::BACKEND {
                "network.macos.planted"
            } else {
                "network.test.planted"
            },
            version: inner.version,
        }
    }

    fn connect(&mut self, wire: &mut dyn Wire, relay: &str) {
        self.inner.connect(wire, relay);
        match self.fault {
            NetFault::SendsBeforeJoin => wire.send(network::Frame::Join),
            NetFault::ConnectsUnlistedHost => wire.connect("direct.peer.test"),
            _ => {}
        }
    }

    fn join(&mut self, wire: &mut dyn Wire) {
        self.inner.join(wire);
    }

    fn send(&mut self, id: u64) {
        self.inner.send(id);
    }

    fn step(&mut self, wire: &mut dyn Wire) -> Vec<u64> {
        let mut out = Vec::new();
        for id in self.inner.step(wire) {
            self.handed += 1;
            let strike = !self.done && self.handed >= STRIKE;
            match self.fault {
                NetFault::DeliversTwice if strike => {
                    out.extend([id, id]);
                    self.done = true;
                }
                NetFault::DeliversOutOfOrder if strike => match self.held.take() {
                    None => self.held = Some(id),
                    Some(first) => {
                        out.extend([id, first]);
                        self.done = true;
                    }
                },
                _ => out.push(id),
            }
        }
        out
    }
}

/// The suite's reply: its verdict beside what was sent and delivered and what the relay did.
pub fn network(messages: u64, seed: u64, macos: bool, planted: Option<NetFault>) -> Value {
    let mut backend = None;
    let fault = match planted {
        Some(NetFault::MacosDeliversTwice) => Some(NetFault::DeliversTwice),
        Some(NetFault::SkipsHelloCheck | NetFault::WritesStepBigEndian) => None,
        other => other,
    };
    let report = network::suite(messages, seed, &mut || {
        let inner: Box<dyn Transport> = match macos {
            true => Box::new(macos::Session::default()),
            false => Box::new(Reliable::default()),
        };
        let made: Box<dyn Transport> = match fault {
            None => inner,
            Some(fault) => Box::new(Planted {
                inner,
                fault,
                handed: 0,
                held: None,
                done: false,
            }),
        };
        backend = Some(made.backend());
        made
    });
    let backend = backend.map(|b| json!({"name": b.name, "version": b.version}));
    let c = report.relay;
    json!({
        "seam": "network",
        "suite": "network.conformance@1",
        "backend": backend,
        "status": if report.faults.is_empty() { "PASS" } else { "FAIL" },
        "faults": report.faults,
        "relay": {
            "messages": c.messages, "delayed": c.delayed, "dropped": c.dropped,
            "duplicated": c.duplicated, "reordered": c.reordered,
        },
        "hosts": {"given": report.given, "connected": report.connected},
        "sent_before_join": report.sent_before_join,
        "sent": report.sent,
        "delivered": report.delivered,
    })
}

/// `{"call": "relay_client", "relay", "ca", "match", "players", "frames"}`: one test client on the
/// macOS backend.
pub struct RelayClient {
    relay: String,
    ca: PathBuf,
    game: MatchId,
    players: u8,
    frames: u32,
}

pub fn parse_client(c: &Map<String, Value>) -> Option<Call> {
    Some(Call::RelayClient(Box::new(RelayClient {
        relay: c
            .get("relay")?
            .as_str()
            .filter(|r| r.starts_with("https://"))?
            .to_string(),
        ca: PathBuf::from(c.get("ca")?.as_str()?),
        game: wire::match_id(c.get("match")?.as_str()?)?,
        players: c.get("players")?.as_u64().filter(|p| (2..=8).contains(p))? as u8,
        frames: c
            .get("frames")?
            .as_u64()
            .filter(|n| (1..=100_000).contains(n))? as u32,
    })))
}

/// How a test client's match ended when it didn't exchange.
enum Ended {
    Refused(String),
    Failed(String),
}

/// What crossed a test client's connection.
#[derive(Default)]
struct Crossed {
    hello: Value,
    player: Option<u8>,
    sent: Vec<Vec<u8>>,
    received: Vec<Vec<u8>>,
    /// Frames received per sending player.
    held: BTreeMap<u8, u32>,
}

impl Crossed {
    fn take(&mut self, frame: Vec<u8>) {
        *self
            .held
            .entry(frame.get(16).copied().unwrap_or(u8::MAX))
            .or_default() += 1;
        self.received.push(frame);
    }
}

/// How long a client waits for its seat and for the match's other copies.
const SEATING: Duration = Duration::from_secs(60);
/// net@1's timeout: nothing arriving this long once the match started ends it.
const TIMEOUT: Duration = Duration::from_secs(5);

/// The test client's reply: what the relay's hello answered, how the match ended, every frame sent
/// and received, and the relay suite's reader on what arrived.
pub fn relay_client(c: &RelayClient, planted: Option<NetFault>) -> Value {
    let mut crossed = Crossed::default();
    let ended = exchange(c, planted, &mut crossed);
    let (outcome, reason) = match ended {
        Ok(()) => ("exchanged", Value::Null),
        Err(Ended::Refused(why)) => ("refused", json!(why)),
        Err(Ended::Failed(why)) => ("failed", json!(why)),
    };
    let failures = crossed
        .player
        .map(|me| deep_relay::suite::read(&crossed.received, &c.game, me, c.players))
        .unwrap_or_default();
    let planted_backend = matches!(
        planted,
        Some(NetFault::SkipsHelloCheck | NetFault::WritesStepBigEndian)
    );
    let hexes = |frames: &[Vec<u8>]| frames.iter().map(|f| wire::hex(f)).collect::<Vec<_>>();
    json!({
        "backend": {
            "name": if planted_backend { "network.macos.planted" } else { macos::BACKEND.name },
            "version": macos::BACKEND.version,
        },
        "relay": macos::host(&c.relay),
        "hello": crossed.hello,
        "outcome": outcome,
        "reason": reason,
        "match": wire::hex(&c.game),
        "player": crossed.player,
        "sent": hexes(&crossed.sent),
        "received": hexes(&crossed.received),
        "reader": {"status": if failures.is_empty() { "PASS" } else { "FAIL" }, "failures": failures},
    })
}

/// Connects to the one relay given, checks its hello, joins, and sends frame i as step i alone
/// until it holds as many from every other player; it never moves to another relay.
fn exchange(
    c: &RelayClient,
    planted: Option<NetFault>,
    crossed: &mut Crossed,
) -> Result<(), Ended> {
    let host = macos::host(&c.relay);
    let ca = std::fs::read(&c.ca).map_err(|e| {
        Ended::Failed(format!(
            "the authority {} for the relay {host} can't be read: {e}",
            c.ca.display()
        ))
    })?;
    let (mut conn, hello) = Connection::open(&c.relay, &ca).map_err(Ended::Failed)?;
    crossed.hello = json!({"protocol": hello["protocol"], "digest": hello["digest"]});
    let limits = match check_hello(&host, &hello) {
        Ok(limits) => limits,
        Err(_) if planted == Some(NetFault::SkipsHelloCheck) => Limits {
            frames_per_s: wire::FRAMES_PER_S,
            frame_bytes: wire::FRAME_BYTES,
        },
        Err(why) => {
            conn.close();
            return Err(Ended::Refused(why));
        }
    };
    let game = wire::hex(&c.game);
    let join = json!({"join": {"match": game, "players": c.players, "open": true}});
    conn.send_control(&join).map_err(Ended::Failed)?;
    let seating = Instant::now() + SEATING;
    let me = loop {
        let wait = seating.saturating_duration_since(Instant::now());
        match conn.next(wait).map_err(Ended::Failed)? {
            Some(Event::Control(m)) if m.get("joined").is_some() => {
                crossed.player = m["joined"]["player"].as_u64().map(|p| p as u8);
            }
            Some(Event::Control(m)) if m.get("refused").is_some() => {
                return Err(Ended::Failed(format!(
                    "the relay {host} refused the join to match {game}: {}",
                    m["refused"]
                )));
            }
            Some(Event::Control(m)) if m.get("start").is_some() => {
                if let Some(me) = crossed.player {
                    break me;
                }
            }
            Some(Event::Frame(f)) => crossed.take(f),
            Some(Event::Control(_)) => {}
            None => {
                return Err(Ended::Failed(format!(
                    "the relay {host} started no match {game} within {} s",
                    SEATING.as_secs()
                )))
            }
        }
    };
    // Three quarters of the hello's rate, so the relay never closes it for passing its limits.
    let gap = Duration::from_secs_f64(1.0 / (limits.frames_per_s as f64 * 0.75));
    let peers: Vec<u8> = (0..c.players).filter(|p| *p != me).collect();
    let (mut step, mut due, mut arrived) = (0u32, Instant::now(), Instant::now());
    loop {
        let lowest = peers
            .iter()
            .map(|p| crossed.held.get(p).copied().unwrap_or(0))
            .min()
            .unwrap_or(0);
        if step == c.frames && lowest >= c.frames {
            break;
        }
        if step < c.frames && Instant::now() >= due {
            let frame = Frame {
                game: c.game,
                player: me,
                confirmed: lowest.min(step + 1),
                first: step,
                steps: vec![step.to_le_bytes().to_vec()],
            };
            let mut bytes = frame.encode();
            if planted == Some(NetFault::WritesStepBigEndian) {
                bytes[21..25].copy_from_slice(&step.to_be_bytes());
            }
            conn.send_frame(bytes.clone()).map_err(Ended::Failed)?;
            crossed.sent.push(bytes);
            step += 1;
            due += gap;
        }
        let wait = match step < c.frames {
            true => due
                .saturating_duration_since(Instant::now())
                .min(Duration::from_millis(5)),
            false => Duration::from_millis(20),
        };
        match conn.next(wait).map_err(Ended::Failed)? {
            Some(Event::Frame(f)) => {
                crossed.take(f);
                arrived = Instant::now();
            }
            Some(Event::Control(_)) => {}
            None if lowest < c.frames && arrived.elapsed() >= TIMEOUT => {
                return Err(Ended::Failed(format!(
                    "the relay {host} forwarded nothing of match {game} for {} s, holding {lowest} of {} frames from every player",
                    TIMEOUT.as_secs(),
                    c.frames
                )));
            }
            None => {}
        }
    }
    conn.close();
    Ok(())
}
