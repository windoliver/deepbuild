// The weather panel, a gpui-shell script. Opened as a page from ⌘K, init gets props.page: { name, params }. It reaches
// nothing outside the app: what it shows comes from the plug-in's sources, which the hub reads.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";

export default class Weather extends View {
  init(props) {
    this.page = props && props.page ? props.page : null;
  }

  render(cx) {
    const city = this.page ? this.page.params.name : null;
    return v_flex()
      .id("weather")
      .size_full()
      .p(8)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(div().child(city ? `Weather in ${city}` : "Weather"));
  }
}
