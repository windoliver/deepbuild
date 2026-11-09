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
//!
//! Issue #1436: chrome-fx@1's 24 operators (deep-canvas-effects' `chrome_fx`, the pack's graphs)
//! run in these slots. Each effect reads the effect clock, unless reduced motion is on or it holds
//! its still pose, when it draws that pose and asks for no frame. Its params may bind to readings
//! from the record, each shown with its source and as-of time; the two ink tiers that may sit on it
//! go in with their floors, which every graph keeps; and `edge.flame`'s embers are particles, a
//! closed form of time, their index and the seed, that stop on the first rectangle they meet. An
//! effect is refused, and drawn nowhere, on a fixed role (a status mark, the question card or a
//! prompt), with a literal where a reading is bound, or when it's expressive in a working view no
//! look or panel you picked asked for it in.

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::{Mutex, OnceLock};

use deep_canvas_effects::chrome_fx as pack;
use gpui_kit::*;
use serde_json::{json, Map, Value};

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
/// it reads, its clip's radii and its place; a chrome-fx@1 operator's own fields in `fx`.
#[derive(Clone, Debug, PartialEq)]
pub struct Effect {
    /// Its own name, which a refusal names.
    pub name: SharedString,
    pub operator: SharedString,
    pub params: Vec<f32>,
    pub backdrop: Option<BackdropScale>,
    pub radii: Corners<Pixels>,
    pub place: Place,
    pub fx: Option<Fx>,
}

/// A chrome-fx@1 effect's fields (#1436): `{operator, params, class, still, bind?}`, the class and
/// still pose being its operator's.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Fx {
    /// Its params by name; any it doesn't give take the operator's defaults.
    pub params: Map<String, Value>,
    pub seed: u32,
    /// Each bound param and what it reads: a reading's handle (`reading:<source>#<series>`).
    pub bind: Vec<(String, Value)>,
    /// Whether a look or a panel you picked asked for it.
    pub asked: bool,
    /// The role a look or panel set it for, if any.
    pub on: Option<String>,
    /// The working view it draws in, if it draws in one.
    pub view: Option<String>,
    /// Always its still pose, as the gallery shows it.
    pub hold: bool,
    /// The rectangles its particles stop on, by id, in window points.
    pub colliders: Vec<(String, Bounds<Pixels>)>,
}

/// The app's record of an effect it refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub effect: String,
    pub operator: String,
    /// The guarded surface: `card`.
    pub over: Option<String>,
    /// The working view an unasked expressive effect was in.
    pub view: Option<String>,
    /// The fixed role it was set on.
    pub role: Option<String>,
    /// The bound param that was given a literal.
    pub param: Option<String>,
    pub code: &'static str,
}

impl Refusal {
    fn new(effect: &Effect, code: &'static str) -> Refusal {
        Refusal {
            effect: effect.name.to_string(),
            operator: effect.operator.to_string(),
            over: None,
            view: None,
            role: None,
            param: None,
            code,
        }
    }

    /// As the record holds it: the fields it has.
    pub fn to_json(&self) -> Value {
        let mut v = json!({"effect": self.effect, "operator": self.operator, "code": self.code});
        for (k, f) in [
            ("over", &self.over),
            ("view", &self.view),
            ("role", &self.role),
            ("param", &self.param),
        ] {
            if let Some(f) = f {
                v[k] = json!(f);
            }
        }
        v
    }
}

/// The code a refusal of an effect over a guarded surface carries.
pub const OVER_GUARDED: &str = "chrome_effect_over_guarded";
/// The code of an effect set on a fixed role.
pub const FIXED_ROLE: &str = "chrome_fx_fixed_role";
/// The code of an expressive effect in a working view no look or panel asked for it in.
pub const EXPRESSIVE_UNASKED: &str = "chrome_fx_expressive_unasked";
/// The code of a bound param given a literal, not a reading.
pub const BIND_LITERAL: &str = "chrome_fx_bind_literal";

