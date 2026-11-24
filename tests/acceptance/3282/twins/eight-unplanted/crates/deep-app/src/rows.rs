//! Issue #1461: the list's rows, headings and empty lines, and a page's bound values, title and lane.

use std::time::Duration;

use gpui_kit::base::ObservedElement;
use gpui_kit::{prelude::FluentBuilder as _, *};

use crate::address::Address;
use crate::chrome::{sizes, Typed as _};
use crate::views::{
    asks_need_you, control, count, focus_list, heading, narrow, now, observed, words_box, Control,
    Kind, OVERLAY_FADE,
};
#[cfg(feature = "plant-row")]
use crate::views::{RowPlant, CUT_TO, ROW_PLANT};
use crate::{bound, chrome, copy, states, text};

/// How long the pointer rests on a row before its tooltip shows.
const ROW_TIP_DELAY: Duration = Duration::from_millis(1500);

/// A row's tooltip (#1458): the row's whole text in a node of the tooltip role, in the small role.
struct RowTip(SharedString);

impl Render for RowTip {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let (chrome, s) = (chrome::of(window), sizes());
        // #1458's planted tooltip keeps the kit's own text size.
        let kit = crate::plain::planted("tooltip-kit-size");
        observed("row-tip")
            .role(Role::Tooltip)
            .typed(s.small)
            .when(kit, |tip| tip.text_size(px(14.))) // size-literal-exception: #1458's planted wrong program, in an env-plants build only; review 2027-04-30
            .px(s.space(1))
            .py(s.space(0))
            .rounded(s.radius)
            .bg(chrome.raised)
            .border(s.hairline)
            .border_color(chrome.divider)
            .text_color(chrome.ink_primary)
            .child(self.0.clone())
            .with_animation(
                "row-tip-fade",
                Animation::new(OVERLAY_FADE),
                |tip, shown| tip.opacity(shown),
            )
    }
}

/// A session's status mark and words, one accessibility node named by what it shows: the mark, the look's drawn glyph
/// for its state tinted in its core (#1592), then the words in the text's color.
pub(crate) fn status(
    id: impl Into<ElementId>,
    state: &states::State,
    text: String,
) -> ObservedElement<Stateful<Div>> {
    marked(id, state.entry(), text)
}

/// A status mark for a status-map entry, and its words.
pub(crate) fn marked(
    id: impl Into<ElementId>,
    entry: &str,
    text: String,
) -> ObservedElement<Stateful<Div>> {
    let glyph = states::glyph(entry);
    #[cfg(feature = "plant-row")]
    let text = match ROW_PLANT.get() {
        Some(RowPlant::CutOff) if text.chars().count() > CUT_TO => {
            format!("{}…", text.chars().take(CUT_TO).collect::<String>())
        }
        _ => text,
    };
    let name = format!("{glyph} {text}");
    // A length at the end of the words is the row's time, drawn in its own slot at the right edge (#1458): as wide as
    // a step of space at least, so a time ticking a digit longer moves nothing else in the row.
    let (said, time) = states::time_at_end(&text);
    let (said, time) = (said.to_owned(), time.map(str::to_owned));
    // #1458's planted row draws its time in the flow before the words, as wide as it reads, so a wider time pushes them.
    let inline = crate::plain::planted("time-flows-inline");
    let time = time.map(|time| {
        let slot = div().flex_none().child(time);
        if inline {
            slot
        } else {
            slot.min_w(sizes().space(5)).flex().justify_end()
        }
    });
    // Past the row's width the text ends in an ellipsis; the row's name keeps the whole of it.
    let words = div().flex_1().min_w_0().truncate();
    // #1458's planted row draws in the canvas's face, not the chrome's.
    let words = if crate::plain::planted("row-label-canvas-face") {
        words.font_family(deep_text_gpui::Role::Body.family())
    } else {
        words
    };
    #[cfg(feature = "plant-row")]
    let words = if ROW_PLANT.get() == Some(RowPlant::PastFrame) {
        div().flex_none()
    } else {
        words
    };
    // Its value is the state's status-map entry, a closed word an agent reads where the eye reads the glyph (#1459).
    let row = observed(id)
        .role(Role::Label)
        .aria_label(name)
        .aria_value(entry.to_owned())
        .typed(sizes().body)
        .h(sizes().body.line)
        .flex()
        .items_center()
        .gap(sizes().space(0))
        // The mark in its slot, then 8 before the words, as a row's is (#1461).
        .child(crate::icons::mark(entry, 0).mr(sizes().space(0)));
    if inline {
        row.children(time).child(words.child(said))
    } else {
        row.child(words.child(said)).children(time)
    }
}

