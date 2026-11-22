// #1847 AC1 planted: a dynamic import whose module name is a template literal naming the toolkit, on line 4.
// Nothing calls it while the panel loads, so a loader that doesn't read this spelling loads the panel.
export async function reach() {
  return import(`gpui-kit`);
}
