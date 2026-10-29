//! Issue #400: windows on any display (canvas primitives: Window and display placement; Frame
//! clock and scheduler; Question card). The scenario's displays, each with its own vsync grid;
//! the main window and the views you pop out into windows of their own, on the display you name,
//! windowed or full screen there, remembered in the layout by display UUID and reopened there on
//! a restart; your drags of a window, as the window server reports them; and the question card,
//! placed by the shell on the display with your latest input and armed 500 ms after it was last
//! still and unobscured, where a window of the app's own stacked over any part of it obscures it.
//! Only the shell places windows: a pop-out needs the serial of your input in that panel, and an
//! agent's call never opens or moves one.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::shared::FLICKS;

/// Question card: `arm_after` is 500 ms.
const ARM_AFTER: i64 = FLICKS / 2;
/// A windowed pop-out opens this far inside its display's bottom-right corner, in points.
const MARGIN: f64 = 20.0;
/// Frame clock and scheduler: a window's `caps: {inactive: 30 Hz, thermal: 60 Hz, hidden: 0}`.
const INACTIVE_HZ: i64 = 30;
const THERMAL_HZ: i64 = 60;

/// One display the scenario connects (Frame clock: per display `{uuid, refresh_ns, next_vsync,
/// latch_lead_ns}`), its bounds in global points. Its scale and color space are checked at the
/// scenario and carried by nothing here: no window reallocates or converts.
#[derive(Clone)]
pub struct Display {
    pub uuid: String,
    pub bounds: [f64; 4],
    pub refresh_hz: i64,
    pub next_vsync: i64,
}

/// A display's vsync grid: `next_vsync + k × period`, k ≥ 0.
#[derive(Clone, Copy, Debug)]
pub struct Grid {
    pub next_vsync: i64,
    pub period: i64,
}

impl Grid {
    /// The first vsync at or after `t`.
    pub fn vsync_from(&self, t: i64) -> i64 {
        if t <= self.next_vsync {
            return self.next_vsync;
        }
        let k = (t - self.next_vsync + self.period - 1).div_euclid(self.period);
        self.next_vsync + k * self.period
    }

    /// Every vsync up to `now`, in order.
    pub fn vsyncs_through(&self, now: i64) -> impl Iterator<Item = i64> + '_ {
        (0..)
            .map(|k| self.next_vsync + k * self.period)
            .take_while(move |v| *v <= now)
    }
}

impl Display {
    pub fn grid(&self) -> Grid {
        Grid {
            next_vsync: self.next_vsync,
            period: FLICKS / self.refresh_hz,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Main,
    Popped,
    FullScreen,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Main => "main",
            Kind::Popped => "popped",
            Kind::FullScreen => "full_screen",
        }
    }

