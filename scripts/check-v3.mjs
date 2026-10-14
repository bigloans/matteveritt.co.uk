// Brief 4 acceptance checks: idle motion, header and menu, both demos, the spec resize label
// and a text search of the built site.
//
// Needs playwright on NODE_PATH and the site served locally.
// Usage: NODE_PATH=/path/to/node_modules node scripts/check-v3.mjs [base-url]

import { createRequire } from "module";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(path.join(process.env.NODE_PATH || ".", "x.js"));
const { chromium } = require("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || "http://localhost:8765";
const pages = ["/", "/work/replacing-the-component-library/", "/work/visual-rules-for-agents/", "/work/design-system-with-agents/", "/spec/", "/changelog/"];
const viewports = [[1444, 862], [390, 844], [320, 568]];
const results = [];
const check = (name, ok, detail = "") => results.push({ ok, name, detail });

const browser = await chromium.launch();

// Motion: nothing animates after 3 seconds idle.

for (const [width, height] of viewports) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  for (const url of pages) {
    await p.goto(base + url, { waitUntil: "networkidle" });
    await p.waitForTimeout(3000);
    const n = await p.evaluate(() => document.getAnimations().length);
    check(`motion ${url} ${width}`, n === 0, `${n} animations`);
  }
  await ctx.close();
}

// Header below 900px: one row, 64px or less, not sticky. The menu works by touch and keyboard.

for (const [width, height] of viewports.slice(1)) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(base + "/work/replacing-the-component-library/", { waitUntil: "networkidle" });
  const h = await p.evaluate(() => {
    const hd = document.querySelector(".site-header"), b = document.querySelector(".menu-button").getBoundingClientRect();
    return { height: hd.getBoundingClientRect().height, position: getComputedStyle(hd).position, button: b.height };
  });
  check(`header ${width}`, h.height <= 64 && h.position !== "sticky" && h.position !== "fixed" && h.button >= 44, JSON.stringify(h));

  await p.tap(".menu-button");
  await p.waitForTimeout(300);
  const open = await p.evaluate(() => ({
    expanded: document.querySelector(".menu-button").getAttribute("aria-expanded"),
    visible: ["Work", "About", "Contact", "Show the spec"].every((t) => [...document.querySelectorAll("#site-menu a, #site-menu button")].some((e) => e.textContent.trim() === t && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility === "visible")),
    focus: document.activeElement.textContent.trim(),
  }));
  check(`menu opens by touch ${width}`, open.expanded === "true" && open.visible && open.focus === "Work", JSON.stringify(open));

  const trail = [];
  for (let i = 0; i < 6; i++) {
    await p.keyboard.press("Tab");
    trail.push(await p.evaluate(() => document.activeElement.textContent.trim()));
  }
  check(`menu traps focus ${width}`, trail.join(",") === "About,Contact,Show the spec,Close,Work,About", trail.join(","));

  await p.keyboard.press("Escape");
  const esc = await p.evaluate(() => ({ expanded: document.querySelector(".menu-button").getAttribute("aria-expanded"), focus: document.activeElement.className }));
  check(`menu closes on Escape ${width}`, esc.expanded === "false" && esc.focus === "menu-button", JSON.stringify(esc));

  await p.keyboard.press("Enter");
  await p.keyboard.press("Tab");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(300);
  const chose = await p.evaluate(() => ({ expanded: document.querySelector(".menu-button").getAttribute("aria-expanded"), hash: location.hash }));
  check(`menu closes after a choice ${width}`, chose.expanded === "false", JSON.stringify(chose));

  await p.goto(base + "/work/replacing-the-component-library/", { waitUntil: "networkidle" });
  await p.tap(".menu-button");
  await p.tap("#site-menu [data-spec-toggle]");
  await p.waitForTimeout(300);
  const spec = await p.evaluate(() => ({ pressed: document.querySelector("[data-spec-toggle]").getAttribute("aria-pressed"), expanded: document.querySelector(".menu-button").getAttribute("aria-expanded") }));
  check(`menu spec toggle by touch ${width}`, spec.pressed === "true" && spec.expanded === "false", JSON.stringify(spec));

  for (const y of [0.5, 1]) {
    await p.evaluate((f) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), y);
    const ok = await p.$eval(".contents-button", (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.height >= 44; });
    check(`contents button reachable ${width} at ${y}`, ok);
  }
  await ctx.close();
}

