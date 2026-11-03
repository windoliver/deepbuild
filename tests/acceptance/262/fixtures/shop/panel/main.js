// The test shop view's panel (#262). It draws the values its view binds, which the hub resolves, and a Read now
// button that calls the plug-in's ext.shop.read_now action. It reaches nothing outside the app.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";

export default class Board extends View {
  init(props) {
    this.values = props && props.values ? props.values : [];
  }

  render(cx) {
    return v_flex()
      .id("board")
      .size_full()
      .p(8)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(div().child(this.values.map((v) => `${v.handle}: ${v.shown}`).join("\n")))
      .child(div().id("read-now").child("Read now").on_click(() => cx.action("ext.shop.read_now", { view: cx.view() })));
  }
}
