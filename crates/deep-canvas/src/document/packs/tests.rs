//! The pack check's own tests: the manifest, its recipes and their expressions.

use super::*;

/// The pack format's contract entry (#200) holds the keys and lists the pack check reads, so
/// the contract diff sees a change to either.
#[test]
fn the_pack_schema_holds_the_checks_keys_and_lists() {
    let schema: Value = serde_json::from_str(include_str!(
        "../../../../../packages/contracts/canvas-schemas/pack@1.json"
    ))
    .expect("JSON");
    let keys = |v: &Value| -> Vec<String> {
        let mut k: Vec<String> = v["properties"]
            .as_object()
            .expect("properties")
            .keys()
            .cloned()
            .collect();
        k.sort();
        k
    };
    let sorted = |l: &[&str]| -> Vec<String> {
        let mut k: Vec<String> = l.iter().map(|s| s.to_string()).collect();
        k.sort();
        k
    };
    let list = |v: &Value| -> Vec<String> {
        v["enum"]
            .as_array()
            .expect("enum")
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    };
    let defs = &schema["$defs"];
    assert_eq!(keys(&schema), sorted(PACK_KEYS), "a pack's keys");
    assert_eq!(
        keys(&defs["recipe"]),
        sorted(RECIPE_KEYS),
        "a recipe's keys"
    );
    assert_eq!(keys(&defs["step"]), sorted(STEP_KEYS), "a step's keys");
    assert_eq!(
        keys(&defs["kind"]),
        sorted(super::super::pack_kinds::KIND_KEYS),
        "a pack kind's keys"
    );
    assert_eq!(
        list(&defs["step"]["properties"]["op"]),
        STEP_OPS,
        "step ops"
    );
    assert_eq!(
        list(&defs["input"]["properties"]["type"]),
        INPUT_TYPES,
        "input types"
    );
}

fn scope() -> Vec<(String, Value)> {
    vec![("n".into(), json!(5)), ("i".into(), json!(2))]
}

#[test]
fn a_recipe_expression_nests_at_most_64_levels_and_takes_at_most_1024_tokens() {
    // Each opener completes to a valid expression; 64 levels parse, 65 are refused.
    let forms = [
        ("(", ")"),
        ("-", ""),
        ("!", ""),
        ("abs(", ")"),
        ("i ? 1 : ", ""),
        ("i ? ", " : 1"),
        ("a[", "]"),
    ];
    for (open, close) in forms {
        let at = |n: usize| format!("{}1{}", open.repeat(n), close.repeat(n));
        assert!(Expr::parse(&at(64)).is_ok(), "{open}");
        let e = Expr::parse(&at(65)).unwrap_err();
        assert!(e.contains("the cap of 64 levels"), "{open}: {e}");
        let e = Expr::parse(&at(1_000_000)).unwrap_err();
        assert!(e.contains("cap of"), "{open}: {e}");
    }
    // A chain nests no parse but a tree as deep as it is long, which a walk recurses down.
    let chain = |n: usize| format!("{}1", "1+".repeat(n));
    assert!(postfix(&chain(511)).is_ok());
    // 1,024 tokens read and the 1,025th is refused.
    assert!(postfix(&format!("-{}", chain(511))).is_ok());
    let e = postfix(&format!("--{}", chain(511))).unwrap_err();
    assert!(e.contains("the cap of 1024 tokens"), "{e}");
    let e = tokenize(&format!("-{} $", chain(511))).unwrap_err();
    assert_eq!(
        e, "runs past the cap of 1024 tokens",
        "the cap before the 1,025th token"
    );
    let e = postfix(&chain(100_000)).unwrap_err();
    assert!(e.contains("the cap of 1024 tokens"), "{e}");
}