/// The bound values on `surface`, one accessibility node each named by its surface, its ID and
/// what it shows: its ID, the value, and where it comes from, muted, unless `titled` says the
/// surface's title already names it (#1455). A missing value shows the dash and says it wasn't reported.
pub(crate) fn bound_values(
    surface: bound::Surface,
    chrome: &chrome::Chrome,
    titled: bool,
) -> Vec<ObservedElement<Stateful<Div>>> {
    bound::on(surface)
        .into_iter()
        .enumerate()
        .map(|(index, b)| {
            let id = ElementId::Name(format!("bound-{}-{index}", surface.name()).into());
            let said = match &b.missing {
                Some(_) => copy::fill("views.not_reported", &[&b.text]),
                None => b.text.clone(),
            };
            observed(id)
                .role(Role::Label)
                .aria_label(b.name())
                .typed(sizes().body)
                .h(sizes().body.line)
                .flex()
                .items_center()
                .gap(sizes().space(1))
                .pl(sizes().space(2))
                .child(
                    div()
                        .w(relative(0.15))
                        .text_color(chrome.ink_secondary)
                        .child(b.id.clone()),
                )
                .child(text::label(
                    &format!("bound-{}-{index}-value", surface.name()),
                    text::Label {
                        bound: true,
                        ..text::Label::new(said)
                    },
                    chrome.ink_primary,
                    None,
                ))
                .children((!titled).then(|| div().text_color(chrome.ink_secondary).child(b.from)))
        })
        .collect()
}

/// A panel in the window holding the bound values bound to it, when any are, titled by the one assertion they bind;
/// values from more than one have no title (#1455).
pub(crate) fn bound_panel(chrome: &chrome::Chrome) -> Option<Stateful<Div>> {
    let bound = bound::on(bound::Surface::Panel);
    let named = bound
        .first()
        .map(|b| b.from.clone())
        .filter(|from| bound.iter().all(|b| &b.from == from));
    let values = bound_values(bound::Surface::Panel, chrome, named.is_some());
    (!values.is_empty()).then(|| {
        div()
            .id("bound-panel")
            .mt(sizes().space(1))
            .w_full()
            .p(sizes().space(1))
            .border(sizes().hairline)
            .border_color(chrome.divider)
            .flex()
            .flex_col()
            .children(named.map(|from| heading("bound-panel-title", from)))
            .children(values)
    })
}

/// A list row's time slot, as every surface writes it (#1458): how long in its state, or when an ask's default applies.
fn time_of(time: crate::list::Time, now: u64) -> String {
    match time {
        crate::list::Time::Since(at) => {
            let age = now.saturating_sub(at);
            states::changes_after(states::changes_in(age));
            states::span(age)
        }
        crate::list::Time::At(at) => states::moment(at, now),
    }
}

/// One slot of a list row (#1461): a node of its own, `<row id>:<slot>`, with the slot's bounds.
fn row_slot(row: &str, slot: &str, name: String) -> ObservedElement<Stateful<Div>> {
    observed(ElementId::Name(format!("{row}:{slot}").into()))
        .role(Role::Label)
        .aria_label(name)
}

/// How a row is drawn beyond its record: whether motion is reduced, and the width the list gives it, once measured.
#[derive(Clone, Copy)]
pub(crate) struct Shape {
    pub(crate) still: bool,
    pub(crate) width: Option<Pixels>,
}

/// The characters of its title a row keeps beside its state word at the list's narrowest (#1808). The 12 is drafted.
const TITLE_LEAST: usize = 12;

