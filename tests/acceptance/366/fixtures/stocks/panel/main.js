// The test stocks view's panel (#366, README: Fixtures). Mounted as the view, it reads "Watchlist"; mounted as one of
// the view's pages, it is given that page as `props.page` ({ name, params }) and reads "Stock page: <symbol>", or
// "Stock page: (none)" when the page came with no symbol. It reaches nothing outside the app.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";

export default class Stocks extends View {
  init(props) {
    this.page = props && props.page ? props.page : null;
  }

  render(cx) {
    const symbol = this.page && this.page.params ? this.page.params.symbol : undefined;
    const text = this.page ? `Stock page: ${symbol ?? "(none)"}` : "Watchlist";
    return v_flex()
      .id("stocks")
      .size_full()
      .p(8)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(div().child(text));
  }
}
