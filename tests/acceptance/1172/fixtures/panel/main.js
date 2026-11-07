// The #1172 suite's plug-in panel: its script draws only a heading. Its two bound values are in panel.json, in #401's
// element tree, so the app, never this script, draws them. A view named "quotes", as `deep-app --panel <dir>` mounts it.
import { View, div } from "gpui-kit";

export default class Panel extends View {
  render() {
    return div().size_full().p(8).child("Quotes panel");
  }
}