/// A title in a slot `room` wide (#1808): whole when it fits, else its longest start of whole characters with an ellipsis
/// after it that does, measured as it's drawn.
pub(crate) fn fitted(window: &Window, title: &str, room: Pixels, weight: FontWeight) -> String {
    let room = room - sizes().hairline * 2.;
    if drawn_width(window, title, weight) <= room {
        return title.to_owned();
    }
    use unicode_segmentation::UnicodeSegmentation as _;
    let ends: Vec<usize> = title
        .grapheme_indices(true)
        .map(|(at, grapheme)| at + grapheme.len())
        .collect();
    let cut = |n: usize| {
        let mut cut = title[..ends[n]].trim_end().to_owned();
        cut.push('…');
        cut
    };
    // The most characters whose cut fits, found by halves: the width grows with each character kept.
    let (mut fits, mut over) = (None, ends.len());
    let mut low = 0;
    while low < over {
        let n = (low + over) / 2;
        if drawn_width(window, &cut(n), weight) <= room {
            fits = Some(n);
            low = n + 1;
        } else {
            over = n;
        }
    }
    fits.map_or_else(|| "…".to_owned(), cut)
}

/// A title drawn in its slot on one line (#1808), as `cut` fits it, so it never draws under the slot to its right.
/// Before the list's width is known it's cut where the text system cuts it.
fn fit<E: Styled + ParentElement>(slot: E, title: String, cut: Option<String>) -> E {
    match cut {
        Some(cut) => slot.overflow_hidden().whitespace_nowrap().child(cut),
        None => slot.truncate().child(title),
    }
}

/// How wide `text` draws in the chrome's face at the body size and `weight`, with the tabular figures a row's text is
/// set in (`Typed`), so a time measures as wide as it draws (#3282).
fn drawn_width(window: &Window, text: &str, weight: FontWeight) -> Pixels {
    if text.is_empty() {
        return px(0.);
    }
    let s = sizes();
    let run = TextRun {
        len: text.len(),
        font: Font {
            weight,
            features: FontFeatures(std::sync::Arc::new(vec![("tnum".into(), 1)])),
            ..font(s.face.clone())
        },
        color: Hsla::default(),
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    window
        .text_system()
        .shape_line(text.to_owned().into(), s.body.size, &[run], None)
        .width
}

/// How far a working mark has turned at each step, in quarter turns: it turns one step for each event its session's
/// hooks send, and holds still while none comes (#2021).
const MARK_STEPS: [usize; 4] = [0, 1, 2, 1];

/// One row of the list (#1461) at `now`, drawn as `shape` says.
pub(crate) fn list_row(
    row: &crate::list::Row,
    selected: bool,
    focused: bool,
    shape: Shape,
    now: u64,
    chrome: &chrome::Chrome,
    window: &Window,
) -> ObservedElement<Stateful<Div>> {
    row_element(
        &RowDrawn::of(row, selected, focused, shape, now, window),
        chrome,
    )
}

/// Everything one row of the list draws, read at `now` (#1482): the row, its texts and its ages as words. A row's
/// view keeps it and draws again only when it differs, so a frame that changes one row draws that row alone.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RowDrawn {
    /// The row's node id: the row's id unless a planted row keys its node by place.
    id: String,
    ask: bool,
    name: String,
    value: String,
    focused: bool,
    selected: bool,
    loud: bool,
    entry: &'static str,
    step: usize,
    title: String,
    /// A session's name and the short ID that tells it from a twin (#2018), apart.
    twin: Option<(String, String)>,
    word: String,
    drawn_word: String,
    flag: Option<(String, String)>,
    time: String,
    second: Option<String>,
    pub(crate) tall: Pixels,
    /// The title as its slot draws it once the list's width is known: whole, or cut at a whole character (#1808).
    cut: Option<String>,
    /// The title reads right to left from its first strong character, so from the slot's right (#1808).
    rtl: bool,
    /// The time is drawn: beside a long state word at the list's narrowest a session row's leaves what's drawn
    /// (#1808); an ask row's stays (#3282). The list sets it too, for #3282's planted row, since only it knows a row's
    /// place.
    pub(crate) timed: bool,
    /// #1808's planted row draws its title whole, over the slots to its right.
    under: bool,
}

