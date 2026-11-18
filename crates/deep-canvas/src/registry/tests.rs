use super::*;
use crate::kinds::{Param, ParamType};

/// A phase's plan without the core's own operators, which every set holds.
fn modules_only(plan: &[String]) -> Vec<&str> {
    plan.iter()
        .map(String::as_str)
        .filter(|k| !k.starts_with("core."))
        .collect()
}

fn manifest(name: &str, deps: &[(&str, bool)]) -> Manifest {
    Manifest {
        name: name.into(),
        version: Semver::parse("1.0.0").unwrap(),
        core: Range::parse("*").unwrap(),
        depends_on: deps
            .iter()
            .map(|(d, optional)| {
                (
                    d.to_string(),
                    Dependency {
                        range: Range::parse("*").unwrap(),
                        optional: *optional,
                    },
                )
            })
            .collect(),
        feature: name.into(),
        license: "Apache-2.0".into(),
        implements: format!("{name}@1"),
        implementation: Implementation::reference(name, Semver::parse("1.0.0").expect("a version")),
    }
}

fn module(name: &str, deps: &[(&str, bool)], register: fn(&mut Registrar)) -> Module {
    Module {
        manifest: manifest(name, deps),
        register,
    }
}

/// A param `w` of `ty` with no unit, default, bounds or evaluator.
fn param(ty: ParamType) -> Param {
    Param {
        name: "w",
        ty,
        unit: "",
        default: Value::Null,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

fn seal_core<const N: usize>(modules: [Module; N]) -> Result<Sealed, Box<SealError>> {
    modules
        .into_iter()
        .fold(Registry::new(BuildSet::Core), Registry::with)
        .seal()
}

fn register_a(r: &mut Registrar) {
    r.array("a.x", "f64", "item", "layout", "items");
    r.operator("write_x", "items", &["self"], &["a.x"]);
}

fn thing() -> Entry {
    Entry {
        family: "b",
        name: "thing",
        versions: vec![crate::kinds::Version {
            major: 1,
            minor: 0,
            params: vec![Param {
                name: "box",
                ..param(ParamType::Json("[x, y, w, h]"))
            }],
        }],
        migrations: vec![],
    }
}

fn register_b(r: &mut Registrar) {
    r.array("b.y", "f64", "item", "layout", "items");
    r.kind(thing(), &["b.y"], "rect@1");
    r.operator("read_a", "items", &["a.x"], &["b.y"]);
    r.operator("own", "items", &["self"], &[]);
}

fn a() -> Module {
    module("a", &[], register_a)
}

fn b(optional: bool) -> Module {
    module("b", &[("a", optional)], register_b)
}

#[test]
fn the_shipped_pair_seals_in_name_order_with_a_plan() {
    let sealed = Registry::new(BuildSet::Full)
        .with(b(false))
        .with(a())
        .seal()
        .unwrap();
    let names: Vec<&str> = sealed.modules.iter().map(|m| m.name.as_str()).collect();
    assert_eq!(names, ["a", "b"]);
    assert_eq!(
        modules_only(&sealed.plan["items"]),
        ["a.write_x", "b.own", "b.read_a"]
    );
    assert!(sealed.left_out.is_empty());
    assert_eq!(sealed.set_digest.len(), 64);
}

#[test]
fn a_missing_optional_dependency_leaves_its_readers_out() {
    let sealed = seal_core([b(true)]).unwrap();
    assert_eq!(
        sealed.left_out.get("b.read_a").map(String::as_str),
        Some("a")
    );
    assert_eq!(modules_only(&sealed.plan["items"]), ["b.own"]);
    assert_eq!(sealed.missing_for("b", "read_a").as_deref(), Some("a"));
    assert_eq!(sealed.missing_for("b", "own"), None);
    assert_eq!(sealed.missing_for("a", "write_x").as_deref(), Some("a"));
}

#[test]
fn one_module_writing_an_array_twice_refuses() {
    fn write_twice(r: &mut Registrar) {
        r.array("a.x", "f64", "item", "layout", "items");
        r.array("a.x", "f64", "item", "layout", "items");
    }
    let err = Registry::new(BuildSet::Full)
        .with(module("a", &[], write_twice))
        .seal()
        .unwrap_err();
    assert_eq!(err.code, "two_writers");
    assert_eq!(err.arrays, ["a.x"]);
    assert_eq!(err.modules, ["a"]);
}

#[test]
fn a_cycle_refuses_naming_both_modules() {
    fn c(r: &mut Registrar) {
        r.array("c.p", "f64", "item", "layout", "items");
        r.operator("p", "items", &["d.q"], &["c.p"]);
    }
    fn d(r: &mut Registrar) {
        r.array("d.q", "f64", "item", "layout", "items");
        r.operator("q", "items", &["c.p"], &["d.q"]);
    }
    // A module downstream of the cycle is stuck behind it, not in it.
    fn e(r: &mut Registrar) {
        r.array("e.r", "f64", "item", "layout", "items");
        r.operator("r", "items", &["c.p"], &["e.r"]);
    }
    let err = Registry::new(BuildSet::Full)
        .with(module("c", &[("d", false)], c))
        .with(module("d", &[("c", false)], d))
        .with(module("e", &[("c", false)], e))
        .seal()
        .unwrap_err();
    assert_eq!(err.code, "cycle");
    assert_eq!(err.modules, ["c", "d"]);
    assert_eq!(err.arrays, ["c.p", "d.q"]);
    // Two manifests that depend on each other are no cycle by themselves: each may read
    // the other's array of an earlier phase.
    fn c_later(r: &mut Registrar) {
        r.array("c.p", "f64", "item", "layout", "items");
        r.operator("p", "items", &["self"], &["c.p"]);
        r.operator("late", "render", &["d.q"], &[]);
    }
    fn d_later(r: &mut Registrar) {
        r.array("d.q", "f64", "item", "layout", "items");
        r.operator("q", "items", &["c.p"], &["d.q"]);
    }
    assert!(Registry::new(BuildSet::Full)
        .with(module("c", &[("d", false)], c_later))
        .with(module("d", &[("c", false)], d_later))
        .seal()
        .is_ok());
}

#[test]
fn places_machines_tools_and_interfaces_are_closed() {
    let err = Registry::new(BuildSet::Full)
        .with(Module {
            manifest: manifest("c", &[]),
            register: |r| {
                r.pass("glow", "somewhere");
            },
        })
        .seal()
        .unwrap_err();
    assert_eq!(err.code, "illegal_place");
    let err = Registry::new(BuildSet::Full)
        .with(Module {
            manifest: manifest("c", &[]),
            register: |r| {
                r.check("c.audit", "fast", &[], |_, _| Vec::new());
            },
        })
        .seal()
        .unwrap_err();
    assert_eq!(err.code, "illegal_machines");
    let err = Registry::new(BuildSet::Full)
        .with(Module {
            manifest: manifest("c", &[]),
            register: |r| {
                r.tool_entry("deep_new", "x");
            },
        })
        .seal()
        .unwrap_err();
    assert_eq!(err.code, "new_tool");
    let mut twin = manifest("c", &[]);
    twin.implements = "a@1".into();
    let err = Registry::new(BuildSet::Full)
        .with(a())
        .with(Module {
            manifest: twin,
            register: |_| {},
        })
        .seal()
        .unwrap_err();
    assert_eq!(err.code, "two_implementations");
    assert_eq!(err.modules, ["a", "c"]);
}

#[test]
fn digests_follow_the_shapes_and_the_set() {
    let empty = seal_core([]).unwrap();
    let with_a = seal_core([a()]).unwrap();
    let again = seal_core([a()]).unwrap();
    assert_ne!(empty.set_digest, with_a.set_digest);
    assert_eq!(with_a.set_digest, again.set_digest);
    // A private array stays out of the digest; a public one enters it.
    fn pub_arr(r: &mut Registrar) {
        r.array("c.p", "f64", "item", "layout", "items");
    }
    fn priv_arr(r: &mut Registrar) {
        r.private_array("c.p", "f64", "item", "layout", "items");
    }
    let p = seal_core([module("c", &[], pub_arr)]).unwrap();
    let q = seal_core([module("c", &[], priv_arr)]).unwrap();
    let none = seal_core([module("c", &[], |_| {})]).unwrap();
    assert_ne!(p.modules[0].digest, q.modules[0].digest);
    assert_eq!(q.modules[0].digest, none.modules[0].digest);
}

#[test]
fn a_kinds_shape_moves_the_digest() {
    fn one(r: &mut Registrar) {
        r.kind(thing(), &[], "rect@1");
    }
    fn with_param(r: &mut Registrar) {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            unit: "u",
            default: json!(1),
            min: Some(0.0),
            max: Some(10.0),
            ..param(ParamType::F32)
        });
        r.kind(entry, &[], "rect@1");
    }
    fn other_type(r: &mut Registrar) {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            unit: "u",
            default: json!(1),
            min: Some(0.0),
            max: Some(10.0),
            ..param(ParamType::Json("number"))
        });
        r.kind(entry, &[], "rect@1");
    }
    fn other_max(r: &mut Registrar) {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            unit: "u",
            default: json!(1),
            min: Some(0.0),
            max: Some(11.0),
            ..param(ParamType::F32)
        });
        r.kind(entry, &[], "rect@1");
    }
    let seal =
        |register: fn(&mut Registrar)| seal_core([module("b", &[], register)]).unwrap().set_digest;
    let digests = [
        seal(one),
        seal(with_param),
        seal(other_type),
        seal(other_max),
    ];
    for (i, a) in digests.iter().enumerate() {
        for b in &digests[i + 1..] {
            assert_ne!(a, b);
        }
    }
}

