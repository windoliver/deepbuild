//! The relay suite (#309): what any relay that speaks relay@1 must pass, the shipped relay in the
//! local preflight among them. It plays matches through the relay with test copies on the macOS
//! backend's connection: joining and its refusals, forwarding only within a match, keeping nothing
//! once a match ends, and closing a connection that passes its limits. Its report carries every
//! frame each connection sent and received, so nobody has to take its verdict alone. The reader
//! here reads frames in relay@1's layout; test clients run it on what they received.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::macos::{check_hello, Connection, Event, Limits};
use crate::wire::{self, Frame, MatchId};

/// The relay suite's reader: every frame a copy of `game` received, read field by field. Each
/// failure names the field and the sending client as `player <n>`.
pub fn read(frames: &[Vec<u8>], game: &MatchId, me: u8, players: u8) -> Vec<String> {
    let mut failures = Vec::new();
    // Per sending player: the step after its latest, and its latest confirmed.
    let mut seen: BTreeMap<u8, (u64, u32)> = BTreeMap::new();
    for (i, bytes) in frames.iter().enumerate() {
        let f = match Frame::decode(bytes) {
            Ok(f) => f,
            Err(e) => {
                let from = bytes
                    .get(16)
                    .map_or("an unknown player".into(), |p| format!("player {p}"));
                failures.push(format!("frame {i} from {from}: {e} (field count)"));
                continue;
            }
        };
        let who = format!("frame {i} from player {}", f.player);
        if f.game != *game {
            failures.push(format!(
                "{who}: field match {}, not this copy's match {}",
                wire::hex(&f.game),
                wire::hex(game)
            ));
            continue;
        }
        if f.player == me || f.player >= players {
            failures.push(format!(
                "{who}: field player {} isn't another seat of {players}",
                f.player
            ));
            continue;
        }
        let (next, confirmed) = seen.get(&f.player).copied().unwrap_or_default();
        let end = f.first as u64 + f.steps.len() as u64;
        if f.steps.is_empty() {
            failures.push(format!("{who}: field count 0, a frame with no step"));
        }
        if f.first as u64 > next {
            failures.push(format!(
                "{who}: field first {} leaves a gap after step {next}",
                f.first
            ));
        }
        if f.confirmed < confirmed || f.confirmed as u64 > end {
            failures.push(format!("{who}: field confirmed {} after {confirmed}, with the frame's steps ending at {end}", f.confirmed));
        }
        seen.insert(f.player, (next.max(end), f.confirmed.max(confirmed)));
    }
    failures.truncate(50);
    failures
}

/// One of the suite's connections and what crossed it.
struct Copy {
    conn: Option<Connection>,
    game: MatchId,
    join: Value,
    player: u8,
    sent: Vec<Vec<u8>>,
    received: Vec<Vec<u8>>,
    controls: Vec<Value>,
}

impl Copy {
    fn json(&self) -> Value {
        let hexes = |frames: &[Vec<u8>]| frames.iter().map(|f| wire::hex(f)).collect::<Vec<_>>();
        json!({"match": wire::hex(&self.game), "join": self.join,
            "sent": hexes(&self.sent), "received": hexes(&self.received)})
    }

    /// Takes what arrived within `wait`.
    fn drain(&mut self, wait: Duration) -> Result<(), String> {
        let Some(conn) = self.conn.as_mut() else {
            return Ok(());
        };
        let mut wait = wait;
        while let Some(event) = conn.next(wait)? {
            match event {
                Event::Frame(f) => self.received.push(f),
                Event::Control(c) => self.controls.push(c),
            }
            wait = Duration::from_millis(1);
        }
        Ok(())
    }

    /// Waits for a control message with `key`.
    fn control(&mut self, key: &str, wait: Duration) -> Result<Option<Value>, String> {
        let until = Instant::now() + wait;
        loop {
            if let Some(at) = self.controls.iter().position(|c| c.get(key).is_some()) {
                return Ok(Some(self.controls.remove(at)));
            }
            if Instant::now() >= until || self.conn.is_none() {
                return Ok(None);
            }
            self.drain(Duration::from_millis(20))?;
        }
    }

    fn send(&mut self, frame: Frame) -> Result<(), String> {
        let bytes = frame.encode();
        if let Some(conn) = self.conn.as_mut() {
            conn.send_frame(bytes.clone())?;
        }
        self.sent.push(bytes);
        Ok(())
    }

    /// The frame for step `first`, as this copy writes it.
    fn frame(&self, first: u32, entries: Vec<u8>) -> Frame {
        Frame {
            game: self.game,
            player: self.player,
            confirmed: 0,
            first,
            steps: vec![entries],
        }
    }