impl RowDrawn {
    pub(crate) fn of(
        row: &crate::list::Row,
        selected: bool,
        focused: bool,
        shape: Shape,
        now: u64,
        window: &Window,
    ) -> RowDrawn {
        let s = sizes();
        let still = shape.still;
        let ask = row.id.starts_with("ask:");
        let working = row.entry == "running" && row.id.starts_with("session:");
        let time = match row.hooks.1 {
            Some(heard) if still && working => copy::fill(
                "views.ago",
                &[&time_of(crate::list::Time::Since(heard), now)],
            ),
            _ => row.time.map(|t| time_of(t, now)).unwrap_or_default(),
        };
        // The working mark's step: one per event, or, in #2021's planted app, one each 300 ms whatever comes.
        let step = if !working {
            0
        } else if crate::plain::planted("mark-on-timer") {
            states::changes_after(300 - now % 300);
            MARK_STEPS[(now / 300 % 4) as usize]
        } else if still {
            0
        } else {
            MARK_STEPS[(row.hooks.0 % 4) as usize]
        };
        let line = row.doing.as_ref().map(|doing| doing.line(now));
        let reach = crate::notify::reach();
        // An ask's row reads as its question, its handle nowhere drawn (#1172) and its id (#1459). The planted rows
        // show the handle, or are keyed by their place.
        let title = if ask && cfg!(feature = "plant-handle-rows") {
            row.id.clone()
        } else {
            row.title.clone()
        };
        // The state word the hub wrote, in the language shown (#2403).
        let word = states::shown(&row.word);
        let name = if ask {
            if reach.not_notified(&row.id) {
                copy::fill("views.not_notified", &[&title])
            } else {
                title.clone()
            }
        } else if cfg!(feature = "plant-row-title-only") {
            title.clone()
        } else if ["BLOCKED", "INVALID", "INCONCLUSIVE"].contains(&row.word.as_str())
            && !row.why.is_empty()
        {
            // A verdict that isn't PASS or FAIL never reads as the bare word (#2018): the row is one line, so its name
            // holds whom it waits for and the evidence it leaves open.
            format!(
                "{} {title} · {word} · {}",
                states::glyph(row.entry),
                copy::hub(&row.why)
            )
        } else if let Some(line) = &line {
            format!("{} {title} · {word} · {line}", states::glyph(row.entry))
        } else {
            format!("{} {title} · {word}", states::glyph(row.entry))
        };
        // Its one flag beside its word (#2019), with what it says: the row is one line, so its name holds the rest.
        let name = match &row.flag {
            Some(flag) => format!("{name} · {}: {}", flag.code, flag.text),
            None => name,
        };
        let id = if ask && cfg!(feature = "plant-row-index-ids") {
            format!("ask-{}", row.id.len())
        } else {
            row.id.clone()
        };
        // A session's name with the short ID the hub added to tell it from a twin (#2018), apart.
        let twin = row
            .id
            .strip_prefix("session:")
            .map(|session| format!(" · {}", &session[..session.len().min(8)]))
            .and_then(|short| {
                let name = title.strip_suffix(short.as_str())?.to_owned();
                Some((name, short))
            });
        // A session waiting on you says so in its mark and its name: the heading Needs you carries the words (#1453
        // rule 9).
        let drawn_word = if !ask && row.entry == "needs_you" {
            String::new()
        } else {
            word.to_owned()
        };
        // #1461's planted row is 24 tall; #2021's selected row takes a second line, its session's line.
        let second = (selected && crate::plain::planted("selected-second-line") && !ask)
            .then(|| line.clone().unwrap_or_default());
        let tall = if crate::plain::planted("row-24") {
            s.space(4)
        } else if second.is_some() {
            s.space(5) * 2.
        } else {
            s.space(5)
        };
        let weight = if row.loud {
            FontWeight::SEMIBOLD
        } else {
            FontWeight::NORMAL
        };
        // A title that runs right to left from its first strong character reads from its slot's right, beside the
        // state word; the slots keep their sides (#1808).
        let rtl = unicode_bidi::get_base_direction(title.as_str()) == unicode_bidi::Direction::Rtl;
        // Once the list's width is known, the title's room is what the row's other slots leave it (#1808). Beside a long
        // state word at the list's narrowest a session row's time leaves what's drawn, its slot kept in the tree with no
        // width, so the title keeps at least 12 characters. An ask row's time is when its recommended answer applies, so
        // it stays and the title takes what's left (#3282).
        let wide = |text: &str, weight| drawn_width(window, text, weight);
        // A slot beside the title is laid out at least its text's width rounded up to a whole point, so each is taken
        // so: an ask's title cut to a few characters would otherwise be fitted to room its slot doesn't have, and lose
        // its ellipsis.
        let slot_wide = |text: &str| wide(text, FontWeight::NORMAL).ceil();
        let roomy = shape.width.map(|width| {
            let flag = row
                .flag
                .as_ref()
                .map_or(px(0.), |flag| s.space(1) + slot_wide(&flag.code));
            let fixed = s.space(1) * 4. + s.space(3) + slot_wide(&drawn_word) + flag;
            let time = (s.space(1) + slot_wide(&time)).max(s.space(5));
            let mut least: String = title.chars().take(TITLE_LEAST).collect();
            if title.chars().count() > TITLE_LEAST {
                least.push('…');
            }
            let timed = ask || width - fixed - time >= wide(&least, weight);
            (timed, width - fixed - if timed { time } else { px(0.) })
        });
        let timed = roomy.is_none_or(|(timed, _)| timed);
        // #1808's planted rows: a title drawn whole over the slots to its right, and one cut at 8 characters whatever
        // room it has.
        let under = crate::plain::planted("title-under-word");
        let eight = crate::plain::planted("title-shows-8") && title.is_empty();
        let twin = twin.filter(|_| !eight);
        let cut = if eight {
            let mut eight: String = title.chars().take(8).collect();
            eight.push('…');
            Some(eight)
        } else {
            roomy.map(|(_, room)| match &twin {
                Some((name, short)) => {
                    fitted(window, name, room - wide(short, weight).ceil(), weight)
                }
                None => fitted(window, &title, room, weight),
            })
        };
        RowDrawn {
            id,
            ask,
            name,
            value: row.value.clone(),
            focused,
            selected,
            loud: row.loud,
            entry: row.entry,
            step,
            title,
            twin,
            word: word.to_owned(),
            drawn_word,
            flag: (row.flag.as_ref()).map(|flag| (flag.code.clone(), flag.text.clone())),
            time,
            second,
            tall,
            cut,
            rtl,
            timed,
            under,
        }
    }
}

