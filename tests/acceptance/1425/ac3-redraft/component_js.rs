//! #1425 AC3, blind redraft: a panel script that builds one component the way a plug-in author would, from
//! the toolkit's own description of it. Every registered component says what its constructor takes
//! (`ConstructorDescriptor::arguments`); a value it needs from another constructor, such as a `CarouselState`
//! or an `InputState`, is an `Entity` argument made by a state export, in the view's `init`, as gpui-shell
//! requires. So a catalog can list any component the toolkit registers, or a state export, and this builds it.
#![allow(dead_code)]

use gpui_shell::{
    ArgumentSchema, ComponentDescriptor, ConstructorDescriptor, FrozenComponentRegistry,
};

/// One component, as a panel script builds it.
pub struct Built {
    /// The registered component the script draws: its name heads its node in the script's debug tree.
    pub descriptor: &'static str,
    /// The names the script imports from the component module: the component's constructor and the
    /// state exports its arguments need.
    pub imports: Vec<String>,
    /// Statements for `init`, which make the states.
    pub init: Vec<String>,
    /// The expression that builds the component.
    pub expr: String,
}

/// Builds `name`: a constructor export, or a state export, which is built inside the first component that
/// takes it. A name that is neither isn't a component the panel runtime can construct.
pub fn build(registry: &FrozenComponentRegistry, name: &str) -> Result<Built, String> {
    let constructors = || {
        registry
            .descriptors()
            .flat_map(|d| d.constructors().iter().map(move |c| (d, c)))
    };
    let (descriptor, constructor) = match constructors().find(|(_, c)| c.export() == name) {
        Some(found) => found,
        None => {
            let state = registry
                .states()
                .find(|state| state.export() == name)
                .ok_or_else(|| {
                    format!("{name} is neither a constructor nor a state export of the panel runtime's components")
                })?;
            let kind = state.kind();
            constructors()
                .find(|(_, c)| {
                    c.arguments()
                        .iter()
                        .any(|a| matches!(a.schema(), ArgumentSchema::Entity(k) if *k == kind))
                })
                .ok_or_else(|| format!("no component takes {name}'s {kind}"))?
        }
    };
    let mut built = Built {
        descriptor: descriptor.name(),
        imports: vec![constructor.export().to_owned()],
        init: Vec::new(),
        expr: String::new(),
    };
    let args = arguments(registry, descriptor, constructor, &mut built)?;
    built.expr = format!("new {}({})", constructor.export(), args.join(", "));
    Ok(built)
}

fn arguments(
    registry: &FrozenComponentRegistry,
    descriptor: &ComponentDescriptor,
    constructor: &ConstructorDescriptor,
    built: &mut Built,
) -> Result<Vec<String>, String> {
    let list = constructor.arguments();
    // Trailing optional arguments are left out, as an author would.
    let required = list
        .iter()
        .rposition(|a| !matches!(a.schema(), ArgumentSchema::Optional(_)))
        .map_or(0, |at| at + 1);
    list[..required]
        .iter()
        .map(|a| value(registry, descriptor.name(), a.name(), a.schema(), built))
        .collect()
}

