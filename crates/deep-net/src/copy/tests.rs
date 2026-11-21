//! The copy's own tests: a two-player lockstep match over a stepper whose state is a word.

use super::*;

/// A piece whose whole state is a running word over its entries, in the order it got them.
#[derive(Default)]
pub(crate) struct Word {
    pub word: u64,
    pub steps: i64,
    /// State no step hash covers.
    pub hidden: u64,
    /// A planted defect: at this step, add 1 to `word` (true) or to `hidden` (false), each
    /// time the step runs.
    pub plant: Option<(i64, bool)>,
    /// #551: its rollback checkpoints, by match step.
    pub ring: BTreeMap<i64, (u64, u64)>,
}

impl Stepper for Word {
    fn enter(&mut self, entry: &Value) -> Result<(), Value> {
        // #277: a seat entry folds its player and state into the word.
        if let Some(seat) = entry.get("seat") {
            let state = seat["state"].as_str().unwrap_or_default().len() as u64;
            self.word = self
                .word
                .wrapping_mul(31)
                .wrapping_add(seat["player"].as_u64().unwrap() * 977 + state);
            return Ok(());
        }
        let (player, value) = (
            entry["player"].as_u64().unwrap(),
            entry["value"].as_f64().unwrap(),
        );
        self.word = self
            .word
            .wrapping_mul(31)
            .wrapping_add(player * 1000 + (value as i64 + 8) as u64);
        Ok(())
    }
    fn run(&mut self, step: i64, _: i64) -> Result<(), Value> {
        assert_eq!(step, self.steps, "steps run once each, in order");
        self.steps += 1;
        self.word = self.word.wrapping_mul(7).wrapping_add(1);
        match self.plant {
            Some((at, true)) if at == step => self.word += 1,
            Some((at, false)) if at == step => self.hidden += 1,
            _ => {}
        }
        Ok(())
    }
    fn hash(&mut self) -> u64 {
        self.word ^ self.hidden
    }
    fn step_hash(&mut self) -> u64 {
        self.word
    }
    fn fields(&mut self) -> Vec<(String, String, u64)> {
        vec![
            ("word".into(), "word".into(), self.word),
            ("word".into(), "hidden".into(), self.hidden),
        ]
    }
    fn again(&self) -> Result<Self, Value> {
        Ok(Word {
            plant: self.plant,
            ..Word::default()
        })
    }
    fn plant(&mut self, d: &Defect) -> Result<(), Value> {
        match d.field.as_str() {
            "word" => self.word += 1,
            _ => self.hidden += 1,
        }
        Ok(())
    }
    fn hold(&mut self, _: usize) {}
    fn keep(&mut self, step: i64) {
        self.ring.insert(step, (self.word, self.hidden));
        self.ring = self.ring.split_off(&(step - 16));
    }
    fn back(&mut self, step: i64, _: i64) -> Result<(), Value> {
        let (word, hidden) = *self.ring.get(&step).ok_or_else(|| json!({"step": step}))?;
        (self.word, self.hidden, self.steps) = (word, hidden, step);
        self.ring.split_off(&step);
        Ok(())
    }
}

pub(crate) fn cfg(delay: i64, hash_every: i64) -> Config {
    Config {
        item: "match".into(),
        relay: "https://relay.test".into(),
        host: "relay.test".into(),
        players: 2,
        step_rate: 20,
        delay,
        window: 0,
        hash_every,
        timeout: 5 * FLICKS,
        controls: json!({"push": {"kind": "slider", "range": [-8, 8]}}),
        seats: false,
        draw_after: Vec::new(),
        courtesy: false,
    }
}

fn pair(delay: i64) -> [Copy<Word>; 2] {
    [1, 2].map(|me| {
        Copy::new(
            cfg(delay, 1),
            Card::default(),
            me,
            2,
            [7; 16],
            Word::default(),
            Planted::None,
            0,
        )
    })
}

#[test]
fn a_copy_runs_a_step_only_once_it_holds_every_players_message() {
    let [mut a, mut b] = pair(2);
    let step = a.cfg.step();
    a.script([(0, "push".to_string(), json!(3), None)]);
    // Alone, copy 1 runs the two steps no entry can reach and then waits for player 2.
    let frame = a.tick(0).unwrap();
    assert_eq!(a.ran(), 0, "player 2's message for step 0 hasn't come");
    b.receive(&frame, 0);
    let back = b.tick(0).unwrap();
    assert_eq!(b.ran(), 1);
    a.receive(&back, 0);
    assert_eq!(a.ran(), 1);
    assert!(
        a.report()["waits"].as_array().unwrap().is_empty(),
        "a wait of no time isn't one"
    );
    // The entry made at step 0 lands at step 2 on both copies, as player 1's.
    for k in 1..=3 {
        let (fa, fb) = (a.tick(k * step), b.tick(k * step));
        b.receive(&fa.unwrap(), k * step);
        a.receive(&fb.unwrap(), k * step);
    }
    assert_eq!((a.ran(), b.ran()), (4, 4));
    assert_eq!(a.hashes(), b.hashes());
    let (ra, rb) = (a.record(), b.record());
    assert_eq!(ra["track"][0]["t"], json!(2 * step));
    assert_eq!(
        (&ra["track"][0]["writer"], &rb["track"][0]["writer"]),
        (&json!("you"), &json!("peer"))
    );
    assert_eq!(rb["track"][0]["player"], json!(1));
}

