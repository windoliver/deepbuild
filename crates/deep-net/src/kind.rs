//! `net@1` (canvas primitives: Net `net@1`): the kind, the module that holds it, its check (one
//! relay, an https host) and a document's match as its net item declares it.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use std::sync::OnceLock;

use deep_canvas::registry::{
    Dependency, Implementation, Manifest, Module, Raised, Range, Registrar, Report, ReportRun,
    Semver,
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
        // #552: the controls whose entries take a random draw (Net: random draws after commit).
        param("draw_after", ParamType::Json("[control ID]"), "", json!([])),
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
    r.rule("net", rate_rule);
    // #550: deep_run's net kinds (Check input: net kinds), each running copies of the document's
    // match in one process over the test relay, through what the build binds.
    r.check("net.rollback", "any", &["net.rollback"], |d, i| {
        issues(rollback_report(d, i))
    })
    .check_report(rollback_report);
    r.check("net.desync", "any", &["net.desync"], |d, i| {
        issues(desync_report(d, i))
    })
    .check_report(desync_report);
    r.check("net.budget", "any", &["net.budget"], |d, i| {
        issues(budget_report(d, i))
    })
    .check_report(budget_report);
    // #280: net.feel, what players would feel on a seeded network.
    r.check("net.feel", "any", &["net.feel"], |d, i| {
        issues(feel_report(d, i))
    })
    .check_report(feel_report);
    r.code(
        "net.rollback",
        "A copy ran a match step before it held every player's entries for it, or a held-back run parted from the on-time run.",
        "Step only from the match's entries, at their steps.",
        false,
    );
    r.code(
        "net.desync",
        "A change planted in one copy's state wasn't caught within one hash interval, or the copies named another step or field than the one planted.",
        "Keep every bit of state the copies carry in their full-state hashes.",
        false,
    );
    r.code(
        "net.budget",
        "A match step passes the class's frame time, or the net item declares a window past the one a host it plays on reports.",
        "Split the work across steps with its progress in memory, or declare at most the reported window, 0 for lockstep.",
        false,
    );
    r.code(
        "net.feel",
        "A copy's stall, rollback depth or correction distance passed its bound on the seeded network, or a copy waited past its deadline.",
        "Raise the delay to the latency the players need, lighten the step, or play lockstep.",
        false,
    );
    // Each code's planted fixture (#138's kit): a match whose logic traps at its first step, so
    // every copy ends it faulted and no net check kind can pass on it.
    for code in ["net.rollback", "net.desync", "net.budget", "net.feel"] {
        planted(r, code);
    }
}

/// The program a planted fixture's logic item runs: its step traps with kind unreachable.
const TRAP: &[u8] = include_bytes!("trap.wasm");

fn planted(r: &mut Registrar, code: &str) {
    let sha = deep_canvas::canon::sha256_hex(TRAP);
    let doc = json!({
        "format": 1, "profile": "figure", "title": code, "size": [320, 180],
        "description": format!("The net module's planted {code}: a match whose logic traps."),
        // Five seconds: net.desync needs a hash interval after the step it plants at.
        "seed": 1, "transport": {"span": "5s", "frame_rate": [60, 1]},
        "requires": {"modules": {"logic": "^1", "net": "^1"}},
        "items": {
            "rules": {"id": "rules", "kind": "logic@1", "name": "Rules", "order": "a1",
                      "params": {"program": sha, "writes": {"n": {"type": "i32"}}}},
            "match": {"id": "match", "kind": KIND, "name": "Match", "order": "a2",
                      "params": {"relay": "https://relay.example", "window": 0}},
        },
    });
    r.fixture(&format!("net-{}", &code[4..]), doc, None)
        .planted()
        .sidecar(json!({"codes": [code], "checks": [{"kind": code}]}))
        .fixture_assets(vec![TRAP.to_vec()]);
}

/// #550: what runs the net check kinds over a lowered document and its check input: the
/// build that links a stepper for a document's carried state binds them (deep-play's, over its
/// logic items). With none bound, each answers BLOCKED, never PASS.
pub struct Runs {
    pub rollback: ReportRun,
    pub desync: ReportRun,
    pub budget: ReportRun,
    pub feel: ReportRun,
}

static RUNS: OnceLock<Runs> = OnceLock::new();

/// Binds the net check kinds' runs; only the first call counts.
pub fn bind(runs: Runs) {
    let _ = RUNS.set(runs);
}

fn unbound(kind: &str) -> Report {
    Report {
        blocked: vec![json!({"code": "module_missing", "kind": kind,
            "what": "this build binds no stepper the net check kinds run copies of"})],
        ..Report::default()
    }
}

