#!/usr/bin/env node
// Turn rendered HTML mockups into a JSON layer tree that scripts/figma/build.js replays in
// Figma as editable frames, text, vectors and images. No MCP and no Figma API token needed.
//
//   node serialize.mjs <file.html>... [--selector .frame] [--dir <bridge work directory>]
//
// Writes <dir>/data/<name>.json and <dir>/data/img/<hash>.<ext>. The default <dir> is
// $FIGMA_BRIDGE_DIR or ./.figma-bridge, the directory the bridge server serves.
//
// What it understands: boxes (background colour, linear gradients at any angle, background
// and <img> pictures, borders, radius, shadows, opacity, clipping), text (family, weight,
// size, line height, letter spacing, colour, alignment, underline, upper case, the exact
// line breaks of wrapped text, one-line text cut with an ellipsis), inline <svg>, and the
// text of <input>, <textarea> and <select>. It also notes how each box lays out its
// children (flex direction, gap, padding), so build.js can make it an auto-layout frame.
// What it does not: CSS pseudo-elements, transforms, blend modes, filters.
// It prints a warning for each thing it had to skip, so draw mockups with real elements.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, parseArgs } from './lib.mjs';

const { files, flags } = parseArgs(process.argv.slice(2), {
  selector: '.frame',
  dir: process.env.FIGMA_BRIDGE_DIR || path.join(process.cwd(), '.figma-bridge'),
});
if (!files.length) { console.error('usage: node serialize.mjs <file.html>... [--selector .frame] [--dir <bridge work directory>]'); process.exit(2); }
const dataDir = path.join(path.resolve(flags.dir), 'data');
fs.mkdirSync(path.join(dataDir, 'img'), { recursive: true });

