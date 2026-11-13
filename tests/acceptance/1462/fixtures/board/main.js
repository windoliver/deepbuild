// The #1462 suite's plug-in view (README, The fixtures). The replica mounts it with `launch.panel`, and `launch.view`
// registers its page `Board` (one per board name) and its command `Refresh board` as `deep.registerView` gives them.
// Mounted as the view it reads "Installed board panel"; mounted as one of its pages it reads "Board page: <name>".
// It reaches nothing outside the app.
import { View, div, v_flex } from "@deepbuild/panel";

export default class Board extends View {
  init(props) {
    this.page = props && props.page ? props.page : null;
  }

  render() {
    const name = this.page && this.page.params ? this.page.params.name : undefined;
    return v_flex()
      .size_full()
      .p(8)
      .child(div().child(this.page ? `Board page: ${name ?? "(none)"}` : "Installed board panel"));
  }
}
