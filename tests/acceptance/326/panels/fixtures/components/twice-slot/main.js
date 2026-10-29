// #326 AC7: a panel whose layout asks for twice its slot. Its slot is the sidebar, 260 points
// wide; its root asks for 520, painted magenta, so its right half lies in the question card's rect
// unless the host keeps it in its slot.
import { View, div } from "gpui-kit";

export default class TwiceSlot extends View {
  render() {
    return div().w(520).h_full().bg("#ff00ff").child("twice its slot");
  }
}