/// One row of the list as `drawn` holds it (#1461): one line, 32 tall, with fixed slots: the mark in 16 and 8 after
/// it, the title, then the state word and a time at least 32 wide at the right edge. An unread or asking row's title
/// is medium; a settled row's is regular in the secondary ink. Its name holds what's drawn and what's cut, and a
/// working session's what its turn is doing now (#2021). Under reduce motion a working mark holds still and its time
/// says when its session's last event came.
pub(crate) fn row_element(
    drawn: &RowDrawn,
    chrome: &chrome::Chrome,
) -> ObservedElement<Stateful<Div>> {
    let s = sizes();
    let id = drawn.id.as_str();
    let (ask, title, time) = (drawn.ask, drawn.title.clone(), drawn.time.clone());
    let whole: SharedString = drawn.name.clone().into();
    let ring = if drawn.focused {
        chrome.focus
    } else {
        chrome.focus.opacity(0.)
    };
    let ink = if drawn.loud {
        chrome.ink_primary
    } else {
        chrome.ink_secondary
    };
    // An ask's time is when its default applies, the moment #1458 names `<ask>:applies` too.
    let time_name = if ask {
        format!("{id}:applies")
    } else {
        format!("{id}:time")
    };
    let time_slot = if ask {
        row_slot(id, "time", time.clone()).child(
            observed(ElementId::Name(time_name.into()))
                .role(Role::Label)
                .aria_label(time.clone())
                .child(time),
        )
    } else {
        row_slot(id, "time", time.clone()).child(time)
    };
    observed(ElementId::Name(id.to_owned().into()))
        .role(Role::Button)
        .aria_label(drawn.name.clone())
        .aria_value(drawn.value.clone())
        .when(drawn.focused, |row| row.aria_active_descendant())
        .typed(s.body)
        // As wide as the list: a row its cached view lays out as a root shrinks to its words otherwise, and its state
        // word and time leave the right edge (#1808).
        .w_full()
        .h(drawn.tall)
        .flex_none()
        .flex()
        .items_center()
        .px(s.space(1))
        .rounded(s.radius)
        .relative()
        .hover(|style| style.bg(chrome.hover))
        .when(drawn.selected, |r| r.bg(chrome.selected))
        // The focus ring over the row, taking no room of its own, so the slots sit where they sit focused or not.
        .child(
            div()
                .absolute()
                .inset_0()
                .rounded(s.radius)
                .border(s.ring)
                .border_color(ring),
        )
        .tooltip(move |_, cx| cx.new(|_| RowTip(whole.clone())).into())
        .tooltip_show_delay(ROW_TIP_DELAY)
        // The mark: its state's drawn glyph tinted in its core, in a slot of 16 with 8 after it (#1592). A working
        // session's turns a quarter for each event its hooks send (#2021).
        .child(
            row_slot(id, "mark", states::glyph(drawn.entry).to_owned())
                .aria_value(drawn.entry.to_owned())
                .flex_none()
                .w(s.mark)
                .h_full()
                .mr(s.space(1))
                .flex()
                .items_center()
                .child(crate::icons::mark(drawn.entry, drawn.step)),
        )
        .child(
            // Each slot the row's full height, so the slots read in the row's order, left to right.
            row_slot(id, "title", title.clone())
                .flex_1()
                .min_w_0()
                .h_full()
                .flex()
                .items_center()
                .when(drawn.rtl, |slot| slot.justify_end())
                .text_color(ink)
                // Unread or asking stands out by weight alone: the chrome's face has no medium of its own, so it
                // takes the next weight it has (#1461).
                .font_weight(if drawn.loud {
                    FontWeight::SEMIBOLD
                } else {
                    FontWeight::NORMAL
                })
                .map(|slot| match (drawn.twin.clone(), drawn.under) {
                    // #1808's planted row: its title whole, in a box of its own over the slots to its right.
                    (_, true) => slot.relative().child(
                        div()
                            .absolute()
                            .left_0()
                            .top_0()
                            .bottom_0()
                            .flex()
                            .items_center()
                            .whitespace_nowrap()
                            .overflow_hidden()
                            .child(title),
                    ),
                    // The short ID that tells a session from its twin stays in view (#2018): a name too long for
                    // the row is cut, its ID never.
                    (Some((name, short)), false) => slot
                        .child(div().min_w_0().map(|cut| fit(cut, name, drawn.cut.clone())))
                        .child(div().flex_none().child(short)),
                    (None, false) => fit(slot, title, drawn.cut.clone()),
                }),
        )
        .child(
            row_slot(id, "word", drawn.word.clone())
                .flex_none()
                .h_full()
                .flex()
                .items_center()
                .pl(s.space(1))
                .text_color(chrome.ink_secondary)
                .child(drawn.drawn_word.clone()),
        )
        // The flag, at most one, in the right slot beside the word (#2019): never a state, so in the word's ink.
        .children(drawn.flag.as_ref().map(|(code, text)| {
            row_slot(id, "flag", format!("{code}: {text}"))
                .flex_none()
                .h_full()
                .flex()
                .items_center()
                .pl(s.space(1))
                .text_color(chrome.ink_secondary)
                .child(code.clone())
        }))
        .child(
            time_slot
                .flex_none()
                .h_full()
                .items_center()
                .map(|slot| {
                    if drawn.timed {
                        slot.min_w(s.space(5)).pl(s.space(1))
                    } else {
                        slot.w(px(0.)).overflow_hidden()
                    }
                })
                .flex()
                .justify_end()
                .text_color(chrome.ink_secondary),
        )
        .children(drawn.second.clone().map(|line| {
            div()
                .absolute()
                .bottom_0()
                .left(s.space(4))
                .text_color(chrome.ink_secondary)
                .child(line)
        }))
}

