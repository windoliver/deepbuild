use std::collections::BTreeMap;

use deep_canvas::document::check_in;
use deep_canvas::kinds::{Entry, Migration, Version};
use deep_canvas::registry::{
    BuildSet, Implementation, Manifest, Module, Range, Registrar, Registry, Sealed, Semver,
};
use serde_json::{json, Value};

const ID: &str = "#2130.00e7dfcf";

fn manifest(name: &str) -> Manifest {
    let version = Semver {
        major: 2,
        minor: 0,
        patch: 0,
    };
    Manifest {
        name: name.to_string(),
        version,
        core: Range::parse("*").expect("`*` is a range"),
        depends_on: BTreeMap::new(),
        feature: name.to_string(),
        license: "Apache-2.0".to_string(),
        implements: format!("{name}@2"),
        implementation: Implementation::reference(name, version),
    }
}

fn migrating_kind(r: &mut Registrar) {
    r.kind(
        Entry {
            family: "b",
            name: "thing",
            versions: vec![
                Version {
                    major: 1,
                    minor: 0,
                    params: Vec::new(),
                },
                Version {
                    major: 2,
                    minor: 0,
                    params: Vec::new(),
                },
            ],
            migrations: vec![Migration {
                from: 1,
                to: 2,
                renames: Vec::new(),
                retires: Vec::new(),
                map: None,
            }],
        },
        &[],
        "",
    );
}

fn single_major_kind(r: &mut Registrar) {
    r.kind(
        Entry {
            family: "c",
            name: "thing",
            versions: vec![Version {
                major: 2,
                minor: 0,
                params: Vec::new(),
            }],
            migrations: Vec::new(),
        },
        &[],
        "",
    );
}

fn sealed_set() -> Sealed {
    let set = Registry::new(BuildSet::Core)
        .with(Module {
            manifest: manifest("b"),
            register: migrating_kind,
        })
        .with(Module {
            manifest: manifest("c"),
            register: single_major_kind,
        })
        .seal();
    match set {
        Ok(sealed) => sealed,
        Err(e) => panic!(
            "{ID} precondition: the test modules b and c, each at 2.0.0, seal; the seal refused \
             them: {} {:?}: {}",
            e.code, e.modules, e.what
        ),
    }
}

fn requiring(module: &str, range: &str) -> Value {
    let mut doc = json!({
        "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
        "size": [10, 10], "requires": {"modules": {}},
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {}
    });
    doc["requires"]["modules"][module] = json!(range);
    doc
}

fn refusals(sealed: &Sealed, module: &str, range: &str) -> Vec<String> {
    let path = format!("requires/modules/{module}");
    let result = check_in(&requiring(module, range), sealed);
    let mut raised: Vec<String> = Vec::new();
    for issue in &result.issues {
        if issue.path == path {
            raised.push(format!("{}: {}", issue.code, issue.what));
        }
    }
    raised
}

#[test]
fn ac3_a_range_some_version_of_an_earlier_major_meets_is_met_by_a_module_that_migrates_from_it() {
    let sealed = sealed_set();

    let version = sealed
        .modules
        .iter()
        .find(|m| m.name == "b")
        .map(|m| m.version.to_string());
    assert_eq!(
        version.as_deref(),
        Some("2.0.0"),
        "{ID} precondition: the sealed set holds the module b at 2.0.0"
    );

    for range in ["^2", "^1"] {
        let raised = refusals(&sealed, "b", range);
        assert!(
            raised.is_empty(),
            "{ID} precondition: a document that requires b at {range} passes: {raised:?}"
        );
    }

    for range in [
        "^3",
        ">=2.1.0",
        "=2.0.1",
        "<1.0.0",
        "~0.9",
        ">=1.5.0, <1.2.0",
    ] {
        let raised = refusals(&sealed, "b", range);
        assert!(
            raised.iter().any(|r| r.starts_with("out_of_range: ")),
            "{ID} precondition: a document that requires b at {range}, which no version of \
             major 1 meets, is refused out_of_range at requires/modules/b: {raised:?}"
        );
    }

    let raised = refusals(&sealed, "c", "^1.2");
    assert!(
        raised.iter().any(|r| r.starts_with("out_of_range: ")),
        "{ID} precondition: a document that requires c at ^1.2 is refused out_of_range at \
         requires/modules/c, since c's one kind has no major 1 to migrate from: {raised:?}"
    );

    let mut problems: Vec<String> = Vec::new();
    for range in ["^1.2", "~1.4", "=1.3.0", ">=1.1.0, <2.0.0"] {
        let raised = refusals(&sealed, "b", range);
        if !raised.is_empty() {
            problems.push(format!("b at {range} is refused: {raised:?}"));
        }
    }
    assert!(
        problems.is_empty(),
        "{ID}: b is sealed at 2.0.0 and its one kind carries its step from major 1, so a range \
         some 1.x version meets is satisfied; the document check refuses it, as if only 1.0.0 \
         were tried: {problems:?}"
    );
}
