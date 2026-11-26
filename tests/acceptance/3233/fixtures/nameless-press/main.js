// #3233 AC2 and AC5: a div that takes a press and holds no text. It takes focus, sets no color and stays in its panel,
// so the one thing wrong with it is that nothing says what the press does. named-press is the same panel with the text.
// The script holds a name it never draws: the count starts at 0 and only grows, so the tree it builds has no text
// under the press, and only a check that reads the tree sees that.
import { View, div, v_flex } from "@deepbuild/panel";

export default class NamelessPress extends View {
  init(_props, cx) {
    this.refreshed = 0;
    this.handle = cx.focus_handle();
  }

  render() {
    const name = this.refreshed < 0 ? "Refresh" : null;
    const press = div()
      .id("refresh-control")
      .w(120)
      .h(28)
      .track_focus(this.handle)
      .on_click((_event, cx) => {
        this.refreshed += 1;
        cx.notify();
      });
    return v_flex()
      .size_full()
      .child(div().child(`Refreshed ${this.refreshed}`))
      .child(name ? press.child(name) : press);
  }
}