#[test]
fn a_dropped_frame_is_recovered_from_the_next_one_and_a_planted_backend_stalls() {
    for planted in [Planted::None, Planted::ResendsNothing] {
        let mut a = Copy::new(
            cfg(1, 1),
            Card::default(),
            1,
            2,
            [7; 16],
            Word::default(),
            planted,
            0,
        );
        let mut b = Copy::new(
            cfg(1, 1),
            Card::default(),
            2,
            2,
            [7; 16],
            Word::default(),
            Planted::None,
            0,
        );
        let step = a.cfg.step();
        for k in 0..6 {
            let (fa, fb) = (a.tick(k * step), b.tick(k * step));
            // Copy 1's second frame is lost.
            if let (Some(f), true) = (fa, k != 1) {
                b.receive(&f, k * step);
            }
            if let Some(f) = fb {
                a.receive(&f, k * step);
            }
        }
        match planted {
            Planted::None => assert!(b.ran() >= 5, "{}", b.ran()),
            _ => assert_eq!(b.ran(), 2, "the lost message for step 2 never comes again"),
        }
    }
}

#[test]
fn a_wait_shows_the_notice_from_a_quarter_second_and_ends_the_match_at_the_timeout() {
    let [mut a, _] = pair(0);
    let step = a.cfg.step();
    for k in 0..=100 {
        a.tick(k * step);
    }
    let r = a.report();
    assert_eq!(
        r["waits"],
        json!([{"step": 0, "player": 2, "from": 0.0, "to": null}])
    );
    assert_eq!(
        r["notices"],
        json!([{"player": 2, "from": 0.25, "to": null}])
    );
    assert_eq!((a.ran(), a.end()), (0, Some(End::Timeout)));
    assert_eq!(a.shown(FLICKS), (-1, Some((2, FLICKS))));
    assert_eq!(a.record()["end"], json!("timeout"));
}

/// Copies 1 and 2 at the steps' times until both are done, every frame delivered at once.
fn rally(a: &mut Copy<Word>, b: &mut Copy<Word>) {
    let step = a.cfg.step();
    for k in 0..2000 {
        let (fa, fb) = (a.tick(k * step), b.tick(k * step));
        if let Some(f) = fa {
            b.receive(&f, k * step);
        }
        if let Some(f) = fb {
            a.receive(&f, k * step);
        }
        if a.done() && b.done() {
            return;
        }
    }
    panic!("the copies never settled");
}

fn planted_pair(plant: (i64, bool), planted: Planted) -> [Copy<Word>; 2] {
    [1, 2].map(|me| {
        let word = Word {
            plant: (me == 2).then_some(plant),
            ..Word::default()
        };
        let mut c = Copy::new(cfg(1, 4), Card::default(), me, 2, [7; 16], word, planted, 0);
        c.limit(40);
        c
    })
}

#[test]
fn a_hash_a_peer_does_not_share_stops_the_match_and_names_the_first_step_and_field() {
    let [mut a, mut b] = planted_pair((6, true), Planted::None);
    rally(&mut a, &mut b);
    for c in [&a, &b] {
        assert_eq!(c.end(), Some(End::Desync));
        let d = c.desync().unwrap();
        assert_eq!(
            (
                &d["cause"],
                &d["first_step"],
                &d["module"],
                &d["field"],
                &d["at"]
            ),
            (
                &json!("state"),
                &json!(6),
                &json!("word"),
                &json!("word"),
                &json!(8)
            )
        );
        // It stops once it holds the peer's hash, which rides a message `delay` steps on.
        assert!(
            (9..=11).contains(&c.ran()),
            "it stops at the hash that parted: {}",
            c.ran()
        );
        assert_eq!(c.report()["desync"], *d);
    }
}

#[test]
fn state_no_step_hash_covers_is_found_by_full_state_hashes_and_missed_by_step_hashes() {
    let [mut a, mut b] = planted_pair((6, false), Planted::None);
    rally(&mut a, &mut b);
    let d = a.desync().unwrap();
    assert_eq!(
        (&d["first_step"], &d["field"]),
        (&json!(6), &json!("hidden"))
    );
    let [mut a, mut b] = planted_pair((6, false), Planted::LocatesByStepHashes);
    rally(&mut a, &mut b);
    assert_eq!(a.desync().unwrap()["first_step"], json!(null));
}

#[test]
fn a_peer_entry_out_of_range_or_undeclared_is_refused_alike_naming_the_player() {
    let [mut a, mut b] = pair(1);
    b.script([
        (2, "push".to_string(), json!(9), None),
        (3, "kick".to_string(), json!(1), None),
    ]);
    b.limit(12);
    a.limit(12);
    rally(&mut a, &mut b);
    assert_eq!(a.end(), None);
    assert_eq!(a.refused(), b.refused());
    let r: Vec<(i64, i64, &str)> = a
        .refused()
        .iter()
        .map(|r| {
            (
                r["step"].as_i64().unwrap(),
                r["player"].as_i64().unwrap(),
                r["code"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(r, vec![(3, 2, "out_of_range"), (4, 2, "unknown_control")]);
    assert_eq!(a.hashes(), b.hashes());
}
