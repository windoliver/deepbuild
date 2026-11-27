use std::collections::BTreeMap;

use deep_canvas::registry::{
    BuildSet, Implementation, Manifest, Module, Raised, Range, Registrar, Registry, Semver,
};
use serde_json::Value;

const ID: &str = "#2130.b3f91bae";
const KIND: &str = "c.audit";

fn manifest(name: &str) -> Manifest {
    let version = Semver {
        major: 1,
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
        implements: format!("{name}@1"),
        implementation: Implementation::reference(name, version),
    }
}

fn first_run(_document: &Value, _input: &Value) -> Vec<(String, Raised)> {
    Vec::new()
}

fn second_run(_document: &Value, _input: &Value) -> Vec<(String, Raised)> {
    Vec::new()
}

fn registers_it_twice(r: &mut Registrar) {
    r.check(KIND, "any", &[], first_run);
    r.check(KIND, "any", &[], second_run);
}

fn registers_it_once(r: &mut Registrar) {
    r.check(KIND, "any", &[], first_run);
}

fn registers_its_own(r: &mut Registrar) {
    r.check("d.audit", "any", &[], first_run);
}

#[test]
fn ac4_the_seal_refuses_a_module_that_registers_one_check_kind_twice() {
    let once = Registry::new(BuildSet::Core)
        .with(Module {
            manifest: manifest("c"),
            register: registers_it_once,
        })
        .seal();
    match once {
        Ok(sealed) => {
            let kinds = sealed.check_kinds();
            let listed = kinds.into_iter().filter(|kind| *kind == KIND).count();
            assert_eq!(
                listed, 1,
                "{ID} precondition: a module that registers {KIND} once seals, and the document \
                 check registry lists the kind once"
            );
        }
        Err(e) => panic!(
            "{ID} precondition: a module that registers {KIND} once seals, but the seal refused \
             it: {} {:?}: {}",
            e.code, e.modules, e.what
        ),
    }

    let across = Registry::new(BuildSet::Core)
        .with(Module {
            manifest: manifest("c"),
            register: registers_it_once,
        })
        .with(Module {
            manifest: manifest("d"),
            register: registers_it_once,
        })
        .seal();
    match across {
        Ok(_) => panic!(
            "{ID} precondition: two modules that each register {KIND} are refused \
             duplicate_check_kind, but the set sealed"
        ),
        Err(e) => assert_eq!(
            e.code, "duplicate_check_kind",
            "{ID} precondition: two modules that each register {KIND} are refused \
             duplicate_check_kind: {}",
            e.what
        ),
    }

    let twice = Registry::new(BuildSet::Core)
        .with(Module {
            manifest: manifest("c"),
            register: registers_it_twice,
        })
        .with(Module {
            manifest: manifest("d"),
            register: registers_its_own,
        })
        .seal();
    match twice {
        Ok(sealed) => {
            let kinds = sealed.check_kinds();
            let listed = kinds.into_iter().filter(|kind| *kind == KIND).count();
            panic!(
                "{ID}: the set sealed though the module c registers the check kind {KIND} twice: \
                 no duplicate_check_kind was raised, check_kinds() lists {KIND} {listed} times and \
                 only the first registration's run is ever reached"
            );
        }
        Err(e) => {
            assert_eq!(
                e.code, "duplicate_check_kind",
                "{ID}: the seal of a module that registers {KIND} twice fails with \
                 duplicate_check_kind; it failed with {}: {}",
                e.code, e.what
            );
            assert_eq!(
                e.modules,
                ["c"],
                "{ID}: the duplicate_check_kind refusal names the module that registers {KIND} \
                 twice, c, and no other: {}",
                e.what
            );
        }
    }
}
