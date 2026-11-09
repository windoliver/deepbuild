//! `--chrome <fixture> (--snapshot <png> | --idle <seconds> | --frames <n>)` (#1434): the chrome@1 fixture as the app's
//! real window's content, one report line, then quit. In a chrome-fixture build only.

use std::path::PathBuf;

use deep_app::chrome_fixture::{Fixture, Live};
use deep_app::init;
use gpui_kit::*;

pub fn run(args: Vec<String>) {
    let usage =
        "usage: deep-app --chrome <fixture> (--snapshot <png> | --idle <seconds> | --frames <n>)";
    let (Some(path), Some(mode), Some(value)) = (args.first(), args.get(1), args.get(2)) else {
        panic!("{usage}");
    };
    let fixture = Fixture::read(std::path::Path::new(path))
        .unwrap_or_else(|why| panic!("deep-app --chrome: {why}"));
    let live = match mode.as_str() {
        "--snapshot" => Live::Snapshot(PathBuf::from(value)),
        "--idle" => Live::Idle(number(value, "--idle takes seconds")),
        "--frames" => Live::Frames(number(value, "--frames takes a count")),
        _ => panic!("{usage}"),
    };
    application().run(move |cx| {
        gpui_kit::init(cx);
        init(cx);
        deep_app::chrome_fixture::run(fixture, live, cx);
    });
}

fn number(arg: &str, what: &str) -> u64 {
    arg.parse().expect(what)
}