/// How tall an item of the list draws: a heading 32 with 8 above it, a row 32 (#1461), or 24 in #1461's planted list.
pub(crate) fn item_height(item: &crate::list::Item) -> Pixels {
    let s = sizes();
    match item {
        crate::list::Item::Heading { .. } => s.space(5) + s.space(1),
        crate::list::Item::Row(_) if crate::plain::planted("row-24") => s.space(4),
        crate::list::Item::Row(_) => s.space(5),
    }
}

/// A heading of the list (#1461): 32 tall with 8 above it, its title in the body role at medium weight, its value the
/// count it carries, if any.
pub(crate) fn list_heading(
    id: &str,
    title: &str,
    value: Option<String>,
) -> ObservedElement<Stateful<Div>> {
    let s = sizes();
    heading(ElementId::Name(id.to_owned().into()), title.to_owned())
        .when_some(value, |h, value| h.aria_value(value))
        .h(s.space(5))
        .mt(s.space(1))
        .px(s.space(1))
        .flex_none()
}

/// The time the views draw by: the virtual clock in a replica, else the system's.
pub(crate) fn now_ms() -> u64 {
    now()
}

/// Needs you's count as the heading carries it (#1461): its value, the number once read; its words, the one count
/// sentence, "reading" before the record is read, or the hub not answering. Never 0 while it can't be read.
fn needs_you_count(
    count: usize,
    empty: crate::empties::Empty,
    now: u64,
) -> (String, Option<String>, String) {
    use crate::empties::Empty;
    // #2026's planted count leaves out a decision's close: each ask a decision closed counts as open.
    let count = if crate::plain::planted("home-skips-decision-close") {
        count + crate::record::with_view(|view| view.table().decided()).unwrap_or(0)
    } else {
        count
    };
    // #2028's planted count adds the list's unread rows to the asks.
    let count = if crate::plain::planted("list-adds-unread") {
        count + crate::list::unread_rows()
    } else {
        count
    };
    match empty {
        // Nothing needs you only once setup finished (#2026): until then, what setup says, and no number.
        Empty::Nothing if count == 0 => match crate::setup::count() {
            Some(setup) => (setup.to_owned(), None, String::new()),
            None => (asks_need_you(0), None, "0".to_owned()),
        },
        // The planted count says "1 asks need you".
        Empty::Nothing if crate::plain::planted("count-one-asks") => (
            format!("{count} asks need you"), // copy-exception: planted wrong program
            Some(count.to_string()),
            count.to_string(),
        ),
        Empty::Nothing => (
            asks_need_you(count),
            Some(count.to_string()),
            count.to_string(),
        ),
        Empty::Reading => (
            copy::text(crate::empties::READING).to_owned(),
            Some(copy::text(crate::empties::READING).to_owned()),
            String::new(),
        ),
        // Every count says the hub isn't answering and since when, in place of a number (#2026).
        Empty::Unreachable { .. } => {
            let words = empty.words("", now);
            (words.clone(), Some(words), String::new())
        }
    }
}

