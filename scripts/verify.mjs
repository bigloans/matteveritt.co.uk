// Checks links, old anchor redirects, rendering without JavaScript, targets, headings,
// the contents sheet, "Show the spec" and axe on every page.
//
// Needs playwright and axe-core on NODE_PATH, and the site served locally.
// Usage: NODE_PATH=/path/to/node_modules node scripts/verify.mjs [base-url]

import { createRequire } from "module";
import { readFileSync } from "fs";
import path from "path";

const require = createRequire(path.join(process.env.NODE_PATH || ".", "x.js"));
const { chromium } = require("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const base = process.argv[2] || "http://localhost:8765";
const pages = ["/", "/work/replacing-the-component-library/", "/work/visual-rules-for-agents/", "/work/design-system-with-agents/", "/spec/"];
const reads = { visual: "visual-rules-for-agents", "visual-language": "visual-rules-for-agents", designers: "design-system-with-agents", team: "design-system-with-agents", reversed: "design-system-with-agents" };
const oldIds = ["glance", "customers", "problem", "options", "product", "visual", "visual-language", "designers", "gate", "evidence", "story", "team", "reversed", "adoption", "changed-mind", "metrics", "tradeoffs", "trade-offs", "roadmap", "reflection"];
const results = [];
const fail = (check, detail) => results.push({ ok: false, check, detail });
const pass = (check, detail = "") => results.push({ ok: true, check, detail });

const browser = await chromium.launch();

// Links: every internal link resolves, and its hash exists on the target page.

{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const links = new Set();
  for (const url of pages) {
    await p.goto(base + url);
    for (const h of await p.$$eval("a[href]", (as) => as.map((a) => a.href))) if (h.startsWith(base)) links.add(h);
  }
  let bad = [];
  for (const href of links) {
    const u = new URL(href);
    if (!u.pathname.endsWith("/")) {
      const head = await ctx.request.get(href);
      if (head.status() !== 200) bad.push(`${href} ${head.status()}`);
      continue;
    }
    const res = await p.goto(u.origin + u.pathname);
    if (!res || res.status() !== 200) { bad.push(`${href} ${res && res.status()}`); continue; }
    const id = decodeURIComponent(u.hash.slice(1));
    if (id && u.pathname !== "/" && !(await p.$(`[id="${id}"]`))) bad.push(`${href} missing #${id}`);
    if (id && u.pathname === "/" && !(await p.evaluate((i) => !!document.getElementById(i), id))) bad.push(`${href} missing #${id}`);
  }
  bad.length ? fail("internal links", bad.join("; ")) : pass("internal links", `${links.size} links`);

  bad = [];
  for (const id of oldIds) {
    await p.goto(`${base}/#${id}`);
    await p.waitForLoadState("load");
    const want = `/work/${reads[id] || "replacing-the-component-library"}/`;
    const u = new URL(p.url());
    const found = await p.evaluate((i) => !!document.getElementById(i), id);
    if (u.pathname !== want || u.hash !== `#${id}` || !found) bad.push(`#${id} went to ${u.pathname}${u.hash}${found ? "" : " (id missing)"}`);
  }
  await p.goto(`${base}/#contact`);
  if (new URL(p.url()).pathname !== "/") bad.push("#contact left the landing page");
  bad.length ? fail("old anchor redirects", bad.join("; ")) : pass("old anchor redirects", `${oldIds.length} anchors`);
  await ctx.close();
}

// Without JavaScript: content and navigation render, "Show the spec" is absent.

{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  for (const url of pages) {
    await p.goto(base + url);
    const r = await p.evaluate(() => ({
      h1: !!document.querySelector("h1")?.getBoundingClientRect().height,
      nav: [...document.querySelectorAll(".site-menu a")].every((a) => a.getBoundingClientRect().height > 0),
      spec: !!document.querySelector("[data-spec-toggle]")?.getBoundingClientRect().height,
      contents: document.querySelector(".contents ol") ? document.querySelector(".contents ol").getBoundingClientRect().height > 0 : true,
      ratios: [...document.querySelectorAll("[data-fg]")].every((b) => /\d\.\d\d:1/.test(b.textContent)),
    }));
    r.h1 && r.nav && !r.spec && r.contents && r.ratios ? pass(`no JS ${url}`) : fail(`no JS ${url}`, JSON.stringify(r));
  }
  await ctx.close();
}

// With JavaScript at each viewport: targets, headings, axe.

for (const [width, height] of [[1444, 862], [390, 844], [320, 568]]) {
  for (const theme of ["dark"]) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    const p = await ctx.newPage();
    for (const url of pages) {
      await p.goto(base + url, { waitUntil: "networkidle" });
      const tag = `${url} ${width} ${theme}`;
      const r = await p.evaluate(() => {
        const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
        const inText = (a) => a.closest("p, li, dd, td, figcaption") && !a.classList.contains("btn") && a.closest("p, li, dd, td, figcaption").textContent.trim() !== a.textContent.trim();
        const small = [...document.querySelectorAll("a, button, summary")].filter(vis).filter((e) => !inText(e) && !e.closest(".contents-sheet")).filter((e) => {
          const b = e.getBoundingClientRect();
          return b.width < 24 || b.height < 24;
        }).map((e) => e.textContent.trim().slice(0, 20));
        const header = [...document.querySelectorAll(".site-header a, .site-header button, .contents-button")].filter(vis).filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim().slice(0, 20));
        const hs = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => +h.tagName[1]);
        const skipped = hs.some((n, i) => i && n > hs[i - 1] + 1);
        return { small, header, h1: hs.filter((n) => n === 1).length, skipped, skip: !!document.querySelector("a.skip[href='#main']"), landmarks: !!document.querySelector("header") && !!document.querySelector("main") };
      });
      const bad = [];
      if (r.small.length) bad.push(`small targets: ${r.small.join(", ")}`);
      if (r.header.length) bad.push(`header under 44px: ${r.header.join(", ")}`);
      if (r.h1 !== 1) bad.push(`${r.h1} h1`);
      if (r.skipped) bad.push("skipped heading level");
      if (!r.skip) bad.push("no skip link");
      if (!r.landmarks) bad.push("missing landmark");
      await p.addScriptTag({ content: axeSource });
      const axe = await p.evaluate(() => window.axe.run({ exclude: [["[data-contrast-exempt]"]] }, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }));
      for (const v of axe.violations) bad.push(`axe ${v.id} (${v.nodes.length})`);
      bad.length ? fail(`page ${tag}`, bad.join("; ")) : pass(`page ${tag}`);
    }
    await ctx.close();
  }
}

