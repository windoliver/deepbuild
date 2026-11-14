// The #1462 suite's plug-in view that fails its kit (README, The fixtures): it imports the toolkit itself and its
// Dialog, which draws outside its parent and could cover the question card, so `panel@1` refuses it and the app's
// loader refuses it again at load, naming the module (#1425). Were it mounted anyway it would draw one line.
import { View, div } from "gpui-kit";
import { Dialog, v_flex } from "gpui-base";

export default class Refused extends View {
  render() {
    const covers = Dialog;
    return v_flex()
      .id(covers ? "overlay" : "plain")
      .size_full()
      .p(8)
      .child(div().child("Refused board panel"));
  }
}