fn rollback_report(doc: &Value, input: &Value) -> Report {
    RUNS.get()
        .map_or_else(|| unbound("net.rollback"), |r| (r.rollback)(doc, input))
}

fn desync_report(doc: &Value, input: &Value) -> Report {
    RUNS.get()
        .map_or_else(|| unbound("net.desync"), |r| (r.desync)(doc, input))
}

fn budget_report(doc: &Value, input: &Value) -> Report {
    RUNS.get()
        .map_or_else(|| unbound("net.budget"), |r| (r.budget)(doc, input))
}

fn feel_report(doc: &Value, input: &Value) -> Report {
    RUNS.get()
        .map_or_else(|| unbound("net.feel"), |r| (r.feel)(doc, input))
}

fn issues(report: Report) -> Vec<(String, Raised)> {
    report
        .raised
        .into_iter()
        .map(|(id, r, _)| (id, r))
        .collect()
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

/// #551: the planted rate rule, which accepts only items that step faster than the match.
static FASTER_ONLY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Plants the rate rule that accepts only items whose step divides the match step's
/// (`net_rate_faster_only`).
pub fn plant_rate_rule(on: bool) {
    FASTER_ONLY.store(on, std::sync::atomic::Ordering::Relaxed);
}

/// A step length in seconds as a refusal names it: `1/20 s`, or `2 s`.
fn seconds(len: i64) -> String {
    match FLICKS % len {
        0 => format!("1/{} s", FLICKS / len),
        _ if len % FLICKS == 0 => format!("{} s", len / FLICKS),
        _ => format!("{:.6} s", len as f64 / FLICKS as f64),
    }
}

/// #551, the rate rule (Net `net@1`): each stepping item's step length divides the match step's
/// or is a whole multiple of it, so a 120 Hz world and a 1 Hz economy both line up with match
/// steps; any other is refused, naming both step lengths.
fn rate_rule(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let hz = item["params"]["step_rate"].as_f64().unwrap_or(60.0);
    let Ok(step) = deep_canvas::time::step_length(hz) else {
        return Vec::new();
    };
    let faster_only = FASTER_ONLY.load(std::sync::atomic::Ordering::Relaxed);
    let mut out = Vec::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    let worlds = doc
        .get("worlds")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    let stepping = items
        .filter(|(other, i)| other.as_str() != id && i["kind"] == "logic@1")
        .map(|(other, i)| {
            (
                format!("items/{other}/params/step_rate"),
                other,
                i["params"]["step_rate"].as_f64().unwrap_or(60.0),
            )
        })
        .chain(worlds.map(|(w, world)| {
            (
                format!("worlds/{w}/step_rate"),
                w,
                world["step_rate"].as_f64().unwrap_or(120.0),
            )
        }));
    for (path, other, rate) in stepping {
        let Ok(len) = deep_canvas::time::step_length(rate) else {
            continue;
        };
        let lines_up = if faster_only {
            step % len == 0
        } else {
            step % len == 0 || len % step == 0
        };
        if !lines_up {
            out.push(Raised {
                code: "out_of_range",
                severity: "error",
                path,
                what: format!(
                    "{other} steps every {len} flicks ({}, {rate} Hz), which neither divides match {id}'s step of {step} flicks ({}, {hz} Hz) nor is a whole multiple of it",
                    seconds(len),
                    seconds(step)
                ),
                fix_ops: None,
            });
        }
    }
    out
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
    /// The document's `controls`: what a player's entry must name, within its range (#550).
    pub controls: Value,
    /// #552: the controls whose entries take a random draw after commit.
    pub draw_after: Vec<String>,
    /// #552: the piece reads `match.me`, so its Join prompt says its fog is a courtesy.
    pub courtesy: bool,
    /// #277: a logic item reads `net.seats`, so a leave, a drop or an absence hands the seat to
    /// the piece's bot at one agreed step; else the match ends as before, nothing playing it.
    pub seats: bool,
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
            controls: controls(form),
            draw_after: p["draw_after"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|c| Some(c.as_str()?.to_string()))
                .collect(),
            courtesy: crate::prompt::reads_me(form),
            seats: reads_seats(form),
        })
    }

    /// One match step, in flicks.
    pub fn step(&self) -> i64 {
        FLICKS / self.step_rate
    }
}

/// The document's `controls`, and under [`PROFILE`] the shape of the profile record a logic item
/// keeps (#276), which each player's step-0 entry is held to.
fn controls(form: &Value) -> Value {
    let mut c = form.get("controls").cloned().unwrap_or(json!({}));
    let items = form
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    if let Some(arrays) = items
        .filter_map(|(_, i)| i.pointer("/params/profile/arrays"))
        .next()
    {
        c[PROFILE] = json!({"profile": arrays});
    }
    c
}

