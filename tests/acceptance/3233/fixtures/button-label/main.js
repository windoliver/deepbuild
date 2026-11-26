// #3233 AC2: a Button whose only label is "button". Its id and the text under it are both that word, its kind's own,
// and nothing else names it. It takes focus and sets no color.
import { View, v_flex, Button } from "@deepbuild/panel";

export default class ButtonLabel extends View {
  init(_props, cx) {
    this.pressed = 0;
    this.handle = cx.focus_handle();
  }

  render() {
    return v_flex()
      .size_full()
      .child(
        Button.new("button")
          .w(120)
          .h(28)
          .track_focus(this.handle)
          .on_click((_event, cx) => {
            this.pressed += 1;
            cx.notify();
          })
          .child("button"),
      );
  }
}
