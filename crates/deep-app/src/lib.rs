//! The app on gpui-kit. A panel runs under an empty gpui-shell policy and imports only `@deepbuild/panel`, DeepBuild's
//! own module (#1425, [`panel_module`]), which also serves the `deepbuild` module's recorded quotes under the `spike`
//! feature. It has no network, files, programs or storage.
//!
//! Issue #338 adds the app's shell with its shipped views as dock panels ([`views`]), the fixture
//! record and inbox projection they draw ([`events`]), the canvas as a registered component
//! ([`canvas`]), and `needs_you` in the `deepbuild` module, which reads the one record reader (#1459).
//!
//! Issue #1172: the shell is the app's window. #337's spike window is no part of the shipped binary: `spike` is built
//! only for the suites that keep its proof, behind the feature of that name.

// A release build refuses the planted programs' feature (#1408).
#[cfg(all(feature = "env-plants", not(debug_assertions)))]
compile_error!("the env-plants feature is for test builds only, never a release build");

pub mod actions;
pub mod address;
pub mod answer;
pub mod arming;
pub mod bound;
pub mod canvas;
#[cfg(feature = "canvas-fixture")]
pub mod canvas_fixture;
pub mod card;
pub mod cells;
pub mod chrome;
#[cfg(feature = "chrome-fixture")]
pub mod chrome_fixture;
pub mod chrome_fx;
pub mod chrome_gallery;
pub mod commands;
pub mod confirm;
pub mod device;
pub mod empties;
#[cfg(feature = "fixtures")]
pub mod events;
pub mod gpu_view;
pub mod hub;
/// #1486: chrome thumbnails through the one image service.
pub mod images;
pub mod installed;
pub mod kinds;
pub mod list;
pub mod notice;
pub mod notify;
pub mod open;
#[cfg(feature = "panel-check")]
pub mod panel_check;
#[cfg(feature = "panel-check")]
pub mod panel_keys;
pub mod panel_module;
pub mod panel_tree;
pub mod panel_values;
pub mod plain;
pub mod question;
pub mod record;
pub mod rules;
pub mod setup;
pub mod show;
pub mod shown;
pub mod single;
#[cfg(feature = "spike")]
pub mod spike;
pub mod states;
pub mod table;
pub mod text;
pub mod views;
pub mod words;

use std::{path::Path, rc::Rc, sync::atomic::AtomicU64};

use gpui_kit::*;
use gpui_shell::{
    anyhow, policy::Policy, FrozenComponentRegistry, HostError, HostModule, HostValue,
    RegistryError, ScriptView, ShellRuntime,
};

pub mod trusted_input;
pub mod unread;

pub mod capture;

/// Issue #498: the camera and microphone, live, through the OS permission and the held control.
#[cfg(target_os = "macos")]
pub mod devices;

#[cfg(target_os = "macos")]
pub mod color;

pub mod brand;

#[cfg(feature = "spike")]
pub use spike::{
    menu_bar_title, report_html, sessions, waiting_count, write_report, Session, SessionState,
    Spike, SESSION_COUNT,
};

/// #337's recording. Issue #1454: it left the shipped module with the spike.
#[cfg(feature = "spike")]
const QUOTES: &str = include_str!("../fixtures/quotes.json");

/// One recorded stock: its symbol, name and prices, one per tick.
#[cfg(feature = "spike")]
#[derive(Clone, Debug, PartialEq)]
pub struct Stock {
    pub symbol: String,
    pub name: String,
    pub prices: Vec<f64>,
}

/// The recording grouped by symbol, in the order the symbols first appear.
#[cfg(feature = "spike")]
pub fn stocks() -> Vec<Stock> {
    let raw: serde_json::Value =
        serde_json::from_str(QUOTES).expect("the recorded quotes are valid JSON");
    let mut stocks: Vec<Stock> = Vec::new();
    for row in raw["quotes"].as_array().expect("a quotes array") {
        let symbol = row["symbol"].as_str().expect("a symbol");
        let price = row["price"].as_f64().expect("a price");
        match stocks.iter_mut().find(|stock| stock.symbol == symbol) {
            Some(stock) => stock.prices.push(price),
            None => stocks.push(Stock {
                symbol: symbol.to_owned(),
                name: row["name"].as_str().unwrap_or(symbol).to_owned(),
                prices: vec![price],
            }),
        }
    }
    stocks
}

