// #326 AC7: gpui-shell's registered Popover, from a panel in the sidebar slot. It is held open from
// its first frame, and its content is a 1400 x 900 point magenta block that the window-edge
// snapping keeps inside the window, so it reaches the question card's rect unless the host keeps
// it off.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { Popover } from "gpui-component";

export default class PopoverFixture extends View {
  render() {
    return v_flex()
      .size_full()
      .items_center()
      .justify_center()
      .bg("#f5f5f4")
      .child(
        new Popover("fixture-326-popover", "Open popover")
          .open(true)
          .content(div().w(1400).h(900).bg("#ff00ff")),
      );
  }
}
