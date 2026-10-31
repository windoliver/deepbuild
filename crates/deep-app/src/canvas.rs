//! Issue #338: the canvas, drawn by the app's own views and mounted from scripts through
//! gpui-shell's component registry, with no fork.
//!
//! A canvas draws items by ID. The Rust session page draws its line through [`line`]; a script
//! draws through the `Canvas` component, whose items live in a `CanvasScene`, a retained-state
//! handle the script keeps across renders and updates with `set(id, value)`. Every item drawn in
//! the last frame is recorded with its evaluated value, which is what a replica's text snapshot
//! lists, and with where it was drawn, which is where a replica's input reaches it (#124).

use std::{cell::RefCell, collections::BTreeMap, sync::Arc};

use gpui_kit::*;
use gpui_shell::{
    anyhow, ArgumentDescriptor, ArgumentSchema, ComponentArgument, ComponentDataValue,
    ComponentDescriptor, ComponentMaterializer, ComponentPayload, ComponentRegistry,
    ConstructorDescriptor, FrozenComponentRegistry, MaterializeRequest, RegistryError,
    StateDescriptor, StateMethodDescriptor,
};
use serde_json::{json, Value};

pub const COMPONENT: &str = "Canvas";
pub const SCENE: &str = "CanvasScene";

thread_local! {
    static DRAWN: RefCell<BTreeMap<String, Value>> = const { RefCell::new(BTreeMap::new()) };
    static PLACED: RefCell<BTreeMap<String, Bounds<Pixels>>> = const { RefCell::new(BTreeMap::new()) };
}

/// Forgets the items of earlier frames; call before the frame a snapshot reads.
pub fn clear_items() {
    DRAWN.with(|drawn| drawn.borrow_mut().clear());
    PLACED.with(|placed| placed.borrow_mut().clear());
}

/// The items drawn since [`clear_items`], by ID, with their evaluated values.
pub fn items() -> Vec<(String, Value)> {
    DRAWN.with(|drawn| {
        drawn
            .borrow()
            .iter()
            .map(|(id, value)| (id.clone(), value.clone()))
            .collect()
    })
}

/// Where each item drawn since [`clear_items`] was drawn, in window points.
pub fn placed() -> Vec<(String, Bounds<Pixels>)> {
    PLACED.with(|placed| {
        placed
            .borrow()
            .iter()
            .map(|(id, bounds)| (id.clone(), *bounds))
            .collect()
    })
}

pub(crate) fn record(id: &str, value: Value, bounds: Bounds<Pixels>) {
    DRAWN.with(|drawn| {
        drawn.borrow_mut().insert(id.to_owned(), value);
    });
    PLACED.with(|placed| {
        placed.borrow_mut().insert(id.to_owned(), bounds);
    });
}

/// A polyline through `values`, spread across the element's width and scaled to its height.
/// Its item is the values it drew.
pub fn line(id: &str, values: Vec<f64>, color: Hsla) -> Canvas<()> {
    let id = id.to_owned();
    canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            record(&id, json!(values), bounds);
            paint_line(bounds, &values, color, window);
        },
    )
}

fn paint_line(bounds: Bounds<Pixels>, values: &[f64], color: Hsla, window: &mut Window) {
    if values.len() < 2 {
        return;
    }
    let low = values.iter().cloned().fold(f64::INFINITY, f64::min);
    let high = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let spread = if high > low { high - low } else { 1.0 };
    let w = f64::from(f32::from(bounds.size.width));
    let h = f64::from(f32::from(bounds.size.height));
    let points = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let x = w * (index as f64 / (values.len() - 1) as f64);
            let y = h * (1.0 - ((value - low) / spread) * 0.84 - 0.08);
            [x, y]
        })
        .collect();
    // The canvas's stroke paint, 2 px wide: no view paints a line of its own (#380).
    let origin = [f32::from(bounds.origin.x), f32::from(bounds.origin.y)];
    deep_marks_gpui::paint(&deep_marks_gpui::stroke(points, 2.0), origin, color, window);
}

/// A script's retained canvas state: items by ID, each a list of values.
#[derive(Default)]
pub struct Scene {
    items: BTreeMap<String, Vec<f64>>,
}

impl Scene {
    pub fn set(&mut self, id: &str, values: Vec<f64>) {
        self.items.insert(id.to_owned(), values);
    }
}

struct CanvasPayload {
    scene: ComponentArgument,
    color: Option<Hsla>,
}

struct CanvasMaterializer;

