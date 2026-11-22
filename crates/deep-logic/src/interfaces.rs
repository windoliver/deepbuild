//! Library interfaces (canvas primitives: Logic: library interfaces; #416): what a library offers,
//! declared by a pack. An interface names its exports with their signatures, the state layout a
//! library keeps (optional), fixtures whose expected values come from the interface and never from
//! a library, the planted libraries that must fail one of them, and the digest over its exports,
//! layout and fixtures. A library that names an interface in `implements` links only once every
//! fixture of that interface passes on this core, run once per library hash and interface digest.
//! A program imports an interface's export as `lib:<name>@<major>.<export>`, resolved to the linked
//! library that implements it.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Map, Value};
use wasmparser::{Parser, Payload, TypeRef};

use crate::links::{Lib, Pack};

/// One export an interface names: a function with its parameter and result types.
#[derive(Clone, Debug, PartialEq)]
pub struct Export {
    pub name: String,
    pub params: Vec<String>,
    pub results: Vec<String>,
}

/// An interface as a pack declares it.
#[derive(Clone, Debug)]
pub struct Interface {
    /// Its name in `lib.interface@1`: `name@major` as a first-party pack declares it, and
    /// `<pack name>.<name>@<major>` for an outside pack's. `implements` and claims name it so.
    pub name: String,
    /// `name@major` as its pack declares it, which a program imports it by.
    pub label: String,
    pub exports: Vec<Export>,
    pub layout: Option<String>,
    pub fixtures: Vec<String>,
    pub planted: Vec<String>,
    pub digest: String,
    /// Its kind kit's planted twins (#1255): each a planted library, the fixture it runs and the
    /// kind rule it must raise there.
    pub twins: Vec<Twin>,
    /// The pack that declares it, `<name>@<version>`, and where that pack came from.
    pub pack: String,
    pub origin: Origin,
}

/// A planted twin of an interface's kind kit: one of its planted libraries, a fixture its pack
/// carries, and the code of the rule the library must fail on it.
#[derive(Clone, Debug)]
pub struct Twin {
    pub planted: String,
    pub example: String,
    pub expect: String,
}

/// Where a pack came from: a first-party pack's interfaces bind every claim; an outside pack's
/// bind only its author's, so one the working agent wrote binds only the agent's own.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Origin {
    FirstParty,
    Installed,
    Agent,
}

fn strings(v: Option<&Value>) -> Option<Vec<String>> {
    v.map_or(Some(Vec::new()), |v| {
        v.as_array()?
            .iter()
            .map(|x| x.as_str().map(str::to_string))
            .collect()
    })
}

