// #3233 AC4: a div that takes a press and can't take focus. It holds the text "Refresh" and sets no color, so the one
// thing wrong with it is that only a pointer reaches its press. named-press is the same panel with focus. The script
// makes a focus handle it never gives the div, so only a check that reads the tree sees that the div can't take focus.
import { View, div, v_flex } from "@deepbuild/panel";

export default class PointerOnly extends View {
  init(_props, cx) {
    this.refreshed = 0;
    this.handle = cx.focus_handle();
  }

  render() {
    const name = this.refreshed >= 0 ? "Refresh" : null;
    const bare = div()
      .id("refresh-control")
      .w(120)
      .h(28)
      .on_click((_event, cx) => {
        this.refreshed += 1;
        cx.notify();
      });
    const press = this.refreshed < 0 ? bare.track_focus(this.handle) : bare;
    return v_flex()
      .size_full()
      .child(div().child(`Refreshed ${this.refreshed}`))
      .child(name ? press.child(name) : press);
  }
}
