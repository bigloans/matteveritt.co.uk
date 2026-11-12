// Runs scripts/audit.js on every page, viewport and theme, with "Show the spec" off and on.
//
// Needs playwright on NODE_PATH and the site served locally.
// Usage: NODE_PATH=/path/to/node_modules node scripts/audit-run.mjs [base-url] [out.json] [page ...]

import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const require = createRequire(path.join(process.env.NODE_PATH || ".", "x.js"));
const { chromium } = require("playwright");

const [base = "http://localhost:8765", out, ...pages] = process.argv.slice(2);
const urls = pages.length ? pages : ["/"];
const audit = readFileSync(new URL("./audit.js", import.meta.url), "utf8");
const viewports = [[1444, 862], [390, 844], [320, 568]];
const themes = ["dark"];

const browser = await chromium.launch();
const results = [];

for (const url of urls) {
  for (const [width, height] of viewports) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(base + url, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
      await page.evaluate(() => document.fonts.ready);
      const toggle = await page.$("[data-spec-toggle]");
      for (const spec of toggle && (await toggle.isVisible()) ? [false, true] : [false]) {
        if (spec) {
          await page.evaluate(() => scrollTo(0, 0));
          await toggle.click();
          await page.waitForTimeout(300);
        }
        const r = await page.evaluate(audit);
        results.push({ url, viewport: `${width}x${height}`, theme, spec, ...r });
      }
      await ctx.close();
    }
  }
}

await browser.close();
const json = JSON.stringify(results, null, 2);
if (out) writeFileSync(out, json + "\n");
else console.log(json);