#[test]
fn kinds_are_one_per_name_with_their_needs_and_draws_as_resolved() {
    fn shadows_core(r: &mut Registrar) {
        let mut entry = thing();
        entry.family = "test";
        entry.name = "rect";
        r.kind(entry, &[], "");
    }
    fn registers_thing(r: &mut Registrar) {
        r.kind(thing(), &[], "rect@1");
    }
    fn needs_nothing_known(r: &mut Registrar) {
        r.kind(thing(), &["b.nothing"], "rect@1");
    }
    fn draws_as_unknown(r: &mut Registrar) {
        r.kind(thing(), &[], "nope@1");
    }
    let err = seal_core([module("b", &[], shadows_core)]).unwrap_err();
    assert_eq!(err.code, "two_kinds");
    let err = seal_core([
        module("b", &[], registers_thing),
        module("c", &[], registers_thing),
    ])
    .unwrap_err();
    assert_eq!(err.code, "two_kinds");
    assert_eq!(err.modules, ["b", "c"]);
    let err = seal_core([module("b", &[], needs_nothing_known)]).unwrap_err();
    assert_eq!(err.code, "unresolved_read");
    assert_eq!(err.arrays, ["b.nothing"]);
    let err = seal_core([module("b", &[], draws_as_unknown)]).unwrap_err();
    assert_eq!(err.code, "unknown_draws_as");
    // A kind's need of a missing optional dependency's array is fine: the build leaves the
    // kind to the check.
    assert!(seal_core([b(true)]).is_ok());
}

#[test]
fn a_read_needs_a_declared_dependency_and_a_write_its_arrays_phase() {
    fn reads_a_undeclared(r: &mut Registrar) {
        r.operator("peek", "items", &["a.x"], &[]);
    }
    let err = seal_core([a(), module("b", &[], reads_a_undeclared)]).unwrap_err();
    assert_eq!(err.code, "undeclared_dependency");
    assert_eq!(err.modules, ["a", "b"]);
    assert_eq!(err.arrays, ["a.x"]);
    fn writes_in_another_phase(r: &mut Registrar) {
        r.array("c.late", "f64", "item", "layout", "render");
        r.operator("early", "items", &["self"], &["c.late"]);
    }
    let err = seal_core([module("c", &[], writes_in_another_phase)]).unwrap_err();
    assert_eq!(err.code, "write_phase");
    assert_eq!(err.arrays, ["c.late"]);
    fn kind_needs_a_undeclared(r: &mut Registrar) {
        r.kind(thing(), &["a.x"], "rect@1");
    }
    let err = seal_core([a(), module("b", &[], kind_needs_a_undeclared)]).unwrap_err();
    assert_eq!(err.code, "undeclared_dependency");
    assert_eq!(err.arrays, ["a.x"]);
}

