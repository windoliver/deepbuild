//! The app on gpui-kit. A panel runs under an empty gpui-shell policy and imports only `@deepbuild/panel`, DeepBuild's
//! own module (#1425, [`panel_module`]), which also serves the `deepbuild` module's recorded quotes under the `spike`
//! feature. It has no network, files, programs or storage.
//!
//! Issue #338 adds the app's shell with its shipped views as dock panels ([`views`]), the fixture
//! record and inbox projection they draw ([`events`]), the canvas as a registered component
//! ([`canvas`]), and `needs_you` in the `deepbuild` module for the fixture panels.
//!
//! Issue #1172: the shell is the app's window. #337's spike window is no part of the shipped binary: `spike` is built
//! only for the suites that keep its proof, behind the feature of that name.

// A release build refuses the planted programs' feature (#1408).
#[cfg(all(feature = "env-plants", not(debug_assertions)))]
compile_error!("the env-plants feature is for test builds only, never a release build");

pub mod answer;
pub mod arming;
pub mod bound;
pub mod canvas;
pub mod card;
pub mod cells;
pub mod chrome;
pub mod chrome_fx;
pub mod chrome_gallery;
#[cfg(feature = "chrome-fixture")]
pub mod chrome_fixture;
pub mod commands;
pub mod confirm;
pub mod device;
pub mod events;
pub mod gpu_view;
pub mod hub;
pub mod installed;
pub mod kinds;
pub mod notify;
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
pub mod text;
pub mod views;

use std::{path::Path, rc::Rc, sync::atomic::AtomicU64};

use gpui_kit::*;
use gpui_shell::{
    anyhow, policy::Policy, FrozenComponentRegistry, HostError, HostModule, HostValue,
    RegistryError, ScriptView, ShellRuntime,
};

pub mod trusted_input;

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
/// can't reach (#994); before the hub has answered, that (no count is known, so none is drawn); else the one count.
pub fn menu_bar_line() -> String {
    match setup::count().or_else(|| notify::reach().short()) {
        Some(line) => line.to_owned(),
        None if record::older().is_some() => "Hub is older".to_owned(),
        None if !record::connected() => "No hub".to_owned(),
        None => views::count().to_string(),
    }
}

/// The rebuilds this panel host has taken.
pub static REBUILDS: AtomicU64 = AtomicU64::new(0);

/// DeepBuild's module for panels: the Needs you inbox, as plain data.
pub fn deepbuild_module() -> HostModule {
    let module = HostModule::new("deepbuild").function("needs_you", |_| needs_you());
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

/// The inbox projection's list for Needs you, as the fixture panels read it: the rows oldest
/// first, which of them are folded or in Later, and the asks that left the list.
fn needs_you() -> Result<HostValue, HostError> {
    let state = views::current_state().ok_or_else(|| {
        HostError::new("no fixture record is loaded; the host sets one before a panel draws")
    })?;
    let handles = |handles: &[String]| {
        HostValue::Array(handles.iter().cloned().map(HostValue::Str).collect())
    };
    Ok(HostValue::Object(vec![
        ("now".into(), HostValue::Number(state.now as f64)),
        (
            "log_pos".into(),
            HostValue::Number(state.inbox.log_pos as f64),
        ),
        ("rows".into(), handles(&state.inbox.rows())),
        ("folded".into(), handles(&state.inbox.folded)),
        ("later".into(), handles(&state.inbox.later)),
        ("superseded".into(), handles(&state.inbox.superseded)),
        ("moot".into(), handles(&state.inbox.moot)),
        (
            "held".into(),
            state
                .held
                .clone()
                .map(HostValue::Str)
                .unwrap_or(HostValue::Null),
        ),
    ]))
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
    gpui_shell::components::init(cx);
    views::register_views(cx);
    card::init(cx);
    commands::init(cx);
    // Chrome effects hold their still pose under macOS's Reduce Motion (#1436).
    #[cfg(target_os = "macos")]
    cx.set_reduce_motion(objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion());
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
    runtime.mount_application(&loaded, window, cx)
}

/// The checks a panel passes before gpui-shell reads it, then `@deepbuild/panel` written where gpui-shell resolves it.
fn admit(dir: &Path) -> anyhow::Result<()> {
    if let Some(dependency) = fetched_dependency(dir) {
        anyhow::bail!("{}", fetch_refusal(&dependency));
    }
    // #1425's planted loader skips the module check, as the merge base's did.
    if !panel_module::planted("panel-load-unchecked") {
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
