//! Issue #148: the Agents page, each agent's MCP servers and skills and a sync's diff to approve.

use gpui_kit::base::ObservedElement;
use gpui_kit::*;
use serde_json::json;

use crate::address::Address;
use crate::chrome::{sizes, Typed as _};
use crate::views::{control, heading, label, observed, Control, Shipped};
use crate::{chrome, copy, text};

/// The diff lines the Agents page shows of each file, and the width a line is cut to, in points.
const DIFF_LINES: usize = 8;
const DIFF_WIDTH: f32 = 1060.;

/// A path as the Agents page shows it: under your home as `~/...`.
fn home_path(path: &str) -> String {
    match std::env::var("HOME") {
        // copy-exception: an environment variable's name
        Ok(home) if !home.is_empty() && path.starts_with(&format!("{home}/")) => {
            format!("~{}", &path[home.len()..])
        }
        _ => path.to_owned(),
    }
}

/// One row of the Agents page: its name, what it is, and where it went, one accessibility node named by all three.
fn agents_row(
    id: impl Into<ElementId>,
    cells: [String; 3],
    chrome: &chrome::Chrome,
) -> ObservedElement<Stateful<Div>> {
    let name = cells.join(" · ");
    let [what, how, wh] = cells;
    observed(id)
        .role(Role::Label)
        .aria_label(name)
        .flex()
        .gap(sizes().space(3))
        .typed(sizes().body)
        .h(sizes().body.line)
        .items_center()
        .child(
            div()
                .w(relative(0.25))
                .truncate()
                .font_weight(FontWeight::MEDIUM)
                .children(crate::find::found(&what, chrome))
                .child(what),
        )
        .child(
            div()
                .w(relative(0.35))
                .truncate()
                .text_color(chrome.ink_secondary)
                .child(how),
        )
        .child(div().flex_1().min_w_0().truncate().child(wh))
}

