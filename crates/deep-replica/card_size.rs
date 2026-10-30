//! #327: a card drawn taller than its slot never arms. The card measures itself as the window lays it out, so
//! this runs the real view in the replica's window: a taste card that fits arms; given more past calls than its
//! slot holds, it draws past its slot and stays presented.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    // Unrun is not passed: off macOS this is INCONCLUSIVE, and says so with a failing exit.
    #[cfg(not(target_os = "macos"))]
    {
        println!("card_size: INCONCLUSIVE; the replica draws on macOS only, so nothing ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::time::Duration;

    use deep_app::arming::ARM_AFTER;
    use deep_replica::{repo_root, Replica};
    use serde_json::{json, Value};

    const NAME: &str = "a_card_drawn_taller_than_its_slot_stays_presented";

    pub fn run() -> i32 {
        let passed = std::panic::catch_unwind(case).is_ok();
        println!("test {NAME} ... {}", if passed { "ok" } else { "FAILED" });
        println!(
            "test result: {}. {} passed; {} failed",
            if passed { "ok" } else { "FAILED" },
            u8::from(passed),
            u8::from(!passed)
        );
        i32::from(!passed)
    }

    fn case() {
        let file = repo_root().join("tests/acceptance/327/fixtures/past.events.jsonl");
        let rows: Vec<Value> = std::fs::read_to_string(&file)
            .expect("the past-calls fixture")
            .lines()
            .map(|line| serde_json::from_str(line).expect("a JSON line"))
            .collect();
        let asks: Vec<&Value> = rows
            .iter()
            .filter(|row| row["event"]["kind"] == "ask.created")
            .collect();
        // The fixture's taste call that lists two past calls on its screen.
        let ask = format!("ask:{}", asks[3]["event"]["id"].as_str().unwrap());
        let decided: Vec<&Value> = rows
            .iter()
            .filter(|row| row["event"]["kind"] == "decision.created")
            .collect();

        let mut replica = Replica::open(&file);
        let card = replica.present(0, &ask);
        assert_eq!(card.state, "presented", "{card:?}");
        let wait = Duration::from_millis(ARM_AFTER + 20);
        replica.advance(wait);
        let card = replica.card_seen(0).expect("the card");
        assert_eq!(
            card.state, "armed",
            "a card that fits its slot arms: {card:?}"
        );

        // Twenty more of your calls on the same screen: the card shows each, draws past its slot, and never arms.
        for n in 0..20 {
            let row = decided[n % decided.len()];
            let mut event = row["event"].clone();
            event["id"] = json!(format!("01MD327Z{n:018}"));
            replica.append(row["session_id"].as_str().unwrap(), event);
        }
        replica.advance(wait);
        replica.advance(wait);
        let card = replica.card_seen(0).expect("the card");
        let listed = card
            .text
            .matches("Darker header on the checkout total?")
            .count()
            + card
                .text
                .matches("Header colour over the total, after the redesign?")
                .count();
        // So many rows run past its slot, and past the window's bottom, where the window draws none.
        assert!(listed > 10, "the card lists the new past calls: {card:?}");
        assert_eq!(
            card.state, "presented",
            "a card taller than its slot armed: {card:?}"
        );
    }
}