/// A value of `schema` for the argument `arg`.
fn value(
    registry: &FrozenComponentRegistry,
    component: &str,
    arg: &str,
    schema: &ArgumentSchema,
    built: &mut Built,
) -> Result<String, String> {
    Ok(match schema {
        ArgumentSchema::String => string(component, arg),
        ArgumentSchema::Number => if arg.contains("index") { "0" } else { "1" }.to_owned(),
        ArgumentSchema::Boolean => "false".to_owned(),
        ArgumentSchema::Element => "div().child(\"Sample\")".to_owned(),
        ArgumentSchema::Enum(values) => {
            format!("{:?}", values.first().copied().unwrap_or_default())
        }
        ArgumentSchema::Array(inner) => {
            format!("[{}]", value(registry, component, arg, inner, built)?)
        }
        ArgumentSchema::Optional(_) => "undefined".to_owned(),
        ArgumentSchema::Callback(signature) => callback(signature),
        ArgumentSchema::Entity(kind) => {
            let state = registry
                .states()
                .find(|state| state.kind() == *kind)
                .ok_or_else(|| {
                    format!("{component}'s {arg} needs a {kind}, and no state export makes one")
                })?;
            let list = state.arguments();
            let required = list
                .iter()
                .rposition(|a| !matches!(a.schema(), ArgumentSchema::Optional(_)))
                .map_or(0, |at| at + 1);
            let mut args = Vec::new();
            for a in &list[..required] {
                args.push(value(
                    registry,
                    state.export(),
                    a.name(),
                    a.schema(),
                    built,
                )?);
            }
            let slot = format!("this.state{}", built.init.len());
            built
                .init
                .push(format!("{slot} = {}({});", state.export(), args.join(", ")));
            if !built.imports.iter().any(|i| i == state.export()) {
                built.imports.push(state.export().to_owned());
            }
            slot
        }
        other => {
            return Err(format!(
                "{component}'s {arg} takes {other:?}, which this test can't make"
            ))
        }
    })
}

/// A string an author would pass for `arg`.
fn string(component: &str, arg: &str) -> String {
    let text = match arg {
        "id" => format!("ac3-{}", component.to_lowercase()),
        // Relative to the application's asset root: the kit's own icon, and a copy of it in the panel.
        "path" | "src" => "icons/check.svg".to_owned(),
        "url" => "https://example.com/".to_owned(),
        "keystroke" => "cmd-k".to_owned(),
        "patch" | "diff" => "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n".to_owned(),
        _ => "Sample".to_owned(),
    };
    format!("{text:?}")
}

/// A function of the callback's declared type, returning what it says it returns.
fn callback(signature: &str) -> String {
    let returns = signature.rsplit("=>").next().unwrap_or("").trim();
    let body = if returns.ends_with("[]") {
        "[]"
    } else if returns.starts_with("Element") {
        "div().child(\"Sample\")"
    } else if returns.starts_with("boolean") {
        "false"
    } else if returns.starts_with("number") {
        "0"
    } else if returns.starts_with("string") {
        "\"Sample\""
    } else if returns.starts_with("void") {
        "undefined"
    } else {
        "null"
    };
    format!("(() => {body})")
}

/// `built` with its `content` slot filled. gpui-shell lets a script fill a named slot on any element, and the
/// registry doesn't say which components need one: `SettingItem`, for one, can't draw without its content. An
/// author who meets "requires content(element)" fills it, so a name that draws only this way renders too.
pub fn with_content(built: &Built) -> Built {
    Built {
        descriptor: built.descriptor,
        imports: built.imports.clone(),
        init: built.init.clone(),
        expr: format!("{}.content(div().child(\"Sample\"))", built.expr),
    }
}

/// A panel's `main.js` that draws `built`, importing `View` and `div` from `kit` and the rest from `components`
/// (one module, `@deepbuild/panel`, in the test; the toolkit's at the probe).
pub fn panel_js(kit: &str, components: &str, built: &Built) -> String {
    let imports = if kit == components {
        format!(
            "import {{ View, div, {} }} from {kit:?};\n",
            built.imports.join(", ")
        )
    } else {
        format!(
            "import {{ View, div }} from {kit:?};\nimport {{ {} }} from {components:?};\n",
            built.imports.join(", ")
        )
    };
    format!(
        "// #1425 AC3: one component, built as an author would.\n{imports}\nexport default class Ac3 extends View {{\n  init() {{\n    {}\n  }}\n\n  render() {{\n    return div().size_full().p(8).child({});\n  }}\n}}\n",
        built.init.join("\n    "),
        built.expr
    )
}

/// A panel that draws only `child`, an expression over `div`, imported from `kit`.
pub fn plain_js(kit: &str, child: &str) -> String {
    format!(
        "import {{ View, div }} from {kit:?};\n\nexport default class Ac3Twin extends View {{\n  render() {{\n    return div().size_full().p(8){child};\n  }}\n}}\n"
    )
}