#[test]
fn plan_ties_break_by_module_name_then_operator_name() {
    fn x(r: &mut Registrar) {
        r.operator("z", "items", &["self"], &[]);
    }
    fn x_a(r: &mut Registrar) {
        r.operator("b", "items", &["self"], &[]);
    }
    let sealed = seal_core([module("x.a", &[], x_a), module("x", &[], x)]).unwrap();
    assert_eq!(modules_only(&sealed.plan["items"]), ["x.z", "x.a.b"]);
}

#[test]
fn a_reader_runs_after_its_writer_whatever_their_names_and_readers_share() {
    // The `ambiguity` and `read_only` cases: a read and a write of one value
    // are ordered by the read, never by name, and two reads of it seal clean.
    fn a(r: &mut Registrar) {
        r.operator("read", "items", &["z.x"], &[]);
        r.operator("also", "items", &["z.x"], &[]);
    }
    fn z(r: &mut Registrar) {
        r.array("z.x", "f64", "item", "layout", "items");
        r.operator("write", "items", &["self"], &["z.x"]);
    }
    let sealed = seal_core([module("a", &[("z", false)], a), module("z", &[], z)]).unwrap();
    assert_eq!(
        modules_only(&sealed.plan["items"]),
        ["z.write", "a.also", "a.read"]
    );
}

#[test]
fn a_build_holds_only_the_modules_it_registers() {
    // R1's canvas is canvas modules (#388): nothing is held without registering.
    let caret = Range::parse("^1").unwrap();
    let sealed = core();
    assert!(!sealed.satisfies("text", &caret));
    assert!(!sealed.satisfies("marks2d", &caret));
    let sealed = seal_core([module("text", &[], |_| {})]).unwrap();
    assert!(sealed.satisfies("text", &caret));
    assert!(!sealed.satisfies("logic", &caret));
}

#[test]
fn d1_hashes_one_canonical_form() {
    let a = json!({"b": [1, {"z": "é", "a": true}], "a": null, "f": 40.0});
    let b = json!({"a": null, "b": [1, {"a": true, "z": "é"}], "f": 40});
    assert_eq!(d1(&a).unwrap(), d1(&b).unwrap());
    assert_ne!(d1(&a).unwrap(), d1(&json!({"a": null})).unwrap());
    assert_eq!(d1(&a).unwrap().len(), 64);
}

#[test]
fn operator_names_are_one_word_and_arrays_carry_their_owner() {
    fn dotted(r: &mut Registrar) {
        r.operator("a.b", "items", &["self"], &[]);
    }
    fn others_array(r: &mut Registrar) {
        r.array("other.x", "f64", "item", "layout", "items");
    }
    fn others_table(r: &mut Registrar) {
        r.table("other.t", "seal", &[]);
    }
    let one = |register: fn(&mut Registrar)| seal_core([module("c", &[], register)]).unwrap_err();
    assert_eq!(one(dotted).code, "bad_operator_name");
    let err = one(others_array);
    assert_eq!(err.code, "not_own_name");
    assert_eq!(err.arrays, ["other.x"]);
    assert_eq!(one(others_table).code, "not_own_name");
}

#[test]
fn a_params_evaluator_is_a_registered_operator_of_a_declared_module() {
    fn with_param(module: &'static str, operator: &'static str) -> Entry {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            module,
            operator,
            ..param(ParamType::Json("number"))
        });
        entry
    }
    fn own_typo(r: &mut Registrar) {
        r.kind(with_param("b", "ownn"), &[], "rect@1");
        r.operator("own", "items", &["self"], &[]);
    }
    fn undeclared(r: &mut Registrar) {
        r.kind(with_param("a", "write_x"), &[], "rect@1");
    }
    fn declared_fine(r: &mut Registrar) {
        r.kind(with_param("a", "write_x"), &[], "rect@1");
    }
    fn nobody(r: &mut Registrar) {
        r.kind(with_param("zz", "op"), &[], "rect@1");
    }
    let seal = |deps: &[(&str, bool)], register: fn(&mut Registrar)| {
        seal_core([a(), module("b", deps, register)])
    };
    assert_eq!(seal(&[], own_typo).unwrap_err().code, "unresolved_read");
    assert_eq!(
        seal(&[], undeclared).unwrap_err().code,
        "undeclared_dependency"
    );
    assert!(seal(&[("a", false)], declared_fine).is_ok());
    assert_eq!(seal(&[], nobody).unwrap_err().code, "undeclared_dependency");
    // A missing optional dependency's evaluator is the check's `module_missing`.
    assert!(seal_core([module("b", &[("a", true)], declared_fine)]).is_ok());
}

#[test]
fn one_operator_writes_an_array_and_a_left_out_operator_blames_the_smallest_module() {
    fn two_ops(r: &mut Registrar) {
        r.array("c.p", "f64", "item", "layout", "items");
        r.operator("one", "items", &["self"], &["c.p"]);
        r.operator("two", "items", &["self"], &["c.p"]);
    }
    let err = seal_core([module("c", &[], two_ops)]).unwrap_err();
    assert_eq!(err.code, "two_writers");
    assert_eq!(err.modules, ["c"]);
    assert_eq!(err.arrays, ["c.p"]);
    fn reads_y_then_x(r: &mut Registrar) {
        r.operator("both", "items", &["y.q", "x.p"], &[]);
    }
    fn reads_x_then_y(r: &mut Registrar) {
        r.operator("both", "items", &["x.p", "y.q"], &[]);
    }
    for register in [reads_y_then_x, reads_x_then_y] {
        let sealed = seal_core([module("b", &[("x", true), ("y", true)], register)]).unwrap();
        assert_eq!(sealed.missing_for("b", "both").as_deref(), Some("x"));
    }
}

