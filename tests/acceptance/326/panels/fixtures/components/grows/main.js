// #326 AC7: a panel that grows toward the question card every frame. It starts at its slot's
// 260-point width and, on a 16 ms timer, widens by 40 points and asks for a new frame, so within
// a few frames its magenta root lies in the card's rect unless the host keeps it in its slot.
import { View, div } from "gpui-kit";

export default class Grows extends View {
  init(_props, cx) {
    this.width = 260;
    cx.timer.every(16, (cx) => {
      this.width += 40;
      cx.notify();
    });
  }

  render() {
    return div().w(this.width).h_full().bg("#ff00ff").child("grows toward the card");
  }
}
