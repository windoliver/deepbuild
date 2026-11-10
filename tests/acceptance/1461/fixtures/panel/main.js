// The #1461 suite's test panel (AC8, AC29): a plug-in's view that draws one line naming itself, "Test panel", and
// "Test panel page" when it is opened as a page (given `props.page`). It reaches nothing outside its panel. Written in
// the form #1172's fixture panel has (tests/acceptance/1172/fixtures/panel), importing only `@deepbuild/panel`.
import { View, div } from "@deepbuild/panel";

export default class Panel extends View {
  init(props) {
    this.page = props && props.page ? props.page : null;
  }

  render() {
    return div().size_full().p(8).child(this.page ? "Test panel page" : "Test panel");
  }
}
