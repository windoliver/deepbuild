// The planted twin for #1998's AC2 (README, Criterion to tests): an app with a Settings page. A view registers a page
// named "Settings", one per section; mounted as the view it reads "Preferences view", and mounted as that page it reads
// "Settings page: <section>". Nothing here reaches outside the app.
import { View, div, v_flex } from "@deepbuild/panel";

export default class SettingsTwin extends View {
  init(props) {
    this.page = props && props.page ? props.page : null;
  }

  render(cx) {
    const section = this.page && this.page.params ? this.page.params.section : undefined;
    const text = this.page ? `Settings page: ${section ?? "(none)"}` : "Preferences view";
    return v_flex()
      .id("settings-twin")
      .size_full()
      .p(8)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(div().child(text));
  }
}
