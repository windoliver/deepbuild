// #3233 AC3: a panel that sets only text_color, to #cccccc, and no bg anywhere, so the fill under its text is the
// shipped look's. Nothing takes a press. The color is built when the script runs.
import { View, div } from "@deepbuild/panel";

const hex = (pair) => `#${pair.repeat(3)}`;

export default class TextColorOnly extends View {
  render() {
    return div().size_full().text_color(hex("cc")).child("Status");
  }
}