#[test]
fn a_recipe_value_past_a_cap_is_refused_not_read_as_text() {
    // Text the grammar doesn't read is a literal, but text it refuses for a cap never is.
    let deep = format!("{}n{}", "(".repeat(70), ")".repeat(70));
    let long = format!("{}1", "n+".repeat(600));
    for text in [deep.clone(), long.clone()] {
        let e = Template::of(&json!(text)).eval(&scope()).unwrap_err();
        assert!(e.contains("past the cap of"), "{e}");
        let repeat = json!({"repeat": {"count": text, "as": "j", "of": "j"}});
        let e = Template::of(&repeat).eval(&scope()).unwrap_err();
        assert!(e.contains("past the cap of"), "{e}");
        let over = json!({"repeat": {"over": text, "as": "j", "of": "j"}});
        let e = Template::of(&over).eval(&scope()).unwrap_err();
        assert!(e.contains("past the cap of"), "{e}");
        let lets = json!({"repeat": {"count": 2, "as": "j", "let": {"k": text}, "of": "k"}});
        let e = Template::of(&lets).eval(&scope()).unwrap_err();
        assert!(e.contains("past the cap of"), "{e}");
    }
    // A refused text reads no name.
    assert_eq!(Template::of(&json!(deep)).reads(), (vec![], vec![]));
    // A repeat whose count no cap stops is still read as it was: a literal.
    let plain = json!({"repeat": {"count": "a b", "as": "j", "of": "j"}});
    assert_eq!(Template::of(&plain).eval(&scope()), Ok(plain.clone()));
}

#[test]
fn the_recipe_lexer_reads_each_token_form() {
    let value = |t: &str| Expr::parse(t).and_then(|e| e.eval(&scope()));
    assert_eq!(value("(i == 2) + (1 != 2) + (2 >= 1)"), Ok(3.0));
    assert!(Expr::parse("f() + 1").is_ok());
    assert_eq!(value(".5 + 1.5\t+\n1"), Ok(3.0));
    // Names are ASCII letters, digits and `_`, and numbers ASCII digits and dots.
    let (names, _) = Template::of(&json!("_a + a_1 + b2")).reads();
    assert_eq!(names, ["_a", "a_1", "b2"]);
    for (text, bad) in [
        ("aé", "é"),
        ("a١", "١"),
        ("1١", "١"),
        ("١", "١"),
        ("é", "é"),
    ] {
        let want = format!("unexpected `{bad}`");
        assert_eq!(Expr::parse(text).err(), Some(want), "{text}");
    }
    assert_eq!(
        Expr::parse("1 # 2").err().as_deref(),
        Some("unexpected `#`")
    );
    // Text a cap stops that no expression could be says so.
    let e = Expr::parse(&"-".repeat(70)).err();
    assert_eq!(e.as_deref(), Some("isn't an expression"));
}

#[test]
fn the_flat_check_reads_each_rule_of_the_grammar() {
    // Short texts, so each case turns on one rule; past a cap the same rules decide.
    let could = [
        "1 < 2 && 2 < 3",
        "i ? 1 < 2 : 2 > 1",
        "f() + 1",
        "1 % 2 + (1 <= 2) + (0 || 1)",
        "max(1, i ? 2 : 3)",
        "a.b[1] - !c",
        "(a == b) * (a != b) / (a >= b)",
        "pi + tau * inf - nan",
    ];
    for text in could {
        assert!(could_be_expression(text), "{text}");
    }
    let never = [
        "(1 ? 2)",
        "(1]",
        "f(1 ? 2, 3 : 4)",
        "(1",
        "1 + + 2",
        "()",
        "f(1,)",
        "a.+",
        "1 + )",
        "1 # 2",
        "1 : 2",
        "1 2",
        "a[1, 2]",
    ];
    for text in never {
        assert!(!could_be_expression(text), "{text}");
    }
}

#[test]
fn long_text_that_is_no_expression_stays_a_literal() {
    // A cap refuses only text that could be an expression; past it, text is still a literal.
    let texts = [
        format!("M 0 0 {}", "L 10.5 20.25 ".repeat(400)),
        "The quick brown fox jumps over the lazy dog, again. ".repeat(120),
        "-".repeat(70),
        format!("{}see note{}", "(".repeat(70), ")".repeat(70)),
        // Read flat they look like one, but the grammar takes no list in parentheses, no
        // chained comparison and no `?` without its `:`.
        format!("({}(0,0))", "(0, 0), ".repeat(400)),
        format!("{}1", "1 < ".repeat(600)),
        format!("{}1", "1 ? ".repeat(600)),
        // A number's name is read as the number, so no call follows it.
        format!("pi({}1)", "1, ".repeat(600)),
        format!("tau({}1)", "1, ".repeat(600)),
        format!("inf({}1)", "1, ".repeat(600)),
        format!("nan({}1)", "1, ".repeat(600)),
    ];
    for text in texts {
        let got = Template::of(&json!(text)).eval(&scope());
        assert_eq!(got, Ok(json!(text)), "{}", &text[..40]);
    }
}

