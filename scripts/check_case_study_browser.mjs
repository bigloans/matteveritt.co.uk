// Browser checks for the case study page.
//
// Needs playwright-core and axe-core on NODE_PATH, and a Chromium binary in CHROME.
// Usage: CHROME=/path/to/chrome NODE_PATH=/path/to/node_modules node scripts/check_case_study_browser.mjs [page.html] [shots-dir]

import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";

const require = createRequire(path.join(process.env.NODE_PATH || ".", "x.js"));
const { chromium } = require("playwright-core");
const axeSource = require("fs").readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const page = path.resolve(process.argv[2] || "index.html");
const shots = process.argv[3];
const url = pathToFileURL(page).href;
let failed = false;

const browser = await chromium.launch({ executablePath: process.env.CHROME });

// With JS disabled, every section and reveal block must be visible.

{
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const p = await ctx.newPage();
  await p.goto(url);
  const hidden = await p.$$eval("section, header, footer, .reveal", (els) =>
    els.filter((e) => getComputedStyle(e).opacity !== "1").map((e) => e.className || e.tagName));
  console.log(`\n== JS disabled: ${hidden.length ? "FAIL hidden: " + hidden.join(", ") : "all sections visible"}`);
  failed ||= hidden.length > 0;
  await ctx.close();
}

// With JS enabled, run axe once every reveal block is shown.

for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 800 }]]) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  await p.goto(url);
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in"));
  });
  await p.waitForTimeout(1200);

  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`\n== ${name}: horizontal overflow ${overflow}px${overflow > 0 ? " FAIL" : ""}`);
  failed ||= overflow > 0;

  const banner = await p.$eval(".draft-banner", (e) => e.textContent).catch(() => null);
  console.log(`   draft banner: ${banner ?? "absent"}`);

  // The failing ghost-button swatch is the defect being demonstrated.

  await p.addScriptTag({ content: axeSource });
  const res = await p.evaluate(() => window.axe.run({ exclude: [["[data-contrast-exempt]"]] }, { resultTypes: ["violations"] }));
  const bad = res.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  for (const v of res.violations) {
    console.log(`   axe ${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}`);
    for (const n of v.nodes.slice(0, 4)) console.log(`      ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
  }
  console.log(`   axe serious or critical: ${bad.length}`);
  failed ||= bad.length > 0;

  if (shots) await p.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(failed ? "\nFAILED" : "\nPASS");
process.exit(failed ? 1 : 0);
