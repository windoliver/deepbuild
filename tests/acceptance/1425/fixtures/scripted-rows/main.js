// #1425 AC7: a list whose rows are drawn by script, its render callback called per visible row on every frame
// (gpui-kit's list), the rule the panel runtime keeps: a list takes its rows as data.
import { View, div, list } from "@deepbuild/panel";

export default class ScriptedList extends View {
  render() {
    return list(
      "rows",
      1000,
      (index) => `row-${index}`,
      (index) => div().h(24).child(`row ${index}`),
    ).size_full();
  }
}