#[test]
fn expressions_evaluate_over_scope() {
    let e = |t: &str| Expr::parse(t).unwrap().eval(&scope()).unwrap();
    assert_eq!(e("i * 20 + 4"), 44.0);
    assert_eq!(e("(n - i) / 3"), 1.0);
    assert_eq!(e("-i"), -2.0);
    assert_eq!(e("max(i, n)"), 5.0);
    assert_eq!(e("7 % 3"), 1.0);
    assert!(Expr::parse("i +").is_err());
    assert!(Expr::parse("x").unwrap().eval(&scope()).is_err());
    // A result that is not a finite number is an error, never a null.
    for t in ["sqrt(0 - 1)", "pow(10, 400)"] {
        let value = Expr::parse(t).unwrap().value(&scope());
        assert!(value.is_err(), "{t}: {value:?}");
    }
    let eval = |v: &Value, s: &[(String, Value)]| Template::of(v).eval(s);
    assert_eq!(eval(&json!("i * 2"), &scope()).unwrap(), json!(4));
    assert_eq!(
        eval(&json!(["i", 1.5, "ink", {"role": "muted"}]), &scope()).unwrap(),
        json!([2, 1.5, "ink", {"role": "muted"}])
    );
}

#[test]
fn a_sum_ends_where_adding_one_changes_nothing() {
    let e = |t: &str| Expr::parse(t).unwrap().eval(&scope()).unwrap();
    // Past 2^53 adding one changes nothing, so a sum that only counts up never ends here.
    assert_eq!(e("sum(k, 9007199254740992, 9007199254740992, 1)"), 1.0);
    assert_eq!(e("sum(k, 1, 4, k)"), 10.0);
    assert_eq!(e("sum(k, 4, 1, k)"), 0.0);
}

#[test]
fn an_expression_past_the_parser_bounds_is_refused() {
    assert!(Expr::parse(&"(".repeat(100_000)).is_err());
    assert!(Expr::parse(&"-".repeat(100_000)).is_err());
    assert!(Expr::parse(&vec!["1"; 100_000].join("+")).is_err());
    let nested = |n: usize| format!("{}1{}", "(".repeat(n), ")".repeat(n));
    assert!(Expr::parse(&nested(MAX_NEST + 1)).is_err());
    // The deepest nesting and the longest chain the bounds admit still evaluate.
    let e = |t: &str| Expr::parse(t).unwrap().eval(&scope()).unwrap();
    assert_eq!(e(&nested(MAX_NEST)), 1.0);
    assert_eq!(e(&vec!["1"; MAX_TOKENS / 2].join("+")), 512.0);
}

#[test]
fn pack_ids_parse_whole_versions_only() {
    let id = PackId::parse("alice/foley@1.0.0").unwrap();
    assert_eq!((id.id.as_str(), id.name.as_str()), ("alice/foley", "foley"));
    assert_eq!(id.text(), "alice/foley@1.0.0");
    assert!(PackId::parse("alice/foley@1.0").is_none());
    assert!(PackId::parse("Alice/foley@1.0.0").is_none());
    assert!(PackId::parse("chart@1.0.0").is_none());
}

#[test]
fn seeds_come_from_instance_step_and_index() {
    assert_eq!(
        seed_of("c1", "bars", Some(2)),
        seed_of("c1", "bars", Some(2))
    );
    assert_ne!(
        seed_of("c1", "bars", Some(2)),
        seed_of("c2", "bars", Some(2))
    );
    assert_ne!(
        seed_of("c1", "bars", Some(2)),
        seed_of("c1", "bars", Some(3))
    );
    assert_ne!(seed_of("c1", "bars", None), seed_of("c1", "bars", Some(0)));
}

