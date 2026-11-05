//! The network seam (canvas primitives: Seam and backend), which only the net module uses: a
//! match's messages over https to the relay a piece declares. Its macOS backend is in deep-relay
//! (#309), the web player's comes with the net module (#179); this is the seam, its conformance suite and the correct
//! test backend the suite passes. The suite plays one match between two copies through a local
//! test relay that delays, drops, duplicates and reorders frames by a seed, and needs every message
//! delivered once and in order, nothing sent before the join call and no connection to a host the
//! backend wasn't given.

use std::collections::BTreeMap;

use crate::Backend;

/// The one host the suite gives a backend: its test relay.
pub const RELAY: &str = "relay.test";

/// What a copy sends the relay over its connection, forwarded to the match's other copy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Frame {
    /// The join call's frame.
    Join,
    /// Messages, each its sequence number in the sender's stream and its id.
    Data(Vec<(u64, u64)>),
    /// Every message before this sequence number arrived.
    Ack(u64),
}

/// A copy's side of the network the suite hands a backend.
pub trait Wire {
    /// Opens a connection to `host`.
    fn connect(&mut self, host: &str);
    /// One frame to the relay, which forwards it to the match's other copy.
    fn send(&mut self, frame: Frame);
    /// The frames the relay forwarded that have arrived, in arrival order.
    fn receive(&mut self) -> Vec<Frame>;
}

/// One backend of the network seam.
pub trait Transport {
    fn backend(&self) -> Backend;
    /// Opens the connection to the relay the piece declares.
    fn connect(&mut self, wire: &mut dyn Wire, relay: &str);
    /// Joins the match; nothing may be sent before it.
    fn join(&mut self, wire: &mut dyn Wire);
    /// Queues one message for the match's other copy.
    fn send(&mut self, id: u64);
    /// One step: sends what it owes and hands on, in order, the messages that arrived.
    fn step(&mut self, wire: &mut dyn Wire) -> Vec<u64>;
}

/// The correct test backend: every message carries its sequence number and repeats until the
/// other copy acknowledges it, and the receiver drops what it already has and holds what came
/// early, so drops, duplicates and reorders never reach the piece.
#[derive(Default)]
pub struct Reliable {
    next: u64,
    /// Unacknowledged messages by sequence number: the id and the step it last went out.
    unacked: BTreeMap<u64, (u64, Option<u64>)>,
    expected: u64,
    early: BTreeMap<u64, u64>,
    owe_ack: bool,
    steps: u64,
}

/// Messages one frame carries at most.
const BATCH: usize = 128;
/// How far past the oldest unacknowledged message a sender may go.
const WINDOW: u64 = 1024;
/// Steps before an unacknowledged message goes out again.
const RESEND: u64 = 16;

impl Transport for Reliable {
    fn backend(&self) -> Backend {
        Backend {
            name: "network.test",
            version: "1.0.0",
        }
    }

    fn connect(&mut self, wire: &mut dyn Wire, relay: &str) {
        wire.connect(relay);
    }

    fn join(&mut self, wire: &mut dyn Wire) {
        wire.send(Frame::Join);
    }

    fn send(&mut self, id: u64) {
        self.unacked.insert(self.next, (id, None));
        self.next += 1;
    }

    fn step(&mut self, wire: &mut dyn Wire) -> Vec<u64> {
        self.steps += 1;
        for frame in wire.receive() {
            match frame {
                Frame::Join => {}
                Frame::Data(messages) => {
                    for (seq, id) in messages {
                        if seq >= self.expected {
                            self.early.entry(seq).or_insert(id);
                        }
                    }
                    self.owe_ack = true;
                }
                Frame::Ack(next) => self.unacked = self.unacked.split_off(&next),
            }
        }
        let mut arrived = Vec::new();
        while let Some(id) = self.early.remove(&self.expected) {
            arrived.push(id);
            self.expected += 1;
        }
        let oldest = self.unacked.keys().next().copied().unwrap_or(self.next);
        let steps = self.steps;
        let batch: Vec<(u64, u64)> = self
            .unacked
            .range_mut(oldest..oldest + WINDOW)
            .filter(|(_, (_, last))| last.is_none_or(|l| steps - l >= RESEND))
            .take(BATCH)
            .map(|(seq, (id, last))| {
                *last = Some(steps);
                (*seq, *id)
            })
            .collect();
        if !batch.is_empty() {
            wire.send(Frame::Data(batch));
        }
        if self.owe_ack {
            wire.send(Frame::Ack(self.expected));
            self.owe_ack = false;
        }
        arrived
    }
}

