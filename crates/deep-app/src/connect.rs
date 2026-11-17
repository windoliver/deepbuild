//! Issue #210: the Connect prompt, the app's own and no plug-in's. A piece's port goes out to one plug-in only
//! after you click Connect here, and the prompt says what that means before you do: the plug-in, the hosts its
//! grant names, what goes out and what comes in, and whether its gear makes sound. Each Connect asks again.
//! A plug-in never draws this card, and nothing but your click in the piece's panel opens the port.

use gpui_kit::*;

use crate::chrome::{self, sizes};

/// What the prompt names: the port as the app holds it (`{port, plugin, hosts, out, in, sound}`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Prompt {
    pub port: String,
    pub plugin: String,
    pub hosts: Vec<String>,
    pub out: Vec<String>,
    pub inn: Vec<String>,
    pub sound: bool,
}

impl Prompt {
    /// A prompt from the hub's `port` reply (`prompt`), or `None` for a value that isn't one.
    pub fn of(v: &serde_json::Value) -> Option<Prompt> {
        let list = |k: &str| -> Option<Vec<String>> {
            v.get(k)?
                .as_array()?
                .iter()
                .map(|s| s.as_str().map(str::to_string))
                .collect()
        };
        Some(Prompt {
            port: v.get("port")?.as_str()?.to_string(),
            plugin: v.get("plugin")?.as_str()?.to_string(),
            hosts: list("hosts")?,
            out: list("out")?,
            inn: list("in")?,
            sound: v.get("sound")?.as_bool()?,
        })
    }

    /// The lines it says, in order: each a label and what it names.
    pub fn lines(&self) -> Vec<(&'static str, String)> {
        let names = |l: &[String]| {
            if l.is_empty() {
                "nothing".to_string()
            } else {
                l.join(", ")
            }
        };
        vec![
            ("Sends out", names(&self.out)),
            ("Reads in", names(&self.inn)),
            ("Reaches", names(&self.hosts)),
            (
                "Makes sound",
                if self.sound {
                    "yes: a mute or quiet hours stop it".to_string()
                } else {
                    "no".to_string()
                },
            ),
        ]
    }

    /// The question the card asks, and the line it shows once the port is open.
    pub fn title(&self, open: bool) -> String {
        if open {
            format!("{} is connected to {}", self.port, self.plugin)
        } else {
            format!("Connect {} to {}?", self.port, self.plugin)
        }
    }

    pub fn opened(&self) -> String {
        "It sends while the piece plays, and stops when you close it.".to_string()
    }
}

fn line(id: String, text: String) -> impl IntoElement {
    crate::views::label(id, text)
}

fn button(id: &str, text: &str, filled: bool, window: &Window) -> impl IntoElement {
    let (chrome, s) = (chrome::of(window), sizes());
    let base = div()
        .id(SharedString::from(id.to_string()))
        .px(s.space(3))
        .h(s.body.line + s.space(2))
        .flex()
        .items_center()
        .rounded(s.radius)
        .border(s.hairline)
        .border_color(chrome.divider);
    if filled {
        base.bg(chrome.accent)
            .text_color(chrome.ground)
            .font_weight(FontWeight::MEDIUM)
            .child(text.to_string())
    } else {
        base.text_color(chrome.ink_primary).child(text.to_string())
    }
}

/// The card, before you click Connect (`open` false: its question and its two buttons) or after (its port is
/// connected, and its one button closes it).
pub fn prompt_card(prompt: &Prompt, open: bool, window: &Window) -> Div {
    let (chrome, s) = (chrome::of(window), sizes());
    let mut card = div()
        .w(px(560.))
        .flex()
        .flex_col()
        .gap(s.space(2))
        .p(s.space(4))
        .rounded(s.radius)
        .bg(chrome.raised)
        .border(s.hairline)
        .border_color(chrome.divider)
        .text_color(chrome.ink_primary)
        .child(crate::views::title("connect:title", prompt.title(open)));
    for (label, what) in prompt.lines() {
        card = card.child(
            div()
                .flex()
                .gap(s.space(3))
                .child(
                    div()
                        .w(px(120.))
                        .text_color(chrome.ink_secondary)
                        .child(line(format!("connect:{label}:label"), label.to_string())),
                )
                .child(line(format!("connect:{label}"), what)),
        );
    }
    if open {
        card = card
            .child(line("connect:opened".into(), prompt.opened()))
            .child(div().flex().gap(s.space(2)).child(button(
                "connect:close",
                "Disconnect",
                false,
                window,
            )));
    } else {
        card = card.child(
            div()
                .flex()
                .gap(s.space(2))
                .child(button("connect:open", "Connect", true, window))
                .child(button("connect:cancel", "Not now", false, window)),
        );
    }
    card
}

/// The fixture the replica draws: the drum pad's port to a test plug-in.
pub fn fixture() -> Prompt {
    Prompt {
        port: "synth".into(),
        plugin: "test.gear".into(),
        hosts: vec!["gear.local".into()],
        out: vec!["notes".into(), "hits.occurrences".into()],
        inn: Vec::new(),
        sound: false,
    }
}
