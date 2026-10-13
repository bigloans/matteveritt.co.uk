// Captures full-page screenshots of each page at desktop and mobile in both themes.
//
// Needs playwright on NODE_PATH and the site served locally.
// Usage: NODE_PATH=/path/to/node_modules node scripts/screenshots.mjs [base-url] [out-dir] [--spec] [page ...]

import { createRequire } from "module";
import { mkdirSync } from "fs";
import path from "path";

const require = createRequire(path.join(process.env.NODE_PATH || ".", "x.js"));
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const spec = args.includes("--spec");
const [base = "http://localhost:8765", out = "shots", ...pages] = args.filter((a) => a !== "--spec");
const urls = pages.length ? pages : ["/", "/work/replacing-the-component-library/", "/work/visual-rules-for-agents/", "/work/design-system-with-agents/", "/spec/"];
const slug = (u) => u.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "home";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const url of urls) {
  for (const [width, height] of [[1444, 862], [390, 844]]) {
    for (const theme of ["dark"]) {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(base + url, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      let name = `${slug(url)}-${width}-${theme}`;
      if (spec) {
        await page.click("[data-spec-toggle]");
        await page.waitForTimeout(400);
        name += "-spec";
      }
      await page.screenshot({ path: path.join(out, name + ".png"), fullPage: !spec });
      if (spec) await page.screenshot({ path: path.join(out, name + "-full.png"), fullPage: true });
      await ctx.close();
    }
  }
}
await browser.close();
console.log(`Saved to ${out}`);