/// What the menu bar shows: while setup hasn't finished, that it didn't, never a number (#1002); then what the app
/// can't reach (#994), the hub with since when, as the list says it (#2026); before the hub has answered, that (no
/// count is known, so none is drawn); else the one count sentence (#1455).
pub fn menu_bar_line() -> String {
    let reach = notify::reach();
    // #2026's planted menu bar keeps the last count it read while the hub isn't answering, as if live.
    if reach.hub_down && setup::count().is_none() && !plain::planted("hub-down-keeps-count") {
        return empties::Empty::Unreachable { since: reach.since }.words("", views::now());
    }
    match setup::count().or_else(|| reach.short().filter(|_| !reach.hub_down)) {
        Some(line) => line.to_owned(),
        None if record::older().is_some() => "Hub is older".to_owned(),
        None if !record::connected() && !reach.hub_down => "No hub".to_owned(),
        // #2026's planted menu bar counts sessions, not asks.
        None if plain::planted("menu-bar-counts-sessions") => views::asks_need_you(
            record::with_view(|view| view.table().every_session().len()).unwrap_or(0),
        ),
        None => views::asks_need_you(views::count()),
    }
}

/// The rebuilds this panel host has taken.
pub static REBUILDS: AtomicU64 = AtomicU64::new(0);

/// DeepBuild's module for panels: the Needs you inbox, as plain data.
pub fn deepbuild_module() -> HostModule {
    let module = HostModule::new("deepbuild")
        .function("needs_you", |_| needs_you())
        .function("sessions", |_| sidebar_sessions());
    #[cfg(feature = "spike")]
    let module = module.function("quotes", |_| {
        let interval: serde_json::Value = serde_json::from_str(QUOTES).expect("valid JSON");
        let symbols = stocks()
            .into_iter()
            .map(|stock| {
                HostValue::Object(vec![
                    ("symbol".into(), HostValue::Str(stock.symbol)),
                    ("name".into(), HostValue::Str(stock.name)),
                    (
                        "prices".into(),
                        HostValue::Array(stock.prices.into_iter().map(HostValue::Number).collect()),
                    ),
                ])
            })
            .collect();
        Ok(HostValue::Object(vec![
            ("interval_s".into(), json_to_host(&interval["interval_s"])),
            ("symbols".into(), HostValue::Array(symbols)),
        ]))
    });
    #[cfg(feature = "panel-check")]
    let module = module
        // #358: a panel's script is a function of how many rebuilds its host has taken.
        .function("rebuild_count", |_| {
            Ok(HostValue::Number(
                REBUILDS.load(std::sync::atomic::Ordering::Relaxed) as f64,
            ))
        })
        // #358: a fold whose open state follows its key in the app, where no rebuild can lose it. A host function
        // can't make a node, so it crosses as a marked text the app reads back.
        .function("fold", |args| {
            let part = |at| args.string(at).map(str::to_owned);
            let parts = [part(0)?, part(1)?, part(2)?];
            let mark = panel_keys::FOLD_MARK;
            Ok(HostValue::Str(
                parts.iter().map(|part| format!("{mark}{part}")).collect(),
            ))
        });
    module
}

/// The inbox projection's list for Needs you, as any panel reads it: the rows oldest first, each open ask's handle and
/// question in that order (so a view keys a row by its ask and draws its question, never the handle, #1459), which of
/// them are folded or in Later, and the asks that left the list. It reads the one record reader, which holds the hub's
/// record in the app and the fixture's in a replica, so a panel gets the same answer in both (#1459).
fn needs_you() -> Result<HostValue, HostError> {
    let (log_pos, inbox) = record::with_view(|view| (view.log_pos, view.inbox.clone()))
        .ok_or_else(|| HostError::new("the app hasn't read the record from the hub yet"))?;
    let text =
        |row: &serde_json::Value, key: &str| row[key].as_str().unwrap_or_default().to_owned();
    // Needs you's order (#1462): open asks oldest first, those put off with Later after them until they come back.
    let now = views::now();
    let later = |row: &serde_json::Value| {
        row["status"] == "later" && row["until"].as_u64().is_none_or(|until| until > now)
    };
    let mut inbox = inbox;
    inbox.sort_by_key(|row| later(row));
    let open: Vec<&serde_json::Value> = inbox
        .iter()
        .filter(|row| row["status"] != "closed")
        .collect();
    let handles = |keep: &dyn Fn(&serde_json::Value) -> bool| {
        HostValue::Array(
            inbox
                .iter()
                .filter(|row| keep(row))
                .map(|row| HostValue::Str(text(row, "ask")))
                .collect(),
        )
    };
    Ok(HostValue::Object(vec![
        ("now".into(), HostValue::Number(views::now() as f64)),
        ("log_pos".into(), HostValue::Number(log_pos as f64)),
        ("rows".into(), handles(&|row| row["status"] != "closed")),
        (
            "asks".into(),
            HostValue::Array(
                open.iter()
                    .map(|row| {
                        HostValue::Object(vec![
                            ("handle".into(), HostValue::Str(text(row, "ask"))),
                            ("question".into(), HostValue::Str(text(row, "question"))),
                        ])
                    })
                    .collect(),
            ),
        ),
        ("folded".into(), handles(&|row| row["status"] == "folded")),
        ("later".into(), handles(&|row| row["status"] == "later")),
        (
            "superseded".into(),
            handles(&|row| row["outcome"] == "superseded"),
        ),
        ("moot".into(), handles(&|row| row["outcome"] == "moot")),
        (
            "held".into(),
            // The hub records no event for a hold yet, so only a replica's fixture names one (#1454), and the shipped
            // app, which has no fixture (#1457), names none.
            held().map(HostValue::Str).unwrap_or(HostValue::Null),
        ),
    ]))
}

