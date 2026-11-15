#!/usr/bin/env node
// Render HTML mockups to PNG so you can look at them before anything reaches Figma.
//
//   node render.mjs <file.html>... [--selector .frame] [--out <dir>] [--scale 1]
//
// For every file it screenshots the frame element and prints one line:
//   <name> w:1440 h:1180 overflowX:0 missingFonts:-
// overflowX is the number of pixels some element sticks out of the frame on the right
// (must be 0). missingFonts lists font families the browser does not have (not installed and
// not loaded by the page), which means the picture you are judging is drawn in a fallback
// font and every text will have another width in Figma. Load the font in the mockup
// (@import or @font-face) until it reads "-".
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, parseArgs } from './lib.mjs';

const { files, flags } = parseArgs(process.argv.slice(2), { selector: '.frame', scale: '1' });
if (!files.length) { console.error('usage: node render.mjs <file.html>... [--selector .frame] [--out <dir>] [--scale 1]'); process.exit(2); }

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(flags.scale) });
const page = await context.newPage();
let failed = false;
for (const file of files) {
  const name = path.basename(file, '.html');
  const outDir = flags.out ? path.resolve(flags.out) : path.dirname(file);
  fs.mkdirSync(outDir, { recursive: true });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const frame = page.locator(flags.selector).first();
  if (!(await frame.count())) { console.log(name, `no element matches ${flags.selector}`); failed = true; continue; }
  await frame.screenshot({ path: path.join(outDir, `${name}.png`) });
  const info = await frame.evaluate((root) => {
    const box = root.getBoundingClientRect();
    let over = 0;
    const families = new Set();
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > box.right + 0.5) {
        // Not an overflow when a box inside the frame clips it (a scrolling plan, a cut line).
        let clipped = false;
        for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
          if (getComputedStyle(a).overflowX !== 'visible' && a.getBoundingClientRect().right <= box.right + 0.5) { clipped = true; break; }
        }
        if (!clipped) over = Math.max(over, Math.round(r.right - box.right));
      }
      families.add(getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''));
    }
    const generic = /^(serif|sans-serif|monospace|system-ui|ui-.*|-apple-system|BlinkMacSystemFont)$/;
    // document.fonts.check() answers true for a family that does not exist at all, so measure
    // instead: if the text is as wide with the family as without it, a fallback was drawn.
    const cv = document.createElement('canvas').getContext('2d'); const probe = 'mmmmmmmmlliiWW@#19';
    const width = (font) => { cv.font = font; return cv.measureText(probe).width; };
    const missing = [...families].filter((f) => f && !generic.test(f) && width(`72px "${f}", monospace`) === width('72px monospace') && width(`72px "${f}", serif`) === width('72px serif'));
    return { w: Math.round(box.width), h: Math.round(box.height), over, missing };
  });
  if (info.over || info.missing.length) failed = true;
  console.log(name, `w:${info.w} h:${info.h} overflowX:${info.over} missingFonts:${info.missing.join(', ') || '-'}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