fn chart_pack(wide: u32) -> Value {
    json!({
        "id": "test/chart", "name": "chart", "version": "1.0.0", "license": "MIT",
        "description": "bars",
        "requires": {"core": ">=0.0.0", "modules": {}},
        "recipes": {"chart.bars@1": {
            "id": "chart.bars", "version": "1.0",
            "inputs": {"n": {"type": "integer", "default": 3, "min": 1, "max": 12}},
            "steps": {"bars": {
                "op": "mark", "kind": "test.rect@1",
                "repeat": {"count": "n", "as": "i"},
                "params": {"w": wide, "h": "40 + 8 * i"},
                "at": {"pos": ["24 * i", 0, 0]}
            }}
        }}
    })
}

fn packs_with(manifest: &Value) -> Packs {
    let mut packs = Packs::default();
    packs
        .admit(manifest, &registry::core())
        .expect("the chart pack checks");
    packs
}

fn board(items: Value) -> Value {
    json!({
        "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
        "size": [640, 360], "packs": ["test/chart@1.0.0"],
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": items
    })
}

fn instance(id: &str, n: u32) -> Value {
    json!({"id": id, "kind": "chart.bars@1", "layer": "main", "name": id, "order": "a0",
        "params": {"n": n}, "at": {"pos": [40, 40, 0]}})
}

#[test]
fn instances_expand_at_check_with_shared_keys_and_derived_items_that_draw() {
    let packs = packs_with(&chart_pack(16));
    let doc = board(json!({"c1": instance("c1", 5), "c2": instance("c2", 5)}));
    let result = super::super::check_packed(&doc, &registry::core(), &packs);
    assert!(result.ok, "{:?}", result.issues);
    let ids: Vec<String> = (0..5).map(|i| format!("c1.bars.{i}")).collect();
    let [c1, c2] = result.expansions.as_slice() else {
        panic!("two expansions, got {}", result.expansions.len())
    };
    assert_eq!(c1.derived.keys().cloned().collect::<Vec<_>>(), ids);
    assert_eq!(c1.key, c2.key, "equal inputs share the key");
    assert_eq!(c1.derived["c1.bars.2"]["params"], json!({"w": 16, "h": 56}));
    assert_eq!(c1.derived["c1.bars.2"]["at"], json!({"pos": [88, 40, 0]}));
    assert!(result.draws.contains(&"c1.bars.4".to_string()));
    assert!(
        !result.draws.contains(&"c1".to_string()),
        "the instance draws nothing itself"
    );
    // Rebuilt with the same inputs: the same IDs, bytes and seeds.
    let again = super::super::check_packed(&doc, &registry::core(), &packs);
    assert_eq!(again.expansions, result.expansions);
    // Out of range, naming n at the instance's params.
    let bad = board(json!({"c3": instance("c3", 20)}));
    let result = super::super::check_packed(&bad, &registry::core(), &packs);
    let range: Vec<_> = result
        .issues
        .iter()
        .filter(|i| i.code == "out_of_range")
        .collect();
    assert_eq!(range[0].path, "items/c3/params/n");
    assert_eq!(range[0].ids, vec!["c3"]);
    assert!(
        result.expansions.is_empty(),
        "an instance with an issue writes nothing"
    );
}

