//! #2660 criterion 4's planted scope: one that keeps its targets across a patch that moves an
//! item. The check `hover.rs` runs after the patch fails on it, naming the item. The scope is
//! planted through `deep_canvas::scope::Planted`'s `keeps_targets_across_patch` switch (README).

mod hover_doc;

use deep_canvas::scope::Planted;

// AC4 #2660.86f235d7 (its planted scope)
#[test]
fn ac4_a_scope_that_keeps_its_targets_across_a_patch_that_moves_an_item_fails_naming_it() {
    let planted = Planted {
        keeps_targets_across_patch: true,
        ..Planted::default()
    };
    let err = hover_doc::hovers_the_moved_item(planted)
        .expect_err("the planted scope hovers what its kept targets say");
    assert!(
        err.contains(hover_doc::MOVED),
        "the failure names the moved item: {err}"
    );
    // The same check passes on the scope as shipped.
    hover_doc::hovers_the_moved_item(Planted::default()).unwrap();
}