/// The ask a replica's fixture holds, since the record has no event for a hold yet (#1457): none in a shipped build.
#[cfg(feature = "fixtures")]
pub(crate) fn held() -> Option<String> {
    views::current_state().and_then(|state| state.held.clone())
}

#[cfg(not(feature = "fixtures"))]
pub(crate) fn held() -> Option<String> {
    None
}

/// The sessions as the sidebar lists them, in its order, for a view replacing its rows (`session.row@1`): each one's
/// ID, which keys its row as `session:<id>`, its title, its state's words and status-map entry, and `asks`, the hub's
/// count of its open asks (#2018), from the one record reader (#1459).
fn sidebar_sessions() -> Result<HostValue, HostError> {
    record::with_view(|view| {
        let table = view.table();
        HostValue::Array(
            table
                .every_session()
                .into_iter()
                .map(|(id, title, _)| {
                    let (words, entry) = table.row(&id, views::now());
                    let asks = table.asks_of(&id);
                    HostValue::Object(vec![
                        ("asks".into(), HostValue::Number(asks as f64)),
                        ("id".into(), HostValue::Str(id)),
                        ("title".into(), HostValue::Str(title)),
                        ("words".into(), HostValue::Str(words)),
                        ("entry".into(), HostValue::Str(entry.to_owned())),
                    ])
                })
                .collect(),
        )
    })
    .ok_or_else(|| HostError::new("the app hasn't read the record from the hub yet"))
}

#[cfg(feature = "spike")]
fn json_to_host(value: &serde_json::Value) -> HostValue {
    use serde_json::Value;
    match value {
        Value::Null => HostValue::Null,
        Value::Bool(value) => HostValue::Bool(*value),
        Value::Number(value) => HostValue::Number(value.as_f64().unwrap_or_default()),
        Value::String(value) => HostValue::Str(value.clone()),
        Value::Array(values) => HostValue::Array(values.iter().map(json_to_host).collect()),
        Value::Object(fields) => HostValue::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), json_to_host(value)))
                .collect(),
        ),
    }
}

/// gpui-shell's component catalog with DeepBuild's canvas beside it.
pub fn components() -> Result<FrozenComponentRegistry, RegistryError> {
    let mut registry = gpui_shell::components::registry()?;
    canvas::register(&mut registry)?;
    registry.freeze()
}

/// An isolated script runtime over [`components`].
pub fn new_runtime() -> anyhow::Result<Rc<ShellRuntime>> {
    ShellRuntime::new_isolated_with_components(components()?)
}

/// Registers gpui-shell's component catalog, the shipped views and DeepBuild's empty-policy
/// default.
pub fn init(cx: &mut App) {
    // The chrome's code face is bundled, not the system's (#1458), so GPUI's text system is given it; a test build's
    // planted row asks for the canvas's face, which it's given too.
    let code = chrome::sizes().code.clone();
    let canvas =
        plain::planted("row-label-canvas-face").then(|| deep_text_gpui::Role::Body.family());
    let faces = deep_text::FACES
        .iter()
        .filter(|face| face.family == code.as_ref() || Some(face.family) == canvas)
        .map(|face| std::borrow::Cow::Borrowed(face.bytes))
        .collect();
    let _ = cx.text_system().add_fonts(faces);
    gpui_shell::components::init(cx);
    views::register_views(cx);
    card::init(cx);
    commands::init(cx);
    actions::init(cx);
    // Chrome effects hold their still pose under macOS's Reduce Motion (#1436).
    #[cfg(target_os = "macos")]
    cx.set_reduce_motion(
        objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion(),
    );
    gpui_shell::policy::set_default(
        Policy::new()
            .with_application("deepbuild-panel")
            .with_host_module(deepbuild_module())
            .expect("`deepbuild` is not a reserved module name"),
    );
}

