use super::*;

pub(super) fn fixer_with(r: &mut Registrar, rule: deep_canvas::registry::Rule, unproved: bool) {
    let link = param("link", ParamType::Json("item ID"), Value::Null, None, None);
    r.kind(
        kind(
            "fixer",
            vec![
                boxed(),
                number("x", 0.0, 0.0, 1000.0),
                number("y", 0.0, 0.0, 1000.0),
                link,
            ],
        ),
        &[],
        "rect@1",
    )
    .drawn(ink_box);
    r.rule("test.kit.fixer", rule);
    r.code(
        "test.kit.fixer.y_over",
        "y is past the fixer's limit of 100.",
        "Set y to 100.",
        true,
    );
    r.code(
        "test.kit.fixer.x_odd",
        "x is an odd number.",
        "Make x even.",
        false,
    );
    if unproved {
        r.code(
            "test.kit.fixer.y_under",
            "y is below 0.",
            "Set y to 0.",
            true,
        );
    }
    let one = |id: &str, params: Value| {
        board(
            "test.kit.fixer",
            "Fixer",
            json!({id: item(id, "test.kit.fixer@1", "a0", params)}),
        )
    };
    r.parity(
        "framework",
        "fixer-y-over",
        one("f1", json!({"box": [20, 20, 40, 40], "x": 0, "y": 150})),
        json!({"checks": [{"kind": "document.validate"}], "oracles": ["analytic"], "codes": ["test.kit.fixer.y_over"]}),
    );
    r.parity(
        "framework",
        "fixer-x-odd",
        one("f2", json!({"box": [20, 20, 40, 40], "x": 3, "y": 10})),
        json!({"checks": [{"kind": "document.validate"}], "oracles": ["analytic"], "codes": ["test.kit.fixer.x_odd"]}),
    );
    r.parity(
        "framework",
        "fixer-clean",
        one("f3", json!({"box": [20, 20, 40, 40], "x": 2, "y": 10})),
        plain(),
    );
}