#[test]
fn a_kind_or_table_over_a_missing_optional_dependency_is_left_out() {
    fn kind_needs_a(r: &mut Registrar) {
        r.kind(thing(), &["a.x"], "rect@1");
    }
    let sealed = seal_core([module("b", &[("a", true)], kind_needs_a)]).unwrap();
    assert_eq!(sealed.missing_for_kind("b.thing@1").as_deref(), Some("a"));
    let doc = json!({
        "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
        "size": [10, 10], "requires": {"modules": {"b": "^1"}},
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {"x": {"id": "x", "kind": "b.thing@1", "layer": "main", "name": "X",
                        "order": "a0", "params": {}}}
    });
    let result = crate::document::check_in(&doc, &sealed);
    assert!(result.issues.iter().any(|i| i.code == "module_missing"
        && i.path == "items/x/kind"
        && i.what.contains("the a module")));
    let with_a = seal_core([a(), module("b", &[("a", true)], kind_needs_a)]).unwrap();
    assert_eq!(with_a.missing_for_kind("b.thing@1"), None);
    fn table_over_a(r: &mut Registrar) {
        r.table("b.t", "check", &["a.x"]);
        r.operator("use", "items", &["table:b.t"], &[]);
        r.array("b.y", "f64", "item", "layout", "items");
        r.operator("fill", "items", &["a.x"], &["b.y"]);
        r.table("b.u", "check", &["b.y"]);
        r.operator("use_u", "items", &["table:b.u"], &[]);
    }
    let sealed = seal_core([module("b", &[("a", true)], table_over_a)]).unwrap();
    assert_eq!(sealed.missing_for("b", "use").as_deref(), Some("a"));
    assert_eq!(sealed.missing_for("b", "use_u").as_deref(), Some("a"));
    assert!(sealed
        .plan
        .get("items")
        .is_none_or(|p| modules_only(p).is_empty()));
}

#[test]
fn a_private_array_is_read_by_its_owner_alone_and_stays_out_of_the_digest() {
    fn a_private(r: &mut Registrar) {
        r.private_array("a.secret", "f64", "item", "layout", "items");
        r.operator("fill", "items", &["self"], &["a.secret"]);
    }
    let a_priv = || module("a", &[], a_private);
    fn table_over_secret(r: &mut Registrar) {
        r.table("c.t", "check", &["a.secret"]);
    }
    fn kind_needs_secret(r: &mut Registrar) {
        r.kind(thing(), &["a.secret"], "rect@1");
    }
    for register in [table_over_secret, kind_needs_secret] {
        let err = seal_core([a_priv(), module("c", &[("a", false)], register)]).unwrap_err();
        assert_eq!(err.code, "private_read");
        assert_eq!(err.modules, ["a", "c"]);
        assert_eq!(err.arrays, ["a.secret"]);
    }
    fn own_p(r: &mut Registrar) {
        r.private_array("c.p", "f64", "item", "layout", "items");
        r.kind(thing(), &["c.p"], "rect@1");
        r.table("c.t", "check", &["c.p"]);
    }
    fn own_q(r: &mut Registrar) {
        r.private_array("c.q", "f64", "item", "layout", "items");
        r.kind(thing(), &["c.q"], "rect@1");
        r.table("c.t", "check", &["c.q"]);
    }
    let digest =
        |register: fn(&mut Registrar)| seal_core([module("c", &[], register)]).unwrap().set_digest;
    assert_eq!(digest(own_p), digest(own_q));
    // The operator that evaluates a param is the implementation's own name too.
    fn evaluated_by(operator: &'static str) -> Entry {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            module: "c",
            operator,
            ..param(ParamType::Json("number"))
        });
        entry
    }
    fn op_x(r: &mut Registrar) {
        r.kind(evaluated_by("x"), &[], "rect@1");
        r.operator("x", "items", &["self"], &[]);
    }
    fn op_y(r: &mut Registrar) {
        r.kind(evaluated_by("y"), &[], "rect@1");
        r.operator("y", "items", &["self"], &[]);
    }
    assert_eq!(digest(op_x), digest(op_y));
}

#[test]
fn a_table_is_read_through_a_declared_dependency_like_an_array() {
    fn table_over_a(r: &mut Registrar) {
        r.table("b.t", "check", &["a.x"]);
    }
    fn table_over_as_table(r: &mut Registrar) {
        r.table("b.t", "check", &["table:a.t"]);
    }
    fn operator_over_as_table(r: &mut Registrar) {
        r.operator("use", "items", &["table:a.t"], &[]);
    }
    fn a_with_table(r: &mut Registrar) {
        r.array("a.x", "f32", "item", "params", "items");
        r.table("a.t", "check", &["a.x"]);
    }
    let a_t = || module("a", &[], a_with_table);
    for register in [table_over_a, table_over_as_table, operator_over_as_table] {
        let err = seal_core([a_t(), module("b", &[], register)]).unwrap_err();
        assert_eq!(err.code, "undeclared_dependency");
        assert_eq!(err.modules, ["a", "b"]);
        assert!(seal_core([a_t(), module("b", &[("a", false)], register)]).is_ok());
    }
}

#[test]
fn a_module_name_has_no_empty_segment_and_no_module_depends_on_itself() {
    for name in [".", "a..b", "test.", ".a"] {
        let err = seal_core([module(name, &[], |_| {})]).unwrap_err();
        assert_eq!(err.code, "bad_module_name", "{name}");
    }
    let err = seal_core([module("a", &[("a", true)], |_| {})]).unwrap_err();
    assert_eq!(err.code, "cycle");
    assert_eq!(err.modules, ["a"]);
}

