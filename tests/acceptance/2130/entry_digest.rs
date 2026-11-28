use std::collections::BTreeMap;

use deep_canvas::document::packs::{check_pack, Planted};
use deep_canvas::registry::{
    self, BuildSet, Implementation, Manifest, Module, Range, Registrar, Registry, Sealed, Semver,
};
use serde_json::{json, Value};

const ID: &str = "#2130.873c8710";
const REGISTRY: &str = "data.layout@1";
const NO_F64: u64 = 9_007_199_254_740_993;

fn layout(max_bytes: u64) -> Value {
    json!({
        "validator": "planted", "max_bytes": max_bytes,
        "twins": ["t"], "judged": [{"asset": "t", "valid": false, "offset": 5}],
        "fixtures": [], "admitted": [], "doc": "d"
    })
}

fn pack_check(sealed: &Sealed, name: &str, mut entry: Value) -> Result<Vec<String>, Vec<String>> {
    entry["name"] = json!(name);
    let manifest = json!({
        "id": "test/acc2130", "name": "acc2130", "version": "1.0.0", "license": "MIT",
        "description": "A test pack of the #2130 acceptance tests: one data layout.",
        "requires": {"core": ">=0.0.0", "modules": {}},
        "entries": {"data.layout@1": [entry]}
    });
    match check_pack(&manifest, sealed, Planted::default()) {
        Ok(pack) => Ok(pack.entries.iter().map(|e| e.digest.clone()).collect()),
        Err(issues) => Err(issues.iter().map(|i| i.to_json().to_string()).collect()),
    }
}

fn manifest() -> Manifest {
    let version = Semver {
        major: 1,
        minor: 0,
        patch: 0,
    };
    Manifest {
        name: "acc".to_string(),
        version,
        core: Range::parse("*").expect("`*` is a range"),
        depends_on: BTreeMap::new(),
        feature: "acc".to_string(),
        license: "Apache-2.0".to_string(),
        implements: "acc@1".to_string(),
        implementation: Implementation::reference("acc", version),
    }
}

fn fills_a_layout(r: &mut Registrar) {
    r.entry(REGISTRY, "acc.grid", layout(4096), "R6");
}

fn fills_a_layout_no_f64_holds(r: &mut Registrar) {
    r.entry(REGISTRY, "acc.grid", layout(NO_F64), "R6");
}

#[test]
fn ac2_the_pack_check_refuses_an_entry_with_no_canonical_form_naming_registry_and_entry() {
    let sealed = registry::core();

    let first = pack_check(&sealed, "acc2130.grid", layout(4096));
    let second = pack_check(&sealed, "acc2130.grid", layout(4097));
    match (&first, &second) {
        (Ok(a), Ok(b)) => {
            assert!(
                a.len() == 1 && b.len() == 1 && !a[0].is_empty() && !b[0].is_empty(),
                "{ID} precondition: an entry with max_bytes 4096, and one with 4097, is sealed \
                 with a digest: {a:?} {b:?}"
            );
            assert_ne!(
                a[0], b[0],
                "{ID} precondition: entries that differ in max_bytes have different digests"
            );
        }
        _ => panic!(
            "{ID} precondition: the pack check admits a data.layout@1 entry that passes its kit, \
             with max_bytes 4096 and with 4097: {first:?} {second:?}"
        ),
    }

    let mut spare = layout(4096);
    spare["spare"] = json!(NO_F64);
    let mut accents = layout(4096);
    accents["caf\u{e9}"] = json!(1);
    accents["cafe\u{301}"] = json!(2);
    let cases = [
        (
            "max_bytes: 9007199254740993",
            "acc2130.grid",
            layout(NO_F64),
        ),
        (
            "an extra member holding 9007199254740993",
            "acc2130.spare",
            spare,
        ),
        (
            "two keys that are one key after NFC",
            "acc2130.accents",
            accents,
        ),
    ];
    let mut problems: Vec<String> = Vec::new();
    for (what, name, entry) in cases {
        match pack_check(&sealed, name, entry) {
            Ok(digests) => problems.push(format!(
                "the entry {name} ({what}) is admitted and sealed with the digest {digests:?}"
            )),
            Err(issues) => {
                let named = issues
                    .iter()
                    .any(|issue| issue.contains(REGISTRY) && issue.contains(name));
                if !named {
                    problems.push(format!(
                        "the refusal of {name} ({what}) names no issue with both {REGISTRY} and \
                         {name}: {issues:?}"
                    ));
                }
            }
        }
    }
    assert!(
        problems.is_empty(),
        "{ID}: a pack's {REGISTRY} entry with no canonical form, which otherwise passes its kit, \
         is refused by the pack check, naming the registry and the entry, and is never sealed \
         with an empty digest: {problems:?}"
    );
}

#[test]
fn ac2_the_seal_gives_no_module_entry_an_empty_digest() {
    let fine = Registry::new(BuildSet::Core)
        .with(Module {
            manifest: manifest(),
            register: fills_a_layout,
        })
        .seal();
    match fine {
        Ok(sealed) => {
            let digest = sealed
                .registry(REGISTRY)
                .and_then(|listed| listed.entry("acc.grid"))
                .map(|entry| entry.digest.clone());
            assert!(
                digest.as_deref().is_some_and(|d| !d.is_empty()),
                "{ID} precondition: the module acc's {REGISTRY} entry acc.grid, with max_bytes \
                 4096, is sealed with a digest: {digest:?}"
            );
        }
        Err(e) => panic!(
            "{ID} precondition: the module acc's {REGISTRY} entry acc.grid, with max_bytes 4096, \
             seals; the seal refused it: {} {:?}: {}",
            e.code, e.modules, e.what
        ),
    }

    let bad = Registry::new(BuildSet::Core)
        .with(Module {
            manifest: manifest(),
            register: fills_a_layout_no_f64_holds,
        })
        .seal();
    if let Ok(sealed) = bad {
        let mut empty: Vec<String> = Vec::new();
        for listed in &sealed.registries {
            for entry in &listed.entries {
                if entry.digest.is_empty() {
                    empty.push(format!("{} {}", entry.registry, entry.name));
                }
            }
        }
        panic!(
            "{ID}: the set sealed though the module acc fills {REGISTRY} with acc.grid, whose \
             max_bytes 9007199254740993 leaves it no canonical form; the sealed entries with an \
             empty digest are {empty:?}"
        );
    }
}