/// Needs you's heading (#1461): its title and, at its right edge, the count drawn as its number, then the control that
/// pops the section out, drawn on hover and in the tree at rest (#1453 rule 10).
pub(crate) fn needs_you_heading(
    count: usize,
    empty: crate::empties::Empty,
    now: u64,
    popped: bool,
    chrome: &chrome::Chrome,
) -> ObservedElement<Stateful<Div>> {
    let (name, drawn, value) = needs_you_count(count, empty, now);
    list_heading(
        crate::list::HEADING,
        copy::text("views.needs_you"),
        Some(value),
    )
    .justify_between()
    .group("needs-you-heading")
    .child(
        div()
            .flex()
            .items_center()
            .gap(sizes().space(1))
            .text_color(chrome.ink_secondary)
            .font_weight(FontWeight::NORMAL)
            .child(
                // As tall as the control beside it, so the two sit on one line in reading order.
                observed("sidebar-count")
                    .role(Role::Label)
                    .aria_label(name)
                    .aria_value(empty.value())
                    .min_h(sizes().space(4))
                    .flex()
                    .items_center()
                    .children(drawn),
            )
            .children((!popped).then(|| {
                // An icon of the set at a row's size (#1592), drawn on hover and named in the tree at rest.
                let (icon, place) = crate::icons::POP_OUT;
                control(
                    "needs-you-pop-out",
                    Control::Icon(icon, place),
                    copy::text("views.pop_out"),
                    chrome,
                )
                .aria_label(copy::text("views.pop_out_needs_you"))
                .opacity(0.)
                .group_hover("needs-you-heading", |style| style.opacity(1.))
                .on_click(|_, _, cx| {
                    crate::open::pop_out(Address::page("needs-you"), Kind::NeedsYou, cx)
                })
            })),
    )
}

/// One of the three empties as a line (#1461), from one table: its mark, which only nothing here goes without, and its
/// words. Its value is its mark's status-map entry; `idle`, the calm one, is nothing here's.
pub(crate) fn empty_line(
    id: &'static str,
    nothing: &str,
    empty: crate::empties::Empty,
    now: u64,
    chrome: &chrome::Chrome,
) -> ObservedElement<Stateful<Div>> {
    let s = sizes();
    let words = empty.words(nothing, now);
    observed(id)
        .role(Role::Label)
        .aria_label(words.clone())
        .aria_value(empty.entry().unwrap_or("idle"))
        .typed(s.body)
        .h(s.space(5))
        .flex_none()
        .flex()
        .items_center()
        // In the list it sits in from the edge as a row does; on a page, on the lane's edge.
        .when(id == "list-empty", |line| line.px(s.space(1)))
        .text_color(chrome.ink_secondary)
        // Its mark, the entry's drawn glyph, in a row's mark slot (#1592); nothing here has none, and its words keep
        // the page's left edge.
        .children(empty.entry().map(|entry| {
            div()
                .flex_none()
                .w(s.mark)
                .mr(s.space(1))
                .flex()
                .items_center()
                .child(crate::icons::mark(entry, 0))
        }))
        .child(div().flex_1().min_w_0().truncate().child(words))
}