// Interactions: contents sheet below 900px, "Show the spec" and Escape.

for (const width of [390, 320]) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 568 } });
  const p = await ctx.newPage();
  await p.goto(base + "/work/replacing-the-component-library/");
  const bad = [];
  for (const y of [0, 0.25, 0.5, 0.75, 1]) {
    await p.evaluate((f) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), y);
    const b = await p.$eval(".contents-button", (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.height >= 44; });
    if (!b) bad.push(`button not reachable at ${y}`);
  }
  await p.evaluate(() => scrollTo(0, 0));
  const closedHidden = await p.$eval(".contents-sheet", (e) => getComputedStyle(e).visibility === "hidden");
  if (!closedHidden) bad.push("sheet visible while closed");
  await p.click(".contents-button");
  await p.waitForTimeout(300);
  if (!(await p.isVisible(".contents-sheet a[href='#options']"))) bad.push("sheet did not open");
  await p.click(".contents-sheet a[href='#options']");
  await p.waitForTimeout(300);
  if (await p.$eval(".contents", (e) => e.classList.contains("is-open"))) bad.push("sheet stayed open after link");
  await p.click(".contents-button");
  await p.keyboard.press("Escape");
  if (await p.$eval(".contents", (e) => e.classList.contains("is-open"))) bad.push("Escape did not close sheet");
  bad.length ? fail(`contents sheet ${width}`, bad.join("; ")) : pass(`contents sheet ${width}`);
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1444, height: 862 } });
  const p = await ctx.newPage();
  const bad = [];
  for (const url of pages) {
    await p.goto(base + url);
    await p.click("[data-spec-toggle]");
    await p.waitForTimeout(300);
    const on = await p.evaluate(() => ({
      pressed: document.querySelector("[data-spec-toggle]").getAttribute("aria-pressed"),
      label: document.querySelector("[data-spec-toggle]").textContent,
      status: document.querySelector("[data-spec-status]").textContent,
      hidden: document.querySelector(".spec-layer").getAttribute("aria-hidden"),
      count: +document.querySelector(".spec-layer").dataset.count,
    }));
    await p.keyboard.press("Escape");
    const off = await p.evaluate(() => document.querySelector("[data-spec-toggle]").getAttribute("aria-pressed"));
    const ok = on.pressed === "true" && on.label === "Hide the spec" && on.status === `Showing ${on.count} spec annotations. Press Escape to hide.` && on.hidden === "true" && off === "false";
    if (!ok) bad.push(`${url} ${JSON.stringify(on)} after Escape ${off}`);
  }
  bad.length ? fail("show the spec", bad.join("; ")) : pass("show the spec", `${pages.length} pages`);
  await ctx.close();
}

await browser.close();
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}${r.detail ? "  " + r.detail : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