impl Interface {
    /// The interface `label` as pack `pack_name` (`pack`, `<name>@<version>`) declares it, or None
    /// when its shape is wrong.
    pub fn parse(
        label: &str,
        v: &Value,
        pack_name: &str,
        pack: &str,
        origin: Origin,
    ) -> Option<Interface> {
        let exports = v
            .get("exports")?
            .as_array()?
            .iter()
            .map(|e| {
                Some(Export {
                    name: e.get("name")?.as_str()?.to_string(),
                    params: strings(e.get("params"))?,
                    results: strings(e.get("results"))?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        Some(Interface {
            name: match origin {
                Origin::FirstParty => label.to_string(),
                _ => format!("{pack_name}.{label}"),
            },
            label: label.to_string(),
            exports,
            layout: match v.get("layout") {
                None | Some(Value::Null) => None,
                Some(l) => Some(l.as_str()?.to_string()),
            },
            fixtures: strings(v.get("fixtures"))?,
            planted: strings(v.get("planted"))?,
            digest: v.get("digest")?.as_str()?.to_string(),
            twins: match v.get("twins") {
                None => Vec::new(),
                Some(t) => t
                    .as_array()?
                    .iter()
                    .map(|t| {
                        let text = |k: &str| Some(t.get(k)?.as_str()?.to_string());
                        Some(Twin {
                            planted: text("planted")?,
                            example: text("example")?,
                            expect: text("expect")?,
                        })
                    })
                    .collect::<Option<_>>()?,
            },
            pack: pack.to_string(),
            origin,
        })
    }

    pub fn export_names(&self) -> Vec<String> {
        self.exports.iter().map(|e| e.name.clone()).collect()
    }

    /// The digest its fields give: the d1 digest of its exports, its layout and its fixtures.
    pub fn computed_digest(&self) -> String {
        let exports: Vec<Value> = self
            .exports
            .iter()
            .map(|e| json!({"name": e.name, "params": e.params, "results": e.results}))
            .collect();
        deep_canvas_sandbox::interfaces::digest(
            &json!(exports),
            &json!(self.layout),
            &json!(self.fixtures),
        )
    }
}

/// The interface the packs hold under `name`: the build's first-party packs come first, then a
/// first-party pack's before an installed one's, and an installed one's before the agent's.
pub fn declared<'a>(packs: &'a [Pack], name: &str) -> Option<&'a Interface> {
    packs
        .iter()
        .filter_map(|p| p.interfaces.get(name))
        .min_by_key(|i| i.origin)
}

/// The interfaces a program imports by name, `lib:<name>@<major>`, each once.
pub fn imported(program: &[u8]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for payload in Parser::new(0).parse_all(program).flatten() {
        if let Payload::ImportSection(s) = payload {
            for i in s.into_imports().flatten() {
                let name = i.module.strip_prefix("lib:").filter(|n| n.contains('@'));
                if let (Some(n), TypeRef::Func(_)) = (name, i.ty) {
                    if !out.iter().any(|o| o == n) {
                        out.push(n.to_string());
                    }
                }
            }
        }
    }
    out
}

/// A fixture's tolerance: `exact`, or `{abs, rel}`, within which an actual value stands for the
/// expected one: |actual − expected| ≤ max(abs, rel × |expected|).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Tolerance {
    Exact,
    Within { abs: f64, rel: f64 },
}

impl Tolerance {
    pub fn parse(v: Option<&Value>) -> Option<Tolerance> {
        match v {
            None => Some(Tolerance::Exact),
            Some(Value::String(s)) if s == "exact" => Some(Tolerance::Exact),
            Some(Value::Object(o)) => {
                let n = |k: &str| match o.get(k) {
                    None => Some(0.0),
                    Some(x) => x.as_f64().filter(|x| x.is_finite() && *x >= 0.0),
                };
                Some(Tolerance::Within {
                    abs: n("abs")?,
                    rel: n("rel")?,
                })
            }
            _ => None,
        }
    }

    /// Whether `actual` stands for `expected`: numbers within the tolerance (exact: the same
    /// value), a vector's numbers each so (#981), anything else equal.
    pub fn holds(&self, expected: &Value, actual: &Value) -> bool {
        match (expected, actual) {
            (Value::Array(e), Value::Array(a)) => {
                e.len() == a.len() && e.iter().zip(a).all(|(e, a)| self.holds(e, a))
            }
            _ => match (expected.as_f64(), actual.as_f64()) {
                (Some(e), Some(a)) => match self {
                    Tolerance::Exact => e == a,
                    Tolerance::Within { abs, rel } => (a - e).abs() <= abs.max(rel * e.abs()),
                },
                _ => expected == actual,
            },
        }
    }
}

/// Each export the interface names that `signatures` (a library's own, by export name) lacks or
/// types otherwise, as refusals naming the interface and the export.
fn exports_missing(
    interface: &Interface,
    library: &str,
    signatures: &std::collections::BTreeMap<String, (Vec<String>, Vec<String>)>,
) -> Vec<Value> {
    interface
        .exports
        .iter()
        .filter(|e| signatures.get(&e.name) != Some(&(e.params.clone(), e.results.clone())))
        .map(|e| {
            let has = signatures.get(&e.name).map(|(p, r)| json!({"params": p, "results": r}));
            json!({"rule": "interface", "interface": interface.name, "library": library, "export": e.name,
                   "expected": {"params": e.params, "results": e.results}, "actual": has,
                   "what": format!("{library} implements {} but {}", interface.name, match &has {
                       None => format!("exports no {}", e.name),
                       Some(_) => format!("types {} otherwise than the interface", e.name),
                   })})
        })
        .collect()
}

/// The interface's refusal when its digest isn't the digest its fields give: it changed under it.
fn changed(iface: &Interface) -> Option<Value> {
    let computed = iface.computed_digest();
    (computed != iface.digest).then(|| json!({"rule": "interface", "interface": iface.name, "digest": iface.digest, "actual": computed,
        "what": format!("{} changed under its digest {}: its exports, layout and fixtures give {computed}; a change takes a new major", iface.name, iface.digest)}))
}

/// A library under an interface's fixtures. Each fixture's item links it by `label`, and every
/// interface the fixture's program imports resolves to it, as the item's one link.
pub(crate) struct UnderTest<'a> {
    pub label: &'a str,
    pub hash: &'a str,
    pub agent: bool,
    pub exports: Vec<String>,
    pub fixtures: &'a [String],
    pub needs: &'a [(String, String)],
}

