//! Issue #140: the backends every reply names, and the `seam_suite` call for the network seam. The suite plays one match through the
//! seam's local test relay on the correct test backend, or on a planted backend with one fault,
//! reachable only through the startup argument `--planted`.

use deep_canvas_seams::network::{self, Reliable, Transport, Wire};
use deep_canvas_seams::Backend;
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
}

impl NetFault {
    pub fn named(name: &str) -> Option<NetFault> {
        Some(match name {
            "net_delivers_twice" => NetFault::DeliversTwice,
            "net_delivers_out_of_order" => NetFault::DeliversOutOfOrder,
            "net_sends_before_join" => NetFault::SendsBeforeJoin,
            "net_connects_unlisted_host" => NetFault::ConnectsUnlistedHost,
            _ => return None,
        })
    }
}

/// `{"call": "seam_suite", "seam": "network", "messages": n, "seed": n}`.
pub fn parse(c: &Map<String, Value>) -> Option<Call> {
    if c.get("seam")?.as_str()? != "network" {
        return None;
    }
    Some(Call::NetworkSuite {
        messages: c
            .get("messages")?
            .as_u64()
            .filter(|n| (1..=1_000_000).contains(n))?,
        seed: c.get("seed")?.as_u64()?,
    })
}

/// The correct test backend with one fault planted past the middle of the match.
struct Planted {
    inner: Reliable,
    fault: NetFault,
    handed: u64,
    held: Option<u64>,
    done: bool,
}

/// Messages handed on before a planted fault strikes.
const STRIKE: u64 = 5_000;

impl Transport for Planted {
    fn backend(&self) -> Backend {
        Backend {
            name: "network.test.planted",
            version: "1.0.0",
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
pub fn network(messages: u64, seed: u64, planted: Option<NetFault>) -> Value {
    let mut backend = None;
    let report = network::suite(messages, seed, &mut || {
        let made: Box<dyn Transport> = match planted {
            None => Box::new(Reliable::default()),
            Some(fault) => Box::new(Planted {
                inner: Reliable::default(),
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