/// The suite's verdict and the evidence it read it from.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Report {
    /// Fault codes: `delivered_twice`, `out_of_order`, `sent_before_join`, `unlisted_host`, `lost`.
    pub faults: Vec<&'static str>,
    pub relay: Counts,
    pub given: Vec<String>,
    pub connected: Vec<String>,
    pub sent_before_join: u64,
    /// Each message's id in the order the sender handed it to its backend.
    pub sent: Vec<u64>,
    /// Each id in the order the receiving backend handed it on, every arrival.
    pub delivered: Vec<u64>,
}

/// What the test relay did: messages are distinct ids it carried; the rest count frames.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub messages: u64,
    pub delayed: u64,
    pub dropped: u64,
    pub duplicated: u64,
    pub reordered: u64,
}

/// The test relay: two copies' connections, frames in flight, and the faults it applies.
struct Relay {
    rng: u64,
    now: u64,
    order: u64,
    connected: Vec<String>,
    /// Per copy: whether it holds a connection to the relay, and whether its join call ran.
    linked: [bool; 2],
    joined: [bool; 2],
    sent_before_join: u64,
    /// Per destination copy: (arrival step, send order, frame).
    flight: [Vec<(u64, u64, Frame)>; 2],
    /// Per destination copy: the latest send order delivered.
    latest: [Option<u64>; 2],
    carried: std::collections::BTreeSet<u64>,
    counts: Counts,
}

impl Relay {
    fn new(seed: u64) -> Relay {
        Relay {
            rng: seed ^ 0x9e37_79b9_7f4a_7c15,
            now: 0,
            order: 0,
            connected: Vec::new(),
            linked: [false; 2],
            joined: [false; 2],
            sent_before_join: 0,
            flight: [Vec::new(), Vec::new()],
            latest: [None; 2],
            carried: Default::default(),
            counts: Counts::default(),
        }
    }

    /// splitmix64: the relay's faults come from the seed alone.
    fn next(&mut self) -> u64 {
        self.rng = self.rng.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.rng;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// True with probability `percent` / 100.
    fn roll(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }

    fn send(&mut self, from: usize, frame: Frame) {
        if !self.joined[from] {
            self.sent_before_join += 1;
            return;
        }
        if !self.linked[from] {
            return;
        }
        if let Frame::Data(messages) = &frame {
            self.carried.extend(messages.iter().map(|(_, id)| *id));
        }
        if self.roll(3) {
            self.counts.dropped += 1;
            return;
        }
        let copies = if self.roll(3) {
            self.counts.duplicated += 1;
            2
        } else {
            1
        };
        for _ in 0..copies {
            let mut delay = 1;
            if self.roll(20) {
                delay += 1 + self.next() % 8;
                self.counts.delayed += 1;
            }
            self.order += 1;
            let order = self.order;
            self.flight[1 - from].push((self.now + delay, order, frame.clone()));
        }
    }

    fn receive(&mut self, to: usize) -> Vec<Frame> {
        let now = self.now;
        let (mut due, rest): (Vec<_>, Vec<_>) =
            self.flight[to].drain(..).partition(|(at, _, _)| *at <= now);
        self.flight[to] = rest;
        due.sort_by_key(|(at, order, _)| (*at, *order));
        due.into_iter()
            .map(|(_, order, frame)| {
                match self.latest[to] {
                    Some(latest) if order < latest => self.counts.reordered += 1,
                    _ => self.latest[to] = Some(order),
                }
                frame
            })
            .collect()
    }
}

/// One copy's port on the test relay.
struct Port<'a> {
    relay: &'a mut Relay,
    side: usize,
}

impl Wire for Port<'_> {
    fn connect(&mut self, host: &str) {
        if !self.relay.connected.iter().any(|h| h == host) {
            self.relay.connected.push(host.to_string());
        }
        if host == RELAY {
            self.relay.linked[self.side] = true;
        }
    }

    fn send(&mut self, frame: Frame) {
        self.relay.send(self.side, frame);
    }

    fn receive(&mut self) -> Vec<Frame> {
        self.relay.receive(self.side)
    }
}

/// Messages the sender hands its backend each step.
const PER_STEP: u64 = 100;
/// Steps the suite keeps going after the last message arrived, for late duplicates.
const SETTLE: u64 = 64;