#[test]
fn one_module_builds_a_table_and_tables_have_a_build_order() {
    fn builds_t(r: &mut Registrar) {
        r.table("a.b.t", "seal", &[]);
    }
    fn builds_t_too(r: &mut Registrar) {
        r.table("a.b.t", "check", &[]);
    }
    let err = seal_core([
        module("a", &[("a.b", false)], builds_t),
        module("a.b", &[], builds_t_too),
    ])
    .unwrap_err();
    assert_eq!(err.code, "two_writers");
    assert_eq!(err.modules, ["a", "a.b"]);
    assert_eq!(err.arrays, ["a.b.t"]);
    fn twice(r: &mut Registrar) {
        r.table("c.t", "seal", &[]);
        r.table("c.t", "check", &[]);
    }
    let err = seal_core([module("c", &[], twice)]).unwrap_err();
    assert_eq!(err.code, "two_writers");
    fn reads_itself(r: &mut Registrar) {
        r.table("c.t", "seal", &["table:c.t"]);
    }
    fn operator_reads_its_own_write(r: &mut Registrar) {
        r.array("c.p", "f64", "item", "layout", "items");
        r.operator("p", "items", &["c.p"], &["c.p"]);
    }
    // Left out or not: the same refusal in the build that lacks its optional dependency.
    fn left_out_reads_its_own_write(r: &mut Registrar) {
        r.array("c.p", "f64", "item", "layout", "items");
        r.operator("p", "items", &["a.x", "c.p"], &["c.p"]);
    }
    for (register, deps) in [
        (operator_reads_its_own_write as fn(&mut Registrar), vec![]),
        (left_out_reads_its_own_write, vec![("a", true)]),
    ] {
        let err = seal_core([module("c", &deps, register)]).unwrap_err();
        assert_eq!(err.code, "cycle");
        assert_eq!(err.modules, ["c"]);
        assert_eq!(err.arrays, ["c.p"]);
    }
    fn read_each_other(r: &mut Registrar) {
        r.table("c.t1", "seal", &["table:c.t2"]);
        r.table("c.t2", "seal", &["table:c.t1"]);
        r.table("c.t3", "seal", &["table:c.t1"]);
    }
    for (register, cycle) in [
        (reads_itself as fn(&mut Registrar), vec!["c.t"]),
        (read_each_other, vec!["c.t1", "c.t2"]),
    ] {
        let err = seal_core([module("c", &[], register)]).unwrap_err();
        assert_eq!(err.code, "cycle");
        assert_eq!(err.modules, ["c"]);
        assert_eq!(err.arrays, cycle);
    }
    fn in_order(r: &mut Registrar) {
        r.table("c.t2", "seal", &["table:c.t1"]);
        r.table("c.t1", "seal", &[]);
    }
    assert!(seal_core([module("c", &[], in_order)]).is_ok());
}

#[test]
fn a_target_on_a_left_out_param_is_module_missing() {
    fn evaluates_w(r: &mut Registrar) {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            module: "b",
            operator: "x",
            ..param(ParamType::F32)
        });
        r.kind(entry, &[], "rect@1");
        r.operator("x", "items", &["a.x"], &[]);
    }
    let sealed = seal_core([module("b", &[("a", true)], evaluates_w)]).unwrap();
    let doc = json!({
        "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
        "size": [10, 10], "requires": {"modules": {"b": "^1"}},
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {"x": {"id": "x", "kind": "b.thing@1", "layer": "main", "name": "X",
                        "order": "a0", "params": {}}},
        "channels": {"c1": {"target": "items/x/params/w"}}
    });
    let result = crate::document::check_in(&doc, &sealed);
    assert!(
        result.issues.iter().any(|i| i.code == "module_missing"
            && i.path == "channels/c1/target"
            && i.what.contains("the a module")),
        "{:?}",
        result
            .issues
            .iter()
            .map(|i| (&i.code, &i.path))
            .collect::<Vec<_>>()
    );
    let mut without = doc.clone();
    without["channels"] = json!({});
    assert!(!crate::document::check_in(&without, &sealed)
        .issues
        .iter()
        .any(|i| i.code == "module_missing"));
}

#[test]
fn a_module_kind_keeps_the_kind_registrys_version_contract() {
    fn with_majors(r: &mut Registrar, majors: &[u32]) {
        let mut entry = thing();
        let one = entry.versions.remove(0);
        entry.versions = majors
            .iter()
            .map(|&major| crate::kinds::Version {
                major,
                ..one.clone()
            })
            .collect();
        // One step per consecutive pair, so only the majors are under test.
        entry.migrations = majors
            .windows(2)
            .filter(|w| w[1] == w[0] + 1)
            .map(|w| crate::kinds::Migration {
                from: w[0],
                to: w[1],
                renames: vec![],
                retires: vec![],
                map: None,
            })
            .collect();
        r.kind(entry, &[], "rect@1");
    }
    fn none(r: &mut Registrar) {
        with_majors(r, &[]);
    }
    fn descending(r: &mut Registrar) {
        with_majors(r, &[2, 1]);
    }
    fn twice(r: &mut Registrar) {
        with_majors(r, &[1, 1]);
    }
    fn ascending(r: &mut Registrar) {
        with_majors(r, &[1, 2]);
    }
    let seal = |register: fn(&mut Registrar)| seal_core([module("b", &[], register)]);
    fn bare_name(r: &mut Registrar) {
        let mut entry = thing();
        entry.family = "";
        entry.name = "rect";
        r.kind(entry, &[], "rect@1");
    }
    fn f32_param(r: &mut Registrar, default: Value, min: Option<f64>) {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            default,
            min,
            ..param(ParamType::F32)
        });
        r.kind(entry, &[], "rect@1");
    }
    fn default_past_f32(r: &mut Registrar) {
        f32_param(r, json!(1e40), None);
    }
    fn default_below_min(r: &mut Registrar) {
        f32_param(r, json!(-1), Some(0.0));
    }
    fn default_in_range(r: &mut Registrar) {
        f32_param(r, json!(0.5), Some(0.0));
    }
    for register in [
        none,
        descending,
        twice,
        bare_name,
        default_past_f32,
        default_below_min,
    ] {
        let err = seal(register).unwrap_err();
        assert_eq!(err.code, "bad_shape");
        assert_eq!(err.modules, ["b"]);
    }
    for register in [ascending, default_in_range] {
        assert!(seal(register).is_ok());
    }
}

