use std::time::Duration;

use gpui_kit::*;
use serde_json::Value;

use crate::chrome::{self, sizes, Typed as _};
use crate::views::observed;

pub type Placed = (String, [f32; 4]);

const SOURCE_LINE_DELAY: Duration = Duration::from_millis(500);

pub(crate) fn placed(listed: &Value) -> Vec<Placed> {
    let listed = listed.as_array().into_iter().flatten();
    listed
        .filter_map(|entry| {
            let text = entry["text"].as_str()?.to_string();
            Some((text, crate::show::rect_of(&entry["box"])?))
        })
        .collect()
}

struct SourceLine(SharedString);

impl Render for SourceLine {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let (chrome, s) = (chrome::of(window), sizes());
        observed("source-line")
            .role(Role::Tooltip)
            .typed(s.small)
            .px(s.space(1))
            .py(s.space(0))
            .rounded(s.radius)
            .bg(chrome.raised)
            .border(s.hairline)
            .border_color(chrome.divider)
            .text_color(chrome.ink_primary)
            .child(self.0.clone())
    }
}

pub(crate) type Node = (Bounds<Pixels>, AnyElement);

pub(crate) fn nodes(
    items: &[crate::show::Item],
    at: impl Fn([f32; 4]) -> Bounds<Pixels>,
) -> Vec<Node> {
    let over = |id: String, place: Bounds<Pixels>| {
        observed(SharedString::from(id))
            .w(place.size.width)
            .h(place.size.height)
    };
    let mut out = Vec::new();
    for item in items {
        for (n, (text, rect)) in item.rows.iter().enumerate() {
            let place = at(*rect);
            let row = over(format!("{}-row-{n}", item.id), place);
            let row = row.role(Role::Row).aria_label(text.clone());
            out.push((place, row.into_any_element()));
        }
        for (n, (line, rect)) in item.source_lines.iter().enumerate() {
            let place = at(*rect);
            let line = SharedString::from(line.clone());
            let number = over(format!("{}-source-{n}", item.id), place)
                .tooltip(move |_, cx| cx.new(|_| SourceLine(line.clone())).into())
                .tooltip_show_delay(SOURCE_LINE_DELAY);
            out.push((place, number.into_any_element()));
        }
    }
    out
}

pub(crate) fn prepaint(mut nodes: Vec<Node>, window: &mut Window, cx: &mut App) -> Vec<AnyElement> {
    for (place, node) in &mut nodes {
        let room = place.size.map(AvailableSpace::Definite);
        node.prepaint_as_root(place.origin, room, window, cx);
    }
    nodes.into_iter().map(|(_, node)| node).collect()
}
