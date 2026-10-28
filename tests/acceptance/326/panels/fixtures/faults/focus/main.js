// #326 AC6, one fault: a registerView panel that moves focus without your gesture. Right after it
// mounts, with no input from anyone, a timer moves the keyboard onto the panel. panel@1 refuses it
// with a message that says "focus", and the window's focus stays where it was.
import { View, div } from "gpui-kit";

export default class Focus extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    cx.timer.after(1, () => {
      this.handle.focus();
    });
  }

  render() {
    return div()
      .id("focus-fixture")
      .size_full()
      .bg("#f5f5f4")
      .track_focus(this.handle)
      .child("focus fixture");
  }
}