#[test]
fn only_the_cells_module_keeps_a_bare_kind_name_and_a_build_without_it_names_it_missing() {
    fn cells(r: &mut Registrar) {
        let mut entry = thing();
        entry.family = "";
        entry.name = "cells";
        r.kind(entry, &[], "");
    }
    let seal = |name: &str| {
        Registry::new(BuildSet::R2)
            .with(module(name, &[], cells))
            .seal()
    };
    let sealed = seal("cells").expect("the cells module keeps `cells@1`");
    assert_eq!(sealed.module_of_kind("cells"), Some("cells"));
    assert_eq!(seal("b").unwrap_err().code, "bad_shape");
    let without = seal_core([]).expect("the core seals");
    assert_eq!(
        without.missing_for_kind("cells@1").as_deref(),
        Some("cells")
    );
    assert_eq!(without.missing_for_kind("text@1"), None);
}

#[test]
fn a_module_kinds_migrations_params_and_box_keep_the_registrys_contract() {
    fn two_majors(migrations: Vec<crate::kinds::Migration>) -> Entry {
        let mut entry = thing();
        let mut two = entry.versions[0].clone();
        two.major = 2;
        two.params.push(Param {
            name: "width",
            default: json!(1),
            ..param(ParamType::F32)
        });
        entry.versions[0].params.push(Param {
            name: "w",
            ..two.params[1].clone()
        });
        entry.versions.push(two);
        entry.migrations = migrations;
        entry
    }
    fn step(
        from: u32,
        to: u32,
        renames: &[(&'static str, &'static str)],
    ) -> crate::kinds::Migration {
        crate::kinds::Migration {
            from,
            to,
            renames: renames
                .iter()
                .map(|(from, to)| crate::kinds::Rename { from, to })
                .collect(),
            retires: vec![],
            map: None,
        }
    }
    fn no_path(r: &mut Registrar) {
        r.kind(two_majors(vec![]), &[], "rect@1");
    }
    fn rename_to_nothing(r: &mut Registrar) {
        r.kind(
            two_majors(vec![step(1, 2, &[("w", "nope")])]),
            &[],
            "rect@1",
        );
    }
    fn rename_from_nothing(r: &mut Registrar) {
        r.kind(
            two_majors(vec![step(1, 2, &[("nope", "width")])]),
            &[],
            "rect@1",
        );
    }
    fn twice(r: &mut Registrar) {
        r.kind(
            two_majors(vec![step(1, 2, &[]), step(1, 2, &[])]),
            &[],
            "rect@1",
        );
    }
    fn backwards(r: &mut Registrar) {
        r.kind(
            two_majors(vec![step(1, 2, &[]), step(2, 1, &[])]),
            &[],
            "rect@1",
        );
    }
    fn unknown_major(r: &mut Registrar) {
        r.kind(
            two_majors(vec![step(1, 2, &[]), step(2, 3, &[])]),
            &[],
            "rect@1",
        );
    }
    fn param_twice(r: &mut Registrar) {
        let mut entry = thing();
        let again = entry.versions[0].params[0].clone();
        entry.versions[0].params.push(again);
        r.kind(entry, &[], "rect@1");
    }
    fn rect_without_box(r: &mut Registrar) {
        let mut entry = thing();
        entry.versions[0].params.clear();
        r.kind(entry, &[], "rect@1");
    }
    fn fine(r: &mut Registrar) {
        r.kind(
            two_majors(vec![step(1, 2, &[("w", "width")])]),
            &[],
            "rect@1",
        );
    }
    fn draws_nothing_without_box(r: &mut Registrar) {
        let mut entry = thing();
        entry.versions[0].params.clear();
        r.kind(entry, &[], "");
    }
    let seal = |register: fn(&mut Registrar)| seal_core([module("b", &[], register)]);
    for register in [
        no_path,
        rename_to_nothing,
        rename_from_nothing,
        twice,
        backwards,
        unknown_major,
        param_twice,
        rect_without_box,
    ] {
        let err = seal(register).unwrap_err();
        assert_eq!(err.code, "bad_shape");
        assert_eq!(err.modules, ["b"]);
    }
    for register in [fine, draws_nothing_without_box] {
        assert!(seal(register).is_ok());
    }
}

#[test]
fn a_typo_in_a_present_modules_array_is_unresolved_not_left_out() {
    fn registers_x(r: &mut Registrar) {
        r.array("a.b.x", "f32", "item", "params", "items");
    }
    fn reads_typo(r: &mut Registrar) {
        r.operator("peek", "items", &["a.b.nothing"], &[]);
    }
    let err = seal_core([
        module("a.b", &[], registers_x),
        module("c", &[("a", true), ("a.b", false)], reads_typo),
    ])
    .unwrap_err();
    assert_eq!(err.code, "unresolved_read");
    assert_eq!(err.arrays, ["a.b.nothing"]);
}

