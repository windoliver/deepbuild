//! AC3 #1454.a94aca43, the refused panel, redrafted blind: that the fixture is what its window tests need. With no
//! window, so it runs on a locked screen: `panel@1` refuses it for its Dialog, and the app's own runtime still loads it
//! and paints its words in the shell's sidebar slot. So its absence from a window means the kit kept it out, and a
//! program that mounts it anyway shows it. README.md here says why each half needs its own test.
//!
//! Wired into deep-replica by one `[[test]]` entry (README, Pinned 3), and run from the checkout with:
//!     cargo test --locked -p deep-replica --test acceptance_1454_panel_redraft

#[path = "../../../326/panels/common.rs"]
mod common;

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_1454_panel_redraft: INCONCLUSIVE; the headless app needs macOS, so nothing ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::path::{Path, PathBuf};

    use deep_replica::{headless_context, kit, shell, SCALE};
    use gpui_kit::*;

    use super::common::{self, capture, card_bounds, Scratch};

    /// main.js's two colors: the panel's own background, and its words, which nothing else on the window uses.
    const PAPER: [u8; 3] = [0xfe, 0xf3, 0xc7];
    const INK: [u8; 3] = [0x7c, 0x2d, 0x12];
    const WORDS: &str = "Refused overlay panel";
    /// The imports the fixture needs, and the same names from the module `kit::panel` can't tell from it.
    const LINKS: &str =
        "import { v_flex } from \"gpui-base\";\nimport { Dialog } from \"gpui-component\";";
    const NEVER_LINKS: &str = "import { Dialog, v_flex } from \"gpui-base\";";

    fn fixture() -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/acceptance/1454/panel-redraft/fixtures/refused/panel/main.js");
        std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
    }

    /// `source` as a panel in a scratch folder: gpui-shell writes its typings into any folder it loads.
    fn panel(scratch: &Scratch, source: &str) -> PathBuf {
        let dir = scratch.0.join("panel");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.js"), source).unwrap();
        dir
    }

    /// The fixture with `from` replaced by `to`, which must be in it.
    fn changed(from: &str, to: &str) -> String {
        let source = fixture();
        assert!(source.contains(from), "main.js no longer holds {from:?}");
        source.replace(from, to)
    }

    /// Why the app's runtime can't load the panel in `dir`, or none when it mounts.
    fn load_error(dir: &Path) -> Option<String> {
        struct Empty;
        impl Render for Empty {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div()
            }
        }
        let mut cx = headless_context();
        let runtime = deep_app::new_runtime().expect("the panel runtime");
        let mut error = None;
        cx.update(|cx| {
            open_window(shell::window_options(), cx, |window, cx| {
                error = deep_app::mount_panel(&runtime, dir, window, cx)
                    .err()
                    .map(|error| format!("{error:#}"));
                cx.new(|_| Empty)
            })
            .expect("a window opens")
        });
        error
    }

    /// Device pixels of each color inside the sidebar's slot, with the panel in `dir` mounted there, past install.
    fn drawn(dir: &Path) -> (usize, usize) {
        let mut cx = headless_context();
        let (handle, slot) = cx.update(|cx| shell::open_with_card(cx, card_bounds(), Some(dir)));
        common::settle(&mut cx, handle, 320);
        let shot = capture(&mut cx, handle);
        let side = |value: Pixels| (f32::from(value) * SCALE) as u32;
        let [x0, y0] = [side(slot.origin.x), side(slot.origin.y)];
        let [x1, y1] = [x0 + side(slot.size.width), y0 + side(slot.size.height)];
        let near = |pixel: [u8; 4], color: [u8; 3], by: u8| {
            (0..3).all(|i| pixel[i].abs_diff(color[i]) <= by)
        };
        let mut seen = (0, 0);
        for y in y0..y1.min(shot.height) {
            for x in x0..x1.min(shot.width) {
                let pixel = shot.pixel(x, y);
                seen.0 += near(pixel, PAPER, 4) as usize;
                seen.1 += near(pixel, INK, 48) as usize;
            }
        }
        seen
    }

    fn the_kit_refuses_the_fixture_for_its_dialog() {
        let scratch = Scratch::new();
        let verdict = kit::panel(&panel(&scratch, &fixture()));
        assert!(
            !verdict.pass,
            "panel@1 passed the fixture, so a window without it proves nothing"
        );
        let names = verdict.names.unwrap_or_default();
        assert!(
            names.contains("panel@1"),
            "the refusal doesn't name the kit: {names}"
        );
        assert!(
            names.contains("Dialog"),
            "refused for something else than its Dialog: {names}"
        );
    }

    fn the_fixture_loads_and_paints_its_words_in_the_sidebar_slot() {
        let scratch = Scratch::new();
        let dir = panel(&scratch, &fixture());
        assert_eq!(
            load_error(&dir),
            None,
            "the app's runtime can't load the fixture"
        );
        let (paper, ink) = drawn(&dir);
        assert!(
            paper > 10_000,
            "the panel's background isn't in the slot: {paper} px, so its render didn't draw"
        );
        assert!(
            ink > 100,
            "the panel's words aren't in the slot: {ink} px of their color"
        );
    }

    /// What the ink count above reads: the same panel with no words leaves none of their color.
    fn wrong_fixture_with_no_words_paints_no_ink() {
        let scratch = Scratch::new();
        let dir = panel(&scratch, &changed(WORDS, " "));
        let (paper, ink) = drawn(&dir);
        assert!(
            paper > 10_000,
            "the panel's background isn't in the slot: {paper} px"
        );
        assert_eq!(
            ink, 0,
            "{ink} px of the words' color with no words, so that count reads something else"
        );
    }

    /// Why the kit's refusal can't stand for the load: it reads the imported name, so it refuses a script that can't
    /// run at all just the same, and a window without that script would prove nothing.
    fn wrong_fixture_dialog_from_gpui_base_is_refused_and_never_loads() {
        let scratch = Scratch::new();
        let dir = panel(&scratch, &changed(LINKS, NEVER_LINKS));
        assert!(
            !kit::panel(&dir).pass,
            "panel@1 passed a panel that imports Dialog"
        );
        let error = load_error(&dir).expect("gpui-base has no Dialog, so this script doesn't link");
        assert!(
            error.contains("Dialog"),
            "it failed to load for another reason: {error}"
        );
    }

    pub fn run() -> i32 {
        common::run(&[
            (
                "the_kit_refuses_the_fixture_for_its_dialog",
                the_kit_refuses_the_fixture_for_its_dialog,
            ),
            (
                "the_fixture_loads_and_paints_its_words_in_the_sidebar_slot",
                the_fixture_loads_and_paints_its_words_in_the_sidebar_slot,
            ),
            (
                "wrong_fixture_with_no_words_paints_no_ink",
                wrong_fixture_with_no_words_paints_no_ink,
            ),
            (
                "wrong_fixture_dialog_from_gpui_base_is_refused_and_never_loads",
                wrong_fixture_dialog_from_gpui_base_is_refused_and_never_loads,
            ),
        ])
    }
}
