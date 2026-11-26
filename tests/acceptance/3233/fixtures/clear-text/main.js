// #3233 AC3: the twin that loads. The same panel as faint-text with the text #595959 on its bg of #ffffff, each color
// built when the script runs.
import { View, div } from "@deepbuild/panel";

const hex = (pair) => `#${pair.repeat(3)}`;

export default class ClearText extends View {
  render() {
    return div().size_full().bg(hex("ff")).text_color(hex("59")).child("Status");
  }
}
