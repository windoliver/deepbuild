// Saved journeys (#37): a journey that passes is saved as a replayable script, plain Playwright and never a
// DeepBuild language, each step finding its control by role and name, label or test ID within its named container,
// never by a CSS path. Its typed and observed values are scrubbed as evidence is. The journey file it came from
// rides along in a comment, scrubbed the same way, so a replay runs the same steps against another stack.
import { scrubValues } from '@deepbuild/evidence';
import { parse } from 'yaml';
import type { Action, DriverLocator, Expect, Journey } from './journey.js';

const js = (v: unknown): string => JSON.stringify(v);
/** A locator as Playwright code, within its container first. */
function locatorCode(l: DriverLocator, scope = 'page'): string {
  const base = l.container ? locatorCode(l.container, scope) : scope;
  if (l.testId) return `${base}.getByTestId(${js(l.testId)})`;
  if (l.label) return `${base}.getByLabel(${js(l.label)})`;
  if (l.role) return `${base}.getByRole(${js(l.role)}${l.name === undefined ? '' : `, { name: ${js(l.name)} }`})`;
  return `${base}.getByLabel(${js(l.name ?? '')}, { exact: true })`;
}
const actionCode = (a: Action, scrub: (s: string) => string): string => {
  if (a.goto !== undefined) return `await page.goto(${js(a.goto)});`;
  if (a.click) return `await ${locatorCode(a.click)}.click();`;
  if (a.fill) return a.secret !== undefined ? `await ${locatorCode(a.fill)}.fill(secret(${js(a.secret)}));` : `await ${locatorCode(a.fill)}.fill(${js(scrub(a.text ?? ''))});`;
  if (a.scrollIntoView) return `await ${locatorCode(a.scrollIntoView)}.scrollIntoViewIfNeeded();`;
  if (a.hover) return `await ${locatorCode(a.hover)}.hover();`;
  if (a.press !== undefined) return `await page.keyboard.press(${js(a.press)});`;
  if (a.wait !== undefined) return `await page.waitForTimeout(${a.wait});`;
  return '';
};
const expectCode = (e: Expect, scrub: (s: string) => string): string => {
  if (e.until) return `await expect(async () => { expect(String(await page.evaluate(${js(e.until.evaluate)}))).toBe(${js(e.until.equals)}); }).toPass();`;
  if (!e.locator) return '';
  if (e.visible === false) return `await expect(${locatorCode(e.locator)}).toBeHidden();`;
  if (e.text !== undefined) return `await expect(${locatorCode(e.locator)}).toContainText(${js(scrub(e.text))});`;
  return `await expect(${locatorCode(e.locator)}).toBeVisible();`;
};
const MARK = 'deepbuild:journey';

/** The script, from the journey and the file it was read from; values typed or observed are scrubbed by the run's secrets. */
export function saveScript(journey: Journey, text: string, secrets: Record<string, string>): string {
  const marks = { env: secrets, held: Object.values(secrets).filter(Boolean) };
  const scrub = (s: string): string => (marks.held.length ? scrubValues(s, marks) : s);
  const lines = [
    `// ${journey.id}: a saved journey, a plain Playwright script. Values are scrubbed as evidence is.`,
    `import { expect, test } from '@playwright/test';`,
    `const secret = (name) => process.env[\`DEEP_JOURNEY_SECRET_\${name}\`];`,
    `test(${js(journey.id)}, async ({ page }) => {`,
  ];
  for (const s of journey.steps) {
    lines.push(`  // step ${s.id} (deadline ${s.deadlineMs} ms)`);
    for (const a of s.actions) lines.push(`  ${actionCode(a, scrub)}`);
    for (const e of s.expects) lines.push(`  ${expectCode(e, scrub)}`);
    if (s.request) lines.push(`  await page.request.fetch(${js(s.request.path)}, { method: ${js(s.request.method)}${s.request.body === undefined ? '' : `, data: ${js(s.request.body)}`} });`);
  }
  for (const c of journey.endState) {
    if (c.oracle !== 'code' || !c.driverLocator) continue;
    lines.push(`  // end state ${c.id}`);
    lines.push(c.text !== undefined ? `  await expect(${locatorCode(c.driverLocator)}).toContainText(${js(scrub(c.text))});` : c.visible === false ? `  await expect(${locatorCode(c.driverLocator)}).toBeHidden();` : `  await expect(${locatorCode(c.driverLocator)}).toBeVisible();`);
  }
  lines.push('});', '', `/* ${MARK}`, scrub(text).replace(/\*\//g, '* /'), '*/', '');
  return lines.join('\n');
}
/** The journey a saved script carries, as its file's data; null when it carries none. */
export function embeddedJourney(script: string): { id: string; doc: Record<string, unknown> } | null {
  const m = new RegExp(`/\\* ${MARK}\\n([\\s\\S]*?)\\n\\*/`).exec(script);
  if (!m) return null;
  const doc = parse(m[1]!) as Record<string, unknown> | null;
  return doc && typeof doc.journey === 'string' ? { id: doc.journey, doc } : null;
}
