//! Issue #1436: the gallery panel. Every chrome-fx@1 operator in a tile of its own, drawn in its still pose over a
//! sample of the app's chrome, with its name, its class and its measured cost. The gallery is a panel you open, so it
//! asks for every operator it shows, the expressive ones too; and since a tile shows the still pose, nothing in it
//! moves or asks for a frame.

use gpui_kit::*;
use serde_json::Map;

use crate::chrome_fx::{self, Effect, Fx, Place};

/// The scale the gallery's pictures are taken at.
pub const SCALE: f32 = 2.;
const COLUMNS: usize = 6;
const TILE: [f32; 2] = [200., 170.];
const GAP: f32 = 12.;
/// The tile's stage, where its operator draws, above its label.
const STAGE: f32 = 120.;
/// How far the sample card sits inside a stage: the inset the edge and halo operators draw around.
const INSET: f32 = 18.;

/// A tile: its operator, the operator's class and cost, and its rect in window points.
#[derive(Clone, Debug)]
pub struct Tile {
    pub operator: &'static str,
    pub class: &'static str,
    pub cost_ms: f64,
    pub rect: [f32; 4],
}

/// The gallery's window and its tiles, in the pack's order.
#[derive(Clone, Debug)]
pub struct Layout {
    pub window: [f32; 2],
    pub tiles: Vec<Tile>,
}

/// The gallery panel.
pub struct Gallery;

impl Gallery {
    pub fn layout() -> Layout {
        let names = deep_canvas_effects::chrome_fx::NAMES;
        let rows = names.len().div_ceil(COLUMNS);
        let tiles = names
            .iter()
            .enumerate()
            .filter_map(|(i, name)| {
                let op = chrome_fx::operator(name)?;
                let (col, row) = ((i % COLUMNS) as f32, (i / COLUMNS) as f32);
                Some(Tile {
                    operator: name,
                    class: op.class.name(),
                    cost_ms: op.cost_ms,
                    rect: [
                        GAP + col * (TILE[0] + GAP),
                        GAP + row * (TILE[1] + GAP),
                        TILE[0],
                        TILE[1],
                    ],
                })
            })
            .collect();
        Layout {
            window: [
                GAP + COLUMNS as f32 * (TILE[0] + GAP),
                GAP + rows as f32 * (TILE[1] + GAP),
            ],
            tiles,
        }
    }
}

/// How a tile stages its operator: around a card (the operators drawn past an inset shape), over a card, or over a
/// line of text.
fn staging(operator: &str) -> &'static str {
    match operator {
        "halo.soft" | "halo.neon" | "halo.aura" | "pulse.breathe" | "pulse.ripple"
        | "edge.electric" | "edge.plasma" | "edge.flame" => "around",
        "text.glow" => "text",
        _ => "over",
    }
}

fn effect(operator: &'static str, place: Place) -> Effect {
    Effect {
        name: format!("gallery-{operator}").into(),
        operator: operator.into(),
        params: Vec::new(),
        backdrop: Some(BackdropScale::Full),
        radii: Corners::all(px(12.)),
        place,
        fx: Some(Fx {
            params: Map::new(),
            seed: 1436,
            asked: true,
            hold: true,
            ..Fx::default()
        }),
    }
}

/// A sample of the chrome: a raised card with a title, a line of secondary ink and an accent bar.
fn card(c: &crate::chrome::Chrome) -> Div {
    ground(c).child(ink(c))
}

/// The card's raised ground, border and accent bar: what an effect over the card draws on.
fn ground(c: &crate::chrome::Chrome) -> Div {
    div()
        .absolute()
        .size_full()
        .rounded(px(12.))
        .bg(c.raised)
        .border_1()
        .border_color(c.divider)
        .child(
            div()
                .absolute()
                .left(px(10.))
                .bottom(px(14.))
                .w(px(56.))
                .h(px(4.))
                .rounded(px(2.))
                .bg(c.accent),
        )
}

/// The card's title and line of secondary ink. An effect over the card goes between its ground and this, so
/// the ink is drawn over the effect, which keeps the ink's contrast floor; drawn under it, the ink would be lifted with
/// the ground.
fn ink(c: &crate::chrome::Chrome) -> Div {
    div()
        .absolute()
        .size_full()
        .p(px(10.))
        .flex()
        .flex_col()
        .gap(px(4.))
        .child(
            div()
                .text_size(px(13.))
                .text_color(c.ink_primary)
                .child("Session 1436"),
        )
        .child(
            div()
                .text_size(px(11.))
                .text_color(c.ink_secondary)
                .child("Three checks ran"),
        )
}

fn stage(operator: &'static str, c: &crate::chrome::Chrome) -> AnyElement {
    let base = div()
        .absolute()
        .left_0()
        .top_0()
        .w(px(TILE[0]))
        .h(px(STAGE));
    match staging(operator) {
        "around" => {
            let (first, _) = chrome_fx::slots(effect(operator, Place::Under));
            base.child(first)
                .child(
                    div()
                        .absolute()
                        .left(px(INSET))
                        .top(px(INSET))
                        .w(px(TILE[0] - 2. * INSET))
                        .h(px(STAGE - 2. * INSET))
                        .child(card(c)),
                )
                .into_any_element()
        }
        "text" => {
            let (first, last) = chrome_fx::slots(effect(operator, Place::Over));
            base.child(
                div()
                    .absolute()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(first)
                    .child(
                        div()
                            .text_size(px(30.))
                            .text_color(c.ink_primary)
                            .child("Glow"),
                    )
                    .children(last),
            )
            .into_any_element()
        }
        _ => {
            let (first, last) = chrome_fx::slots(effect(operator, Place::Over));
            base.child(
                div()
                    .absolute()
                    .left(px(10.))
                    .top(px(10.))
                    .w(px(TILE[0] - 20.))
                    .h(px(STAGE - 20.))
                    .child(ground(c))
                    .child(first)
                    .children(last)
                    .child(ink(c)),
            )
            .into_any_element()
        }
    }
}

impl Render for Gallery {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        chrome_fx::begin_frame();
        let c = crate::chrome::of(window);
        let tiles = Self::layout().tiles.into_iter().map(|t| {
            let [x, y, w, h] = t.rect;
            div()
                .absolute()
                .left(px(x))
                .top(px(y))
                .w(px(w))
                .h(px(h))
                .rounded(px(12.))
                .overflow_hidden()
                .border_1()
                .border_color(c.divider)
                .child(stage(t.operator, c))
                .child(
                    div()
                        .absolute()
                        .left(px(12.))
                        .top(px(STAGE + 8.))
                        .flex()
                        .flex_col()
                        .gap(px(2.))
                        .child(
                            div()
                                .text_size(px(13.))
                                .text_color(c.ink_primary)
                                .child(t.operator),
                        )
                        .child(
                            div()
                                .text_size(px(11.))
                                .text_color(c.ink_secondary)
                                .child(format!("{} · {:.2} ms · still pose", t.class, t.cost_ms)),
                        ),
                )
        });
        div().size_full().relative().bg(c.ground).children(tiles)
    }
}
