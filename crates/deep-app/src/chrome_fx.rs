//! Issue #1434: the app's own surfaces carry GPU effects through three primitives of the vendored
//! renderer (`vendor/gpui-pre`'s `scene::chrome`, drawn by `vendor/gpui-pre-apple`'s
//! `chrome_layers`): a layer, whose subtree draws offscreen and composites once with group
//! opacity, rounded clip radii and a soft edge; a backdrop, a copy of what's drawn so far under an
//! element; and an effect slot, which runs a shipped operator at the element's own place in paint
//! order. Chrome names the operator and its params; the operator's graphs are the effects
//! module's (deep-effects-render's chrome operators), so chrome never carries shader text.
//!
//! An effect stays inside its element and the panel that holds it (the element's content mask),
//! and never draws over the question card: the window guards the card's slot before anything
//! paints, and an effect that would cover it is refused, drawn nowhere and recorded. The access
//! and key prompts are the OS's own windows (LocalAuthentication, the screen-recording request),
//! which nothing in the app's window can reach. A settled effect asks for no frame, so a still
//! window draws nothing.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Mutex;

use gpui_kit::*;

/// How a layer composites: once, at `opacity`, clipped to `radii` with a soft edge `edge` wide.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layer {
    pub opacity: f32,
    pub radii: Corners<Pixels>,
    pub edge: Pixels,
}

/// Where an effect slot draws in its element's paint order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Place {
    /// Before the element's own fill, text and children.
    Under,
    /// After them.
    Over,
}

/// An effect slot: a shipped operator by name, its params in the operator's order, the backdrop
/// it reads, its clip's radii and its place.
#[derive(Clone, Debug, PartialEq)]
pub struct Effect {
    /// Its own name, which a refusal names.
    pub name: SharedString,
    pub operator: SharedString,
    pub params: Vec<f32>,
    pub backdrop: Option<BackdropScale>,
    pub radii: Corners<Pixels>,
    pub place: Place,
}

/// The app's record of an effect it refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub effect: String,
    pub operator: String,
    /// The guarded surface: `card`.
    pub over: String,
    pub code: &'static str,
}

/// The code a refusal of an effect over a guarded surface carries.
pub const OVER_GUARDED: &str = "chrome_effect_over_guarded";

static REFUSED: Mutex<Vec<Refusal>> = Mutex::new(Vec::new());

/// The refusals recorded since the last take, oldest first.
pub fn take_refusals() -> Vec<Refusal> {
    REFUSED
        .lock()
        .map(|mut r| std::mem::take(&mut *r))
        .unwrap_or_default()
}

/// The question card's name as a guarded surface.
pub const CARD: &str = "card";

