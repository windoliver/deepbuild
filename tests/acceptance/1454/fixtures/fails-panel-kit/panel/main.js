// `panel@1` refuses this panel: it uses Dialog, which gpui-shell draws outside its parent, where it could cover the
// question card (crates/deep-replica/src/kit.rs, OVERLAYS; docs/extension-guide.md, the planted fill covers-the-card).
// It would otherwise draw one line, so a program that mounts it anyway shows that line on the window's pixels.
import { View, div } from "gpui-kit";
import { Dialog, v_flex } from "gpui-base";

export default class Overlay extends View {
  render(cx) {
    const covers = Dialog;
    return v_flex()
      .id(covers ? "overlay" : "plain")
      .size_full()
      .p(8)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(div().child("Refused overlay panel"));
  }
}
