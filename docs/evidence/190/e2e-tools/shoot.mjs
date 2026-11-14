// Saves the e2e page's screenshots with Playwright's own Chromium: `node shoot.mjs <out dir>`, from inside the repo
// (Node resolves `playwright` from the repo's node_modules), with server.mjs serving on 127.0.0.1:41190.
import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:41190/');
await page.waitForSelector('body[data-done="1"]', { timeout: 120000 });
console.log(await page.evaluate(() => navigator.userAgent));
await page.screenshot({ path: `${out}/00-full-page.png`, fullPage: true });
const runs = await page.$$('.run');
const names = ['01-maze-browser-vs-app', '02-chase-browser-vs-app', '03-corner-cutter-own-fixture', '04-grid-path-fixture'];
for (const [i, r] of runs.entries()) await r.screenshot({ path: `${out}/${names[i]}.png` });
await (await page.$('#repliesbox')).screenshot({ path: `${out}/05-deep-logic-replies.png` });
await (await page.$('#plantedbox')).screenshot({ path: `${out}/06-planted-twins.png` });
await browser.close();