#[test]
fn a_missing_pack_version_keeps_and_skips_its_instances_and_two_of_a_name_are_refused() {
    let packs = packs_with(&chart_pack(16));
    let mut doc = board(json!({"c1": instance("c1", 5)}));
    doc["packs"] = json!(["test/chart@2.0.0"]);
    let result = super::super::check_packed(&doc, &registry::core(), &packs);
    // The document opens (#1958): no error, one notice naming the pack, the version and c1,
    // and c1 neither expands with 1.0.0 nor draws.
    assert!(
        result.issues.iter().all(|i| i.severity != "error"),
        "{:?}",
        result.issues
    );
    let missing = result
        .notices
        .iter()
        .find(|n| n.code == "pack_missing")
        .expect("pack_missing");
    assert_eq!(
        missing.actual,
        json!({"pack": "test/chart", "version": "2.0.0"})
    );
    assert_eq!(missing.ids, vec!["c1"]);
    assert!(result.notices.iter().all(|n| n.code != "unknown_kind"));
    assert!(result.expansions.is_empty() && result.draws.is_empty());
    doc["packs"] = json!(["test/chart@1.0.0", "other/chart@1.0.0"]);
    let result = super::super::check_packed(&doc, &registry::core(), &packs);
    let both = result
        .issues
        .iter()
        .find(|i| i.path == "packs/1")
        .expect("refused");
    assert!(both.what.contains("test/chart@1.0.0") && both.what.contains("other/chart@1.0.0"));
    // The same version published again with other contents is refused.
    let mut packs = packs;
    let err = packs
        .admit(&chart_pack(18), &registry::core())
        .expect_err("refused");
    assert!(err[0].what.contains("never changes"));
    assert!(packs.admit(&chart_pack(16), &registry::core()).is_ok());
}

#[test]
fn a_derived_item_is_no_patch_target_until_broken_out_and_undo_hands_it_back() {
    let packs = packs_with(&chart_pack(16));
    let mut doc = board(json!({"c1": instance("c1", 5), "c2": instance("c2", 5)}));
    let knows = |k: &str| {
        !matches!(
            crate::kinds::lookup(&crate::kinds::registry(), k),
            crate::kinds::Lookup::UnknownKind
        )
    };
    let writing = super::super::Writing {
        layer: "main",
        writer: "agent-a",
        you: false,
        base: None,
        knows: &knows,
        packs: Some(&packs),
    };
    let patch = |ops: Value| json!({"patch": "01J9Z00000000000000000AC96", "doc": "doc-1", "base": 0, "reason": "r", "ops": ops});
    let set = patch(
        json!([{"op": "set", "id": "c1.bars.1", "path": "items/c1.bars.1/params/w", "value": 3}]),
    );
    let err =
        super::super::apply_ops(&mut doc, &set, "patch", "doc-1", &writing).expect_err("refused");
    assert_eq!(
        (err.code, err.ids.clone()),
        ("derived_item", vec!["c1.bars.1".to_string()])
    );
    let before = doc.clone();
    let out = patch(json!([{"op": "break_out", "instance": "c1", "item": "c1.bars.2"}]));
    let done =
        super::super::apply_ops(&mut doc, &out, "patch", "doc-1", &writing).expect("applies");
    let undo = patch(json!(done.undo(&doc)));
    let broken = doc.clone();
    assert_eq!(doc["items"]["c1"]["broken_out"], json!(["c1.bars.2"]));
    assert_eq!(
        doc["items"]["c1.bars.2"]["params"],
        json!({"w": 16, "h": 56})
    );
    assert_eq!(doc["items"]["c1.bars.2"]["layer"], json!("main"));
    let result = super::super::check_packed(&doc, &registry::core(), &packs);
    assert!(result.ok, "{:?}", result.issues);
    let c1 = &result.expansions[0];
    assert_eq!(c1.broken_out, vec!["c1.bars.2"]);
    assert!(
        !c1.derived.contains_key("c1.bars.2"),
        "the instance stops writing it"
    );
    assert_ne!(c1.key, result.expansions[1].key, "broken_out joins the key");
    // Now the writer's own: a set applies, and a change of n re-expands the others around it.
    let own = patch(
        json!([{"op": "set", "id": "c1.bars.2", "path": "items/c1.bars.2/params/w", "value": 3},
        {"op": "set", "id": "c1", "path": "items/c1/params/n", "value": 6}]),
    );
    super::super::apply_ops(&mut doc, &own, "patch", "doc-1", &writing).expect("applies");
    let result = super::super::check_packed(&doc, &registry::core(), &packs);
    assert!(result.ok, "{:?}", result.issues);
    assert_eq!(
        result.lowered["items"]["c1.bars.2"]["params"]["w"],
        json!(3)
    );
    assert!(result.expansions[0].derived.contains_key("c1.bars.5"));
    // The planted re-expansion writes over it.
    let planted = Packs {
        planted: Planted {
            overwrite_broken_out: true,
            ..Planted::default()
        },
        ..packs_with(&chart_pack(16))
    };
    let result = super::super::check_packed(&doc, &registry::core(), &planted);
    assert_eq!(
        result.lowered["items"]["c1.bars.2"]["params"]["w"],
        json!(16)
    );
    // The undo of the break-out, from `Patched::undo`, hands the item back as expanded.
    let mut doc = broken;
    super::super::apply_ops(&mut doc, &undo, "patch", "doc-1", &writing).expect("undo applies");
    assert_eq!(doc, before);
}

