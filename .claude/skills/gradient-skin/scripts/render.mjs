// render.mjs — screenshot an HTML file with Playwright/Chromium.
// usage: node render.mjs in.html out.png 1600x900 2
// Resolves `playwright` from a local install, NODE_PATH, or the global npm root.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";

const [, , input, output, size = "1600x900", scale = "2"] = process.argv;
if (!input || !output) { console.error("usage: node render.mjs in.html out.png WxH scale"); process.exit(2); }
const [w, h] = size.split("x").map(Number);

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = ["playwright", "playwright-core"];
  for (const c of candidates) { try { return require(c); } catch {} }
  try {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    for (const c of candidates) { try { return require(path.join(root, c)); } catch {} }
  } catch {}
  throw new Error("playwright not found. Install: npm i -g playwright && npx playwright install chromium");
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(scale) });
await page.goto("file://" + path.resolve(input), { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts && document.fonts.ready);
await page.waitForTimeout(150);
await page.screenshot({ path: output, clip: { x: 0, y: 0, width: w, height: h } });
await browser.close();
console.log("rendered", output);