    fn leave(&mut self) {
        if let Some(conn) = self.conn.take() {
            conn.close();
        }
    }
}

struct Run {
    relay: String,
    ca: Vec<u8>,
    copies: Vec<Copy>,
    hello: Value,
    limits: Limits,
    checks: BTreeMap<&'static str, Vec<String>>,
    next_match: u8,
}

const WAIT: Duration = Duration::from_secs(10);
/// Frames each copy of the forwarding matches sends.
const FRAMES: u32 = 40;

impl Run {
    fn fail(&mut self, check: &'static str, failure: String) {
        self.checks.entry(check).or_default().push(failure);
    }

    /// A fresh match ID for this run.
    fn new_match(&mut self) -> MatchId {
        self.next_match += 1;
        let mut id = [0x30; 16];
        id[0] = self.next_match;
        id[15] = (std::process::id() & 0xff) as u8;
        id
    }

    /// Opens a connection and joins `game`; the copy's index in the report.
    fn join(&mut self, game: MatchId, players: u8, open: bool) -> Result<usize, String> {
        let (conn, _) = Connection::open(&self.relay, &self.ca)?;
        let mut copy = Copy {
            conn: Some(conn),
            game,
            join: json!({}),
            player: 0,
            sent: vec![],
            received: vec![],
            controls: vec![],
        };
        let join = json!({"join": {"match": wire::hex(&game), "players": players, "open": open}});
        copy.conn
            .as_mut()
            .map_or(Ok(()), |c| c.send_control(&join))?;
        let until = Instant::now() + WAIT;
        while copy.join == json!({}) && Instant::now() < until {
            copy.drain(Duration::from_millis(20))?;
            if let Some(at) = copy
                .controls
                .iter()
                .position(|c| c.get("joined").is_some() || c.get("refused").is_some())
            {
                let answer = copy.controls.remove(at);
                copy.join = match answer.get("joined") {
                    Some(joined) => joined.clone(),
                    None => json!({"refused": answer["refused"]}),
                };
            }
        }
        copy.player = copy.join["player"].as_u64().unwrap_or(0) as u8;
        if copy.join.get("refused").is_some() {
            copy.leave();
        }
        self.copies.push(copy);
        Ok(self.copies.len() - 1)
    }

    fn refused(&self, copy: usize) -> Option<&str> {
        self.copies[copy].join["refused"].as_str()
    }

    /// Two copies of a new match, both seated and started.
    fn pair(&mut self) -> Result<(usize, usize), String> {
        let game = self.new_match();
        let (a, b) = (self.join(game, 2, true)?, self.join(game, 2, false)?);
        for c in [a, b] {
            let hex = wire::hex(&game);
            if self.copies[c].join.get("player").is_none() {
                let answer = self.copies[c].join.clone();
                self.fail(
                    "joining",
                    format!("a join to match {hex} with a free seat was answered {answer}"),
                );
            } else if self.copies[c].control("start", WAIT)?.is_none() {
                self.fail(
                    "joining",
                    format!("match {hex} got no start once both seats were taken"),
                );
            }
        }
        if self.copies[a].player == self.copies[b].player {
            self.fail(
                "joining",
                "the two copies of a match were given one player number".into(),
            );
        }
        Ok((a, b))
    }

    /// Sends `frames` frames from each copy, at three quarters of the hello's rate, while taking
    /// what arrives.
    fn exchange(&mut self, copies: &[usize], frames: u32) -> Result<(), String> {
        let gap = Duration::from_secs_f64(1.0 / (self.limits.frames_per_s as f64 * 0.75));
        for i in 0..frames {
            for &c in copies {
                let frame =
                    self.copies[c].frame(i, (i as u64 * 31 + c as u64).to_le_bytes().to_vec());
                self.copies[c].send(frame)?;
                self.copies[c].drain(Duration::from_millis(1))?;
            }
            std::thread::sleep(gap);
        }
        let until = Instant::now() + WAIT;
        while Instant::now() < until
            && copies
                .iter()
                .any(|&c| (self.copies[c].received.len() as u32) < frames)
        {
            for &c in copies {
                self.copies[c].drain(Duration::from_millis(5))?;
            }
        }
        Ok(())
    }

