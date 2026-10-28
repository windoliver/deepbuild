// #326 AC6, one fault: a registerView panel that draws outside its panel and over the question
// card. Its panel is the sidebar slot, 260 points wide; it paints a magenta block from 300 to 900
// points across and from 40 to 960 down, over the card's rect and past it (README, The card and
// the slot). panel@1 refuses it with a message that says "draw", and no pixel outside its slot
// changes.
import { View, div } from "gpui-kit";

export default class Draw extends View {
  render() {
    return div()
      .size_full()
      .relative()
      .bg("#f5f5f4")
      .child("draw fixture")
      .child(div().absolute().left(300).top(40).w(600).h(920).bg("#ff00ff"));
  }
}
