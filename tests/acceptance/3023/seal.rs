//! AC2 of #3023: `test.gpu` seals with the core canvas (a `deep_canvas` registry with
//! `deep_canvas_test_modules::test_gpu()`, as a `test-meter` live build seals it beside the shipped
//! modules), and the sealed listing's list `test.texture@1.mips` offers the word `all` and is closed
//! for `record`, with reopens_if `never: a test module's fixture kind` and instead `nothing`.
//!
//! Written blind at the base e9d73de96 (README.md). No GPU: the seal and its listing only. The
//! registry is the build set the live build seals (`BuildSet::Full`), holding `test.gpu` alone
//! beside the core's own kinds and fill.

use deep_canvas::registry::fields::Closure;
use deep_canvas::registry::{BuildSet, Registry};
use serde_json::json;

/// The list the issue names, as the sealed listing names it.
const LIST: &str = "test.texture@1.mips";

#[test]
fn test_gpu_seals_with_the_core_canvas_and_its_texture_mips_list_is_closed_for_record() {
    let sealed = match Registry::new(BuildSet::Full)
        .with(deep_canvas_test_modules::test_gpu())
        .seal()
    {
        Ok(sealed) => sealed,
        Err(e) => panic!(
            "test.gpu seals with the core canvas, but the seal refused it: code {}, modules {:?}: {}",
            e.code, e.modules, e.what
        ),
    };
    let Some(list) = sealed.field_list(LIST) else {
        let test_lists: Vec<&str> = sealed
            .lists
            .iter()
            .map(|l| l.list.as_str())
            .filter(|l| l.starts_with("test."))
            .collect();
        panic!("the sealed listing holds the list {LIST}; its test.* lists are {test_lists:?}");
    };
    // The list as the sealed listing carries it: its name, kind, field, words and closure.
    assert_eq!(
        list.to_json(),
        json!({
            "list": "test.texture@1.mips",
            "entry": "test.texture@1",
            "field": "mips",
            "words": ["all"],
            "closure": {
                "closed": "record",
                "reopens_if": "never: a test module's fixture kind",
                "instead": "nothing",
            },
        }),
        "the sealed listing's {LIST}"
    );
    assert_eq!(
        list.closure,
        Closure::closed("record", "never: a test module's fixture kind", "nothing"),
        "{LIST} is closed for record, reopens_if never: a test module's fixture kind, instead nothing"
    );
}
