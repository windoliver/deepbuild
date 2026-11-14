//! `--canvas <scenario.json>` (#1485): the canvas panel in the app's real window over the scenario's revisions, one
//! report line, then quit. In a canvas-fixture build only.

use deep_app::canvas_fixture::Scenario;
use deep_app::init;
use gpui_kit::*;

pub fn run(path: Option<String>) {
    let path = path.expect("usage: deep-app --canvas <scenario.json>");
    let scenario = Scenario::read(std::path::Path::new(&path))
        .unwrap_or_else(|why| panic!("deep-app --canvas: {why}"));
    application().run(move |cx| {
        gpui_kit::init(cx);
        init(cx);
        deep_app::canvas_fixture::run(scenario, cx);
    });
}