/// The empty a place is in now (#1461): the hub said down, the record not read yet, or read.
pub(crate) fn empty_now() -> crate::empties::Empty {
    let reach = crate::notify::reach();
    let empty = crate::empties::Empty::of(reach.hub_down, reach.since, crate::record::read_yet());
    // #1461's planted app draws not read yet as couldn't read.
    if empty == crate::empties::Empty::Reading && crate::plain::planted("empties-alike") {
        return crate::empties::Empty::Unreachable { since: None };
    }
    empty
}

/// A page's title (#1461): where every page has it, a node `page-title` around the page's own title. The row stays as
/// its page scrolls (#1808); in a window too narrow for both regions it starts with Needs you's count, the way back to
/// the list, so the count is never off screen.
pub(crate) fn page_title(
    inner: impl IntoElement,
    chrome: &chrome::Chrome,
) -> ObservedElement<Stateful<Div>> {
    let s = sizes();
    observed("page-title")
        .role(Role::Group)
        .w_full()
        .flex_none()
        // #1808's planted narrow window shows no count on its page.
        .when(
            narrow() && !crate::plain::planted("narrow-no-count"),
            |row| {
                row.flex()
                    .items_center()
                    .gap(s.space(2))
                    .child(count_back(chrome))
            },
        )
        .child(div().flex_1().min_w_0().child(inner))
}

/// Needs you's count on a narrow window's page (#1808): its number, or what the count says while there's none to give,
/// as the list's heading carries it. A press shows the list with the keyboard on it, as Esc does.
fn count_back(chrome: &chrome::Chrome) -> ObservedElement<Stateful<Div>> {
    let (name, drawn, value) = needs_you_count(count(), empty_now(), now());
    let shown = match drawn {
        Some(drawn) if drawn != name => copy::fill("views.needs_you_drawn", &[&drawn]),
        Some(drawn) => drawn,
        None => copy::text("views.needs_you").to_owned(),
    };
    control("page-count", Control::Plain, shown, chrome)
        .aria_label(name)
        .aria_value(value)
        .flex_none()
        .on_click(|_, window, cx| focus_list(window, cx))
}

/// The reading lane of a page (#1461): its title row, then its content no wider than `min(720, page − 48)`, centred, so
/// text keeps one left edge; and the box at its foot, but on the first-launch page. Under the title the content scrolls,
/// from its top for each `scrolls` key (#1808); with none, the content keeps to the lane and scrolls inside itself.
pub(crate) fn in_lane(
    scrolls: Option<SharedString>,
    title: Option<AnyElement>,
    content: impl IntoElement,
    with_box: bool,
) -> Div {
    let s = sizes();
    // #1461's planted page draws its content and its box the page's width.
    let lane = if crate::plain::planted("page-no-lane") {
        crate::chrome::sizes().window.0 * 4.
    } else {
        s.lane
    };
    div()
        .size_full()
        .flex()
        .flex_col()
        .items_center()
        .px(s.space(4))
        .child(
            observed("lane")
                .role(Role::Group)
                .w_full()
                .max_w(lane)
                .flex_1()
                .min_h_0()
                .flex()
                .flex_col()
                .children(title)
                // #1808's planted page cuts what's past its lane's foot, as the merge base's did.
                .child(
                    match scrolls.filter(|_| !crate::plain::planted("page-clips")) {
                        // Under its title the page scrolls (#1808), each address from its top.
                        Some(key) => crate::find::lane(key, content).into_any_element(),
                        // A page whose content scrolls inside itself, as a card's rows do.
                        None => div()
                            .flex_1()
                            .min_h_0()
                            .w_full()
                            .flex()
                            .flex_col()
                            .overflow_hidden()
                            .child(content)
                            .into_any_element(),
                    },
                ),
        )
        .children(with_box.then(words_box).flatten().map(|words| {
            div()
                .w_full()
                .max_w(lane)
                .flex_none()
                .pb(s.space(2))
                .child(words)
        }))
}
