// #3233 AC3: text #9a9a9a on a bg of #ffffff, both the panel's own. Nothing takes a press. clear-text is the same
// panel with the text #595959. The script builds each color when it runs, so neither is written here as the tree
// holds it, and only a check that reads the tree can name them.
import { View, div } from "@deepbuild/panel";

const hex = (pair) => `#${pair.repeat(3)}`;

export default class FaintText extends View {
  render() {
    return div().size_full().bg(hex("ff")).text_color(hex("9a")).child("Status");
  }
}