    /// What each copy received against what the other copies of its match sent.
    fn forwarding(&mut self) {
        let mut failures = Vec::new();
        for (i, c) in self.copies.iter().enumerate() {
            let peers: Vec<&Copy> = self
                .copies
                .iter()
                .enumerate()
                .filter(|(j, o)| *j != i && o.game == c.game && o.join.get("player").is_some())
                .map(|(_, o)| o)
                .collect();
            let mut expected: Vec<&Vec<u8>> = Vec::new();
            for p in &peers {
                expected.extend(
                    p.sent
                        .iter()
                        .filter(|f| f.len() as u64 <= wire::FRAME_BYTES),
                );
            }
            for f in &c.received {
                let game: MatchId = f
                    .get(..16)
                    .and_then(|g| g.try_into().ok())
                    .unwrap_or_default();
                if game != c.game {
                    failures.push(format!(
                        "a frame of match {} reached copy {i}, a copy of match {}",
                        wire::hex(&game),
                        wire::hex(&c.game)
                    ));
                } else if !expected.contains(&f) {
                    failures.push(format!(
                        "copy {i} of match {} received a frame no other copy of its match sent",
                        wire::hex(&c.game)
                    ));
                }
            }
            if c.join.get("player").is_some() {
                for p in &peers {
                    let theirs: Vec<&Vec<u8>> = c
                        .received
                        .iter()
                        .filter(|f| f.starts_with(&c.game) && f.get(16) == Some(&p.player))
                        .collect();
                    let sent: Vec<&Vec<u8>> = p
                        .sent
                        .iter()
                        .filter(|f| f.len() as u64 <= wire::FRAME_BYTES)
                        .collect();
                    if !sent.starts_with(&theirs)
                        || (p.conn.is_some() && theirs.len() != sent.len())
                    {
                        failures.push(format!("copy {i} of match {} received {} of player {}'s {} frames, or out of order", wire::hex(&c.game), theirs.len(), p.player, sent.len()));
                    }
                }
                let read = read(&c.received, &c.game, c.player, 2);
                failures.extend(read.into_iter().map(|f| format!("copy {i}'s reader: {f}")));
            }
        }
        self.checks.insert("forwarding", failures);
    }
}

/// The relay suite against the relay `relay` names, trusting the PEM authorities `ca`: its report.
pub fn run(relay: &str, ca: &[u8]) -> Value {
    let host = crate::macos::host(relay);
    let mut run = Run {
        relay: relay.to_string(),
        ca: ca.to_vec(),
        copies: vec![],
        hello: Value::Null,
        limits: Limits {
            frames_per_s: wire::FRAMES_PER_S,
            frame_bytes: wire::FRAME_BYTES,
        },
        checks: ["hello", "joining", "forwarding", "keeps_nothing", "closing"]
            .into_iter()
            .map(|c| (c, vec![]))
            .collect(),
        next_match: 0,
    };
    let played = play(&mut run);
    if let Err(e) = played {
        run.fail("joining", e);
    }
    let checks: serde_json::Map<String, Value> = run
        .checks
        .iter()
        .map(|(name, failures)| {
            let status = if failures.is_empty() { "PASS" } else { "FAIL" };
            (
                name.to_string(),
                json!({"status": status, "failures": failures}),
            )
        })
        .collect();
    let pass = run.checks.values().all(Vec::is_empty);
    json!({
        "suite": "relay@1",
        "relay": host,
        "hello": {"protocol": run.hello["protocol"], "digest": run.hello["digest"]},
        "status": if pass { "PASS" } else { "FAIL" },
        "checks": checks,
        "connections": run.copies.iter().map(Copy::json).collect::<Vec<_>>(),
    })
}

