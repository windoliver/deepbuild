//! #1579 AC3, the app's half: an answer the app's own signer makes, sent by the path the question card uses
//! (`deep_app::answer::send`), written blind from the issue, docs/technical-design.md and the merge base 6042ef5a.
//! Wired into deep-app by a `[[test]]` entry the implementer adds (README, Pinned here: 6):
//!
//! ```toml
//! [[test]]
//! name = "acceptance_1579"
//! path = "../../tests/acceptance/1579/app/answer.rs"
//! ```
//!
//! It runs only from `../app.test.ts`, which starts a real hub, seeds the ask, pairs nothing itself and sets `HOME` to a
//! home of the app's own whose `config.json` points at a socket in front of the hub; hence `#[ignore]`, so a plain
//! `cargo test` doesn't run it without that hub. It prints the hub's reply on one line, `DA1579_REPLY <json>`.

use serde_json::Value;

#[test]
#[ignore = "run by tests/acceptance/1579/app.test.ts against a hub it starts"]
fn ac3_the_app_answers_with_its_own_signer() {
    let params = std::env::var("DA1579_PARAMS")
        .expect("BLOCKED: DA1579_PARAMS is unset: run this from tests/acceptance/1579/app.test.ts");
    let params: Value = serde_json::from_str(&params).expect("DA1579_PARAMS is JSON");
    match deep_app::answer::send(&params) {
        Ok(reply) => println!("DA1579_REPLY {reply}"),
        Err(error) => panic!("the app's signed answer was refused: {error:?}"),
    }
}