impl ComponentMaterializer for CanvasMaterializer {
    fn materialize(&self, mut request: MaterializeRequest<'_>) -> anyhow::Result<AnyElement> {
        let payload = request
            .payload()
            .downcast_ref::<CanvasPayload>()
            .ok_or_else(|| anyhow::anyhow!("Canvas received an incompatible payload"))?;
        // A script that names no color draws its line in the look's line role.
        let color = payload.color;
        let scene = request.with_state::<Entity<Scene>, _>(&payload.scene, Clone::clone)?;
        let items: Vec<(String, Vec<f64>)> = request.with_window_app(|_, cx| {
            Ok(scene
                .read(cx)
                .items
                .iter()
                .map(|(id, values)| (id.clone(), values.clone()))
                .collect())
        })?;
        let mut element = div().child(
            canvas(
                |_, _, _| (),
                move |bounds, _, window, _| {
                    let color = color.unwrap_or_else(|| crate::chrome::of(window).session_line);
                    for (id, values) in &items {
                        record(id, json!(values), bounds);
                        paint_line(bounds, values, color, window);
                    }
                },
            )
            .size_full(),
        );
        element.style().refine(&request.take_style());
        Ok(element.into_any_element())
    }
}

/// Registers `Canvas` and `CanvasScene` into a registry beside gpui-shell's own catalog.
pub fn register(registry: &mut ComponentRegistry) -> Result<(), RegistryError> {
    registry.register_state(
        StateDescriptor::new(SCENE, SCENE, Vec::new(), |_, _, cx| {
            Ok(Box::new(cx.new(|_| Scene::default())))
        })
        .with_documentation("The items a Canvas draws, by ID, kept across renders.")
        .with_methods(vec![StateMethodDescriptor::new::<Entity<Scene>>(
            "set",
            "set(id: string, values: number[]): void",
            |scene, arguments, _, cx| {
                let [ComponentDataValue::String(id), ComponentDataValue::Array(values)] = arguments
                else {
                    anyhow::bail!(
                        "CanvasScene.set(id, values) expects an id and a list of numbers"
                    );
                };
                let values = values
                    .iter()
                    .map(|value| match value {
                        ComponentDataValue::Number(number) => Ok(*number),
                        other => Err(anyhow::anyhow!(
                            "CanvasScene.set: {other:?} is not a number"
                        )),
                    })
                    .collect::<anyhow::Result<Vec<f64>>>()?;
                scene.update(cx, |scene, _| scene.set(id, values));
                Ok(ComponentDataValue::Null)
            },
        )]),
    )?;
    registry.register(
        ComponentDescriptor::new(COMPONENT, Arc::new(CanvasMaterializer))
            .with_constructors(vec![ConstructorDescriptor::new(
                COMPONENT,
                vec![
                    ArgumentDescriptor::new("scene", ArgumentSchema::Entity(SCENE)),
                    ArgumentDescriptor::new(
                        "color",
                        ArgumentSchema::Optional(Box::new(ArgumentSchema::String)),
                    ),
                ],
                |arguments| match arguments {
                    [scene @ ComponentArgument::Entity { .. }, ComponentArgument::Optional(color)] => {
                        let color = match color.as_deref() {
                            Some(ComponentArgument::String(text)) => Some(
                                parse_hex(text).ok_or_else(|| format!("invalid Canvas color `{text}`"))?,
                            ),
                            Some(other) => return Err(format!("Canvas color {other:?} is not a string")),
                            None => None,
                        };
                        Ok(ComponentPayload::new(CanvasPayload {
                            scene: scene.clone(),
                            color,
                        }))
                    }
                    _ => Err("Canvas(scene, color?) expects a CanvasScene".into()),
                },
            )])
            .with_documentation("Draws a CanvasScene's items as lines."),
    )?;
    Ok(())
}

fn parse_hex(text: &str) -> Option<Hsla> {
    let digits = text.strip_prefix('#')?;
    if digits.len() != 6 {
        return None;
    }
    let value = u32::from_str_radix(digits, 16).ok()?;
    Some(rgb(value).into())
}

/// What the registry says about the canvas: its constructor's argument schemas, typed by
/// gpui-shell's `ComponentArgument` kinds, and whether a retained state backs it.
pub fn describe(registry: &FrozenComponentRegistry) -> Option<Value> {
    let descriptor = registry
        .descriptors()
        .find(|descriptor| descriptor.name() == COMPONENT)?;
    let constructor = descriptor.constructors().first()?;
    let arguments: Vec<Value> = constructor
        .arguments()
        .iter()
        .map(|argument| json!({ "name": argument.name(), "type": schema_kind(argument.schema()) }))
        .collect();
    let retained = constructor.arguments().iter().any(
        |argument| matches!(argument.schema(), ArgumentSchema::Entity(kind) if *kind == SCENE),
    ) && registry.states().any(|state| state.kind() == SCENE);
    Some(json!({
        "component": descriptor.name(),
        "arguments": arguments,
        "retainedState": retained,
    }))
}

fn schema_kind(schema: &ArgumentSchema) -> &'static str {
    match schema {
        ArgumentSchema::String => "string",
        ArgumentSchema::Number => "number",
        ArgumentSchema::Boolean => "boolean",
        ArgumentSchema::Element => "element",
        ArgumentSchema::Entity(_) => "entity",
        ArgumentSchema::Callback(_) => "callback",
        ArgumentSchema::Enum(_) => "enum",
        ArgumentSchema::Array(_) => "array",
        ArgumentSchema::Optional(_) => "optional",
        _ => "unknown",
    }
}
