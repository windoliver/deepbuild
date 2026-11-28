use std::collections::BTreeMap;

use deep_canvas::registry::{
    BuildSet, Implementation, Manifest, Module, Raised, Range, Registrar, Registry, Semver,
};
use serde_json::Value;

const ID: &str = "#2130.219ed3ba";

fn manifest() -> Manifest {
    let version = Semver {
        major: 1,
        minor: 0,
        patch: 0,
    };
    Manifest {
        name: "c".to_string(),
        version,
        core: Range::parse("*").expect("`*` is a range"),
        depends_on: BTreeMap::new(),
        feature: "c".to_string(),
        license: "Apache-2.0".to_string(),
        implements: "c@1".to_string(),
        implementation: Implementation::reference("c", version),
    }
}

fn run(_document: &Value, _input: &Value) -> Vec<(String, Raised)> {
    Vec::new()
}

fn any_reads_same_machine(r: &mut Registrar) {
    r.array("c.p", "f64", "item", "layout", "items");
    r.operator("p", "items", &["self"], &["c.p"])
        .determinism("same_machine");
    r.check("c.audit", "any", &[], run);
    r.check_reads(&["c.p"]);
}

fn same_reads_same_machine(r: &mut Registrar) {
    r.array("c.p", "f64", "item", "layout", "items");
    r.operator("p", "items", &["self"], &["c.p"])
        .determinism("same_machine");
    r.check("c.audit", "same", &[], run);
    r.check_reads(&["c.p"]);
}

fn reads_what_no_operator_writes(r: &mut Registrar) {
    r.array("c.q", "f64", "item", "layout", "items");
    r.check("c.audit", "any", &[], run);
    r.check_reads(&["c.q"]);
}

#[test]
fn ac6_a_not_exact_refusal_of_a_checks_read_names_the_array() {
    let same = Registry::new(BuildSet::Core)
        .with(Module {
            manifest: manifest(),
            register: same_reads_same_machine,
        })
        .seal();
    if let Err(e) = same {
        panic!(
            "{ID} precondition: a check with machines same that reads c.p, which a same_machine \
             operator writes, seals; the seal refused it: {} {:?}: {}",
            e.code, e.modules, e.what
        );
    }

    let any = Registry::new(BuildSet::Core)
        .with(Module {
            manifest: manifest(),
            register: any_reads_same_machine,
        })
        .seal();
    match any {
        Ok(_) => panic!(
            "{ID}: the set sealed though a check with machines any reads c.p, which a \
             same_machine operator writes"
        ),
        Err(e) => {
            assert_eq!(
                e.code, "not_exact",
                "{ID}: the seal of a check with machines any that reads c.p, which a \
                 same_machine operator writes, fails with not_exact; it failed with {}: {}",
                e.code, e.what
            );
            assert_eq!(
                e.arrays,
                ["c.p"],
                "{ID}: the not_exact refusal's arrays is {:?}, not [c.p]: the array a check reads \
                 is only in the refusal's text ({})",
                e.arrays,
                e.what
            );
        }
    }
}

#[test]
fn ac6_an_unresolved_read_refusal_of_a_checks_read_names_the_array() {
    let unwritten = Registry::new(BuildSet::Core)
        .with(Module {
            manifest: manifest(),
            register: reads_what_no_operator_writes,
        })
        .seal();
    match unwritten {
        Ok(_) => panic!("{ID}: the set sealed though a check reads c.q, which no operator writes"),
        Err(e) => {
            assert_eq!(
                e.code, "unresolved_read",
                "{ID}: the seal of a check that reads c.q, which no operator writes, fails with \
                 unresolved_read; it failed with {}: {}",
                e.code, e.what
            );
            assert_eq!(
                e.arrays,
                ["c.q"],
                "{ID}: the unresolved_read refusal's arrays is {:?}, not [c.q]: the array a check \
                 reads is only in the refusal's text ({})",
                e.arrays,
                e.what
            );
        }
    }
}