impl<'a> UnderTest<'a> {
    fn of(lib: &'a Lib) -> UnderTest<'a> {
        UnderTest {
            label: &lib.label,
            hash: &lib.hash,
            agent: lib.agent,
            exports: lib.exports.clone(),
            fixtures: &lib.fixtures,
            needs: &lib.needs,
        }
    }
}

fn bad(what: &str) -> Value {
    json!({"ok": false, "code": "bad_input", "what": what})
}

impl crate::Logic {
    /// The interfaces `lib` implements, each one's fixtures run on it once per library hash and
    /// interface digest, or the refusals that keep it from linking: an interface no pack declares,
    /// one that changed under its digest, an export it lacks, or a fixture it fails.
    pub(crate) fn verify_interfaces(
        &mut self,
        piece_v: &Value,
        lib: &Lib,
    ) -> Result<Value, Vec<Value>> {
        if lib.implements.is_empty() {
            return Ok(json!([]));
        }
        let packs = crate::links::packs(piece_v).ok_or_else(|| vec![bad("packs")])?;
        let mut out = Vec::new();
        for name in &lib.implements {
            let iface = self.claimed(&packs, lib, name)?;
            let records = self.interface_fixtures(piece_v, &iface, &UnderTest::of(lib))?;
            out.push(json!({"interface": name, "fixtures": records}));
        }
        Ok(Value::Array(out))
    }

    /// The interface `name` that `lib` claims, once it has kept its digest and `lib` exports what
    /// it names with its signatures.
    fn claimed(&self, packs: &[Pack], lib: &Lib, name: &str) -> Result<Interface, Vec<Value>> {
        let Some(iface) = declared(packs, name).cloned() else {
            return Err(vec![
                json!({"rule": "interface", "interface": name, "library": lib.label,
                "what": format!("{} implements {name}, which no installed pack declares", lib.label)}),
            ]);
        };
        if let Some(r) = changed(&iface) {
            return Err(vec![r]);
        }
        let object = deep_canvas_sandbox::link::Object {
            name: lib.name(),
            label: &lib.label,
            bytes: &lib.bytes,
            exports: &lib.exports,
            implements: &[],
        };
        let signatures =
            deep_canvas_sandbox::link::signatures(&object).map_err(|r| vec![r.to_json()])?;
        let missing = exports_missing(&iface, &lib.label, &signatures);
        if !missing.is_empty() {
            return Err(missing);
        }
        Ok(iface)
    }

    /// The claim that `lib` implements the interface `name`, decided from that interface's
    /// fixtures run on it: FAIL when one fails; PASS when they pass and a first-party pack
    /// declares it; else INCONCLUSIVE with one ask, since an outside pack's interface binds only its
    /// author's own claims, as the working agent's own checks do.
    pub(crate) fn claim_interface(
        &mut self,
        piece_v: &Value,
        packs: &[Pack],
        lib: &Lib,
        name: &str,
    ) -> Value {
        let ran = self.claimed(packs, lib, name).and_then(|i| {
            Ok((
                self.interface_fixtures(piece_v, &i, &UnderTest::of(lib))?,
                i,
            ))
        });
        match ran {
            Err(r) => json!({"ok": true, "verdict": "FAIL", "asks": [], "refusals": r}),
            Ok((_, i))
                if i.origin == Origin::FirstParty || self.planted.outside_interface_binds_all =>
            {
                json!({"ok": true, "verdict": "PASS", "asks": []})
            }
            Ok((_, i)) => {
                let whose = match i.origin {
                    Origin::Agent => "a pack the working agent wrote",
                    _ => "an outside pack",
                };
                json!({"ok": true, "verdict": "INCONCLUSIVE", "asks": [{"kind": "approval", "interface": name,
                    "why": format!("{} implements {name}, an interface from {whose} ({}): its fixtures bind only its author's own claims until you approve the pack", lib.label, i.pack)}]})
            }
        }
    }

