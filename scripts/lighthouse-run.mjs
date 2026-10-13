// Runs mobile Lighthouse on each page and prints the four category scores.
//
// Needs lighthouse, chrome-launcher and playwright on NODE_PATH, and the site served locally.
// Usage: NODE_PATH=/path/to/node_modules node scripts/lighthouse-run.mjs [base-url] [out.json] [page ...]

import { createRequire } from "module";
import { writeFileSync } from "fs";
import path from "path";

const require = createRequire(path.join(process.env.NODE_PATH || ".", "x.js"));
const { chromium } = require("playwright");
const { launch } = await import(require.resolve("chrome-launcher"));
const lighthouse = (await import(require.resolve("lighthouse"))).default;

const [base = "http://localhost:8765", out, ...pages] = process.argv.slice(2);
const urls = pages.length ? pages : ["/"];
const results = [];

// A fresh browser per page, so one page's state can't skew the next page's metrics.

for (const url of urls) {
  const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ["--headless=new"] });
  const { lhr } = await lighthouse(base + url, { port: chrome.port, output: "json", logLevel: "error" });
  const score = (k) => Math.round(lhr.categories[k].score * 100);
  const failing = Object.values(lhr.audits).filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === "binary").map((a) => a.id);
  await chrome.kill();
  results.push({ url, performance: score("performance"), accessibility: score("accessibility"), bestPractices: score("best-practices"), seo: score("seo"), failing });
}

const json = JSON.stringify(results, null, 2);
if (out) writeFileSync(out, json + "\n");
console.log(json);