#[test]
fn a_pack_whose_module_the_build_lacks_is_refused_naming_it_unless_planted() {
    let mut manifest = chart_pack(16);
    manifest["requires"]["modules"] = json!({"scene3d": ">=0.0.0"});
    let err = check_pack(&manifest, &registry::core(), Planted::default()).expect_err("refused");
    assert_eq!(err[0].code, "module_missing");
    assert!(err[0].what.contains("scene3d"));
    let planted = Planted {
        skip_requires_modules: true,
        ..Planted::default()
    };
    assert!(check_pack(&manifest, &registry::core(), planted).is_ok());
}
// ---- #420: nesting, conditions, repeats along a curve, channels, lights in the budget ----

fn nest_pack(recipes: Value) -> Value {
    json!({
        "id": "test/nest", "name": "nest", "version": "1.0.0", "license": "MIT",
        "description": "recipes in recipes",
        "requires": {"core": ">=0.0.0", "modules": {}},
        "recipes": recipes
    })
}

fn rect_step() -> Value {
    json!({"op": "mark", "kind": "test.rect@1", "params": {"w": 10, "h": 10}})
}

fn nested(name: &str, child: &str) -> Value {
    json!({"id": format!("nest.{name}"), "version": "1.0",
           "steps": {"inner": {"op": "recipe", "kind": format!("nest.{child}@1")}}})
}

fn nest_doc(kind: &str, extra: Value) -> Value {
    let mut doc = json!({
        "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
        "size": [640, 360], "packs": ["test/nest@1.0.0"],
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {"n1": {"id": "n1", "kind": kind, "layer": "main", "name": "n1", "order": "a0",
                         "at": {"pos": [10, 0, 0]}}}
    });
    if let (Some(d), Some(e)) = (doc.as_object_mut(), extra.as_object()) {
        for (k, v) in e {
            if k == "items" {
                let items = d
                    .get_mut("items")
                    .and_then(Value::as_object_mut)
                    .expect("items");
                items.extend(v.as_object().cloned().unwrap_or_default());
            } else {
                d.insert(k.clone(), v.clone());
            }
        }
    }
    doc
}

fn checked(recipes: Value, kind: &str, extra: Value) -> crate::document::CheckResult {
    let packs = packs_with(&nest_pack(recipes));
    super::super::check_packed(&nest_doc(kind, extra), &registry::core(), &packs)
}

#[test]
fn a_recipe_step_nests_its_recipe_under_its_own_derived_id() {
    let result = checked(
        json!({
            "nest.leaf@1": {"id": "nest.leaf", "version": "1.0", "steps": {"r": rect_step()}},
            "nest.box@1": nested("box", "leaf"),
        }),
        "nest.box@1",
        json!({}),
    );
    assert!(result.ok, "{:?}", result.issues);
    let derived: Vec<&String> = result.expansions[0].derived.keys().collect();
    assert_eq!(derived, ["n1.inner", "n1.inner.r"]);
    assert_eq!(
        result.expansions[0].derived["n1.inner"]["kind"],
        json!("nest.leaf@1")
    );
}

