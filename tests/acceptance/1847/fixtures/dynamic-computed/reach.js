

const toolkit = "gpui-" + "kit";

export async function reach() {
  return import(toolkit);
}
