//! Issue #327: the card's answer, as the `ask.answer` params the shell signs as the device you paired and sends to
//! the hub. The answer the card sends is the option the shell chose, with the words or image you typed beside it
//! as its reason, bound to the plan digest the card showed; words with no option are `decision: none`.
//!
//! Issue #1454: [`send`] is that path: the app's own device signs the params and the hub takes them. It blocks while the
//! OS confirms you, so the card runs it off the main thread, on a connection of its own.

use serde_json::{json, Map, Value};

use crate::device::Device;
use crate::hub::{HubClient, HubError};

/// Signs `params`, the card's `ask.answer` params, for `ask.answer` on this hub, and sends them. A device the hub no
/// longer knows, as after a restore, pairs again, once.
pub fn send(params: &Value) -> Result<Value, HubError> {
    let mut client = HubClient::app()?;
    let params = params.as_object().cloned().unwrap_or_default();
    // The hub's ID, as its hello names it: what the signature is for (#1579).
    let hub = client.hello["hub"].as_str().unwrap_or_default().to_owned();
    let device = Device::paired(&mut client)?;
    match client.call(
        "ask.answer",
        device.sign("ask.answer", &hub, params.clone())?,
    ) {
        Err(HubError::Refused(refusal))
            if refusal["code"] == "credential"
                && refusal["path"] == "/params/signature/signed/device" =>
        {
            Device::forget();
            let device = Device::paired(&mut client)?;
            client.call("ask.answer", device.sign("ask.answer", &hub, params)?)
        }
        reply => reply,
    }
}

/// The OS confirming you for one press the card can't trust by itself: the hub asks, naming the ask and the option.
#[cfg(not(feature = "test-confirm"))]
pub fn confirm(ask: &str, reason: &str) -> Result<(), HubError> {
    HubClient::app()?
        .call("ask.confirm", json!({ "ask": ask, "reason": reason }))
        .map(|_| ())
}

/// A file stands in for the OS's prompt, read at each ask: holding `confirmed` is you, anything else a cancelled prompt.
#[cfg(feature = "test-confirm")]
pub fn confirm(_: &str, _: &str) -> Result<(), HubError> {
    let said = std::env::var_os("DEEP_APP_TEST_CONFIRM").map(std::fs::read_to_string);
    match said {
        Some(Ok(said)) if said.trim() == "confirmed" => Ok(()),
        _ => Err(HubError::Protocol("the prompt was cancelled".to_owned())),
    }
}

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