    /// A pack's interface at its check: its digest the one its fields give, at least one fixture
    /// and one planted library, and each planted library failing one of its fixtures. The verdicts
    /// are `[{planted, fails}]`, the fixture each failed first; a refusal names the interface.
    pub(crate) fn judge_interface(
        &mut self,
        piece_v: &Value,
        iface: &Interface,
        agent: bool,
    ) -> Result<Value, Vec<Value>> {
        let refuse = |what: String| {
            vec![json!({"rule": "interface", "interface": iface.name, "what": what})]
        };
        if let Some(r) = changed(iface) {
            return Err(vec![r]);
        }
        if iface.fixtures.is_empty() {
            return Err(refuse(format!("{} ships no fixture", iface.name)));
        }
        if iface.planted.is_empty() {
            return Err(refuse(format!(
                "{} ships no planted library: each interface ships one that must fail one of its fixtures",
                iface.name
            )));
        }
        let mut judged = Vec::new();
        for sha in &iface.planted {
            let label = format!("planted.{}@0", &sha[..sha.len().min(16)]);
            let under = UnderTest {
                label: &label,
                hash: sha,
                agent,
                exports: iface.export_names(),
                fixtures: &[],
                needs: &[],
            };
            match self.interface_fixtures(piece_v, iface, &under) {
                Ok(_) => {
                    let mut r = refuse(format!(
                        "{}'s planted library {sha} passes every fixture: a planted library must fail one",
                        iface.name
                    ));
                    r[0]["planted"] = json!(sha);
                    return Err(r);
                }
                Err(r) => {
                    let fails = r.first().map_or(Value::Null, |r| r["fixture"].clone());
                    judged.push(json!({"planted": sha, "fails": fails}));
                }
            }
        }
        Ok(Value::Array(judged))
    }

    /// An interface's kind kit at its pack's check (#1255; Pack: kind rules and the kind kit): each
    /// planted twin's library run on its example, a fixture the pack carries, and read by the
    /// interface's kind rules as `judge` reads a run, each rule's params the example's `rules`.
    /// The verdicts are `[{planted, example, expect, raised}]`, `raised` the rules that failed; a
    /// twin that doesn't raise the rule it names refuses the pack, naming the interface, the twin
    /// and what it raised.
    pub(crate) fn kit(
        &mut self,
        piece_v: &Value,
        iface: &Interface,
        agent: bool,
    ) -> Result<Value, Vec<Value>> {
        let mut ran = Vec::new();
        for t in &iface.twins {
            let refuse = |what: String, raised: Value| {
                vec![
                    json!({"rule": "interface", "interface": iface.name, "planted": t.planted, "example": t.example,
                    "expect": t.expect, "raised": raised, "what": what}),
                ]
            };
            if !iface.planted.contains(&t.planted) {
                return Err(refuse(
                    format!(
                        "{}'s twin for {} names {}, which isn't one of its planted libraries",
                        iface.name, t.expect, t.planted
                    ),
                    json!([]),
                ));
            }
            let label = format!("planted.{}@0", &t.planted[..t.planted.len().min(16)]);
            let under = UnderTest {
                label: &label,
                hash: &t.planted,
                agent,
                exports: iface.export_names(),
                fixtures: &[],
                needs: &[],
            };
            let (fixture, mut line) = Self::fixture_call(piece_v, iface, &under, &t.example)?;
            line["call"] = json!("judge");
            line["rules"] = fixture.get("rules").cloned().unwrap_or(json!({}));
            let outer = self.under_test.replace(t.planted.clone());
            let judged = self.judge(&line);
            self.under_test = outer;
            let judged = judged.map_err(|r| {
                r["refusals"]
                    .as_array()
                    .cloned()
                    .unwrap_or_else(|| vec![r.clone()])
            })?;
            let mut raised: Vec<&String> = judged["items"]
                .as_object()
                .into_iter()
                .flat_map(|items| items.values())
                .filter_map(|i| i["rules"].as_object())
                .flatten()
                .filter(|(_, r)| r["verdict"] == json!("FAIL"))
                .map(|(code, _)| code)
                .collect();
            raised.sort();
            raised.dedup();
            if !raised.contains(&&t.expect) {
                return Err(refuse(
                    format!("{}'s planted twin {} raises {raised:?} on {}, not {}: each rule's planted twin fails with that rule's code", iface.name, t.planted, t.example, t.expect),
                    json!(raised),
                ));
            }
            ran.push(json!({"planted": t.planted, "example": t.example, "expect": t.expect, "raised": raised}));
        }
        Ok(Value::Array(ran))
    }

