// The #1454 suite's installed panel. Mounted as the view it reads "Installed board panel"; mounted as one of the view's
// pages it is given that page as `props.page` ({ name, params }) and reads "Board page: <name>", or "Board page: (none)"
// when the page came with no name. It reaches nothing outside the app.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";

export default class Board extends View {
  init(props) {
    this.page = props && props.page ? props.page : null;
  }

  render(cx) {
    const name = this.page && this.page.params ? this.page.params.name : undefined;
    const text = this.page ? `Board page: ${name ?? "(none)"}` : "Installed board panel";
    return v_flex()
      .id("board")
      .size_full()
      .p(8)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(div().child(text));
  }
}