#[test]
fn an_array_name_keeps_the_grammar_and_a_declared_longer_name_owns_its_reads() {
    for bad in ["a..x", "a.X", "a.b.", "a.x y"] {
        let err = seal_core([Module {
            manifest: manifest("a", &[]),
            register: match bad {
                "a..x" => |r: &mut Registrar| {
                    r.array("a..x", "f32", "item", "params", "items");
                },
                "a.X" => |r: &mut Registrar| {
                    r.array("a.X", "f32", "item", "params", "items");
                },
                "a.b." => |r: &mut Registrar| {
                    r.array("a.b.", "f32", "item", "params", "items");
                },
                _ => |r: &mut Registrar| {
                    r.array("a.x y", "f32", "item", "params", "items");
                },
            },
        }])
        .unwrap_err();
        assert_eq!(err.code, "not_own_name", "{bad}");
        assert_eq!(err.arrays, [bad]);
    }
    // `a.b` is known through `n`'s manifest, so `a.b.x` is never `a`'s to be missing.
    fn reads_a_b_x(r: &mut Registrar) {
        r.operator("peek", "items", &["a.b.x"], &[]);
    }
    let err = seal_core([
        module("m", &[("a", true)], reads_a_b_x),
        module("n", &[("a.b", true)], |_| {}),
    ])
    .unwrap_err();
    assert_eq!(err.code, "unresolved_read");
    assert_eq!(err.arrays, ["a.b.x"]);
}

#[test]
fn a_name_between_two_modules_is_the_longer_ones() {
    fn registers_into_sibling(r: &mut Registrar) {
        r.array("a.b.x", "f32", "item", "params", "items");
    }
    for deps in [vec![], vec![("a.b", true)]] {
        let mut registry =
            Registry::new(BuildSet::Core).with(module("a", &deps, registers_into_sibling));
        if deps.is_empty() {
            registry = registry.with(module("a.b", &[], |_| {}));
        }
        let err = registry.seal().unwrap_err();
        assert_eq!(err.code, "not_own_name");
        assert_eq!(err.modules, ["a"]);
        assert_eq!(err.arrays, ["a.b.x"]);
    }
}

#[test]
fn a_seal_built_table_reads_no_array_and_f32_bounds_are_finite_and_ordered() {
    fn seal_over_array(r: &mut Registrar) {
        r.array("c.p", "f64", "item", "layout", "items");
        r.table("c.t", "seal", &["c.p"]);
    }
    let err = seal_core([module("c", &[], seal_over_array)]).unwrap_err();
    assert_eq!(err.code, "later_phase");
    assert_eq!(err.arrays, ["c.p"]);
    // A name nothing owns stays `unresolved_read`, whatever the build.
    fn seal_over_nothing(r: &mut Registrar) {
        r.table("c.t", "seal", &["c.nowhere"]);
    }
    let err = seal_core([module("c", &[], seal_over_nothing)]).unwrap_err();
    assert_eq!(err.code, "unresolved_read");
    // The same in the build that lacks the array's optional owner: left out is no verdict.
    fn seal_over_missing(r: &mut Registrar) {
        r.table("c.t", "seal", &["a.x"]);
    }
    let err = seal_core([module("c", &[("a", true)], seal_over_missing)]).unwrap_err();
    assert_eq!(err.code, "later_phase");
    assert_eq!(err.arrays, ["a.x"]);
    fn nan_bound(r: &mut Registrar) {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            min: Some(f64::NAN),
            max: Some(1.0),
            ..param(ParamType::F32)
        });
        r.kind(entry, &[], "rect@1");
    }
    let err = seal_core([module("b", &[], nan_bound)]).unwrap_err();
    assert_eq!(err.code, "bad_shape");
    fn min_above_max(r: &mut Registrar) {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            min: Some(1.0),
            max: Some(0.0),
            ..param(ParamType::F32)
        });
        r.kind(entry, &[], "rect@1");
    }
    let err = seal_core([module("b", &[], min_above_max)]).unwrap_err();
    assert_eq!(err.code, "bad_shape");
}

#[test]
fn a_seal_built_table_reads_no_check_built_table() {
    fn seal_over_check(r: &mut Registrar) {
        r.table("c.t1", "seal", &["table:c.t2"]);
        r.table("c.t2", "check", &[]);
    }
    let err = seal_core([module("c", &[], seal_over_check)]).unwrap_err();
    assert_eq!(err.code, "later_phase");
    assert_eq!(err.arrays, ["table:c.t2"]);
    fn check_over_seal(r: &mut Registrar) {
        r.table("c.t1", "check", &["table:c.t2"]);
        r.table("c.t2", "seal", &[]);
    }
    assert!(seal_core([module("c", &[], check_over_seal)]).is_ok());
}

#[test]
fn a_manifest_depends_on_r1_modules_only_where_the_build_registers_them() {
    let err = seal_core([module("c", &[("text", false), ("marks2d", false)], |_| {})]).unwrap_err();
    assert_eq!(err.code, "missing_dependency");
    fn measure(r: &mut Registrar) {
        r.array("text.w", "f64", "item", "geometry", "items");
        r.operator("measure", "items", &["self"], &["text.w"]);
    }
    let text = || module("text", &[], measure);
    // A param the text module evaluates resolves when the manifest declares it.
    fn text_evaluates(r: &mut Registrar) {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            module: "text",
            operator: "measure",
            ..param(ParamType::Json("number"))
        });
        r.kind(entry, &[], "rect@1");
    }
    assert!(seal_core([text(), module("c", &[("text", false)], text_evaluates)]).is_ok());
    let err = seal_core([text(), module("c", &[], text_evaluates)]).unwrap_err();
    assert_eq!(err.code, "undeclared_dependency");
    assert_eq!(err.modules, ["c", "text"]);
    let err = seal_core([module("c", &[("vector", false)], |_| {})]).unwrap_err();
    assert_eq!(err.code, "missing_dependency");
}

#[test]
fn a_sealed_sets_canonical_form_counts_its_module_kinds_defaults() {
    fn with_default(r: &mut Registrar) {
        let mut entry = thing();
        entry.versions[0].params.push(Param {
            default: json!(2),
            ..param(ParamType::F32)
        });
        r.kind(entry, &[], "rect@1");
    }
    let sealed = seal_core([module("b", &[], with_default)]).unwrap();
    let doc = json!({
        "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
        "size": [10, 10], "requires": {"modules": {"b": "^1"}},
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {"x": {"id": "x", "kind": "b.thing@1", "layer": "main", "name": "X",
                        "order": "a0", "params": {"w": 2}}}
    });
    let by_set = crate::document::canonical_in(&doc, &sealed.kinds()).unwrap();
    let by_core = crate::document::canonical(&doc).unwrap();
    assert!(!by_set.bytes.contains("\"w\""), "{}", by_set.bytes);
    assert!(by_core.bytes.contains("\"w\""), "{}", by_core.bytes);
    assert_ne!(by_set.sha256, by_core.sha256);
}

