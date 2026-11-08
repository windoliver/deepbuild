// Issue #124's clean audit panel (tests/acceptance/124/README.md, Fixtures): everything the UI check audits, done
// right, with the marks of ../audit-marks/main.js put right. An icon-only button named "Close", a text button that
// needs no name of its own, and a line of words.
import { View, div, svg, v_flex, Button } from "@deepbuild/panel";
import { SAVE } from "./words.js";

export default class AuditClean extends View {
  render(cx) {
    const colors = cx.theme().colors;
    return v_flex()
      .id("audit-clean")
      .size_full()
      .p(12)
      .gap(8)
      .bg(colors.background)
      .text_color(colors.foreground)
      .child(Button.new("close").accessibility_label("Close").w(28).h(28).child(svg("icons/close.svg").size(16).text_color(colors.foreground)))
      .child(Button.new("words").w(120).h(28).child("Open the log"))
      .child(div().child(SAVE));
  }
}