/// The network seam's conformance suite: two copies made by `make`, one sending `messages`
/// messages to the other through the test relay with `seed`'s faults.
pub fn suite(messages: u64, seed: u64, make: &mut dyn FnMut() -> Box<dyn Transport>) -> Report {
    let mut relay = Relay::new(seed);
    let mut copies = [make(), make()];
    for (side, copy) in copies.iter_mut().enumerate() {
        copy.connect(
            &mut Port {
                relay: &mut relay,
                side,
            },
            RELAY,
        );
    }
    for (side, copy) in copies.iter_mut().enumerate() {
        relay.joined[side] = true;
        copy.join(&mut Port {
            relay: &mut relay,
            side,
        });
    }
    let sent: Vec<u64> = (0..messages)
        .map(|i| (seed % 1_000_000) * 1_000_000_000 + i)
        .collect();
    let mut delivered = Vec::new();
    let [sender, receiver] = &mut copies;
    let limit = messages * 2 + 100_000;
    let mut settled = 0;
    for step in 0..limit {
        relay.now += 1;
        let from = (step * PER_STEP).min(messages) as usize;
        let to = ((step + 1) * PER_STEP).min(messages) as usize;
        for id in &sent[from..to] {
            sender.send(*id);
        }
        sender.step(&mut Port {
            relay: &mut relay,
            side: 0,
        });
        delivered.extend(receiver.step(&mut Port {
            relay: &mut relay,
            side: 1,
        }));
        if delivered.len() as u64 >= messages {
            settled += 1;
            if settled > SETTLE {
                break;
            }
        }
    }
    let mut faults = delivery_faults(&sent, &delivered);
    if relay.sent_before_join > 0 {
        faults.push("sent_before_join");
    }
    if relay.connected.iter().any(|h| h != RELAY) {
        faults.push("unlisted_host");
    }
    relay.counts.messages = relay.carried.len() as u64;
    Report {
        faults,
        relay: relay.counts,
        given: vec![RELAY.to_string()],
        connected: relay.connected,
        sent_before_join: relay.sent_before_join,
        sent,
        delivered,
    }
}

/// What arrived against what was sent: each once, in the order sent, none lost.
fn delivery_faults(sent: &[u64], delivered: &[u64]) -> Vec<&'static str> {
    let order: BTreeMap<u64, usize> = sent.iter().enumerate().map(|(i, id)| (*id, i)).collect();
    let mut seen = std::collections::BTreeSet::new();
    let (mut twice, mut out_of_order) = (false, false);
    let mut last = None;
    for id in delivered {
        if !seen.insert(*id) {
            twice = true;
            continue;
        }
        match order.get(id) {
            Some(at) if last.is_some_and(|l| *at < l) => out_of_order = true,
            Some(at) => last = Some(*at),
            None => {}
        }
    }
    let mut faults = Vec::new();
    if twice {
        faults.push("delivered_twice");
    }
    if out_of_order {
        faults.push("out_of_order");
    }
    if seen.len() < sent.len() || delivered.iter().any(|id| !order.contains_key(id)) {
        faults.push("lost");
    }
    faults
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_correct_backend_passes_through_every_fault() {
        for seed in 1..=3 {
            let r = suite(10_000, seed, &mut || Box::new(Reliable::default()));
            assert_eq!(r.faults, Vec::<&str>::new(), "seed {seed}");
            assert_eq!(r.delivered, r.sent, "seed {seed}");
            assert_eq!(r.relay.messages, 10_000);
            let c = r.relay;
            assert!(
                c.delayed > 0 && c.dropped > 0 && c.duplicated > 0 && c.reordered > 0,
                "{c:?}"
            );
        }
    }

    /// A backend that hands on whatever arrives, with no sequence numbers kept.
    struct Naive(Reliable);

    impl Transport for Naive {
        fn backend(&self) -> Backend {
            self.0.backend()
        }
        fn connect(&mut self, wire: &mut dyn Wire, relay: &str) {
            self.0.connect(wire, relay)
        }
        fn join(&mut self, wire: &mut dyn Wire) {
            self.0.join(wire)
        }
        fn send(&mut self, id: u64) {
            self.0.send(id)
        }
        fn step(&mut self, wire: &mut dyn Wire) -> Vec<u64> {
            let mut out = Vec::new();
            for frame in wire.receive() {
                if let Frame::Data(m) = frame {
                    out.extend(m.into_iter().map(|(_, id)| id));
                }
            }
            out
        }
    }

    #[test]
    fn a_backend_that_trusts_the_relay_fails() {
        // The sender is correct; the receiver hands on whatever the relay forwards.
        let mut made = 0;
        let r = suite(2_000, 1, &mut || {
            made += 1;
            match made {
                1 => Box::new(Reliable::default()),
                _ => Box::new(Naive(Reliable::default())),
            }
        });
        assert!(r.faults.contains(&"delivered_twice"), "{:?}", r.faults);
    }
}
