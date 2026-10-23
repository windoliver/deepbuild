//! `deep-replica --view <needs-you|sidebar|session> --out <dir>`: the replica. Opens the app's
//! shell headless at the reference window on gpui's virtual clock, draws the view over the
//! fixture record, and writes `snapshots/<view>.json` and `screens/<view>.png` under `out`.
//! A launch is timed from this process's spawn to the first-frame line it prints.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(replica::run());
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("deep-replica: the replica renders pixels on macOS only");
        std::process::exit(2);
    }
}

#[cfg(target_os = "macos")]
mod replica {

    use deep_app::views::Layout;
    use deep_replica::{shell::open_shell, snapshot::from_observed};
    use gpui_kit::test::TestWindowExt;

    pub fn run() -> i32 {
        let (view, out) = match deep_replica::view_args("deep-replica", "dir") {
            Ok(args) => args,
            Err(code) => return code,
        };

        let started = std::time::Instant::now();
        let mut phases = Vec::new();
        let mut phase =
            |name: &str| phases.push(format!("{name} {}ms", started.elapsed().as_millis()));
        let mut cx = deep_replica::headless_context();
        phase("context and init");
        deep_app::views::set_state(deep_replica::load_state());
        let layout = Layout::shipped(&view);
        let (handle, _) = cx.update(|cx| open_shell(&layout, cx, |_, _| {}));
        phase("window");
        // The first frame is the launch; the line goes out as soon as it is drawn. The second
        // frame, over cleared canvas items, is the one the snapshot reads.
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .expect("the window draws");
        println!("{}", deep_replica::FIRST_FRAME);
        std::io::Write::flush(&mut std::io::stdout()).expect("stdout flushes");
        phase("first frame");
        let snapshot = cx
            .update_window(handle, |_, window, cx| {
                deep_app::canvas::clear_items();
                window.render_frame(cx);
                from_observed(window)
            })
            .expect("the window draws");
        cx.run_until_parked();
        phase("frames");
        let image = cx
            .capture_screenshot(handle)
            .expect("offscreen rendering is available");
        phase("screenshot");

        std::fs::create_dir_all(out.join("snapshots")).expect("the output directory");
        std::fs::create_dir_all(out.join("screens")).expect("the output directory");
        std::fs::write(
            out.join("snapshots").join(format!("{view}.json")),
            serde_json::to_string_pretty(&snapshot.to_json()).expect("JSON"),
        )
        .expect("the snapshot is written");
        image
            .save(out.join("screens").join(format!("{view}.png")))
            .expect("the screenshot is written");
        phase("written");
        eprintln!("deep-replica phases: {}", phases.join(", "));
        println!(
            "replica {view}: {} nodes, {} canvas items, {}x{} screenshot",
            snapshot.flatten().len(),
            snapshot.items.len(),
            image.width(),
            image.height()
        );
        0
    }
}
