// #326 AC5: a panel package whose gpui-shell manifest lists a Git dependency. gpui-shell fetches a
// manifest's Git dependencies when it loads the package, before any policy applies; DeepBuild
// refuses the package at install, naming `pad-326`, and loading it reaches no host. The test
// copies this folder and writes its listener's port over __PORT__ in gpui-shell.json.
import { View, div } from "gpui-kit";
import pad from "pad-326";

export default class Fetched extends View {
  render() {
    return div().size_full().child(String(pad));
  }
}
