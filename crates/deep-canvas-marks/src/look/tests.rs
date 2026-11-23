use super::*;

fn resolve(def: &Value) -> Result<Look, Refusal> {
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    super::resolve(def, &bundled)
}

#[test]
fn a_data_role_near_a_status_color_is_refused_naming_both() {
    let mut def = shipped("clean").unwrap();
    def["palette"]["slate"] = json!("#636465");
    assert_eq!(
        resolve(&def),
        Err(Refusal::Distance {
            theme: "light",
            role: "muted".into(),
            state: "idle",
            distance: distance([0x63, 0x64, 0x65], [0x63, 0x64, 0x64]),
        })
    );
}

#[test]
fn a_theme_that_changes_more_than_palette_and_roles_is_refused() {
    let mut def = shipped("clean").unwrap();
    def["themes"]["dark"]["status"] = json!({"pass": "#000000"});
    assert_eq!(
        resolve(&def),
        Err(Refusal::Bad("themes/dark/status".into()))
    );
}

#[test]
fn the_clean_look_passes_its_own_guard() {
    assert!(resolve(&shipped("clean").unwrap()).is_ok());
}

#[test]
fn a_status_color_too_close_to_a_ground_is_refused_unless_an_outline_holds_it() {
    let mut def = shipped("clean").unwrap();
    // Darker than the night ground allows: under 3:1 against it.
    def["status"]["idle"] = json!("#5a0a0a");
    assert_eq!(
        resolve(&def),
        Err(Refusal::Contrast {
            theme: "dark",
            state: "idle",
            against: "ground"
        })
    );
    def["palette"]["rim"] = json!("#c8c8c8");
    def["roles"]["rim"] = json!("rim");
    def["status_treatment"]["outline"] = json!({"px": 1, "role": "rim"});
    assert_eq!(resolve(&def).err(), None, "an outline at 3:1 holds it");
}

#[test]
fn a_status_color_no_label_can_read_on_is_refused() {
    let mut def = shipped("clean").unwrap();
    // Mid grey: 3:1 on white but under 4.5:1 for both white and the ink on it.
    def["status"]["idle"] = json!("#7a7a7a");
    assert_eq!(
        resolve(&def),
        Err(Refusal::Contrast {
            theme: "light",
            state: "idle",
            against: "label"
        })
    );
}

#[test]
fn the_attention_glyph_is_one_no_state_may_share() {
    let mut def = shipped("clean").unwrap();
    def["attention_treatment"]["glyph"] = json!("!");
    assert_eq!(
        resolve(&def),
        Err(Refusal::GlyphShared(["needs_you", "attention"]))
    );
    def["attention_treatment"]["line"] = json!("solid");
    def["attention_treatment"]["glyph"] = json!("⚠");
    assert_eq!(
        resolve(&def),
        Err(Refusal::Bad("attention_treatment/line".into()))
    );
}

#[test]
fn a_focus_ring_is_held_in_a_look_without_other_chrome_roles() {
    let mut def = shipped("chalk").unwrap();
    def["roles"]["focus"] = def["roles"]["ground"].clone();
    assert!(matches!(
        resolve(&def),
        Err(Refusal::FocusContrast {
            theme: "light",
            on: "ground",
            ..
        })
    ));
}

#[test]
fn every_shipped_look_gives_each_token_class_and_diff_mark_a_role_the_guard_holds() {
    for id in SHIPPED {
        let def = shipped(id).unwrap();
        // The guard as the app's look: every role at the status distance, in both themes.
        let look = resolve(&def).unwrap_or_else(|r| panic!("{id}: {r:?}"));
        let classes: Vec<&str> = look.light_type.code.keys().map(String::as_str).collect();
        let mut listed = crate::code::CLASSES.to_vec();
        listed.sort_unstable();
        assert_eq!(classes, listed, "{id}");
        assert_eq!(look.dark_type.code, look.light_type.code, "{id}");
        for mark in DIFF_MARKS {
            let role = def["diff"][mark].as_str().unwrap_or_default();
            assert!(look.light.contains_key(role), "{id}: diff/{mark} in light");
            assert!(look.dark.contains_key(role), "{id}: diff/{mark} in dark");
        }
    }
}

