use deep_canvas::registry;

const ID: &str = "#2130.995b1ac2";

#[test]
fn ac7_geometry_shading_names_the_loop_module_in_the_cores_sealed_set() {
    let sealed = registry::core();

    let modules: Vec<&str> = sealed.modules.iter().map(|m| m.name.as_str()).collect();
    assert!(
        !modules.contains(&"loop"),
        "{ID} precondition: the core's sealed set holds no loop module; it holds {modules:?}"
    );
    assert!(
        sealed.check_kind("geometry.shading").is_none(),
        "{ID} precondition: no module of the core's sealed set registers geometry.shading"
    );

    let logic = sealed.module_of_check("logic.determinism");
    assert_eq!(
        logic.as_deref(),
        Some("logic"),
        "{ID} precondition: logic.determinism names the logic module in the same build"
    );
    let core_kind = sealed.module_of_check("geometry.audit");
    assert!(
        core_kind.is_none(),
        "{ID} precondition: geometry.audit is the core's own check kind and names no module; it \
         names {core_kind:?}"
    );
    let unknown = sealed.module_of_check("nowhere.audit");
    assert!(
        unknown.is_none(),
        "{ID} precondition: a kind of no family the design names, nowhere.audit, names no \
         module; it names {unknown:?}"
    );

    let found = sealed.module_of_check("geometry.shading");
    assert_eq!(
        found.as_deref(),
        Some("loop"),
        "{ID}: in the core's sealed set, with no loop module, module_of_check(\"geometry.shading\") \
         is {found:?}, not Some(\"loop\"): the module check kinds have no row for the loop module \
         and the kind's family `geometry` is no module, so a check input naming it is BLOCKED \
         with no module named"
    );
}