/// The Agents page (#148): the agents installed, each MCP server and skill with the agents it is synced to, what each
/// agent has that DeepBuild doesn't manage, and the syncs waiting for you; the one you review shows its diff per file,
/// and Apply opens its ask, whose answer carries it out.
pub(crate) fn agents_page(
    page: Stateful<Div>,
    view: &Shipped,
    chrome: &chrome::Chrome,
    cx: &mut Context<Shipped>,
) -> Stateful<Div> {
    let empty = json!({});
    let model = view.agents.as_ref().unwrap_or(&empty);
    let list = |key: &str| model[key].as_array().cloned().unwrap_or_default();
    let agents = list("agents");
    let name_of = |id: &str| {
        agents
            .iter()
            .find(|a| a["id"] == id)
            .and_then(|a| a["name"].as_str())
            .unwrap_or(id)
            .to_owned()
    };
    let names = |ids: &serde_json::Value| {
        ids.as_array()
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| id.as_str())
                    .map(&name_of)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default()
    };
    let named = |installed: bool| {
        agents
            .iter()
            .filter(|a| (a["installed"] == true) == installed)
            .filter_map(|a| a["name"].as_str().map(str::to_owned))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let section = |id: &'static str, text: &'static str| {
        heading(id, text).mt(sizes().space(3)).mb(sizes().space(0))
    };
    let servers = list("servers").into_iter().enumerate().map(|(i, s)| {
        let spec = &s["spec"];
        let scope = spec["scope"]["repos"]
            .as_array()
            .filter(|r| !r.is_empty())
            .map_or(copy::text("views.every_repo").to_owned(), |repos| {
                let repos: Vec<String> = repos
                    .iter()
                    .filter_map(|r| r.as_str())
                    .map(|r| r.rsplit('/').next().unwrap_or(r).to_owned())
                    .collect();
                copy::fill("views.scoped_to", &[&repos.join(", ")])
            });
        let secrets = spec["secrets"]
            .as_array()
            .filter(|v| !v.is_empty())
            .map(|v| {
                let v: Vec<&str> = v.iter().filter_map(|x| x.as_str()).collect();
                copy::fill("views.by_handle", &[&v.join(", ")])
            })
            .unwrap_or_default();
        let how = format!(
            "{} · {scope}{secrets}",
            spec["transport"].as_str().unwrap_or("stdio")
        );
        agents_row(
            ("agents-server", i),
            [
                s["name"].as_str().unwrap_or_default().to_owned(),
                how,
                copy::fill("views.synced_to", &[&names(&s["agents"])]),
            ],
            chrome,
        )
    });
    // In reading order, which ⌘F walks (#1815).
    let servers = servers.collect::<Vec<_>>();
    let skills = list("skills").into_iter().enumerate().map(|(i, k)| {
        let repo = k["repo"].as_str().unwrap_or_default();
        let commit = k["commit"].as_str().unwrap_or_default();
        let how = copy::fill(
            "views.skill_at",
            &[
                &repo.rsplit('/').next().unwrap_or(repo),
                &&commit[..commit.len().min(7)],
                &k["path"].as_str().unwrap_or_default(),
            ],
        );
        let pin = if k["differs"] == true {
            copy::text("views.pin_differs")
        } else {
            copy::text("views.pin_matches")
        };
        agents_row(
            ("agents-skill", i),
            [
                k["name"].as_str().unwrap_or_default().to_owned(),
                how,
                copy::fill("views.synced_to_pin", &[&names(&k["agents"]), &pin]),
            ],
            chrome,
        )
    });
    let skills = skills.collect::<Vec<_>>();
    let yours = agents
        .iter()
        .filter(|a| a["installed"] == true)
        .enumerate()
        .map(|(i, a)| {
            let mine: Vec<&str> = a["yours"]
                .as_array()
                .map(|v| v.iter().filter_map(|x| x.as_str()).collect())
                .unwrap_or_default();
            agents_row(
                ("agents-yours", i),
                [
                    a["name"].as_str().unwrap_or_default().to_owned(),
                    if mine.is_empty() {
                        copy::text("views.nothing_of_yours").to_owned()
                    } else {
                        mine.join(", ")
                    },
                    copy::text("views.yours_left_alone").to_owned(),
                ],
                chrome,
            )
        })
        .collect::<Vec<_>>();
    let syncs = list("syncs");
    let waiting: Vec<serde_json::Value> = syncs
        .iter()
        .filter(|s| s["status"] == "proposed")
        .cloned()
        .collect();
    let rows = waiting
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let id = s["id"].as_str().unwrap_or_default().to_owned();
            let files = s["files"].as_array().map_or(0, Vec::len);
            let reached: Vec<String> = s["files"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|f| f["agents"].as_array().cloned().unwrap_or_default())
                .filter_map(|a| a.as_str().map(name_of))
                .fold(Vec::new(), |mut all, a| {
                    if !all.contains(&a) {
                        all.push(a);
                    }
                    all
                });
            div()
                .flex()
                .items_center()
                .gap(sizes().space(3))
                .child(agents_row(
                    ("agents-waiting", i),
                    [
                        format!(
                            "{} {}",
                            s["kind"].as_str().unwrap_or_default(),
                            s["name"].as_str().unwrap_or_default()
                        ),
                        copy::fill("views.sync_files", &[&files, &reached.join(", ")]),
                        String::new(),
                    ],
                    chrome,
                ))
                .child(
                    control(
                        ("agents-review", i),
                        Control::Plain,
                        copy::text("views.review_the_diff"),
                        chrome,
                    )
                    .aria_label(copy::fill(
                        "views.review_the_diff_of",
                        &[&s["name"].as_str().unwrap_or_default()],
                    ))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.reviewing = Some(id.clone());
                        cx.notify();
                    })),
                )
        })
        .collect::<Vec<_>>();
    let review = view
        .reviewing
        .as_ref()
        .and_then(|id| waiting.iter().find(|s| s["id"] == id.as_str()))
        .map(|s| review_panel(s, &name_of, chrome, cx));
    // Whether each agent's sessions reach DeepBuild, from its newest agent.reach (#2019): one waiting for its first
    // session says so, and one whose sessions can't reach DeepBuild says why, with its fix.
    let reach = crate::record::with_view(|view| view.table().agents().to_vec())
        .unwrap_or_default()
        .into_iter()
        .map(|(agent, r)| {
            let text = |key: &str| r[key].as_str().unwrap_or_default().to_owned();
            let [how, fix] = match r["state"].as_str() {
                Some("waiting") => [
                    copy::text("views.waits_first_session").to_owned(),
                    String::new(),
                ],
                Some("unreachable") => [
                    copy::fill("views.cant_reach", &[&copy::hub(&text("why"))]),
                    copy::hub(&text("fix")),
                ],
                _ => [copy::text("views.reaches").to_owned(), String::new()],
            };
            let name = r["name"].as_str().unwrap_or(&agent).to_owned();
            agents_row(
                ElementId::Name(format!("agent:{agent}").into()),
                [name, how, fix],
                chrome,
            )
        })
        .collect::<Vec<_>>();
    // The page's title and its scrolling are the lane's (#1808).
    // The planted wrong program draws the page's title alone.
    if crate::plain::planted("agents-title-only") {
        return page;
    }
    page.child(section(
        "agents-reach-title",
        copy::text("views.how_each_agent_reaches"),
    ))
    .children(reach)
    .child(label(
        "agents-installed",
        copy::fill("views.installed", &[&named(true)]),
    ))
    .child(
        label(
            "agents-missing",
            copy::fill("views.not_installed_here", &[&named(false)]),
        )
        .text_color(chrome.ink_secondary),
    )
    .child(section(
        "agents-servers-title",
        copy::text("views.mcp_servers"),
    ))
    .children(servers)
    .child(section("agents-skills-title", copy::text("views.skills")))
    .children(skills)
    .child(section(
        "agents-yours-title",
        copy::text("views.already_in_each_agent"),
    ))
    .children(yours)
    .child(section(
        "agents-waiting-title",
        copy::text("views.waiting_for_you"),
    ))
    .children(rows)
    .children(review)
}