/// Loads a panel directory's `main.js` and mounts its view. A panel loads nothing from the network: one whose
/// gpui-shell manifest lists a Git dependency is refused before gpui-shell reads it, so nothing is fetched (#326). A
/// panel that imports the toolkit, or a name off the panel catalog, is refused before it loads too (#1425).
pub fn mount_panel(
    runtime: &Rc<ShellRuntime>,
    dir: &Path,
    window: &mut Window,
    cx: &mut App,
) -> anyhow::Result<Entity<ScriptView>> {
    admit(dir)?;
    let loaded = runtime.load_application(dir, "main.js")?;
    let view = runtime.mount_application(&loaded, window, cx)?;
    MOUNTED.with(|mounted| mounted.borrow_mut().push(view.downgrade()));
    Ok(view)
}

thread_local! {
    /// The panels mounted in this process, so a new reading of the record reaches the scripts that read it.
    static MOUNTED: std::cell::RefCell<Vec<WeakEntity<ScriptView>>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Tells every mounted panel the record moved: a script reads it through `deepbuild.needs_you`, so its description is
/// stale and its `render` runs again (gpui-shell's `refresh`, not a bare notify). A panel that went is forgotten.
pub fn refresh_panels(cx: &mut App) {
    let mounted: Vec<Entity<ScriptView>> = MOUNTED.with(|mounted| {
        let mut mounted = mounted.borrow_mut();
        mounted.retain(|view| view.upgrade().is_some());
        mounted.iter().filter_map(WeakEntity::upgrade).collect()
    });
    for view in mounted {
        view.update(cx, |view, cx| view.refresh(cx));
    }
}

/// The checks a panel passes before gpui-shell reads it, then `@deepbuild/panel` written where gpui-shell resolves it.
fn admit(dir: &Path) -> anyhow::Result<()> {
    if let Some(dependency) = fetched_dependency(dir) {
        anyhow::bail!("{}", fetch_refusal(&dependency));
    }
    // #1425's planted loader skips the module check, as the merge base's did.
    if !plain::planted("panel-load-unchecked") {
        panel_module::check(dir).map_err(anyhow::Error::msg)?;
    }
    Ok(panel_module::serve(dir)?)
}

/// Mounts one of a view's pages (#366): the panel in `dir`, its script's `init` given `props.page`. gpui-shell gives a
/// top-level script no props, so a small entry beside the panel's `main.js` creates the panel as a nested view with
/// them; the page is the panel's own code, reading nothing more.
pub fn mount_page(
    runtime: &Rc<ShellRuntime>,
    dir: &Path,
    page: &serde_json::Value,
    window: &mut Window,
    cx: &mut App,
) -> anyhow::Result<Entity<ScriptView>> {
    admit(dir)?;
    let props = serde_json::json!({ "page": page });
    std::fs::write(
        dir.join(panel_module::PAGE_ENTRY),
        format!(
            "import {{ View }} from \"@deepbuild/panel\";\nimport Panel from \"./main.js\";\n\nexport default class Page extends View {{\n  init(_props, cx) {{\n    this.panel = cx.new(Panel, {props});\n  }}\n\n  render() {{\n    return this.panel;\n  }}\n}}\n"
        ),
    )?;
    let loaded = runtime.load_application(dir, panel_module::PAGE_ENTRY)?;
    runtime.mount_application(&loaded, window, cx)
}

/// The first dependency a panel's manifest names. Every form gpui-shell takes, object or shorthand, fetches from a
/// repository, so any entry counts. A manifest that doesn't parse fetches nothing: gpui-shell refuses it too.
pub fn fetched_dependency(dir: &Path) -> Option<String> {
    // #358: a package's own manifest is read as well; what it asks for is never granted either way.
    ["gpui-shell.json", "package.json"].iter().find_map(|file| {
        let text = std::fs::read_to_string(dir.join(file)).ok()?;
        let manifest: serde_json::Value = serde_json::from_str(&text).ok()?;
        manifest["dependencies"].as_object()?.keys().next().cloned()
    })
}

/// Why a panel whose manifest fetches a dependency is refused.
pub fn fetch_refusal(dependency: &str) -> String {
    format!("its manifest lists the Git dependency {dependency}; a panel loads nothing from the network")
}
