// The stocks panel, a gpui-shell script. Opened as a page from ⌘K, init gets props.page: { name, params }. It reaches
// nothing outside the app: prices and history come from the plug-in's sources, which the hub reads.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";

export default class Stocks extends View {
  init(props) {
    this.page = props && props.page ? props.page : null;
  }

  render(cx) {
    const symbol = this.page ? this.page.params.symbol : null;
    return v_flex()
      .id("stocks")
      .size_full()
      .p(8)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(div().child(symbol ? `${symbol}: 30-day chart` : "Watchlist"));
  }
}