/// The views a person works in: an expressive effect runs there only where a look or a panel you
/// picked asks for it.
pub const WORKING_VIEWS: [&str; 3] = ["needs-you", "sidebar", "session"];
/// The roles no effect sits on (#1035): status marks, the question card and the access and key
/// prompts.
pub const FIXED_ROLES: [&str; 3] = ["status_mark", "card", "prompt"];

/// The pack's operators, checked once.
fn operators() -> &'static BTreeMap<String, pack::Operator> {
    static OPS: OnceLock<BTreeMap<String, pack::Operator>> = OnceLock::new();
    OPS.get_or_init(|| {
        pack::library()
            .into_iter()
            .map(|o| (o.name.clone(), o))
            .collect()
    })
}

/// A chrome-fx@1 operator by name.
pub fn operator(name: &str) -> Option<&'static pack::Operator> {
    operators().get(name)
}

/// Why an effect may not draw, if it may not: on a fixed role; a bound param given a literal; or
/// an expressive operator in a working view that no look or panel asked for it in.
pub fn admit(effect: &Effect) -> Option<Refusal> {
    let Some(fx) = &effect.fx else { return None };
    if let Some(role) = fx.on.as_deref().filter(|r| FIXED_ROLES.contains(r)) {
        return Some(Refusal {
            role: Some(role.into()),
            ..Refusal::new(effect, FIXED_ROLE)
        });
    }
    if let Some((param, _)) = fx.bind.iter().find(|(_, src)| !is_reading(src)) {
        return Some(Refusal {
            param: Some(param.clone()),
            ..Refusal::new(effect, BIND_LITERAL)
        });
    }
    let expressive = operator(&effect.operator).is_some_and(|o| o.class == pack::Class::Expressive);
    if let Some(view) = fx
        .view
        .as_deref()
        .filter(|v| expressive && !fx.asked && WORKING_VIEWS.contains(v))
    {
        return Some(Refusal {
            view: Some(view.into()),
            ..Refusal::new(effect, EXPRESSIVE_UNASKED)
        });
    }
    None
}

/// Whether a bind's source is a reading's handle, `reading:<source>#<series>`.
fn is_reading(src: &Value) -> bool {
    src.as_str()
        .and_then(|s| s.strip_prefix("reading:"))
        .is_some_and(|rest| {
            rest.split_once('#')
                .is_some_and(|(a, b)| !a.is_empty() && !b.is_empty())
        })
}

thread_local! {
    /// The record's readings by handle: the value and its as-of time in ms.
    static READINGS: RefCell<BTreeMap<String, (f64, u64)>> = const { RefCell::new(BTreeMap::new()) };
    /// The effect clock: a fixed time (the replica's), or the real clock from its first read.
    static CLOCK: Cell<Option<f64>> = const { Cell::new(None) };
    static STARTED: Cell<Option<std::time::Instant>> = const { Cell::new(None) };
    /// Each bound param as the last frame showed it.
    static BOUND: RefCell<Vec<Value>> = const { RefCell::new(Vec::new()) };
    /// The embers' emitters this frame, and the particles the last frame drew.
    static EMITTERS: RefCell<Vec<Emitter>> = const { RefCell::new(Vec::new()) };
    static PARTICLES: RefCell<Vec<Value>> = const { RefCell::new(Vec::new()) };
}

/// The readings bound params read, as the record's one reader folded them.
pub fn set_readings(readings: BTreeMap<String, (f64, u64)>) {
    READINGS.with(|r| *r.borrow_mut() = readings);
}

/// Holds the effect clock at `t` seconds, for the replica.
pub fn set_clock(t: f64) {
    CLOCK.with(|c| c.set(Some(t)));
}

/// The effect clock's time: the replica's, or seconds since the window's first effect drew.
pub fn clock() -> f64 {
    CLOCK.with(Cell::get).unwrap_or_else(|| {
        STARTED.with(|s| {
            s.get()
                .unwrap_or_else(|| {
                    let now = std::time::Instant::now();
                    s.set(Some(now));
                    now
                })
                .elapsed()
                .as_secs_f64()
        })
    })
}