#[test]
fn a_module_the_build_lacks_is_the_param_s_missing_one() {
    let sealed = core();
    assert_eq!(
        sealed.missing_for("motion", "ease").as_deref(),
        Some("motion")
    );
    assert_eq!(sealed.missing_for("logic", "run").as_deref(), Some("logic"));
}

#[test]
fn a_kind_family_of_an_absent_known_module_is_missing() {
    let sealed = seal_core([]).unwrap();
    assert_eq!(
        sealed.missing_for_kind("logic.program@1").as_deref(),
        Some("logic")
    );
    assert_eq!(sealed.missing_for_kind("test.slab@3"), None);
    let with_b = seal_core([b(true)]).unwrap();
    assert_eq!(with_b.missing_for_kind("b.thing@1"), None);
}

#[test]
fn a_kind_draws_as_its_core_kind_at_a_major_the_module_carries() {
    let with_b = seal_core([b(true)]).unwrap();
    assert_eq!(with_b.draws_as("b.thing@1"), Some("rect@1"));
    assert_eq!(with_b.draws_as("b.thing@0"), None);
    assert_eq!(with_b.draws_as("b.thing@2"), None);
    assert_eq!(with_b.draws_as("b.thing"), None);
    assert_eq!(with_b.module_of_kind("b.thing"), Some("b"));
    assert_eq!(with_b.module_of_kind("rect"), None);
}

#[test]
fn domains_table_builds_carried_kinds_and_table_reads_are_checked() {
    let one = |register: fn(&mut Registrar)| seal_core([module("c", &[], register)]).unwrap_err();
    fn bad_domain(r: &mut Registrar) {
        r.array("c.p", "f64", "nowhere", "layout", "items");
    }
    fn bad_build(r: &mut Registrar) {
        r.table("c.t", "never", &[]);
    }
    fn bad_carried(r: &mut Registrar) {
        r.carried("blob", "c.k", 1);
    }
    fn bad_table_read(r: &mut Registrar) {
        r.table("c.t", "check", &["c.nowhere"]);
    }
    assert_eq!(one(bad_domain).code, "illegal_domain");
    assert_eq!(one(bad_build).code, "illegal_table_build");
    assert_eq!(one(bad_carried).code, "illegal_carried");
    let err = one(bad_table_read);
    assert_eq!(err.code, "unresolved_read");
    assert_eq!(err.arrays, ["c.nowhere"]);
    fn fine(r: &mut Registrar) {
        r.array("c.p", "f64", "row", "layout", "items");
        r.table("c.t", "check", &["c.p", "self"]);
        r.carried("tail", "c.k", 1);
    }
    assert!(seal_core([module("c", &[], fine)]).is_ok());
}

#[test]
fn a_document_names_the_module_of_every_module_kind_it_uses() {
    let with_b = seal_core([b(true)]).unwrap();
    let mut doc = json!({
        "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
        "size": [10, 10],
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {"x": {"id": "x", "kind": "b.thing@1", "layer": "main", "name": "X",
                        "order": "a0", "params": {}}}
    });
    let result = crate::document::check_in(&doc, &with_b);
    assert!(!result.ok);
    assert!(result
        .issues
        .iter()
        .any(|i| i.code == "out_of_range" && i.path == "items/x/kind" && i.what.contains("`b`")));
    doc["requires"] = json!({"modules": {"b": "^1"}});
    let result = crate::document::check_in(&doc, &with_b);
    assert!(result.ok, "{:?}", result.issues);
    // Malformed kind text is out of range, never a missing module.
    doc["items"]["x"]["kind"] = json!("logic");
    let result = crate::document::check_in(&doc, &with_b);
    assert!(result
        .issues
        .iter()
        .any(|i| i.code == "out_of_range" && i.path == "items/x/kind"));
    assert!(!result.issues.iter().any(|i| i.code == "module_missing"));
}

/// The module `x` filling `export.target@1` (#501) with `raw`, read back by `reader`.
fn export_target(r: &mut Registrar, reader: &str) {
    r.entry(
        "export.target@1",
        "test.raw",
        json!({"writer": "x", "fidelity": ["export.fidelity"], "reader": reader,
                   "hidden": "listed"}),
        "R6",
    );
}

fn raw_target() -> Module {
    module("x", &[], |r| export_target(r, "y"))
}

#[test]
fn a_build_without_media_seals_another_modules_export_target() {
    let sealed = seal_core([raw_target()]).unwrap();
    let targets = sealed.registry("export.target@1").expect("declared");
    assert_eq!(targets.owner, "core");
    let names: Vec<&str> = targets.entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["test.raw"]);
}

#[test]
fn an_export_target_read_by_its_own_writer_is_refused_by_name() {
    let err = seal_core([module("x", &[], |r| export_target(r, "x"))]).unwrap_err();
    assert_eq!(err.code, "entry_refused");
    let at = err.registry.as_ref().expect("a registry refusal");
    assert_eq!(at.name, "export.target@1");
    assert_eq!(at.entries, [json!("test.raw")]);
    assert_eq!(at.rules, ["reader_is_not_writer"]);
}

#[test]
fn export_targets_declared_in_media_refuse_a_build_without_it_naming_media() {
    let err = Registry::new(BuildSet::Core)
        .with(raw_target())
        .plant(Fault::ExportTargetInMedia)
        .seal()
        .unwrap_err();
    assert_eq!(err.code, "unknown_registry");
    assert_eq!(err.modules, ["media", "x"]);
    assert_eq!(
        err.registry.as_ref().map(|r| r.name.as_str()),
        Some("export.target@1")
    );
}