#[test]
fn a_code_or_diff_map_is_refused_at_what_it_lacks_or_adds() {
    let refused = |edit: &dyn Fn(&mut Value)| {
        let mut def = shipped("clean").unwrap();
        edit(&mut def);
        resolve(&def).err()
    };
    let bad = |path: &str| Some(Refusal::Bad(path.into()));
    assert_eq!(
        refused(&|d| d["code"]["identifier"] = json!("ink")),
        bad("code/identifier")
    );
    assert_eq!(
        refused(&|d| {
            d["code"].as_object_mut().unwrap().remove("comment");
        }),
        bad("code/comment")
    );
    // A role the look doesn't give, a font role, and a role only one theme gives.
    assert_eq!(
        refused(&|d| d["code"]["keyword"] = json!("crimson")),
        bad("code/keyword")
    );
    assert_eq!(
        refused(&|d| d["code"]["plain"] = json!("math")),
        bad("code/plain")
    );
    assert_eq!(
        refused(&|d| {
            d["palette"]["leaf"] = json!("#0f4f32");
            d["themes"]["dark"]["roles"]["leaf"] = json!("leaf");
            d["diff"]["added"] = json!("leaf");
        }),
        bad("diff/added")
    );
    assert_eq!(
        refused(&|d| d["diff"]["moved"] = json!("ink")),
        bad("diff/moved")
    );
    // A look with neither is still a look: its tokens draw in plain.
    let mut bare = shipped("clean").unwrap();
    bare.as_object_mut().unwrap().remove("code");
    bare.as_object_mut().unwrap().remove("diff");
    assert!(resolve(&bare).unwrap().light_type.code.is_empty());
}

#[test]
fn the_clean_look_draws_one_icon_set_at_two_sizes_with_one_stroke() {
    let look = resolve(&shipped("clean").unwrap()).unwrap();
    let icons = look.sizes.unwrap().icons;
    assert_eq!((icons.row, icons.page, icons.stroke), (14.0, 16.0, 1.5));
    // A look pack can't change them, as it can't change type or space (#1458).
    let mut def = shipped("clean").unwrap();
    def["icons"]["row"] = json!(18);
    assert_eq!(resolve(&def).err(), Some(Refusal::Bad("icons".into())));
}

#[test]
fn every_state_has_a_drawn_mark_told_apart_from_every_other_with_color_off() {
    let look = resolve(&shipped("clean").unwrap()).unwrap();
    let marks = look.marks.expect("the clean look draws its status marks");
    assert_eq!(marks.slot, 16.0);
    let covers: Vec<_> = STATES
        .iter()
        .map(|s| (*s, marks.coverage(s).unwrap()))
        .collect();
    for (i, (a, ca)) in covers.iter().enumerate() {
        assert!(ca.iter().any(|c| *c), "{a} covers something");
        for (b, cb) in &covers[i + 1..] {
            let share = apart(ca, cb);
            assert!(share >= TOLD_APART, "{a} and {b} differ in {share}");
        }
    }
    // A mark with a cut is its core with the cut masked out; one without is its core alone.
    assert!(marks.svg("pass").unwrap().contains(r#"mask="url(#cut)""#));
    assert!(!marks.svg("blocked").unwrap().contains("mask"));
}

#[test]
fn two_states_drawn_alike_are_refused_naming_the_pair() {
    let mut def = shipped("clean").unwrap();
    def["status_treatment"]["drawn"]["fail"] = def["status_treatment"]["drawn"]["pass"].clone();
    match resolve(&def) {
        Err(Refusal::MarkShared { pair, share }) => {
            assert_eq!(pair, ["pass", "fail"]);
            assert_eq!(share, 0.0);
        }
        other => panic!("not refused as a shared mark: {other:?}"),
    }
    // The same shape a point to the right is still the same shape.
    let mut def = shipped("clean").unwrap();
    def["status_treatment"]["drawn"]["stale"] = json!({"core": "M5.5 2L12.5 2C13.881 2 15 3.119 15 4.5L15 11.5C15 12.881 13.881 14 12.5 14L5.5 14C4.119 14 3 12.881 3 11.5L3 4.5C3 3.119 4.119 2 5.5 2Z"});
    assert!(matches!(
        resolve(&def),
        Err(Refusal::MarkShared {
            pair: ["blocked", "stale"],
            ..
        })
    ));
}

#[test]
fn a_mark_past_its_slot_or_missing_is_refused() {
    let mut def = shipped("clean").unwrap();
    def["status_treatment"]["drawn"]["idle"]["core"] = json!("M0 0L17 0L17 17Z");
    assert_eq!(
        resolve(&def).err(),
        Some(Refusal::Bad("status_treatment/drawn/idle/core".into()))
    );
    let mut def = shipped("clean").unwrap();
    def["status_treatment"]["drawn"]
        .as_object_mut()
        .unwrap()
        .remove("stale");
    assert_eq!(
        resolve(&def).err(),
        Some(Refusal::Bad("status_treatment/drawn/stale".into()))
    );
}

#[test]
fn a_font_that_can_t_ship_is_refused_naming_it() {
    let mut def = shipped("clean").unwrap();
    def["fonts"]["body"]["file"] = json!("Helvetica.ttc");
    assert_eq!(resolve(&def), Err(Refusal::Font("body".into())));
    let mut def = shipped("clean").unwrap();
    def["fonts"]["mono"]["embed"] = json!(false);
    assert_eq!(resolve(&def), Err(Refusal::Font("mono".into())));
}