/// Each bound param the last frame showed: `{effect, param, source, value, as_of}`.
pub fn bound() -> Vec<Value> {
    BOUND.with(|b| b.borrow().clone())
}

/// Every particle the last frame drew, alive or stopped: `{effect, index, seed, path, stopped}`.
pub fn particles() -> Vec<Value> {
    PARTICLES.with(|p| p.borrow().clone())
}

/// What a frame starts with: no bound params or emitters shown yet.
pub fn begin_frame() {
    BOUND.with(|b| b.borrow_mut().clear());
    EMITTERS.with(|e| e.borrow_mut().clear());
}

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
    for name in chrome::OPERATORS.iter().chain(&pack::NAMES) {
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
///
/// A chrome-fx@1 effect always reads a backdrop (the whole one, unless it names a scale), and over
/// its element's content it reads what the window holds when it paints, content and all, since
/// it draws its element opaque.
pub fn slots(mut effect: Effect) -> (AnyElement, Option<AnyElement>) {
    register_operators();
    if effect.fx.is_some() {
        effect.backdrop.get_or_insert(BackdropScale::Full);
    }
    let captured = Rc::new(Cell::new(None));
    let slot = |effect: Effect, captured: Rc<Cell<Option<u64>>>| {
        canvas(
            |_, _, _| {},
            move |bounds, _, window, cx| paint_effect(&effect, captured.get(), bounds, window, cx),
        )
        .absolute()
        .size_full()
        .into_any_element()
    };
    match (effect.place, effect.backdrop) {
        (Place::Under, _) => (slot(effect, captured), None),
        (Place::Over, Some(scale)) if effect.fx.is_none() => {
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
        (Place::Over, _) => (div().into_any_element(), Some(slot(effect, captured))),
    }
}

fn paint_effect(
    effect: &Effect,
    captured: Option<u64>,
    bounds: Bounds<Pixels>,
    window: &mut Window,
    cx: &App,
) {
    #[cfg(feature = "chrome-fixture")]
    if crate::chrome_fixture::omitted(&effect.name) {
        return;
    }
    let mut moving = false;
    let params = match &effect.fx {
        None => effect.params.clone(),
        Some(fx) => {
            if let Some(refusal) = admit(effect) {
                if let Ok(mut refused) = REFUSED.lock() {
                    refused.push(refusal);
                }
                return;
            }
            let Some(op) = operator(&effect.operator) else {
                return;
            };
            let still = fx.hold || cx.reduce_motion();
            moving = op.moves() && !still;
            match fx_params(effect, fx, op, still, window) {
                Ok(params) => params,
                Err(why) => {
                    eprintln!("deep-app: chrome effect {}: {why}", effect.name);
                    return;
                }
            }
        }
    };
    let painted = window.paint_chrome_effect(
        bounds,
        effect.name.clone(),
        effect.operator.clone(),
        params,
        effect.backdrop,
        captured,
        effect.radii,
        px(0.),
    );
    if let Err(refusal) = painted {
        if let Ok(mut refused) = REFUSED.lock() {
            refused.push(Refusal {
                effect: refusal.effect.to_string(),
                over: Some(refusal.over.to_string()),
                ..Refusal::new(effect, OVER_GUARDED)
            });
        }
        return;
    }
    PAINTED.with(|p| {
        p.borrow_mut().insert(
            effect.name.to_string(),
            if moving { "moving" } else { "settled" },
        )
    });
    if let Some(fx) = effect
        .fx
        .as_ref()
        .filter(|_| effect.operator == "edge.flame" && moving)
    {
        EMITTERS.with(|e| {
            e.borrow_mut().push(Emitter {
                effect: effect.name.to_string(),
                rect: bounds,
                seed: fx.seed,
                params: fx.params.clone(),
                colliders: fx.colliders.clone(),
            })
        });
    }
    if moving || redraws_settled() {
        window.request_animation_frame();
    }
}

/// A chrome-fx@1 effect's params for its slot this frame: its own (bound ones read from the
/// record), its still pose's when it holds still, then the clock, its seed and the two ink tiers
/// with their floors, pt params at the window's scale.
fn fx_params(
    effect: &Effect,
    fx: &Fx,
    op: &pack::Operator,
    still: bool,
    window: &Window,
) -> Result<Vec<f32>, String> {
    let mut given = fx.params.clone();
    for (param, src) in &fx.bind {
        let handle = src.as_str().unwrap_or_default();
        let reading = READINGS.with(|r| r.borrow().get(handle).copied());
        if let Some((value, _)) = reading {
            given.insert(param.clone(), json!(value));
        }
        BOUND.with(|b| {
            b.borrow_mut().push(json!({
                "effect": effect.name.to_string(), "param": param, "source": handle,
                "value": reading.map(|r| r.0), "as_of": reading.map(|r| r.1),
            }))
        });
    }
    let time = if still {
        given.extend(op.still.clone());
        op.still.get("time").and_then(Value::as_f64).unwrap_or(0.0)
    } else {
        clock()
    };
    let chrome = crate::chrome::of(window);
    let ink = |c: Hsla| {
        let c = Rgba::from(c);
        json!([c.r, c.g, c.b, c.a])
    };
    for (k, v) in [
        ("time", json!(time)),
        ("seed", json!(f64::from(fx.seed % 16_777_216))),
        ("ink", ink(chrome.ink_secondary)),
        ("floor", json!(INK_FLOORS.0)),
        ("ink2", ink(chrome.ink_tertiary)),
        ("floor2", json!(INK_FLOORS.1)),
    ] {
        given.insert(k.into(), v);
    }
    pack::lay_out(op, &given, f64::from(window.scale_factor()))
}

/// The floors of the secondary and tertiary inks (#882's ink tiers), the two that may sit on an
/// effect and set how far it may move: the primary keeps more contrast than the secondary always.
pub const INK_FLOORS: (f64, f64) = (4.5, 3.0);

/// An `edge.flame` drawn this frame, whose embers the frame's particles draw.
#[derive(Clone, Debug)]
struct Emitter {
    effect: String,
    rect: Bounds<Pixels>,
    seed: u32,
    params: Map<String, Value>,
    colliders: Vec<(String, Bounds<Pixels>)>,
}

thread_local! {
    static PAINTED: RefCell<BTreeMap<String, &'static str>> = const { RefCell::new(BTreeMap::new()) };
}

/// Each effect painted so far, by name, and whether it has settled: one that moves with the
/// effect clock is `moving`; one holding its still pose, or with fixed params, has settled.
pub fn states() -> Vec<(String, &'static str)> {
    PAINTED.with(|p| p.borrow().iter().map(|(n, s)| (n.clone(), *s)).collect())
}

/// The element that draws the frame's embers, after everything it may land on: the window root's
/// last child. It draws nothing under reduced motion, when no ember flies.
pub fn embers() -> impl IntoElement {
    canvas(|_, _, _| {}, |_, _, window, cx| paint_embers(window, cx))
        .absolute()
        .size_0()
}

fn paint_embers(window: &mut Window, cx: &App) {
    let emitters = EMITTERS.with(|e| e.borrow().clone());
    let t = clock();
    let chrome = crate::chrome::of(window);
    let inks = [
        (chrome.ink_secondary, INK_FLOORS.0),
        (chrome.ink_tertiary, INK_FLOORS.1),
    ];
    let mut shown = Vec::new();
    for emitter in emitters.iter().filter(|_| !cx.reduce_motion()) {
        let Some(op) = operator("edge.flame") else {
            continue;
        };
        let param = |name: &str| {
            emitter
                .params
                .get(name)
                .or(op
                    .checked
                    .op
                    .inputs
                    .get(name)
                    .and_then(|i| i.default.as_ref()))
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
        };
        let flight = Flight {
            count: param("embers") as u32,
            life: param("ember_life"),
            lift: param("ember_lift"),
            drift: param("ember_drift"),
            gravity: param("ember_gravity"),
        };
        let size = param("ember_size") as f32;
        let color = keep_color([1.0, 0.62, 0.22], &inks);
        for e in flight.at(emitter, t) {
            let [_, x, y] = *e.path.last().expect("a path has its emission point");
            let fade = (1.0 - (t - e.emitted) / flight.life).clamp(0.0, 1.0) as f32;
            let r = px(size);
            window.paint_quad(
                fill(
                    Bounds {
                        origin: point(px(x as f32) - r, px(y as f32) - r),
                        size: gpui_kit::size(r * 2., r * 2.),
                    },
                    Rgba {
                        r: color[0],
                        g: color[1],
                        b: color[2],
                        a: 0.9 * fade,
                    },
                )
                .corner_radii(r),
            );
            shown.push(json!({
                "effect": emitter.effect, "index": e.index, "seed": emitter.seed,
                "path": e.path,
                "stopped": e.stopped.as_ref().map(|(on, at, t)| json!({"on": on, "at": at, "t": t})),
            }));
        }
    }
    PARTICLES.with(|p| *p.borrow_mut() = shown);
}

/// How `edge.flame`'s embers fly, from its params: `count` alive at once, each living `life` s,
/// thrown up at up to `lift` pt/s and sideways at up to `drift`, falling at `gravity` pt/s².
#[derive(Clone, Copy, Debug)]
pub struct Flight {
    pub count: u32,
    pub life: f64,
    pub lift: f64,
    pub drift: f64,
    pub gravity: f64,
}

/// One ember at a time: its index, when it was thrown, its path as `[t, x, y]` from its emission
/// at most 1/60 s apart to where it is, and where and when it stopped, on what.
#[derive(Clone, Debug, PartialEq)]
pub struct Ember {
    pub index: u64,
    pub emitted: f64,
    pub path: Vec<[f64; 3]>,
    pub stopped: Option<(String, [f64; 2], f64)>,
}

impl Flight {
    /// The embers alive at `t`: ember j is thrown at j × life ÷ count from a point on the flame's top
    /// edge, each of its numbers a hash of the seed and j, and flies ballistically until the first
    /// rectangle it enters stops it on that rectangle's edge, where it rests until its life ends.
    fn at(&self, emitter: &Emitter, t: f64) -> Vec<Ember> {
        if self.count == 0 || self.life <= 0.0 || t < 0.0 {
            return Vec::new();
        }
        let dt = self.life / f64::from(self.count);
        let last = (t / dt).floor() as u64;
        let first = (((t - self.life) / dt).floor() + 1.0).max(0.0) as u64;
        let r = emitter.rect;
        let f = |p: Pixels| f64::from(f32::from(p));
        let (rx, ry, rw) = (f(r.origin.x), f(r.origin.y), f(r.size.width));
        let rects: Vec<(&str, [f64; 4])> = emitter
            .colliders
            .iter()
            .map(|(id, b)| {
                (
                    id.as_str(),
                    [b.origin.x, b.origin.y, b.size.width, b.size.height].map(f),
                )
            })
            .collect();
        (first..=last)
            .map(|j| {
                let rand = |k: u32| {
                    f64::from(deep_canvas_effects::interp::hash(&[emitter.seed, j as u32, k]) >> 8)
                        / 16_777_216.0
                };
                let emitted = j as f64 * dt;
                let p0 = [rx + rand(1) * rw, ry];
                let v = [
                    (rand(2) - 0.5) * 2.0 * self.drift,
                    -self.lift * (0.3 + 0.7 * rand(3)),
                ];
                let age = t - emitted;
                let hit = rects
                    .iter()
                    .filter_map(|(id, rect)| {
                        entry(p0, v, self.gravity, *rect).map(|tau| (tau, *id))
                    })
                    .filter(|(tau, _)| *tau <= age)
                    .min_by(|a, b| a.0.total_cmp(&b.0));
                let end = hit.map_or(age, |h| h.0);
                let at = |tau: f64| {
                    [
                        emitted + tau,
                        p0[0] + v[0] * tau,
                        p0[1] + v[1] * tau + 0.5 * self.gravity * tau * tau,
                    ]
                };
                let mut path: Vec<[f64; 3]> = (0..)
                    .map(|k| f64::from(k) / 60.0)
                    .take_while(|tau| *tau < end)
                    .map(at)
                    .collect();
                path.push(at(end));
                let stopped = hit.map(|(tau, id)| {
                    let p = at(tau);
                    (id.to_string(), [p[1], p[2]], emitted + tau)
                });
                Ember {
                    index: j,
                    emitted,
                    path,
                    stopped,
                }
            })
            .collect()
    }
}

/// When a ballistic path from `p` at velocity `v` under `g` (down) first enters `rect` (x, y, w, h)
/// through one of its edges, if it does.
fn entry(p: [f64; 2], v: [f64; 2], g: f64, [x, y, w, h]: [f64; 4]) -> Option<f64> {
    let pos = |tau: f64| [p[0] + v[0] * tau, p[1] + v[1] * tau + 0.5 * g * tau * tau];
    let mut best: Option<f64> = None;
    let mut take = |tau: f64| {
        if tau > 1e-9 && best.is_none_or(|b| tau < b) {
            best = Some(tau);
        }
    };
    // Top and bottom: y(τ) = edge, falling through the top, rising through the bottom.
    for (edge, falling) in [(y, true), (y + h, false)] {
        let (a, b, c) = (0.5 * g, v[1], p[1] - edge);
        let roots: Vec<f64> = if a.abs() < 1e-12 {
            if b.abs() < 1e-12 {
                vec![]
            } else {
                vec![-c / b]
            }
        } else {
            let disc = b * b - 4.0 * a * c;
            if disc < 0.0 {
                vec![]
            } else {
                vec![
                    (-b - disc.sqrt()) / (2.0 * a),
                    (-b + disc.sqrt()) / (2.0 * a),
                ]
            }
        };
        for tau in roots {
            let vy = v[1] + g * tau;
            let px = pos(tau)[0];
            if (vy > 0.0) == falling && px >= x && px <= x + w {
                take(tau);
            }
        }
    }
    // Left and right: x(τ) = edge, moving right through the left, left through the right.
    for (edge, right) in [(x, true), (x + w, false)] {
        if (v[0] > 0.0) == right && v[0].abs() > 1e-12 {
            let tau = (edge - p[0]) / v[0];
            let py = pos(tau)[1];
            if py >= y && py <= y + h {
                take(tau);
            }
        }
    }
    best
}

/// `rgb` (sRGB, 0 to 1) moved toward white under dark ink, or black under light ink, by the least
/// that keeps each ink, composited over it, at its floor with 4% to spare: the keeper every
/// chrome-fx@1 graph ends in, for what the app draws itself.
pub fn keep_color(rgb: [f32; 3], inks: &[(Hsla, f64)]) -> [f32; 3] {
    let lin = |c: f64| ((c.clamp(0.0, 1.0) + 0.055) / 1.055).powf(2.4);
    let lum = |c: [f64; 3]| 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    let inks: Vec<([f64; 3], f64, f64)> = inks
        .iter()
        .map(|(c, floor)| {
            let c = Rgba::from(*c);
            ([c.r, c.g, c.b].map(f64::from), f64::from(c.a), *floor)
        })
        .collect();
    let ok = |v: [f64; 3]| {
        inks.iter().all(|(ink, a, floor)| {
            let comp = [0, 1, 2].map(|i| ink[i] * a + v[i] * (1.0 - a));
            let (x, y) = (lum(comp), lum(v));
            (x.max(y) + 0.05) / (x.min(y) + 0.05) >= floor * 1.04
        })
    };
    let base = rgb.map(f64::from);
    let toward = if inks.first().is_some_and(|(ink, _, _)| lum(*ink) < 0.18) {
        1.0
    } else {
        0.0
    };
    let at = |k: f64| base.map(|c| c + (toward - c) * k);
    if ok(base) {
        return rgb;
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..8 {
        let mid = (lo + hi) / 2.0;
        if ok(at(mid)) {
            hi = mid
        } else {
            lo = mid
        }
    }
    at(hi).map(|c| c as f32)
}