    /// `iface`'s fixtures run on `under`, once per library hash and interface digest in this
    /// process: `ran` is true only at the run.
    fn interface_fixtures(
        &mut self,
        piece_v: &Value,
        iface: &Interface,
        under: &UnderTest,
    ) -> Result<Value, Vec<Value>> {
        let needs: Vec<String> = under
            .needs
            .iter()
            .map(|(n, a)| format!("{n} {a}"))
            .collect();
        let key = json!(["interface", iface.digest, under.hash, needs]).to_string();
        if let Some(done) = self.verified.get(&key) {
            return done.clone().map(|mut r| {
                for f in r.as_array_mut().into_iter().flatten() {
                    f["ran"] = json!(false);
                }
                r
            });
        }
        if iface.fixtures.is_empty() {
            return Err(vec![json!({"rule": "interface", "interface": iface.name,
                "what": format!("{} ships no fixture", iface.name)})]);
        }
        let mut records = Vec::new();
        for id in &iface.fixtures {
            match self.interface_fixture(piece_v, iface, under, id) {
                Ok(r) => records.push(r),
                Err((refusals, verdict)) => {
                    if verdict {
                        self.verified.insert(key, Err(refusals.clone()));
                    }
                    return Err(refusals);
                }
            }
        }
        let records = Value::Array(records);
        self.verified.insert(key, Ok(records.clone()));
        Ok(records)
    }

    /// A fixture of `iface` as a call on `under`: the fixture, and the `bake` of its item, linking
    /// `under`, with its controls, on its track for its steps.
    fn fixture_call(
        piece_v: &Value,
        iface: &Interface,
        under: &UnderTest,
        id: &str,
    ) -> Result<(Value, Value), Vec<Value>> {
        // The piece's assets, and the first-party packs' it doesn't carry.
        let mut assets = crate::first_party::assets().clone();
        assets.extend(
            piece_v
                .get("assets")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default(),
        );
        let refuse = |what: String| {
            vec![json!({"rule": "interface", "interface": iface.name, "fixture": id, "what": what})]
        };
        let decoded = |sha: &str| -> Option<Vec<u8>> {
            B64.decode(assets.get(sha)?.as_str()?)
                .ok()
                .filter(|b| deep_canvas_sandbox::rewrite::hash(b) == sha)
        };
        let fixture: Value = decoded(id)
            .and_then(|b| serde_json::from_slice(&b).ok())
            .ok_or_else(|| {
                refuse(format!(
                    "{}'s fixture {id} isn't a fixture the piece carries",
                    iface.name
                ))
            })?;
        let mut item = fixture.get("item").cloned().unwrap_or(Value::Null);
        let program = item["params"]["program"]
            .as_str()
            .and_then(decoded)
            .unwrap_or_default();
        // The library under test, carried by a pack of its own that names it as implementing every
        // interface the fixture's program imports, so each resolves to it.
        let needs: Vec<Value> = under
            .needs
            .iter()
            .map(|(n, a)| json!({"name": n, "asset": a}))
            .collect();
        let mut packs = vec![
            json!({"name": format!("{} under test", iface.name), "version": "0",
            "origin": if under.agent { "agent" } else { "installed" },
            "libs": {under.label: {"asset": under.hash, "exports": under.exports, "fixtures": under.fixtures,
                "needs": needs, "implements": imported(&program)}}}),
        ];
        packs.extend(piece_v["packs"].as_array().cloned().unwrap_or_default());
        item["params"]["links"] = json!([{"name": under.label, "asset": under.hash}]);
        // The fixture's other items beside its own, such as a lane graph's floor paths (#981).
        let mut items = fixture
            .get("items")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        items.insert("fixture".into(), item);
        let mut piece = json!({"seed": 0, "packs": packs, "items": items, "assets": assets});
        if let Some(c) = fixture.get("controls") {
            piece["controls"] = c.clone();
        }
        let line = json!({"call": "bake", "piece": piece, "track": fixture.get("track").cloned().unwrap_or(json!([])),
            "steps": fixture.get("steps").cloned().unwrap_or(json!(1))});
        Ok((fixture, line))
    }

