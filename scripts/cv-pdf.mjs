// Prints scripts/cv/cv.html to assets/matt-everitt-cv.pdf and fails if it runs past one page.
//
// Needs playwright on NODE_PATH.
// Usage: NODE_PATH=/path/to/node_modules node scripts/cv-pdf.mjs

import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";

const require = createRequire(path.join(process.env.NODE_PATH || ".", "x.js"));
const { chromium } = require("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "assets/matt-everitt-cv.pdf");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(root, "scripts/cv/cv.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: out, format: "A4", preferCSSPageSize: true, printBackground: true });
await browser.close();

const pages = (readFileSync(out, "latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log(`Wrote ${path.relative(root, out)}, ${pages} page${pages === 1 ? "" : "s"}`);
if (pages !== 1) process.exit(1);
