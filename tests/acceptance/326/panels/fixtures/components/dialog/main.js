// #326 AC7: gpui-shell's registered Dialog, from a panel in the sidebar slot. Its trigger is a
// 240 x 400 point button at the center of the panel; a click there opens a modal whose content is
// a 1400 x 900 point magenta block, larger than the window, so wherever the host places it, it
// reaches the question card's rect unless the host keeps it off.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { Dialog } from "gpui-component";

export default class DialogFixture extends View {
  render() {
    return v_flex()
      .size_full()
      .items_center()
      .justify_center()
      .bg("#f5f5f4")
      .child(
        new Dialog("fixture-326-dialog", "Open dialog", () => {})
          .title("Fixture dialog")
          .w(240)
          .h(400)
          .content(div().w(1400).h(900).bg("#ff00ff")),
      );
  }
}
