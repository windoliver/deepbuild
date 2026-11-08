// Issue #124's marked audit panel (tests/acceptance/124/README.md, Fixtures): ../audit-clean/main.js with two wrongs
// the UI check must name: the icon-only button has no accessible name, and the line of words is a raw string key.
import { View, div, svg, v_flex, Button } from "@deepbuild/panel";

export default class AuditMarks extends View {
  render(cx) {
    const colors = cx.theme().colors;
    return v_flex()
      .id("audit-marks")
      .size_full()
      .p(12)
      .gap(8)
      .bg(colors.background)
      .text_color(colors.foreground)
      .child(Button.new("close").w(28).h(28).child(svg("icons/close.svg").size(16).text_color(colors.foreground)))
      .child(Button.new("words").w(120).h(28).child("Open the log"))
      .child(div().child("panel.actions.save_label"));
  }
}