// Runs in the page. Returns { tree, warnings }.
function serializeInPage(selector) {
  const warnings = new Set();
  const root = document.querySelector(selector);
  if (!root) return { tree: null, warnings: [`no element matches ${selector}`] };
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const px = (v) => parseFloat(v) || 0;

  const color = (value) => {
    if (!value || value === 'transparent') return null;
    const m = value.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
      const a = p.length > 3 ? p[3] : 1;
      return a === 0 ? null : { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a };
    }
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return d[3] ? { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255 } : null;
  };
  const splitTop = (s) => {
    const out = []; let depth = 0; let cur = '';
    for (const c of s) {
      if (c === '(') depth++; else if (c === ')') depth--;
      if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const COLOR = /(rgba?\([^)]*\)|[a-z-]+\([^)]*\)|#[0-9a-f]{3,8})/i;
  const shadows = (value) => (value === 'none' ? [] : splitTop(value).map((part) => {
    const cm = part.match(COLOR);
    const c = color(cm ? cm[1] : 'rgb(0, 0, 0)');
    const n = part.replace(cm ? cm[1] : '', '').replace('inset', '').trim().split(/\s+/).map(parseFloat);
    return c && { inset: /\binset\b/.test(part), color: c, x: n[0] || 0, y: n[1] || 0, blur: n[2] || 0, spread: n[3] || 0 };
  }).filter(Boolean));
  // angle: CSS degrees, 0 = upwards, clockwise. "to top right" and the other corners depend
  // on the shape of the box, as in CSS.
  const gradient = (layer, r) => {
    const parts = splitTop(layer.slice(layer.indexOf('(') + 1, layer.lastIndexOf(')')));
    let dir = 'bottom'; let angle = 180;
    const first = parts[0];
    if (/^to /.test(first)) {
      const words = first.slice(3).trim().split(/\s+/); dir = words[words.length - 1];
      const corner = (Math.atan2(r.height, r.width) * 180) / Math.PI; const has = (w) => words.includes(w);
      angle = words.length === 1 ? { top: 0, right: 90, bottom: 180, left: 270 }[words[0]]
        : has('top') && has('right') ? corner : has('bottom') && has('right') ? 180 - corner : has('bottom') && has('left') ? 180 + corner : 360 - corner;
      parts.shift();
    } else if (/(deg|turn|rad|grad)$/.test(first)) {
      const v = parseFloat(first);
      const deg = /turn$/.test(first) ? v * 360 : /grad$/.test(first) ? v * 0.9 : /rad$/.test(first) ? (v * 180) / Math.PI : v;
      angle = ((deg % 360) + 360) % 360;
      dir = ['top', 'right', 'bottom', 'left'][Math.round(angle / 90) % 4];
      parts.shift();
    }
    const stops = parts.map((p) => {
      const cm = p.match(COLOR) || [p, p.split(' ')[0]];
      const pos = p.replace(cm[1], '').trim();
      return { color: color(cm[1]) || { r: 0, g: 0, b: 0, a: 0 }, pos: /%$/.test(pos) ? parseFloat(pos) / 100 : null };
    });
    stops.forEach((s, i) => { if (s.pos === null) s.pos = stops.length > 1 ? i / (stops.length - 1) : 0; });
    return { kind: 'gradient', dir, angle, stops };
  };
  // CSS lists background layers top to bottom; Figma paints fills bottom to top.
  const fills = (cs, r) => {
    const out = [];
    const bg = color(cs.backgroundColor);
    if (bg) out.push({ kind: 'solid', color: bg });
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      for (const layer of splitTop(cs.backgroundImage).reverse()) {
        if (/^linear-gradient\(/.test(layer)) out.push(gradient(layer, r));
        else if (/^url\(/.test(layer)) out.push({ kind: 'image', src: layer.slice(4, -1).replace(/^["']|["']$/g, ''), fit: /contain/.test(cs.backgroundSize) ? 'FIT' : 'FILL' });
        else warnings.add(`background layer skipped: ${layer.slice(0, 40)}`);
      }
    }
    return out;
  };
  const radius = (cs, r) => ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].map((k) => {
    const v = cs[k].split(' ')[0];
    const n = /%$/.test(v) ? (parseFloat(v) / 100) * Math.min(r.width, r.height) : px(v);
    return Math.min(n, Math.min(r.width, r.height) / 2);
  });
  const nameOf = (el) => el.getAttribute('data-name') || (typeof el.className === 'string' && el.className.trim().split(/\s+/)[0]) || el.tagName.toLowerCase();

  const textStyle = (cs) => ({
    family: cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''),
    weight: parseInt(cs.fontWeight, 10) || 400,
    italic: cs.fontStyle === 'italic',
    size: px(cs.fontSize),
    lh: cs.lineHeight === 'normal' ? null : px(cs.lineHeight),
    ls: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
    color: color(cs.color),
    align: { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', justify: 'left' }[cs.textAlign] || 'left',
    deco: /underline/.test(cs.textDecorationLine) ? 'UNDERLINE' : /line-through/.test(cs.textDecorationLine) ? 'STRIKETHROUGH' : null,
  });
  const cased = (s, cs) => (cs.textTransform === 'uppercase' ? s.toUpperCase() : cs.textTransform === 'lowercase' ? s.toLowerCase() : s);

  // Which edge of a one-line text must stay put when Figma draws it a pixel wider or
  // narrower than the browser did? Look at the nearest ancestor that is wider than the
  // text: flush right means right, equal gaps mean centred (button labels), else left.
  const anchor = (el, l) => {
    for (let a = el; a && a !== root.parentElement; a = a.parentElement) {
      const b = a.getBoundingClientRect(); const s = getComputedStyle(a);
      const left = b.left + px(s.borderLeftWidth) + px(s.paddingLeft);
      const right = b.right - px(s.borderRightWidth) - px(s.paddingRight);
      if (right - left <= l.right - l.left + 3) continue;
      const gl = l.left - left; const gr = right - l.right;
      if (gr < 1.5 && gl > 1.5) return 'right';
      if (Math.abs(gl - gr) < 1.5 && gl > 1.5) return 'center';
      return 'left';
    }
    return 'left';
  };

  const text = (node, el, cs, org, out) => {
    const raw = node.nodeValue;
    if (!raw.trim()) return;
    const pre = /^pre/.test(cs.whiteSpace);
    const range = document.createRange();
    const lines = []; let cur = null; let i = 0;
    for (const ch of raw) {
      range.setStart(node, i); range.setEnd(node, i + ch.length); i += ch.length;
      const rc = range.getClientRects()[0];
      // White space never sets the extent of a line: a leading space would shift the run.
      if (!rc || (!pre && /\s/.test(ch))) { if (cur) cur.text += ch; continue; }
      if (!cur || Math.abs(rc.top - cur.top) > rc.height / 2) { cur = { text: '', top: rc.top, bottom: rc.bottom, left: rc.left, right: rc.right }; lines.push(cur); }
      cur.text += ch;
      cur.left = Math.min(cur.left, rc.left); cur.right = Math.max(cur.right, rc.right);
      cur.top = Math.min(cur.top, rc.top); cur.bottom = Math.max(cur.bottom, rc.bottom);
    }
    const clean = (s) => cased(pre ? s : s.replace(/\s+/g, ' ').trim(), cs);
    const style = textStyle(cs);
    const real = lines.filter((l) => clean(l.text));
    if (!real.length) return;
    const alone = [...el.childNodes].every((n) => n === node || (n.nodeType === 3 && !n.nodeValue.trim()));
    if (real.length > 1 && alone) {
      // One paragraph that wraps: keep it as one text layer with the width of its container.
      const box = el.getBoundingClientRect();
      const left = box.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
      const right = box.right - px(cs.borderRightWidth) - px(cs.paddingRight);
      const pitch = (real[real.length - 1].top - real[0].top) / (real.length - 1);
      const inline = cs.display.startsWith('inline');
      const x0 = inline ? Math.min(...real.map((l) => l.left)) : left;
      const x1 = inline ? Math.max(...real.map((l) => l.right)) : right;
      // lineTexts: what stands on each line in the browser, so Figma can break at the same words.
      out.push({ type: 'TEXT', ...style, lh: style.lh || pitch, chars: clean(real.map((l) => l.text).join(' ')), lines: real.length,
        ...(pre ? {} : { lineTexts: real.map((l) => clean(l.text)) }),
        x: x0 - org.x, y: real[0].top - org.y, w: x1 - x0, h: real[real.length - 1].bottom - real[0].top });
      return;
    }
    // A line that the browser cuts with "…": keep the full text and let Figma cut it at the
    // same place. The cut belongs to the block the text sits in, also when the text is
    // inside a link or a span of that block; what lies wholly behind the cut is left out.
    let block = el;
    while (block !== root && getComputedStyle(block).display.startsWith('inline') && block.parentElement) block = block.parentElement;
    const bs = getComputedStyle(block);
    if (real.length === 1 && bs.textOverflow === 'ellipsis' && bs.overflowX !== 'visible' && block.scrollWidth > block.clientWidth + 1) {
      const l = real[0];
      const right = block.getBoundingClientRect().right - px(bs.borderRightWidth) - px(bs.paddingRight);
      if (l.left >= right - 4) return;
      if (l.right > right + 1) {
        out.push({ type: 'TEXT', ...style, lh: style.lh || l.bottom - l.top, chars: clean(l.text), lines: 1, align: 'left',
          x: l.left - org.x, y: l.top - org.y, w: right - l.left, h: l.bottom - l.top, trunc: Math.max(right - l.left, 8) });
        return;
      }
    }
    // Single line, or a text run mixed with other inline content: one layer per line.
    for (const l of real) {
      out.push({ type: 'TEXT', ...style, lh: style.lh || l.bottom - l.top, chars: clean(l.text), lines: 1,
        x: l.left - org.x, y: l.top - org.y, w: l.right - l.left, h: l.bottom - l.top, align: anchor(el, l) });
    }
  };

  // <input>, <textarea> and <select> keep their text outside the DOM tree: read it from the
  // control and put it where the browser draws it.
  const controlText = (el, cs, r, out) => {
    const tag = el.tagName.toLowerCase();
    if (/^(checkbox|radio|range|color|file|hidden|image|submit|button|reset)$/.test(el.type || '')) return;
    const shown = tag === 'select' ? (el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : '') : el.value;
    const chars = shown || el.getAttribute('placeholder') || '';
    if (!chars) return;
    const style = textStyle(cs); style.align = 'left';
    if (!shown) style.color = color(getComputedStyle(el, '::placeholder').color) || style.color;
    const lh = style.lh || style.size * 1.2;
    const left = px(cs.borderLeftWidth) + px(cs.paddingLeft);
    const inner = r.width - left - px(cs.borderRightWidth) - px(cs.paddingRight);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const area = tag === 'textarea';
    // h equals the line height, so build.js puts the line box exactly at y.
    out.push({ type: 'TEXT', ...style, lh, chars: cased(chars, cs), lines: 1, x: left, y: area ? px(cs.borderTopWidth) + px(cs.paddingTop) : (r.height - lh) / 2,
      w: area ? inner : Math.min(ctx.measureText(chars).width, inner), h: lh, ...(area ? { box: inner } : {}) });
  };

  const flow = (cs) => ({ ...(/absolute|fixed/.test(cs.position) ? { abs: true } : {}), ...(Number(cs.flexGrow) > 0 ? { grow: Number(cs.flexGrow) } : {}) });

  const visit = (el, org, out) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    if (tag === 'svg') {
      const copy = el.cloneNode(true);
      copy.setAttribute('width', r.width); copy.setAttribute('height', r.height);
      if (!copy.getAttribute('xmlns')) copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      out.push({ type: 'SVG', name: nameOf(el), x: r.left - org.x, y: r.top - org.y, w: r.width, h: r.height,
        svg: copy.outerHTML.replace(/currentColor/g, cs.color), opacity: parseFloat(cs.opacity), ...flow(cs) });
      return;
    }
    if (tag === 'img') {
      if (cs.objectPosition !== '50% 50%') warnings.add('object-position is ignored: crop the image file instead');
      out.push({ type: 'IMAGE', name: el.alt || nameOf(el), x: r.left - org.x, y: r.top - org.y, w: r.width, h: r.height,
        src: el.currentSrc || el.src, fit: cs.objectFit === 'contain' ? 'FIT' : 'FILL', radius: radius(cs, r), opacity: parseFloat(cs.opacity), ...flow(cs) });
      return;
    }
    const control = ['input', 'textarea', 'select'].includes(tag);
    if (['video', 'canvas', 'iframe'].includes(tag)) warnings.add(`<${tag}> has no layer: draw it with plain elements`);
    for (const pseudo of ['::before', '::after']) {
      const content = getComputedStyle(el, pseudo).content;
      if (content && content !== 'none' && content !== 'normal') warnings.add(`${pseudo} on .${nameOf(el)} has no layer: use a real element`);
    }
    if (cs.transform !== 'none') warnings.add(`transform on .${nameOf(el)} is flattened to its bounding box`);
    const bw = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
    const side = ['Top', 'Right', 'Bottom', 'Left'][bw.findIndex((w) => w > 0)];
    const bc = side ? color(cs[`border${side}Color`]) : null;
    const paint = fills(cs, r);
    const sh = shadows(cs.boxShadow);
    const clip = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    const opacity = parseFloat(cs.opacity);
    // A flex container is kept as a layer even when it paints nothing: it is the "row" or
    // "stack" a designer expects to find, and build.js turns it into an auto-layout frame.
    const flex = /flex/.test(cs.display) && el.children.length > 0;
    // So is a group that is one item of a flex row or column (it holds several things that
    // move together), and an empty spacer that pushes its neighbours apart.
    const inFlex = el !== root && el.parentElement && /flex/.test(getComputedStyle(el.parentElement).display) && !/absolute|fixed/.test(cs.position);
    const group = inFlex && el.children.length > 0;
    const spacer = inFlex && !el.childNodes.length && Number(cs.flexGrow) > 0;
    // A cell: a flex item that holds only text but is wider than that text (a table column
    // with a fixed width, or one that takes the rest of the row). The box carries the width.
    let cell = false;
    if (inFlex && !el.children.length && el.textContent.trim()) {
      const range = document.createRange(); range.selectNodeContents(el);
      cell = r.width - range.getBoundingClientRect().width > 2;
    }
    const isLayer = el === root || el.hasAttribute('data-name') || paint.length || bc || sh.length || clip || opacity < 1 || flex || control || group || spacer || cell;
    let target = out; let origin = org;
    if (isLayer && r.width > 0 && (r.height > 0 || spacer)) {
      const frame = { type: 'FRAME', name: nameOf(el), x: r.left - org.x, y: r.top - org.y, w: r.width, h: r.height, fills: paint,
        clip, radius: radius(cs, r), bc, bw, dashed: side ? /dashed|dotted/.test(cs[`border${side}Style`]) : false, shadows: sh, opacity, children: [],
        // Layout hints for auto layout: padding (top right bottom left), flex settings, and
        // whether this box itself is taken out of the flow or grows inside its parent.
        pad: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)], ...flow(cs) };
      if (flex) frame.flex = { dir: cs.flexDirection, gap: px(/column/.test(cs.flexDirection) ? cs.rowGap : cs.columnGap), justify: cs.justifyContent, align: cs.alignItems, wrap: cs.flexWrap !== 'nowrap' };
      out.push(frame); target = frame.children; origin = { x: r.left, y: r.top };
      if (control) { controlText(el, cs, r, target); return; }
    }
    const z = (n) => (n.nodeType === 1 && getComputedStyle(n).position !== 'static' ? parseInt(getComputedStyle(n).zIndex, 10) || 0 : 0);
    const kids = [...el.childNodes].map((n, i) => ({ n, i, z: z(n) })).sort((a, b) => a.z - b.z || a.i - b.i);
    for (const { n } of kids) {
      if (n.nodeType === 3) text(n, el, cs, origin, target);
      else if (n.nodeType === 1) visit(n, origin, target);
    }
  };

  const out = [];
  const box = root.getBoundingClientRect();
  visit(root, { x: box.left, y: box.top }, out);
  return { tree: out[0], warnings: [...warnings] };
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const helper = await context.newPage();

// Figma accepts PNG, JPEG and GIF. Anything else is redrawn as PNG in the browser.
async function saveImage(src, baseUrl) {
  const url = new URL(src, baseUrl);
  let bytes;
  if (url.protocol === 'file:') bytes = fs.readFileSync(fileURLToPath(url));
  else if (url.protocol === 'data:') bytes = Buffer.from(url.href.slice(url.href.indexOf(',') + 1), /;base64,/.test(url.href) ? 'base64' : 'utf8');
  else bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const magic = bytes.subarray(0, 4).toString('hex');
  let ext = magic.startsWith('89504e47') ? 'png' : magic.startsWith('ffd8') ? 'jpg' : magic.startsWith('47494638') ? 'gif' : null;
  if (!ext) {
    const head = bytes.subarray(0, 64).toString('latin1');
    const mime = /WEBP/.test(head) ? 'image/webp' : /ftypavif/.test(head) ? 'image/avif' : /<svg|<\?xml/.test(head) ? 'image/svg+xml' : 'image/*';
    await helper.setContent(`<body style="margin:0;background:transparent"><img id="i" src="data:${mime};base64,${bytes.toString('base64')}"></body>`, { waitUntil: 'load' });
    bytes = await helper.locator('#i').screenshot({ omitBackground: true });
    ext = 'png';
  }
  const name = `${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
  fs.writeFileSync(path.join(dataDir, 'img', name), bytes);
  return `data/img/${name}`;
}

async function resolveImages(node, baseUrl, warnings) {
  const jobs = [];
  if (node.type === 'IMAGE') jobs.push(node);
  for (const f of node.fills || []) if (f.kind === 'image') jobs.push(f);
  for (const job of jobs) {
    try { job.img = await saveImage(job.src, baseUrl); } catch (e) { warnings.push(`image not loaded: ${String(job.src).slice(0, 80)} (${e.message})`); }
    delete job.src;
  }
  for (const child of node.children || []) await resolveImages(child, baseUrl, warnings);
}

const count = (n) => 1 + (n.children || []).reduce((s, c) => s + count(c), 0);
let failed = false;
for (const file of files) {
  const name = path.basename(file, '.html');
  const baseUrl = pathToFileURL(file).href;
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const { tree, warnings } = await page.evaluate(serializeInPage, flags.selector);
  if (!tree) { console.log(name, 'FAILED', warnings.join('; ')); failed = true; continue; }
  await resolveImages(tree, baseUrl, warnings);
  tree.title = await page.title();
  fs.writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(tree));
  console.log(name, `layers:${count(tree)} w:${Math.round(tree.w)} h:${Math.round(tree.h)}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