/// #276: the control key a player's profile record entry travels under, at step 0 only.
pub const PROFILE: &str = ":profile";

/// #276: a profile record's entry, `{profile: sha256, arrays}`, holds an array of each name the
/// piece's profile declares, of its count, and nothing else.
fn admit_profile(shape: &Value, value: &Value) -> Result<(), Value> {
    let fits = |name: &str, want: &Value| {
        let n = want.get("count").and_then(Value::as_u64).unwrap_or(1) as usize;
        value["arrays"][name]
            .as_array()
            .is_some_and(|a| a.len() == n && a.iter().all(|x| x.is_number() || x.is_boolean()))
    };
    let shape = shape.as_object().cloned().unwrap_or_default();
    let ok = value["profile"].as_str().is_some_and(|h| h.len() == 64)
        && value["arrays"]
            .as_object()
            .is_some_and(|a| a.len() == shape.len())
        && shape.iter().all(|(n, w)| fits(n, w));
    if ok {
        Ok(())
    } else {
        Err(
            json!({"code": "out_of_range", "control": PROFILE, "value": value,
            "what": "a profile record's entry holds the arrays the piece's profile declares"}),
        )
    }
}

/// #550: the checks every player's entry passes on every copy, a peer's as the viewer's own: it
/// names a control the piece declares, and its value is one that control can take (a number
/// within a slider's range, one of a choice's options, a text within its cap). The refusal names
/// the code and the control; the copy adds the player.
/// #277: whether a logic item of `form` reads `net.seats`.
pub fn reads_seats(form: &Value) -> bool {
    let items = form.get("items").and_then(Value::as_object);
    items.into_iter().flatten().any(|(_, i)| {
        i["kind"].as_str().is_some_and(|k| k.starts_with("logic@"))
            && i["params"]["reads"]
                .as_array()
                .is_some_and(|r| r.iter().any(|r| r == crate::copy::NET_SEATS))
    })
}

pub fn admit(controls: &Value, control: &str, value: &Value) -> Result<(), Value> {
    // #552: a draw's commitment and bits are the net module's own entries.
    if control == crate::draw::COMMIT || control == crate::draw::REVEAL {
        return crate::draw::admit(control, value);
    }
    if let Some(shape) = controls.get(PROFILE).filter(|_| control == PROFILE) {
        return admit_profile(&shape["profile"], value);
    }
    // #277: a seat entry the net module writes, never a player's control.
    if control == crate::copy::SEAT {
        return match crate::copy::Seat::named(value.as_str().unwrap_or_default()) {
            Some(_) => Ok(()),
            None => Err(
                json!({"code": "out_of_range", "control": control, "value": value,
                               "what": "a seat is left, absent or back"}),
            ),
        };
    }
    let Some(c) = controls.get(control) else {
        return Err(json!({"code": "unknown_control", "control": control,
            "what": format!("the piece declares no control {control}")}));
    };
    let out = |what: String| {
        Err(json!({"code": "out_of_range", "control": control, "value": value, "what": what}))
    };
    if let Some([lo, hi]) = c
        .get("range")
        .and_then(Value::as_array)
        .and_then(|r| Some([r.first()?.as_f64()?, r.get(1)?.as_f64()?]))
    {
        match value.as_f64() {
            Some(v) if v.is_finite() && (lo..=hi).contains(&v) => {}
            _ => return out(format!("{control} takes a number from {lo} to {hi}")),
        }
    }
    if let Some(options) = c.get("options").and_then(Value::as_array) {
        let named = |o: &Value| o.get("name").unwrap_or(o) == value;
        if !options.iter().any(named) {
            return out(format!("{control} takes one of its options"));
        }
    }
    if let Some(max) = c.get("max_bytes").and_then(Value::as_u64) {
        if value.as_str().is_none_or(|t| t.len() as u64 > max) {
            return out(format!("{control} takes a text of at most {max} bytes"));
        }
    }
    Ok(())
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

    #[test]
    fn an_entry_names_a_declared_control_and_a_value_in_its_range() {
        let controls = json!({"paddle": {"kind": "slider", "range": [-1, 1]},
                              "serve": {"kind": "button"}});
        assert!(admit(&controls, "paddle", &json!(0.5)).is_ok());
        assert!(admit(&controls, "serve", &json!(1)).is_ok());
        assert_eq!(
            admit(&controls, "paddle", &json!(1.5)).unwrap_err()["code"],
            "out_of_range"
        );
        assert_eq!(
            admit(&controls, "paddle", &json!("x")).unwrap_err()["code"],
            "out_of_range"
        );
        assert_eq!(
            admit(&controls, "jump", &json!(1)).unwrap_err()["code"],
            "unknown_control"
        );
    }
}
