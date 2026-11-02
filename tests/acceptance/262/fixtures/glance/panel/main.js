// The test glance view's panel (#262, AC7): it draws the error rate its view binds and, when the rate is over 2%,
// marks it; this is the plug-in's only check for its notice kind. It reaches nothing outside the app.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";

export default class Glance extends View {
  init(props) {
    this.rate = props && props.values && props.values[0] ? props.values[0].value : null;
  }

  render(cx) {
    const over = typeof this.rate === "number" && this.rate > 2;
    return v_flex()
      .id("glance")
      .size_full()
      .p(8)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(div().child(over ? `Error rate ${this.rate}%: over 2%` : `Error rate ${this.rate ?? "—"}%`));
  }
}
