//! Issue #327: the card's answer, as the `ask.answer` params the shell signs as the device you paired and sends to
//! the hub. The answer the card sends is the option the shell chose, with the words or image you typed beside it
//! as its reason, bound to the plan digest the card showed; words with no option are `decision: none`.

use serde_json::{json, Map, Value};

/// What the card answers with: the option the shell chose, if any, your words beside it, and the plan digest the
/// card showed for an authority ask.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Answer {
    pub option: Option<String>,
    pub words: Option<String>,
    /// The image you attached, by its SHA-256 in the evidence store.
    pub image: Option<String>,
    pub plan_hash: Option<String>,
    /// The click token an approval binds, from the armed hardware press.
    pub token: Option<String>,
    /// For a batch approved in part: the asks of the batch the approval runs, by index in the batch.
    pub steps: Option<Vec<usize>>,
}

impl Answer {
    /// The `ask.answer` params, before signing.
    pub fn params(&self, ask: &str) -> Map<String, Value> {
        let mut params = Map::new();
        params.insert("ask".into(), Value::String(ask.to_owned()));
        if let Some(option) = &self.option {
            params.insert("option".into(), Value::String(option.clone()));
        }
        if let Some(words) = &self.words {
            params.insert("words".into(), Value::String(words.clone()));
        }
        if let Some(image) = &self.image {
            params.insert("image".into(), Value::String(image.clone()));
        }
        if let Some(plan_hash) = &self.plan_hash {
            params.insert("plan_hash".into(), Value::String(plan_hash.clone()));
        }
        if let Some(token) = &self.token {
            params.insert("token".into(), Value::String(token.clone()));
        }
        if let Some(steps) = &self.steps {
            params.insert("steps".into(), json!(steps));
        }
        params
    }
}
