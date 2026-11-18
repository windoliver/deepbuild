//! Issue #1482: the two windows a launch's `arm` names besides the app's: `blank`, an empty window in the same
//! harness, for what the harness itself costs, and `lists`, GPUI's two list elements side by side, each its own view,
//! each 1,000 rows of 32 points, for wheel events at a list's end.

use std::{cell::RefCell, collections::HashMap};

use gpui_kit::base::ObservedElement;
use gpui_kit::{prelude::FluentBuilder as _, test::TestSupportExt as _, *};

/// The window opens with what the arm names; `wheel_notifies` is the planted program's.
pub(super) fn open(
    arm: &str,
    options: WindowOptions,
    wheel_notifies: bool,
    cx: &mut App,
) -> AnyWindowHandle {
    let window = if arm == "blank" {
        gpui_kit::open_window(options, cx, |_, cx| cx.new(|_| Blank)).map(|(window, _)| window)
    } else {
        gpui_kit::open_window(options, cx, move |_, cx| {
            let uniform = cx.new(|_| Host::new(Kind::Uniform, wheel_notifies));
            let list = cx.new(|_| Host::new(Kind::List, wheel_notifies));
            name(uniform.entity_id(), "lists/uniform_list");
            name(list.entity_id(), "lists/list");
            cx.new(|_| Lists { uniform, list })
        })
        .map(|(window, _)| window)
    };
    window.expect("the arm's window opens")
}

thread_local! {
    static NAMES: RefCell<HashMap<EntityId, &'static str>> = RefCell::new(HashMap::new());
}

fn name(entity: EntityId, name: &'static str) {
    NAMES.with(|names| names.borrow_mut().insert(entity, name));
}

/// The name an arm gave the view, if the arm is the one that made it.
pub(super) fn named(entity: EntityId) -> Option<&'static str> {
    NAMES.with(|names| names.borrow().get(&entity).copied())
}

/// An empty window: a background and nothing else.
struct Blank;

impl Render for Blank {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().bg(rgb(0xffffff))
    }
}

/// The two lists, side by side.
struct Lists {
    uniform: Entity<Host>,
    list: Entity<Host>,
}

impl Render for Lists {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .bg(rgb(0xffffff))
            .flex()
            .child(self.uniform.clone())
            .child(self.list.clone())
    }
}

#[derive(Clone, Copy)]
enum Kind {
    Uniform,
    List,
}

impl Kind {
    fn id(self) -> &'static str {
        match self {
            Kind::Uniform => "uniform_list",
            Kind::List => "list",
        }
    }
}

const ROWS: usize = 1_000;

/// A list of its own in a view of its own.
struct Host {
    kind: Kind,
    state: ListState,
    wheel_notifies: bool,
}

impl Host {
    fn new(kind: Kind, wheel_notifies: bool) -> Host {
        Host {
            kind,
            // Every row measured, so the list's end is where its rows end, not where the rows drawn so far do.
            state: ListState::new(ROWS, ListAlignment::Top, px(64.)).measure_all(),
            wheel_notifies,
        }
    }
}

/// One row: an element the replica finds by its id, `<list>:<n>`.
fn row(list: &'static str, n: usize) -> ObservedElement<Stateful<Div>> {
    div()
        .id(ElementId::Name(format!("{list}:{n}").into()))
        .test_support()
        .accessibility_id(SharedString::from(format!("{list}:{n}")))
        .role(Role::ListItem)
        .aria_label(format!("Row {n}"))
        .h(px(32.))
        .flex_none()
        .child(format!("Row {n}"))
}

impl Render for Host {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let id = self.kind.id();
        let items = match self.kind {
            Kind::Uniform => uniform_list(
                ElementId::Name("uniform_list:items".into()),
                ROWS,
                |range, _, _| range.map(|n| row(id, n)).collect::<Vec<_>>(),
            )
            .h_full()
            .into_any_element(),
            Kind::List => list(self.state.clone(), move |n, _, _| row(id, n).into_any_element())
                .h_full()
                .into_any_element(),
        };
        div()
            .id(ElementId::Name(id.into()))
            .test_support()
            .accessibility_id(SharedString::from(id))
            .role(Role::List)
            .flex_1()
            .h_full()
            .when(self.wheel_notifies, |host| {
                host.on_scroll_wheel(cx.listener(|_, _, _, cx| cx.notify()))
            })
            .child(items)
    }
}
