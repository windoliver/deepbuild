use gpui::{
    AppContext as _, Context, Entity, InteractiveElement as _, IntoElement, MouseButton,
    ParentElement as _, Pixels, Point, Render, StatefulInteractiveElement as _, Styled as _,
    TestAppContext, Window, WindowHandle, div, point, px,
};
use std::{cell::Cell, rc::Rc};

struct Label {
    text: u32,
    builds: Rc<Cell<usize>>,
}

impl Render for Label {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.builds.set(self.builds.get() + 1);
        div().h(px(20.)).child(format!("label {}", self.text))
    }
}

struct Target {
    builds: Rc<Cell<usize>>,
}

impl Render for Target {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.builds.set(self.builds.get() + 1);
        div()
            .id("target")
            .w(px(120.))
            .h(px(40.))
            .on_click(|_, _, _| {})
            .child(
                div()
                    .id("inner")
                    .size(px(20.))
                    .on_mouse_down(MouseButton::Left, |_, _, _| {}),
            )
    }
}

struct Holder {
    label: Entity<Label>,
    target: Entity<Target>,
}

impl Render for Holder {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .w(px(300.))
            .h(px(300.))
            .child(self.label.clone())
            .child(self.target.clone())
    }
}

struct Fixture {
    window: WindowHandle<Holder>,
    label: Entity<Label>,
    label_builds: Rc<Cell<usize>>,
    target_builds: Rc<Cell<usize>>,
}

fn fixture(cx: &mut TestAppContext) -> Fixture {
    let label_builds = Rc::new(Cell::new(0));
    let target_builds = Rc::new(Cell::new(0));
    let window = cx.add_window({
        let (label_builds, target_builds) = (label_builds.clone(), target_builds.clone());
        move |_, cx| Holder {
            label: cx.new(|_| Label {
                text: 0,
                builds: label_builds,
            }),
            target: cx.new(|_| Target {
                builds: target_builds,
            }),
        }
    });
    let label = window
        .update(cx, |holder, _, _| holder.label.clone())
        .unwrap();
    Fixture {
        window,
        label,
        label_builds,
        target_builds,
    }
}

fn draw(cx: &mut TestAppContext, window: WindowHandle<Holder>) {
    cx.update_window(window.into(), |_, window, cx| window.draw(cx).clear(cx))
        .unwrap();
}

fn hit_elements(
    cx: &mut TestAppContext,
    window: WindowHandle<Holder>,
    at: Point<Pixels>,
) -> Vec<String> {
    cx.update_window(window.into(), |_, window, _| {
        window
            .hits_at(at)
            .iter()
            .map(|hit| hit.element.to_string())
            .collect()
    })
    .unwrap()
}

fn refreshed_hit_elements(
    cx: &mut TestAppContext,
    window: WindowHandle<Holder>,
    at: Point<Pixels>,
) -> Vec<String> {
    cx.update_window(window.into(), |_, window, cx| {
        window.refresh();
        window.draw(cx).clear(cx);
        window
            .hits_at(at)
            .iter()
            .map(|hit| hit.element.to_string())
            .collect()
    })
    .unwrap()
}

fn assert_same_hits(cause: &str, at: Point<Pixels>, refreshed: &[String], replayed: &[String]) {
    for index in 0..refreshed.len().max(replayed.len()) {
        let fresh = refreshed.get(index).map_or("no hit", String::as_str);
        let kept = replayed.get(index).map_or("no hit", String::as_str);
        assert_eq!(
            kept,
            fresh,
            "the hit at ({:?}, {:?}) on a frame replayed from retention {cause}: hit {index} names the element `{kept}` where a refreshed frame names `{fresh}` (refreshed {refreshed:?}, replayed {replayed:?})",
            at.x,
            at.y,
        );
    }
}

#[test]
fn hits_at_on_a_view_replayed_from_retention_names_the_elements_a_refreshed_frame_names() {
    let mut cx = TestAppContext::single();
    let f = fixture(&mut cx);
    cx.update_window(f.window.into(), |_, window, _| {
        window.set_view_retention(true)
    })
    .unwrap();
    assert!(
        cx.update_window(f.window.into(), |_, window, _| window.view_retention())
            .unwrap(),
        "view retention is on"
    );
    let at = point(px(10.), px(30.));
    draw(&mut cx, f.window);

    let target_builds = f.target_builds.get();
    let refreshed = refreshed_hit_elements(&mut cx, f.window, at);
    assert!(
        f.target_builds.get() > target_builds,
        "the refreshed frame rendered the target view"
    );
    assert!(
        refreshed.iter().any(|element| element.ends_with("inner"))
            && refreshed.iter().any(|element| element.ends_with("target")),
        "the refreshed frame's hits at (10, 30) name the target and its inner box: {refreshed:?}"
    );
    let target_builds = f.target_builds.get();
    let label_builds = f.label_builds.get();

    f.label.update(&mut cx, |label, cx| {
        label.text += 1;
        cx.notify();
    });
    draw(&mut cx, f.window);
    assert!(
        f.label_builds.get() > label_builds,
        "the label rendered again after it changed"
    );
    assert_eq!(
        f.target_builds.get(),
        target_builds,
        "the target view was replayed from retention, not rendered, after its sibling changed"
    );
    let after_sibling = hit_elements(&mut cx, f.window, at);
    assert_same_hits("after its sibling changed", at, &refreshed, &after_sibling);

    f.window.update(&mut cx, |_, _, cx| cx.notify()).unwrap();
    draw(&mut cx, f.window);
    assert_eq!(
        f.target_builds.get(),
        target_builds,
        "the target view was replayed from retention, not rendered, after the view holding it rendered again"
    );
    let after_parent = hit_elements(&mut cx, f.window, at);
    assert_same_hits(
        "after the view holding it rendered again",
        at,
        &refreshed,
        &after_parent,
    );
}