fn play(run: &mut Run) -> Result<(), String> {
    let (conn, hello) = Connection::open(&run.relay, &run.ca)?;
    conn.close();
    run.hello = hello.clone();
    match check_hello(&crate::macos::host(&run.relay), &hello) {
        Ok(limits) => run.limits = limits,
        Err(why) => run.fail("hello", why),
    }

    // Joining: two matches at once, each seated and started; a third copy is refused full, a join
    // to a match never opened unknown.
    let (a0, a1) = run.pair()?;
    let (b0, b1) = run.pair()?;
    let game_a = run.copies[a0].game;
    let full = run.join(game_a, 2, false)?;
    if run.refused(full) != Some("full") {
        let answer = run.copies[full].join.clone();
        run.fail("joining", format!("a third join to the two-seat match {} before its first frame was answered {answer}, not refused full", wire::hex(&game_a)));
    }
    let never = run.new_match();
    let unknown = run.join(never, 2, false)?;
    if run.refused(unknown) != Some("unknown") {
        let answer = run.copies[unknown].join.clone();
        run.fail("joining", format!("a join that opens nothing, to match {}, never opened, was answered {answer}, not refused unknown", wire::hex(&never)));
    }

    // Forwarding: each copy of both matches sends its frames; each must get only its peer's.
    run.exchange(&[a0, a1, b0, b1], FRAMES)?;
    let started = run.join(game_a, 2, false)?;
    if run.refused(started) != Some("started") {
        let answer = run.copies[started].join.clone();
        run.fail("joining", format!("a join to the full match {} after its first frame was answered {answer}, not refused started", wire::hex(&game_a)));
    }

    // Keeping nothing: match A's copies leave; the other hears why, and a join to A is unknown.
    run.copies[a0].leave();
    let left = run.copies[a1].control("closed", WAIT)?;
    let want =
        json!({"match": wire::hex(&game_a), "player": run.copies[a0].player, "reason": "left"});
    if left.as_ref().map(|c| &c["closed"]) != Some(&want) {
        run.fail(
            "closing",
            format!(
                "when a copy of match {} left, its peer was told {left:?}, not closed {want}",
                wire::hex(&game_a)
            ),
        );
    }
    run.copies[a1].leave();
    let ended = run.join(game_a, 2, false)?;
    if run.refused(ended) != Some("unknown") {
        let answer = run.copies[ended].join.clone();
        run.fail("keeps_nothing", format!("a join to match {}, which ended when its copies left, was answered {answer}, not refused unknown", wire::hex(&game_a)));
    }
    run.forwarding();
    run.copies[b0].leave();
    run.copies[b1].leave();

    // Closing: one frame past frame_bytes, and frames_per_s passed for 3 seconds running.
    let (c0, c1) = run.pair()?;
    // Steps of the most bytes a step holds, until the frame passes frame_bytes.
    let mut big = run.copies[c0].frame(0, vec![]);
    big.steps = vec![
        vec![7; u16::MAX as usize];
        run.limits.frame_bytes as usize / (u16::MAX as usize + 2) + 1
    ];
    run.copies[c0].send(big)?;
    closed_for(run, c0, c1, "size")?;
    let (d0, d1) = run.pair()?;
    let until = Instant::now() + Duration::from_secs(6);
    let mut step = 0;
    while run.copies[d1]
        .controls
        .iter()
        .all(|c| c.get("closed").is_none())
        && Instant::now() < until
    {
        let frame = run.copies[d0].frame(step, vec![1]);
        if run.copies[d0].send(frame).is_err() {
            break;
        }
        step += 1;
        // The 1 ms wait paces the flood well past frames_per_s.
        run.copies[d1].drain(Duration::from_millis(1))?;
    }
    closed_for(run, d0, d1, "rate")?;
    for c in [c1, d1] {
        run.copies[c].leave();
    }
    Ok(())
}

/// The relay closed `culprit`'s connection and told its peer why.
fn closed_for(run: &mut Run, culprit: usize, peer: usize, reason: &str) -> Result<(), String> {
    let closed = run.copies[peer].control("closed", WAIT)?;
    let game = wire::hex(&run.copies[culprit].game);
    let want = json!({"match": game, "player": run.copies[culprit].player, "reason": reason});
    if closed.as_ref().map(|c| &c["closed"]) != Some(&want) {
        run.fail("closing", format!("past its {reason} limit, a copy of match {game} wasn't closed with its peer told {want}: {closed:?}"));
    }
    // Its connection is gone: the next read says so.
    if let Some(conn) = run.copies[culprit].conn.as_mut() {
        let gone = (0..200).any(|_| conn.next(Duration::from_millis(20)).is_err());
        if !gone {
            run.fail(
                "closing",
                format!("past its {reason} limit, a copy of match {game} still had its connection"),
            );
        }
    }
    run.copies[culprit].conn = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames(player: u8, firsts: &[u32], big_endian: bool) -> Vec<Vec<u8>> {
        firsts
            .iter()
            .map(|&first| {
                let mut b = Frame {
                    game: [1; 16],
                    player,
                    confirmed: 0,
                    first,
                    steps: vec![vec![0]],
                }
                .encode();
                if big_endian {
                    b[21..25].copy_from_slice(&first.to_be_bytes());
                }
                b
            })
            .collect()
    }

    #[test]
    fn the_reader_names_the_field_and_the_client() {
        assert_eq!(
            read(&frames(1, &[0, 1, 2, 1, 3], false), &[1; 16], 0, 2),
            Vec::<String>::new()
        );
        let failures = read(&frames(1, &[0, 1, 2], true), &[1; 16], 0, 2);
        assert!(
            failures
                .iter()
                .any(|f| f.contains("field first") && f.contains("player 1")),
            "{failures:?}"
        );
        let other = read(&frames(1, &[0], false), &[2; 16], 0, 2);
        assert!(other[0].contains("field match"), "{other:?}");
    }
}
