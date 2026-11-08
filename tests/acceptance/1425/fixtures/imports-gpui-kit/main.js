// #1425 AC2: a panel that names the toolkit under DeepBuild's module instead of importing @deepbuild/panel.
// Its one import, on line 3, is the fault; the toolkit resolves it, so a loader with no check runs it.
import { View, div } from "gpui-kit";

export default class NamesTheToolkit extends View {
  render() {
    return div().size_full().p(8).child("names the toolkit");
  }
}
