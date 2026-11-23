//! Issue #1801: the kit's test.kit.pointer module, and `-declared`, which declares its reference.

use super::*;

// ------------------------------------------------------------------------------------------------
// test.kit.pointer (#1801): a box whose `points_to` names another item of the document; `-declared`
// declares that field a reference of kind target, as the kit's references part and refs_to read it.

fn pointer_with(r: &mut Registrar, declared: bool) {
    let points_to = param(
        "points_to",
        ParamType::Json("ID | null"),
        Value::Null,
        None,
        None,
    );
    r.kind(kind("pointer", vec![boxed(), points_to]), &[], "rect@1")
        .drawn(ink_box)
        // #2777: `null` is the one word the field offers.
        .closes(
            "points_to",
            deep_canvas::registry::fields::Closure::closed(
                "record",
                "never: a test module's fixture kind",
                deep_canvas::registry::fields::NOTHING,
            ),
        );
    if declared {
        use deep_canvas::refs::{kind as names, Decl, Holds};
        r.refs(&[Decl::new("params/points_to", Holds::Item, names::TARGET)]);
    }
    // The kit proves the module alone, with the core: its target is a pointer too, to nothing.
    let target = item(
        "t1",
        "test.kit.pointer@1",
        "a0",
        json!({"box": [20, 20, 40, 40], "points_to": null}),
    );
    let pointer = item(
        "p1",
        "test.kit.pointer@1",
        "a1",
        json!({"box": [80, 20, 40, 40], "points_to": "t1"}),
    );
    r.parity(
        "kernel",
        "pointer",
        board(
            "test.kit.pointer",
            "Pointer",
            json!({"t1": target, "p1": pointer}),
        ),
        json!({"checks": [{"kind": "document.validate"}], "oracles": ["analytic"], "codes": []}),
    );
}

fn register_pointer(r: &mut Registrar) {
    pointer_with(r, false);
}

fn register_pointer_declared(r: &mut Registrar) {
    pointer_with(r, true);
}

pub fn pointer() -> Module {
    Module {
        manifest: manifest("test.kit.pointer", 1),
        register: register_pointer,
    }
}

pub fn pointer_declared() -> Module {
    Module {
        manifest: manifest("test.kit.pointer", 1),
        register: register_pointer_declared,
    }
}
