//! `--chrome <fixture> [--reduce-motion] (--snapshot <png> | --idle <seconds> | --frames <n> | --after-first <s>)`
//! (#1434, #1436): the chrome@1 fixture as the app's real window's content, one report line, then quit. In a
//! chrome-fixture build only.

use std::path::PathBuf;

use deep_app::chrome_fixture::{Fixture, Live};
use deep_app::init;
use gpui_kit::*;

pub fn run(mut args: Vec<String>) {
    let usage = "usage: deep-app --chrome <fixture> [--reduce-motion] (--snapshot <png> | --idle <seconds> | --frames <n> | --after-first <s>)";
    let reduce_motion = args.iter().any(|a| a == "--reduce-motion");
    args.retain(|a| a != "--reduce-motion");
    let (Some(path), Some(mode), Some(value)) = (args.first(), args.get(1), args.get(2)) else {
        panic!("{usage}");
    };
    let fixture = Fixture::read(std::path::Path::new(path))
        .unwrap_or_else(|why| panic!("deep-app --chrome: {why}"));
    let live = match mode.as_str() {
        "--snapshot" => Live::Snapshot(PathBuf::from(value)),
        "--idle" => Live::Idle(number(value, "--idle takes seconds")),
        "--frames" => Live::Frames(number(value, "--frames takes a count")),
        "--after-first" => Live::AfterFirst(value.parse().expect("--after-first takes seconds")),
        _ => panic!("{usage}"),
    };
    application().run(move |cx| {
        gpui_kit::init(cx);
        init(cx);
        cx.set_reduce_motion(reduce_motion);
        deep_app::chrome_fixture::run(fixture, live, cx);
    });
}

fn number(arg: &str, what: &str) -> u64 {
    arg.parse().expect(what)
}