#[test]
fn recipes_nest_four_deep_and_a_fifth_is_refused_naming_its_step() {
    let chain = |deep: usize| {
        let mut recipes = Map::new();
        for k in 1..deep {
            recipes.insert(
                format!("nest.d{k}@1"),
                nested(&format!("d{k}"), &format!("d{}", k + 1)),
            );
        }
        recipes.insert(
            format!("nest.d{deep}@1"),
            json!({"id": format!("nest.d{deep}"), "version": "1.0", "steps": {"r": rect_step()}}),
        );
        Value::Object(recipes)
    };
    let four = checked(chain(4), "nest.d1@1", json!({}));
    assert!(four.ok, "{:?}", four.issues);
    assert!(four.expansions[0]
        .derived
        .contains_key("n1.inner.inner.inner.r"));
    let five = checked(chain(5), "nest.d1@1", json!({}));
    assert!(!five.ok);
    assert!(
        five.issues
            .iter()
            .any(|i| i.code == "out_of_range"
                && i.path == "items/n1.inner.inner.inner/steps/inner/kind"),
        "{:?}",
        five.issues
    );
    assert!(
        five.expansions.is_empty(),
        "a refused nesting writes nothing"
    );
}

#[test]
fn a_recipe_that_nests_itself_is_refused_as_a_cycle() {
    let result = checked(
        json!({"nest.a@1": nested("a", "b"), "nest.b@1": nested("b", "a")}),
        "nest.a@1",
        json!({}),
    );
    assert!(
        result.issues.iter().any(|i| i.code == "cycle"),
        "{:?}",
        result.issues
    );
    assert!(result.expansions.is_empty());
}

#[test]
fn a_false_condition_leaves_its_step_out_and_one_reading_t_is_refused_at_the_pack_check() {
    let recipes = |when: &str| {
        json!({"nest.opt@1": {
            "id": "nest.opt", "version": "1.0",
            "inputs": {"lamp": {"type": "bool", "default": false}},
            "steps": {"base": rect_step(),
                      "lamp": {"op": "mark", "kind": "test.rect@1", "when": when, "params": {"w": 2, "h": 2}}}
        }})
    };
    let off = checked(recipes("lamp"), "nest.opt@1", json!({}));
    assert!(off.ok, "{:?}", off.issues);
    assert_eq!(
        off.expansions[0].derived.keys().collect::<Vec<_>>(),
        ["n1.base"]
    );
    let lit = json!({"items": {"n1": {"id": "n1", "kind": "nest.opt@1", "layer": "main", "name": "n1",
                                      "order": "a0", "params": {"lamp": true}}}});
    let on = checked(recipes("lamp"), "nest.opt@1", lit);
    assert_eq!(
        on.expansions[0].derived.keys().collect::<Vec<_>>(),
        ["n1.base", "n1.lamp"]
    );
    let mut packs = Packs::default();
    let refused = packs
        .admit(&nest_pack(recipes("t * 2")), &registry::core())
        .expect_err("a condition reading t is refused");
    assert!(
        refused.iter().any(|i| i.path.ends_with("steps/lamp/when")),
        "{refused:?}"
    );
}

#[test]
fn copies_along_a_curve_stand_at_their_arc_lengths_turned_to_it() {
    let recipes = |repeat: Value| {
        json!({"nest.row@1": {
            "id": "nest.row", "version": "1.0",
            "inputs": {"rail": {"type": "ID", "default": "rail"}},
            "steps": {"post": {"op": "mark", "kind": "test.rect@1", "repeat": repeat, "params": {"w": 1, "h": 1}}}
        }})
    };
    let rail = json!({"items": {"rail": {"id": "rail", "kind": "test.rect@1", "layer": "main",
        "name": "rail", "order": "a1", "params": {"points": [[0, 0, 0], [4, 0, 0], [4, 0, -2]]}}}});
    let counted = checked(
        recipes(json!({"along": "rail", "count": 4, "as": "i"})),
        "nest.row@1",
        rail.clone(),
    );
    let at = |r: &crate::document::CheckResult, k: usize| {
        r.expansions[0].derived[&format!("n1.post.{k}")]["at"].clone()
    };
    // Six metres in four copies: 0, 2, 4 (the corner) and 6, each from the instance's origin.
    assert_eq!(at(&counted, 0)["pos"], json!([10, 0, 0]));
    assert_eq!(at(&counted, 1)["pos"], json!([12, 0, 0]));
    assert_eq!(at(&counted, 3)["pos"], json!([14, 0, -2]));
    assert_eq!(at(&counted, 1)["rot"], json!([0, 0, 0]));
    // Past the corner it runs along −z: a quarter turn about +Y.
    assert_eq!(at(&counted, 3)["rot"], json!([0, 90, 0]));
    let spaced = checked(
        recipes(json!({"along": "rail", "spacing": 1.5, "as": "i"})),
        "nest.row@1",
        rail,
    );
    assert_eq!(
        spaced.expansions[0].derived.len(),
        5,
        "floor(6 / 1.5) + 1 copies"
    );
    assert_eq!(
        spaced.expansions[0].derived["n1.post.3"]["at"]["pos"],
        json!([14, 0, -0.5])
    );
    let mut packs = Packs::default();
    let refused = packs
        .admit(
            &nest_pack(recipes(json!({"along": "rail", "spacing": "t", "as": "i"}))),
            &registry::core(),
        )
        .expect_err("a spacing reading t is refused");
    assert!(
        refused
            .iter()
            .any(|i| i.path.ends_with("steps/post/repeat/spacing")),
        "{refused:?}"
    );
}

