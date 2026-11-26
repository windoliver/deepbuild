// #3233 AC2 and AC4: the twin that loads. The same div as nameless-press holding the text "Refresh", and the same div as
// pointer-only with focus: it takes a press, has a name and takes focus. Its press counts, and the count is drawn, so
// a key that runs the handler shows in the tree. It differs from nameless-press in one sign: here the name is drawn.
import { View, div, v_flex } from "@deepbuild/panel";

export default class NamedPress extends View {
  init(_props, cx) {
    this.refreshed = 0;
    this.handle = cx.focus_handle();
  }

  render() {
    const name = this.refreshed >= 0 ? "Refresh" : null;
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