    /// One fixture of `iface` run on `under`: its item, linking `under`, with its controls, baked on
    /// its track and held to logic.determinism, its arrays compared with the expected values within
    /// its tolerance. A refusal is `true` when the run itself failed.
    fn interface_fixture(
        &mut self,
        piece_v: &Value,
        iface: &Interface,
        under: &UnderTest,
        id: &str,
    ) -> Result<Value, (Vec<Value>, bool)> {
        let (fixture, line) =
            Self::fixture_call(piece_v, iface, under, id).map_err(|r| (r, false))?;
        let expect = fixture.get("expect").cloned().unwrap_or(Value::Null);
        let tolerance = Tolerance::parse(expect.get("tolerance")).ok_or_else(|| {
            (
                vec![json!({"rule": "interface", "interface": iface.name, "fixture": id,
                    "what": format!("{}'s fixture {id} has a tolerance that is neither exact nor {{abs, rel}}", iface.name)})],
                false,
            )
        })?;
        let started = std::time::Instant::now();
        let outer = self.under_test.replace(under.hash.to_string());
        let bake = self.bake(&line);
        let det = bake.as_ref().ok().map(|_| {
            let mut line = line.clone();
            line["at_times"] = json!([0.0]);
            self.determinism(&line)
        });
        self.under_test = outer;
        let ns = started.elapsed().as_nanos() as u64;
        let bake = bake.map_err(|r| {
            let refusals = r["refusals"]
                .as_array()
                .cloned()
                .unwrap_or_else(|| vec![r.clone()]);
            (refusals, false)
        })?;
        if let Some(r) = outside(iface, under.label, id, &expect, &tolerance, &bake) {
            return Err((vec![r], true));
        }
        match det {
            Some(Ok(d)) if d["verdict"] == json!("PASS") => {}
            Some(Ok(d)) => {
                return Err((
                    vec![
                        json!({"rule": "interface", "interface": iface.name, "library": under.label, "fixture": id,
                    "what": format!("{} fails {}'s fixture {id} under logic.determinism", under.label, iface.name),
                    "failures": d["failures"]}),
                    ],
                    true,
                ))
            }
            Some(Err(r)) => return Err((vec![r], false)),
            None => {}
        }
        let deep: Map<String, Value> = bake["checkpoints"]["fixture"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| (c["step"].to_string(), c["deep_hash"].clone()))
            .collect();
        Ok(json!({"fixture": id, "verdict": "PASS", "ran": true, "ns": ns, "deep_hashes": deep}))
    }
}

/// The first expected value a fixture's run lands outside its tolerance, at the earliest step, in
/// the fixture's own order of arrays, as a refusal naming the interface, the fixture, the array,
/// the element, the expected value, what the run gave and the tolerance as the fixture wrote it.
fn outside(
    iface: &Interface,
    library: &str,
    fixture: &str,
    expect: &Value,
    tolerance: &Tolerance,
    bake: &Value,
) -> Option<Value> {
    let written = expect.get("tolerance").cloned().unwrap_or(json!("exact"));
    let mut steps: Vec<(i64, &Map<String, Value>)> = expect
        .get("arrays")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(k, v)| Some((k.parse().ok()?, v.as_object()?)))
        .collect();
    steps.sort_by_key(|s| s.0);
    let ran = bake["steps"].as_array().cloned().unwrap_or_default();
    for (step, arrays) in steps {
        let at = ran.iter().find(|s| s["step"] == json!(step));
        for (name, want) in arrays {
            let got = at.map_or(&Value::Null, |s| &s["arrays"][format!("fixture.{name}")]);
            let (w, g) = (
                want.as_array().cloned().unwrap_or_default(),
                got.as_array().cloned().unwrap_or_default(),
            );
            let index = (0..w.len().max(g.len())).find(|i| match (w.get(*i), g.get(*i)) {
                (Some(e), Some(a)) => !tolerance.holds(e, a),
                _ => true,
            });
            if let Some(index) = index {
                let e = w.get(index).cloned().unwrap_or(Value::Null);
                let a = g.get(index).cloned().unwrap_or(Value::Null);
                return Some(
                    json!({"rule": "interface", "interface": iface.name, "library": library, "fixture": fixture,
                    "step": step, "array": name, "index": index, "expected": e, "actual": a, "tolerance": written,
                    "what": format!("{library} fails {}'s fixture {fixture}: {name}[{index}] at step {step} is {a}, outside {e} within {written}",
                        iface.name)}),
                );
            }
        }
    }
    None
}