thread_local! {
    /// The surfaces each frame guards before it paints, in window points: the card's slot while a
    /// card shows.
    static GUARDED: std::cell::RefCell<Vec<(&'static str, Bounds<Pixels>)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// Guards `bounds` under `name` in every frame from now, until [`unguard`].
pub fn guard(name: &'static str, bounds: Bounds<Pixels>) {
    GUARDED.with(|g| {
        let mut g = g.borrow_mut();
        g.retain(|(n, _)| *n != name);
        g.push((name, bounds));
    });
}

/// Ends `name`'s guard.
pub fn unguard(name: &'static str) {
    GUARDED.with(|g| g.borrow_mut().retain(|(n, _)| *n != name));
}

/// The element that paints the frame's guards: the window root's first child, so it paints before
/// anything an effect could be in.
pub fn guards() -> impl IntoElement {
    canvas(|_, _, _| {}, |_, _, window, _| paint_guards(window))
        .absolute()
        .size_0()
}

/// Paints the frame's guards. The window's root calls it before it paints anything else.
pub fn paint_guards(window: &mut Window) {
    if !guards_on() {
        return;
    }
    for (name, bounds) in GUARDED.with(|g| g.borrow().clone()) {
        window.guard_from_chrome(name, bounds);
    }
}

#[cfg(feature = "chrome-fixture")]
fn guards_on() -> bool {
    !crate::chrome_fixture::planted("no_card_guard")
        && !crate::chrome_fixture::planted("effect_above_card")
}

#[cfg(not(feature = "chrome-fixture"))]
fn guards_on() -> bool {
    true
}

#[cfg(feature = "chrome-fixture")]
fn redraws_settled() -> bool {
    crate::chrome_fixture::planted("redraws_settled_effects")
}

#[cfg(not(feature = "chrome-fixture"))]
fn redraws_settled() -> bool {
    false
}

/// Registers every shipped chrome operator with the renderer, once.
pub fn register_operators() {
    #[cfg(target_os = "macos")]
    {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(register);
    }
}

#[cfg(target_os = "macos")]
fn register() {
    use deep_effects_render::chrome::{self, Input};
    use gpui_apple::metal_renderer::chrome_layers::{
        register_operator, ChromeGraph, ChromeInput, ChromeOperator, ChromeRun,
    };
    for name in chrome::OPERATORS {
        let operator = match chrome::operator(name) {
            Some(Ok(operator)) => operator,
            Some(Err(why)) => {
                eprintln!("deep-app: the chrome operator {name} didn't compile: {why}");
                continue;
            }
            None => continue,
        };
        let graphs = operator
            .graphs
            .iter()
            .map(|g| ChromeGraph {
                label: g.label.clone(),
                msl: g.msl.clone(),
                vertex: g.vertex.clone(),
                fragment: g.fragment.clone(),
            })
            .collect();
        let plan = std::sync::Arc::new(move |params: &[f32]| {
            operator
                .plan(params)
                .into_iter()
                .map(|run| ChromeRun {
                    graph: run.graph,
                    inputs: run.inputs,
                    textures: run
                        .textures
                        .into_iter()
                        .map(|t| match t {
                            Input::Backdrop => ChromeInput::Backdrop,
                            Input::Run(i) => ChromeInput::Run(i),
                        })
                        .collect(),
                })
                .collect()
        });
        register_operator(name, ChromeOperator { graphs, plan });
    }
}

/// Wraps `child` so its subtree draws offscreen and composites once with `layer`.
pub fn layer(layer: Layer, child: impl IntoElement) -> LayerElement {
    LayerElement {
        layer,
        child: child.into_any_element(),
    }
}

/// A layer around a subtree: it lays out and prepaints as its child, and paints it into a layer.
pub struct LayerElement {
    layer: Layer,
    child: AnyElement,
}

impl IntoElement for LayerElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for LayerElement {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        (self.child.request_layout(window, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.child.prepaint(window, cx);
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        let Layer {
            opacity,
            radii,
            edge,
        } = self.layer;
        let child = &mut self.child;
        window.paint_chrome_layer(bounds, opacity, radii, edge, |window| {
            child.paint(window, cx)
        });
    }
}

/// The elements an effect adds to its element's children, each filling it: one to go first, and
/// one to go last when the effect draws over the element's content. Over its content, the
/// effect still reads the backdrop as it was when the element started painting.
pub fn slots(effect: Effect) -> (AnyElement, Option<AnyElement>) {
    register_operators();
    let captured = Rc::new(Cell::new(None));
    let slot = |effect: Effect, captured: Rc<Cell<Option<u64>>>| {
        canvas(
            |_, _, _| {},
            move |bounds, _, window, _| paint_effect(&effect, captured.get(), bounds, window),
        )
        .absolute()
        .size_full()
        .into_any_element()
    };
    match (effect.place, effect.backdrop) {
        (Place::Under, _) => (slot(effect, captured), None),
        (Place::Over, Some(scale)) => {
            let capture = {
                let captured = captured.clone();
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        captured.set(Some(window.paint_chrome_backdrop(bounds, scale)))
                    },
                )
                .absolute()
                .size_full()
                .into_any_element()
            };
            (capture, Some(slot(effect, captured)))
        }
        (Place::Over, None) => (div().into_any_element(), Some(slot(effect, captured))),
    }
}

fn paint_effect(
    effect: &Effect,
    captured: Option<u64>,
    bounds: Bounds<Pixels>,
    window: &mut Window,
) {
    #[cfg(feature = "chrome-fixture")]
    if crate::chrome_fixture::omitted(&effect.name) {
        return;
    }
    let painted = window.paint_chrome_effect(
        bounds,
        effect.name.clone(),
        effect.operator.clone(),
        effect.params.clone(),
        effect.backdrop,
        captured,
        effect.radii,
        px(0.),
    );
    if let Err(refusal) = painted {
        if let Ok(mut refused) = REFUSED.lock() {
            refused.push(Refusal {
                effect: refusal.effect.to_string(),
                operator: effect.operator.to_string(),
                over: refusal.over.to_string(),
                code: OVER_GUARDED,
            });
        }
    }
    PAINTED.with(|p| p.borrow_mut().insert(effect.name.to_string()));
    if redraws_settled() {
        window.request_animation_frame();
    }
}

thread_local! {
    static PAINTED: std::cell::RefCell<std::collections::BTreeSet<String>> =
        const { std::cell::RefCell::new(std::collections::BTreeSet::new()) };
}

/// Each effect painted so far, by name, and whether it has settled. No chrome effect moves yet
/// (its params are fixed while it shows), so one that has painted once has settled.
pub fn states() -> Vec<(String, &'static str)> {
    PAINTED.with(|p| {
        p.borrow()
            .iter()
            .map(|name| (name.clone(), "settled"))
            .collect()
    })
}