/// One sync's diff, file by file, each with the agents that read it, then Apply, which opens its ask.
fn review_panel(
    sync: &serde_json::Value,
    name_of: &dyn Fn(&str) -> String,
    chrome: &chrome::Chrome,
    cx: &mut Context<Shipped>,
) -> Stateful<Div> {
    let ask = sync["ask"].as_str().unwrap_or_default().to_owned();
    let refused = sync["refused"].as_array().cloned().unwrap_or_default();
    let files = sync["files"].as_array().cloned().unwrap_or_default();
    // A diff line holds one row: a longer one ends in an ellipsis inside its block.
    let mono = |text: &str| text::Label {
        family: deep_text_gpui::Role::Mono.family(),
        width: Some(DIFF_WIDTH),
        max_lines: Some(1),
        ..text::Label::new(text)
    };
    let blocks = files.iter().enumerate().map(|(i, f)| {
        let readers: Vec<String> = f["agents"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|a| a.as_str().map(name_of))
            .collect();
        let read = match readers.as_slice() {
            [] => String::new(),
            [one] => copy::fill("views.read_by", &[one]),
            [first, rest @ ..] => copy::fill("views.read_by_both", &[first, &rest.join(", ")]),
        };
        let lines: Vec<String> = f["diff"]
            .as_str()
            .unwrap_or_default()
            .lines()
            .skip(2)
            .take(DIFF_LINES)
            .map(str::to_owned)
            .collect();
        div()
            .flex()
            .flex_col()
            .mt(sizes().space(1))
            .child(agents_row(
                ("agents-file", i),
                [
                    home_path(f["path"].as_str().unwrap_or_default()),
                    read,
                    String::new(),
                ],
                chrome,
            ))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .p(sizes().space(1))
                    .bg(chrome.raised)
                    .border(sizes().hairline)
                    .border_color(chrome.divider)
                    .children(lines.iter().enumerate().map(|(n, line)| {
                        let color = match line.chars().next() {
                            Some('+') => chrome.ink_primary,
                            _ => chrome.ink_secondary,
                        };
                        let drawn =
                            text::label(&format!("agents-diff-{i}-{n}"), mono(line), color, None)
                                .into_any_element();
                        match crate::find::found(line, chrome) {
                            Some(found) => div().child(drawn).child(found).into_any_element(),
                            None => drawn,
                        }
                    })),
            )
    });
    let refusals = refused.iter().enumerate().map(|(i, r)| {
        label(
            ("agents-refused", i),
            copy::fill(
                "views.refuses_field",
                &[
                    &name_of(r["agent"].as_str().unwrap_or_default()),
                    &r["field"].as_str().unwrap_or_default(),
                    &r["reason"].as_str().unwrap_or_default(),
                ],
            ),
        )
        .text_color(chrome.ink_secondary)
    });
    div()
        .id("agents-review-panel")
        .mt(sizes().space(2))
        .p(sizes().space(2))
        .border(sizes().hairline)
        .border_color(chrome.divider)
        .rounded(sizes().radius)
        .flex()
        .flex_col()
        // Apply and Close beside the title, so they show however long the diff runs.
        .child(
            div()
                .flex()
                .items_center()
                .gap(sizes().space(1))
                .child(
                    label(
                        "agents-review-title",
                        copy::fill(
                            "views.approve_the_sync",
                            &[&sync["name"].as_str().unwrap_or_default()],
                        ),
                    )
                    .flex_1()
                    .font_weight(FontWeight::MEDIUM),
                )
                .child(
                    control(
                        "agents-apply",
                        Control::Main,
                        copy::text("views.apply"),
                        chrome,
                    )
                    .aria_label(copy::text("views.apply_the_sync"))
                    .on_click(move |_, window, cx| {
                        crate::open::open(&Address::ask(&ask), window, cx).ok();
                    }),
                )
                .child(
                    control(
                        "agents-close",
                        Control::Plain,
                        copy::text("views.close"),
                        chrome,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.reviewing = None;
                        cx.notify();
                    })),
                ),
        )
        .children(refusals)
        .children(blocks)
}