// Demos: keyboard only, with polite live regions.

for (const [width, height] of [[1444, 862], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  await p.goto(base + "/work/replacing-the-component-library/", { waitUntil: "networkidle" });
  const live = await p.$eval("[data-gate-status]", (e) => e.getAttribute("aria-live"));
  const seen = [];
  for (const v of ["hex", "padding", "alt", "ghost"]) {
    await p.focus(`[data-violation=${v}]`);
    await p.keyboard.press("Space");
    seen.push(await p.textContent("[data-gate-status]"));
  }
  const lines = await p.$eval("[data-gate-output]", (e) => e.textContent.split("\n").filter((l) => /^\s+card\./.test(l)).length);
  await p.keyboard.press("Space");
  seen.push(await p.textContent("[data-gate-status]"));
  const stacked = await p.evaluate(() => {
    const a = document.querySelector(".gate-demo-stage").getBoundingClientRect(), b = document.querySelector("[data-gate-output]").getBoundingClientRect();
    return b.top >= a.bottom - 1;
  });
  const ok = live === "polite" && lines === 4 && seen[3] === "Gate result: FAIL, 4 violations." && seen[4] === "Gate result: FAIL, 3 violations." && stacked === (width < 900);
  check(`try the gate ${width}`, ok, JSON.stringify({ live, lines, seen, stacked }));

  await p.goto(base + "/work/design-system-with-agents/", { waitUntil: "networkidle" });
  await p.focus("[data-bug-next]");
  const bug = [];
  for (const k of ["Enter", "Space", "Enter", "Enter", "Enter"]) {
    await p.keyboard.press(k);
    bug.push(await p.$eval("[aria-current=step] .bug-role", (e) => e.textContent));
  }
  await p.focus("[data-bug-prev]");
  await p.keyboard.press("Enter");
  bug.push(await p.$eval("[aria-current=step] .bug-role", (e) => e.textContent));
  const bugLive = await p.$eval("[data-bug-status]", (e) => [e.getAttribute("aria-live"), e.textContent]);
  check(`follow a bug ${width}`, bug.join(",") === "Check author,Scope warden,Verifier,Release steward,Release steward,Verifier" && bugLive[0] === "polite" && /^Step 4 of 5\./.test(bugLive[1]), JSON.stringify({ bug, bugLive }));
  await ctx.close();
}

// Show the spec on resize: a spacing label that changes step says what it was.

{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 862 } });
  const p = await ctx.newPage();
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.click("[data-spec-toggle]");
  await p.waitForTimeout(1500);
  await p.setViewportSize({ width: 860, height: 862 });
  await p.waitForTimeout(300);
  const labels = await p.$$eval(".spec-label.is-changed", (ls) => ls.map((l) => l.textContent));
  check("spec resize label", labels.includes("was --space-96, now --space-64"), labels.join(" | "));
  await ctx.close();
}

await browser.close();

// Text search of the built site. Jekyll excludes match _config.yml.

const excluded = ["scripts", "docs", "tokens.json", "changelog.json", ".git", "node_modules", "fonts", "_config.yml", ".gitignore"];
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f), rel = path.relative(root, full);
    if (excluded.includes(rel) || f.startsWith(".") || /\.md$/.test(f)) continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(html|css|js|svg|txt)$/.test(f)) files.push(rel);
  }
})(root);
const banned = ["permission", "£94", "Fancy a chat", "Email me", "Download my CV", "grad-text", "gate/src/rendered", "run.js", "#20", "\"light\":", "light-mode", "data-theme", "#F3F5F8", "#5D6878", "#C2185B", "#D3D9E1", "inverse-"];
for (const term of banned) {
  const hits = files.filter((f) => readFileSync(path.join(root, f), "utf8").toLowerCase().includes(term.toLowerCase()));
  check(`text "${term}"`, hits.length === 0, hits.join(", "));
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.ok ? "  " + r.detail : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