#[test]
fn a_recipes_channels_join_the_document_targeting_the_items_it_derived() {
    let result = checked(
        json!({"nest.grow@1": {
            "id": "nest.grow", "version": "1.0",
            "steps": {"bars": {"op": "mark", "kind": "test.rect@1", "repeat": {"count": 2, "as": "i"},
                               "params": {"w": 4, "h": 4}}},
            "channels": {"rise": {"target": "step:bars/params/h", "type": "f32",
                "keys": {"k0": {"t": "0s", "value": 4, "interp": "linear"}, "k1": {"t": "1s", "value": 8}}}}
        }}),
        "nest.grow@1",
        json!({}),
    );
    assert!(result.ok, "{:?}", result.issues);
    let channels = &result.lowered["channels"];
    assert_eq!(
        channels["n1.rise.0"]["target"],
        json!("items/n1.bars.0/params/h")
    );
    assert_eq!(
        channels["n1.rise.1"]["target"],
        json!("items/n1.bars.1/params/h")
    );
    let bad = json!({"nest.bad@1": {"id": "nest.bad", "version": "1.0",
        "steps": {"bars": rect_step()},
        "channels": {"rise": {"target": "step:nothing/params/h"}}}});
    let mut packs = Packs::default();
    let refused = packs
        .admit(&nest_pack(bad), &registry::core())
        .expect_err("a channel on no step is refused");
    assert!(
        refused
            .iter()
            .any(|i| i.path.ends_with("channels/rise/target")),
        "{refused:?}"
    );
}

#[test]
fn lights_a_recipe_derives_count_against_the_documents_light_cap() {
    let recipes = json!({"nest.lamps@1": {
        "id": "nest.lamps", "version": "1.0",
        "steps": {"lamp": {"op": "item", "kind": "light.sun@1", "repeat": {"count": 3, "as": "i"}}}
    }});
    let over = checked(
        recipes.clone(),
        "nest.lamps@1",
        json!({"budget": {"lights": 2}}),
    );
    let issue = over.issues.iter().find(|i| i.path == "budget/lights");
    assert!(
        issue.is_some_and(|i| i.code == "over_budget" && i.ids.len() == 3),
        "{:?}",
        over.issues
    );
    // A cap that is no whole number at or above 0 is refused, never read as no cap.
    for cap in [json!(-1), json!(2.5), json!("2")] {
        let budget = json!({"budget": {"lights": cap}});
        let bad = checked(recipes.clone(), "nest.lamps@1", budget);
        let issue = bad.issues.iter().find(|i| i.path == "budget/lights");
        assert!(
            issue.is_some_and(|i| i.code == "out_of_range"),
            "{:?}",
            bad.issues
        );
    }
    let fits = checked(recipes, "nest.lamps@1", json!({"budget": {"lights": 3}}));
    assert!(
        !fits.issues.iter().any(|i| i.path == "budget/lights"),
        "{:?}",
        fits.issues
    );
}
