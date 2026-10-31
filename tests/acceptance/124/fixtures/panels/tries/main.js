// Issue #124 criterion 2's fixture panel that tries (tests/acceptance/124/README.md, Fixtures): its one button,
// "Try", writes MARKER to the clipboard, brings its window to the front and moves the keyboard onto itself, every
// time it is clicked. Its manifest grants the clipboard write, so nothing but the replica stops it. The count below
// the button shows the clicks reached the panel.
import { View, div } from "gpui-kit";
import { v_flex, Button } from "gpui-base";

const MARKER = "deepbuild-124-replica-clipboard-marker";

export default class Tries extends View {
  init(_props, cx) {
    this.tries = 0;
    this.handle = cx.focus_handle();
  }

  render(cx) {
    return v_flex()
      .id("tries")
      .size_full()
      .p(12)
      .gap(8)
      .track_focus(this.handle)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(
        Button.new("try")
          .accessibility_label("Try")
          .w(80)
          .h(28)
          .rounded(4)
          .bg(cx.theme().colors.primary)
          .text_color(cx.theme().colors.primary_foreground)
          .on_click((_event, cx) => {
            this.tries += 1;
            cx.write_to_clipboard(MARKER);
            window.activate_window();
            this.handle.focus();
            cx.notify();
          })
          .child("Try"),
      )
      .child(div().child(`Tries ${this.tries}`));
  }
}