    fn parse(s: &str) -> Option<Kind> {
        Some(match s {
            "main" => Kind::Main,
            "popped" => Kind::Popped,
            "full_screen" => Kind::FullScreen,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub enum OpenedBy {
    Serial,
    Restore,
}

/// One window the app has open: the main window, or a view popped out into its own.
#[derive(Clone)]
pub struct Window {
    pub id: String,
    pub kind: Kind,
    pub view: Option<String>,
    /// The UUID of the display that paces it.
    pub display: String,
    /// Global points.
    pub rect: [f64; 4],
    pub opened_by: Option<OpenedBy>,
}

impl Window {
    pub fn to_json(&self) -> Value {
        json!({
            "window": self.id,
            "kind": self.kind.name(),
            "view": self.view,
            "display": self.display,
            "rect": self.rect,
            "opened_by": self.opened_by.map(|o| match o {
                OpenedBy::Serial => "serial",
                OpenedBy::Restore => "restore",
            }),
        })
    }
}

/// One row of a saved layout (`saved_positions`).
struct LayoutRow {
    window: String,
    kind: Kind,
    view: Option<String>,
    display: String,
    rect: [f64; 4],
}

pub struct Layout {
    windows: Vec<LayoutRow>,
    /// Each display's bounds when the layout was saved, by UUID.
    displays: BTreeMap<String, [f64; 4]>,
}

fn rect_of(v: &Value) -> Option<[f64; 4]> {
    let a = v.as_array().filter(|a| a.len() == 4)?;
    let r: Vec<f64> = a.iter().map(Value::as_f64).collect::<Option<_>>()?;
    let r = [r[0], r[1], r[2], r[3]];
    (r.iter().all(|v| v.is_finite()) && r[2] > 0.0 && r[3] > 0.0).then_some(r)
}

impl Layout {
    /// A layout as a `layout` call returned it: one main window at most, and no window ID or
    /// view twice. `None` when it isn't one.
    pub fn parse(v: &Value) -> Option<Layout> {
        let windows = v
            .get("windows")?
            .as_array()?
            .iter()
            .map(|w| {
                Some(LayoutRow {
                    window: w.get("window")?.as_str()?.to_string(),
                    kind: Kind::parse(w.get("kind")?.as_str()?)?,
                    view: match w.get("view") {
                        None | Some(Value::Null) => None,
                        Some(s) => Some(s.as_str()?.to_string()),
                    },
                    display: w.get("display")?.as_str()?.to_string(),
                    rect: rect_of(w.get("rect")?)?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let distinct = |f: &dyn Fn(&LayoutRow) -> Option<&str>| {
            let mut seen = std::collections::BTreeSet::new();
            windows.iter().filter_map(f).all(|k| seen.insert(k))
        };
        if windows.iter().filter(|r| r.kind == Kind::Main).count() > 1
            || windows
                .iter()
                .any(|r| (r.kind == Kind::Main) == r.view.is_some())
            || !distinct(&|r| Some(r.window.as_str()))
            || !distinct(&|r| r.view.as_deref())
        {
            return None;
        }
        let displays = match v.get("displays") {
            None => BTreeMap::new(),
            Some(d) => d
                .as_object()?
                .iter()
                .map(|(k, b)| Some((k.clone(), rect_of(b)?)))
                .collect::<Option<_>>()?,
        };
        Some(Layout { windows, displays })
    }
}

/// The area two rects share, 0 when they only touch.
fn overlap(a: [f64; 4], b: [f64; 4]) -> f64 {
    let w = (a[0] + a[2]).min(b[0] + b[2]) - a[0].max(b[0]);
    let h = (a[1] + a[3]).min(b[1] + b[3]) - a[1].max(b[1]);
    if w > 0.0 && h > 0.0 {
        w * h
    } else {
        0.0
    }
}

/// `r` moved the least to lie inside `bounds` (its top-left wins when it's larger).
fn clamp_into(r: [f64; 4], bounds: [f64; 4]) -> [f64; 4] {
    let x = r[0].min(bounds[0] + bounds[2] - r[2]).max(bounds[0]);
    let y = r[1].min(bounds[1] + bounds[3] - r[3]).max(bounds[1]);
    [x, y, r[2], r[3]]
}

/// The wrong programs the #400 criteria catch, each reachable only through the scenario's
/// `planted`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Planted {
    /// On restore, every popped or full-screen view reopens on the main display.
    pub restores_to_main: bool,
    /// The card always opens on the main window's display.
    pub card_on_main_display: bool,
    /// Every window is paced by the main display's clock.
    pub one_clock_for_all: bool,
    /// The card ignores the app's own windows when it judges whether it is obscured.
    pub arms_under_own_window: bool,
    /// A window you switched away from keeps its display's rate.
    pub ignores_inactive_cap: bool,
    /// The thermal state caps no window.
    pub ignores_thermal_cap: bool,
    /// A hidden window keeps presenting, and evaluating its sessions.
    pub presents_hidden: bool,
    /// A hidden window presents nothing but still evaluates its sessions at its latches.
    pub evaluates_hidden: bool,
    /// #401: a pop-out takes any serial in the writer's ring, however old and from whichever
    /// of its panels.
    pub accepts_any_ring_serial: bool,
}

/// What happened to a window: it opened or was dragged to a rect, or came to the top of the
/// stack (a window comes to the top when it opens, when you drag it and when you give it input).
enum Event {
    Placed([f64; 4], String),
    Raised,
}

/// Every window's rect and the stacking order, bottom to top, as they were at one time.
struct Stack {
    /// Each window's rect and the UUID of its display.
    rects: BTreeMap<String, ([f64; 4], String)>,
    order: Vec<String>,
}

impl Stack {
    /// Whether a window above `own` lies over any part of `rect`.
    fn covers(&self, own: &str, rect: [f64; 4]) -> bool {
        let Some(top) = self.order.iter().position(|id| id == own) else {
            return false;
        };
        self.order[top + 1..]
            .iter()
            .filter_map(|id| self.rects.get(id))
            .any(|(r, _)| overlap(*r, rect) > 0.0)
    }
}

/// What the window server and the OS reported that caps a window's frames, each with its time,
/// in time order.
#[derive(Default)]
struct Reports {
    /// The window that became key, or `None` when you switched to another app.
    key: Vec<(i64, Option<String>)>,
    /// Whether the Mac is hot: its thermal state `serious` or `critical`.
    hot: Vec<(i64, bool)>,
    /// A window you hid (`true`) or showed again.
    hidden: Vec<(i64, String, bool)>,
}

/// The app's windows on the scenario's displays, and what the card's placement reads: your
/// inputs and every window's rects and stacking over time.
pub struct Placement {
    displays: Vec<Display>,
    windows: Vec<Window>,
    /// What happened to each window and when, in time order.
    events: Vec<(i64, String, Event)>,
    /// Your inputs: when, and the window the panel was in.
    inputs: Vec<(i64, String)>,
    /// The input router's serials, each the panel it was delivered to and when.
    serials: BTreeMap<u64, (String, i64)>,
    reports: Reports,
    next_id: u32,
    planted: Planted,
}

/// Input router: a token lives at most 30 s (`token: {serial, writer, kind, expires ≤ 30 s}`).
pub const TOKEN_LIFE: i64 = 30 * FLICKS;

/// Whether a gesture at `when` is still fresh at `now` (#401).
fn fresh(when: i64, now: i64) -> bool {
    when <= now && now - when < TOKEN_LIFE
}

/// A refusal's code.
fn refused(code: &str) -> Value {
    json!({"code": code})
}

impl Placement {
    /// The app opened on `displays` (the first is the main display): its main window of
    /// `window` points at the main display's origin, or every window a saved `layout` holds,
    /// each on the display whose UUID it names.
    pub fn open(
        displays: Vec<Display>,
        window: Option<[f64; 2]>,
        layout: Option<&Layout>,
        planted: Planted,
    ) -> Placement {
        let mut p = Placement {
            displays,
            windows: Vec::new(),
            events: Vec::new(),
            inputs: Vec::new(),
            serials: BTreeMap::new(),
            reports: Reports::default(),
            next_id: 1,
            planted,
        };
        let Some(first) = p.displays.first().cloned() else {
            return p;
        };
        let size = window.unwrap_or([first.bounds[2], first.bounds[3]]);
        if let Some(l) = layout {
            p.restore(l, &first);
        }
        if p.main_window().is_none() {
            let rect = clamp_into(
                [first.bounds[0], first.bounds[1], size[0], size[1]],
                first.bounds,
            );
            let id = p.mint();
            p.add(
                0,
                Window {
                    id,
                    kind: Kind::Main,
                    view: None,
                    display: first.uuid,
                    rect,
                    opened_by: None,
                },
            );
        }
        p
    }

    fn mint(&mut self) -> String {
        let id = format!("win-{}", self.next_id);
        self.next_id += 1;
        id
    }

    fn add(&mut self, at: i64, w: Window) {
        self.events
            .push((at, w.id.clone(), Event::Placed(w.rect, w.display.clone())));
        self.windows.push(w);
    }

    /// Reopens each of the layout's windows on the display it names, where it was on that display
    /// (Window and display placement: "Displays are remembered by UUID"); a display gone since
    /// gives its windows to the main window's.
    fn restore(&mut self, layout: &Layout, first: &Display) {
        let main = layout
            .windows
            .iter()
            .find(|r| r.kind == Kind::Main)
            .and_then(|r| self.display(&r.display).cloned())
            .unwrap_or_else(|| first.clone());
        for row in &layout.windows {
            let to = match self.display(&row.display) {
                Some(d) if row.kind != Kind::Main && !self.planted.restores_to_main => d.clone(),
                _ => main.clone(),
            };
            let rect = match (row.kind, layout.displays.get(&row.display)) {
                (Kind::FullScreen, _) => to.bounds,
                (_, Some(old)) => clamp_into(
                    [
                        to.bounds[0] + (row.rect[0] - old[0]),
                        to.bounds[1] + (row.rect[1] - old[1]),
                        row.rect[2],
                        row.rect[3],
                    ],
                    to.bounds,
                ),
                (_, None) => clamp_into(row.rect, to.bounds),
            };
            if let Some(n) = row
                .window
                .strip_prefix("win-")
                .and_then(|n| n.parse::<u32>().ok())
            {
                self.next_id = self.next_id.max(n + 1);
            }
            self.add(
                0,
                Window {
                    id: row.window.clone(),
                    kind: row.kind,
                    view: row.view.clone(),
                    display: to.uuid.clone(),
                    rect,
                    opened_by: (row.kind != Kind::Main).then_some(OpenedBy::Restore),
                },
            );
        }
    }

    pub fn display(&self, uuid: &str) -> Option<&Display> {
        self.displays.iter().find(|d| d.uuid == uuid)
    }

    pub fn main_window(&self) -> Option<&Window> {
        self.windows.iter().find(|w| w.kind == Kind::Main)
    }

    /// The window a panel's view is in: its own when popped out, else the main window.
    pub fn window_of(&self, panel: &str) -> Option<&Window> {
        self.windows
            .iter()
            .find(|w| w.view.as_deref() == Some(panel))
            .or_else(|| self.main_window())
    }

    /// The display that paces a panel's window (the main window's display's clock when
    /// planted).
    pub fn pacing(&self, panel: &str) -> Option<(&Window, &Display)> {
        let w = self.window_of(panel)?;
        let paced_by = if self.planted.one_clock_for_all {
            &self.main_window()?.display
        } else {
            &w.display
        };
        Some((w, self.display(paced_by)?))
    }

    /// `activate`: the window server's report that `window` became the key window, or with
    /// `None` that you switched to another app.
    pub fn activate(&mut self, at: i64, window: Option<&str>, agent: bool) -> Value {
        if let Err(e) = self.report(window, agent) {
            return e;
        }
        self.reports.key.push((at, window.map(str::to_string)));
        json!({})
    }

    /// `thermal`: the OS's report of the Mac's thermal state, `hot` at `serious` or `critical`.
    pub fn thermal(&mut self, at: i64, hot: bool, agent: bool) -> Value {
        if let Err(e) = self.report(None, agent) {
            return e;
        }
        self.reports.hot.push((at, hot));
        json!({})
    }

    /// `hide_window`: the window server's report that you hid `window` or showed it again.
    pub fn hide_window(&mut self, at: i64, window: &str, hidden: bool, agent: bool) -> Value {
        if let Err(e) = self.report(Some(window), agent) {
            return e;
        }
        self.reports.hidden.push((at, window.to_string(), hidden));
        json!({})
    }

    /// Whether a report may be taken: only the window server and the OS make one, about a
    /// window the app has.
    fn report(&self, window: Option<&str>, agent: bool) -> Result<(), Value> {
        if agent {
            return Err(refused("agent_cannot_report"));
        }
        match window {
            Some(id) if !self.windows.iter().any(|w| w.id == id) => Err(refused("unknown_window")),
            _ => Ok(()),
        }
    }

    /// The lowest cap on `window`'s frames at `t`, in Hz (0: hidden), or `None` when uncapped.
    /// A window you switched away from was key and another window, or another app, became key
    /// after it.
    fn cap(&self, window: &str, t: i64) -> Option<i64> {
        let r = &self.reports;
        let hidden = r
            .hidden
            .iter()
            .rev()
            .find(|(at, w, _)| *at <= t && w == window)
            .is_some_and(|(_, _, h)| *h);
        if hidden && !self.planted.presents_hidden {
            return Some(0);
        }
        let key = |k: &Option<String>| k.as_deref() == Some(window);
        let was_key = r.key.iter().any(|(at, k)| *at <= t && key(k));
        let is_key = r
            .key
            .iter()
            .rev()
            .find(|(at, _)| *at <= t)
            .is_some_and(|(_, k)| key(k));
        let hot = r
            .hot
            .iter()
            .rev()
            .find(|(at, _)| *at <= t)
            .is_some_and(|(_, h)| *h);
        if was_key && !is_key && !self.planted.ignores_inactive_cap {
            Some(INACTIVE_HZ)
        } else if hot && !self.planted.ignores_thermal_cap {
            Some(THERMAL_HZ)
        } else {
            None
        }
    }

    /// The vsyncs of `grid` through `now` at which `window` may present, each judged at its
    /// latch, `lead` before it, against the window's caps; and the vsyncs at whose latches a hidden
    /// window still evaluates its sessions, which only the planted twin has.
    pub fn slots(&self, window: &str, grid: Grid, lead: i64, now: i64) -> (Vec<i64>, Vec<i64>) {
        let mut open = Vec::new();
        let mut unseen = Vec::new();
        let mut last: Option<i64> = None;
        for vsync in grid.vsyncs_through(now) {
            match self.cap(window, vsync - lead) {
                Some(0) => {
                    if self.planted.evaluates_hidden {
                        unseen.push(vsync);
                    }
                }
                Some(hz) if last.is_some_and(|l| vsync - l < FLICKS / hz) => {}
                _ => {
                    last = Some(vsync);
                    open.push(vsync);
                }
            }
        }
        (open, unseen)
    }

    /// Your input to a panel at `at`: its window comes to the top.
    pub fn input(&mut self, at: i64, panel: &str) {
        if let Some(id) = self.window_of(panel).map(|w| w.id.clone()) {
            self.inputs.push((at, id.clone()));
            self.events.push((at, id, Event::Raised));
        }
    }

    /// A gesture of yours (a press, or a key the panel took) delivered to `panel` at `at`, with
    /// its serial: what lets that panel's focus, pop-out, clipboard write, toast, placement or
    /// send through while fresh (#401). A hover, a scroll or a key the shell took is no gesture.
    pub fn gesture(&mut self, at: i64, panel: &str, serial: u64) {
        self.serials.insert(serial, (panel.to_string(), at));
    }

    /// The newest of your gesture serials in `panel` fresh at `now` and newer than `after`.
    pub fn fresh_serial(&self, panel: &str, now: i64, after: u64) -> Option<u64> {
        self.serials
            .range(after + 1..)
            .rev()
            .find(|(_, (p, when))| p == panel && fresh(*when, now))
            .map(|(s, _)| *s)
    }

    /// Whether `serial` is a gesture of yours in `panel` fresh at `now`.
    pub fn serial_fresh_in(&self, serial: u64, panel: &str, now: i64) -> bool {
        self.serials
            .get(&serial)
            .is_some_and(|(p, when)| p == panel && fresh(*when, now))
    }

    /// `pop_out`: your pop-out of `panel`'s view, `size` points, onto `display`, pressed with
    /// your input whose serial the router gave it in that panel.
    pub fn pop_out(
        &mut self,
        at: i64,
        panel: &str,
        display: &str,
        serial: Option<u64>,
        full_screen: bool,
        size: [f64; 2],
    ) -> Value {
        let Some(serial) = serial else {
            return refused("no_serial");
        };
        match self.serials.get(&serial) {
            Some(_) if self.planted.accepts_any_ring_serial => {}
            Some((p, _)) if p != panel => return refused("serial_not_in_panel"),
            // #401: a serial lets a pop-out through only while fresh (`expires ≤ 30 s`).
            Some((_, when)) if !fresh(*when, at) => return refused("serial_expired"),
            Some(_) => {}
            None => return refused("serial_not_in_panel"),
        }
        self.open_view(at, panel, display, full_screen, size)
    }

    /// Opens `panel`'s view in a window of its own on `display`: the step of a pop-out after
    /// its serial is checked.
    pub fn open_view(
        &mut self,
        at: i64,
        panel: &str,
        display: &str,
        full_screen: bool,
        size: [f64; 2],
    ) -> Value {
        let Some(d) = self.display(display).cloned() else {
            return refused("unknown_display");
        };
        if self
            .windows
            .iter()
            .any(|w| w.view.as_deref() == Some(panel))
        {
            return refused("already_popped");
        }
        let b = d.bounds;
        let (kind, rect) = if full_screen {
            (Kind::FullScreen, b)
        } else {
            let corner = [
                b[0] + b[2] - size[0] - MARGIN,
                b[1] + b[3] - size[1] - MARGIN,
            ];
            (
                Kind::Popped,
                clamp_into([corner[0], corner[1], size[0], size[1]], b),
            )
        };
        let id = self.mint();
        let w = Window {
            id,
            kind,
            view: Some(panel.to_string()),
            display: d.uuid,
            rect,
            opened_by: Some(OpenedBy::Serial),
        };
        let reply = json!({"window": w.to_json()});
        self.add(at, w);
        reply
    }

    /// `move_window`: the window server's report that you dragged a window by its title bar to
    /// `rect`, its size kept; its display becomes the one holding most of it, and it comes to
    /// the top. An agent's ask to move one is refused.
    pub fn move_window(
        &mut self,
        at: i64,
        window: &str,
        rect: [f64; 4],
        agent: bool,
    ) -> Result<&Window, Value> {
        if agent {
            return Err(refused("agent_cannot_move_window"));
        }
        let Some(k) = self.windows.iter().position(|w| w.id == window) else {
            return Err(refused("unknown_window"));
        };
        if self.windows[k].kind == Kind::FullScreen {
            return Err(refused("full_screen"));
        }
        if self.windows[k].rect[2..] != rect[2..] {
            return Err(refused("not_a_drag"));
        }
        let most = self
            .displays
            .iter()
            .map(|d| (overlap(d.bounds, rect), d.uuid.clone()))
            .filter(|(a, _)| *a > 0.0)
            .max_by(|a, b| a.0.total_cmp(&b.0))
            .map(|(_, u)| u);
        let w = &mut self.windows[k];
        w.rect = rect;
        if let Some(u) = most {
            w.display = u;
        }
        let display = w.display.clone();
        self.events
            .push((at, window.to_string(), Event::Placed(rect, display)));
        Ok(&self.windows[k])
    }

    pub fn windows_json(&self) -> Value {
        json!({"windows": self.windows.iter().map(Window::to_json).collect::<Vec<_>>()})
    }

    /// `layout`: the windows as the app would save them now, with each display's bounds.
    pub fn layout_json(&self) -> Value {
        json!({
            "layout": {
                "windows": self.windows.iter().map(|w| json!({
                    "window": w.id, "kind": w.kind.name(), "view": w.view, "display": w.display, "rect": w.rect,
                })).collect::<Vec<_>>(),
                "displays": self.displays.iter().map(|d| (d.uuid.clone(), json!(d.bounds))).collect::<BTreeMap<_, _>>(),
            }
        })
    }

    /// The windows' rects and stacking as they were at `t`.
    fn stack_at(&self, t: i64) -> Stack {
        let mut s = Stack {
            rects: BTreeMap::new(),
            order: Vec::new(),
        };
        for (_, id, e) in self.events.iter().filter(|(at, _, _)| *at <= t) {
            if let Event::Placed(r, d) = e {
                s.rects.insert(id.clone(), (*r, d.clone()));
            }
            s.order.retain(|o| o != id);
            s.order.push(id.clone());
        }
        s
    }

    /// Whether a window of the app's own stacked over the card's window lies over any part of
    /// the card at `t` (Question card: "It can never: be covered, even partly"; `rearm_on:
    /// occluded`).
    fn occluded(&self, own: &str, rect: [f64; 4], t: i64) -> bool {
        !self.planted.arms_under_own_window && self.stack_at(t).covers(own, rect)
    }

    /// The question card for an ask created at `asked`, measured `size`, as it stands at `now`:
    /// on the display with your latest input, in the window that input went to (the main window
    /// when there was none), presented at that display's
    /// first vsync at or after the ask, where it stays; armed 500 ms after it was last presented,
    /// last uncovered or its window last moved, at that display's next vsync. `None` before the
    /// ask.
    pub fn card(&self, ask: &str, asked: i64, size: [f64; 2], now: i64) -> Option<CardState> {
        if now < asked {
            return None;
        }
        let main = self.main_window()?;
        let at_ask = self.stack_at(asked);
        let latest = self.inputs.iter().rev().find(|(at, _)| *at <= asked);
        let window = match latest {
            Some((_, id)) if !self.planted.card_on_main_display => {
                self.windows.iter().find(|w| &w.id == id).unwrap_or(main)
            }
            _ => main,
        };
        let (placed, display) = match at_ask.rects.get(&window.id) {
            Some((r, d)) => (*r, self.display(d)?),
            None => (window.rect, self.display(&window.display)?),
        };
        let rect = clamp_into(
            [
                placed[0] + (placed[2] - size[0]) / 2.0,
                placed[1] + (placed[3] - size[1]) / 2.0,
                size[0],
                size[1],
            ],
            display.bounds,
        );
        let grid = display.grid();
        let presented = grid.vsync_from(asked);
        let mut card = CardState {
            ask: ask.to_string(),
            display: display.uuid.clone(),
            window: window.id.clone(),
            rect,
            states: Vec::new(),
        };
        // Hidden until its display's first vsync at or after the ask.
        if now < presented {
            return Some(card);
        }
        let states = &mut card.states;
        states.push(("presented", presented));
        let mut armed = false;
        let mut since = presented;
        let mut covered = self.occluded(&window.id, rect, presented);
        let changes = self
            .events
            .iter()
            .filter(|(at, _, _)| *at > presented && *at <= now)
            .map(|(at, id, e)| (*at, id == &window.id && matches!(e, Event::Placed(..))));
        let mut times: Vec<(i64, bool)> = Vec::new();
        for (at, moved) in changes {
            match times.last_mut() {
                Some((t, m)) if *t == at => *m |= moved,
                _ => times.push((at, moved)),
            }
        }
        // At each instant something changed, the card arms first if its interval ran out by
        // then, and the change is read after; a change at `now` counts.
        let arms_by = |t: i64, armed: bool, covered: bool, since: i64| {
            (!armed && !covered)
                .then(|| grid.vsync_from(since + ARM_AFTER))
                .filter(|a| *a <= t)
        };
        for (t, moved) in times {
            if let Some(arms) = arms_by(t, armed, covered, since) {
                states.push(("armed", arms));
                armed = true;
            }
            let now_covered = self.occluded(&window.id, rect, t);
            // Covered after arming, or moved: back to presented and the interval restarts.
            if (now_covered && !covered) || moved {
                if armed {
                    states.push(("presented", t));
                    armed = false;
                }
                since = t;
            } else if covered && !now_covered {
                since = t;
            }
            covered = now_covered;
        }
        if let Some(arms) = arms_by(now, armed, covered, since) {
            states.push(("armed", arms));
        }
        Some(card)
    }
}

/// The card as it stands: where it was presented, and each state it entered since, in order.
pub struct CardState {
    pub ask: String,
    pub display: String,
    pub window: String,
    pub rect: [f64; 4],
    pub states: Vec<(&'static str, i64)>,
}

impl CardState {
    pub fn to_json(&self) -> Value {
        json!({
            "ask": self.ask,
            "display": self.display,
            "window": self.window,
            "rect": self.rect,
            "state": self.states.last().map_or("hidden", |(s, _)| *s),
            "states": self.states.iter().map(|(s, at)| json!({"state": s, "at": at})).collect::<Vec<_>>(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A gesture serial is fresh under 30 s, only in the panel it went to, and a hover's serial
    /// (an input but no gesture) lets nothing through (#401).
    #[test]
    fn a_gesture_serial_is_fresh_under_thirty_seconds_in_its_own_panel() {
        let mut p = Placement::open(Vec::new(), None, None, Planted::default());
        p.input(5 * FLICKS, "p");
        p.input(10 * FLICKS, "p");
        p.gesture(10 * FLICKS, "p", 7);
        assert_eq!(p.fresh_serial("p", 39 * FLICKS, 0), Some(7), "29 s old");
        assert_eq!(p.fresh_serial("p", 40 * FLICKS, 0), None, "30 s old");
        assert_eq!(p.fresh_serial("q", 11 * FLICKS, 0), None, "another panel");
        assert_eq!(p.fresh_serial("p", 9 * FLICKS, 0), None, "before the press");
        assert_eq!(p.fresh_serial("p", 11 * FLICKS, 7), None, "spent by a send");
        assert!(
            !p.serial_fresh_in(6, "p", 6 * FLICKS),
            "a hover is no gesture"
        );
        assert!(p.serial_fresh_in(7, "p", 39 * FLICKS));
        assert!(!p.serial_fresh_in(7, "p", 41 * FLICKS));
    }
}
