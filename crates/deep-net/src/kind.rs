//! `net@1` (canvas primitives: Net `net@1`): the kind, the module that holds it, its check (one
//! relay, an https host) and a document's match as its net item declares it.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{
    Dependency, Implementation, Manifest, Module, Raised, Range, Registrar, Semver,
};
use serde_json::{json, Value};

/// Flicks in a second, the one clock's unit.
pub const FLICKS: i64 = deep_canvas::camera::FLICKS_PER_SECOND;

pub const KIND: &str = "net@1";

fn param(name: &'static str, ty: ParamType, unit: &'static str, default: Value) -> Param {
    Param {
        name,
        ty,
        unit,
        default,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

fn ranged(name: &'static str, unit: &'static str, default: f64, range: [f64; 2]) -> Param {
    Param {
        min: Some(range[0]),
        max: Some(range[1]),
        ..param(name, ParamType::F32, unit, json!(default))
    }
}

fn register(r: &mut Registrar) {
    let params = vec![
        param(
            "relay",
            ParamType::Json("text (one https URL)"),
            "",
            json!(""),
        ),
        ranged("players", "", 2.0, [2.0, 8.0]),
        ranged("step_rate", "Hz", 60.0, [1.0, 240.0]),
        ranged("delay", "", 2.0, [0.0, 30.0]),
        ranged("window", "", 8.0, [0.0, 16.0]),
        ranged("hash_every", "", 60.0, [1.0, 100_000.0]),
        ranged("timeout", "s", 5.0, [0.05, 3600.0]),
    ];
    let net = Entry {
        family: "",
        name: "net",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params,
        }],
        migrations: vec![],
    };
    r.kind(net, &[], "");
    r.rule("net", relay_rule);
}

/// The host a relay URL names, when it is one https URL: `https://<host>[:port][/...]`.
pub fn host_of(relay: &Value) -> Result<String, String> {
    let url = match relay {
        Value::String(s) if !s.is_empty() => s,
        Value::String(_) | Value::Null => {
            return Err("a net item declares its relay, one https host; this one names none".into())
        }
        Value::Array(a) if a.len() > 1 => {
            return Err(format!(
            "a net item names one relay, the only host the module reaches; this one names {} hosts",
            a.len()
        ))
        }
        _ => return Err("a net item's relay is one https URL".into()),
    };
    let Some(rest) = url.strip_prefix("https://") else {
        return Err(format!(
            "a net item's relay is reached over https; {url} isn't an https URL"
        ));
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let (name, port) = host
        .rsplit_once(':')
        .map_or((host, None), |(n, p)| (n, Some(p)));
    let named = !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    if !named
        || port.is_some_and(|p| p.parse::<u16>().is_err())
        || url.contains(char::is_whitespace)
    {
        return Err(format!(
            "a net item's relay names one https host; {url} doesn't"
        ));
    }
    Ok(host.to_string())
}

/// Net `net@1`: the relay is one https host, the only one the module names.
fn relay_rule(_: &Value, id: &str, item: &Value) -> Vec<Raised> {
    match host_of(&item["params"]["relay"]) {
        Ok(_) => Vec::new(),
        Err(what) => vec![Raised {
            code: "out_of_range",
            severity: "error",
            path: format!("items/{id}/params/relay"),
            what,
            fix_ops: None,
        }],
    }
}

/// The net module, holding `net@1`; it depends on logic.
pub fn module() -> Module {
    let one = Semver::parse("1.0.0").expect("a version");
    Module {
        manifest: Manifest {
            name: "net".into(),
            version: one,
            core: Range::parse("*").expect("a range"),
            depends_on: [(
                "logic".to_string(),
                Dependency {
                    range: Range::parse("^1").expect("a range"),
                    optional: false,
                },
            )]
            .into_iter()
            .collect(),
            feature: "net".into(),
            license: "Apache-2.0".into(),
            implements: KIND.into(),
            implementation: Implementation::reference("net", one),
        },
        register,
    }
}

/// A document's net item, by its ID.
pub fn item(form: &Value) -> Option<(&str, &Value)> {
    form.get("items")?
        .as_object()?
        .iter()
        .find(|(_, i)| i.get("kind").and_then(Value::as_str) == Some(KIND))
        .map(|(id, i)| (id.as_str(), i))
}

/// A document's match, as its net item declares it.
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub item: String,
    /// The relay's URL as written, and the host it names; empty where the item names none.
    pub relay: String,
    pub host: String,
    pub players: u8,
    pub step_rate: i64,
    pub delay: i64,
    pub window: i64,
    pub hash_every: i64,
    /// In flicks.
    pub timeout: i64,
}

impl Config {
    pub fn of(form: &Value) -> Option<Config> {
        let (id, item) = item(form)?;
        let p = &item["params"];
        let whole = |name: &str, default: i64, range: [i64; 2]| {
            p.get(name)
                .and_then(Value::as_f64)
                .map_or(default, |v| v as i64)
                .clamp(range[0], range[1])
        };
        let timeout = p.get("timeout").and_then(Value::as_f64).unwrap_or(5.0);
        Some(Config {
            item: id.to_string(),
            relay: p["relay"].as_str().unwrap_or_default().to_string(),
            host: host_of(&p["relay"]).unwrap_or_default(),
            players: whole("players", 2, [2, 8]) as u8,
            step_rate: whole("step_rate", 60, [1, 240]),
            delay: whole("delay", 2, [0, 30]),
            window: whole("window", 8, [0, 16]),
            hash_every: whole("hash_every", 60, [1, 100_000]),
            timeout: (timeout.max(0.05) * FLICKS as f64).round() as i64,
        })
    }

    /// One match step, in flicks.
    pub fn step(&self) -> i64 {
        FLICKS / self.step_rate
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relay_is_one_https_host() {
        assert_eq!(
            host_of(&json!("https://relay.test/549")).unwrap(),
            "relay.test"
        );
        assert_eq!(
            host_of(&json!("https://127.0.0.1:4433")).unwrap(),
            "127.0.0.1:4433"
        );
        for (bad, names) in [
            (json!(""), "names none"),
            (Value::Null, "names none"),
            (json!("http://relay.test/549"), "https"),
            (json!(["https://a.test", "https://b.test"]), "2 hosts"),
            (json!("https://user@relay.test"), "one https host"),
            (json!("https://a.test https://b.test"), "one https host"),
        ] {
            let why = host_of(&bad).unwrap_err();
            assert!(why.contains(names), "{bad}: {why}");
        }
    }

    #[test]
    fn a_match_reads_its_item_with_the_kinds_defaults() {
        let doc = json!({"items": {"m": {"kind": "net@1", "params":
            {"relay": "https://r.test", "step_rate": 20, "window": 0, "delay": 4}}}});
        let c = Config::of(&doc).unwrap();
        assert_eq!(
            (c.players, c.step_rate, c.delay, c.window, c.hash_every),
            (2, 20, 4, 0, 60)
        );
        assert_eq!(
            (c.step(), c.timeout, c.host.as_str()),
            (FLICKS / 20, 5 * FLICKS, "r.test")
        );
        assert_eq!(Config::of(&json!({"items": {}})), None);
    }
}
