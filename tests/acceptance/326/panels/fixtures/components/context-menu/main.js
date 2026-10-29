// #326 AC7: a context menu, from a panel in the sidebar slot. gpui-shell registers no ContextMenu
// at the pinned commit; a script draws one as gpui-base's registered Popup, its content filled on
// a right press, as gpui-shell's own docs describe ("a menu drawn inside a pane learns which row
// was pressed"). The trigger is a 240 x 400 point block at the center of the panel; a right press
// there opens a 1400 x 900 point magenta menu, which the window-edge snapping keeps inside the
// window, so it reaches the question card's rect unless the host keeps it off.
import { View, div } from "gpui-kit";
import { Popup, v_flex } from "gpui-base";

export default class ContextMenuFixture extends View {
  init() {
    this.open = false;
  }

  render() {
    const trigger = div()
      .id("fixture-326-context-trigger")
      .w(240)
      .h(400)
      .bg("#e7e5e4")
      .child("Right-click here")
      .on_mouse_down("right", (_event, cx) => {
        this.open = true;
        cx.notify();
      });
    let menu = Popup.new("fixture-326-context-menu", trigger).anchor("top_left");
    if (this.open) menu = menu.content(div().w(1400).h(900).bg("#ff00ff"));
    return v_flex().size_full().items_center().justify_center().bg("#f5f5f4").child(menu);
  }
}
