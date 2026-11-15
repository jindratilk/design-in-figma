#!/usr/bin/env node
// Compare what the browser rendered with what Figma shows, pixel by pixel.
//
//   node compare.mjs <render.png>... [--dir <bridge work directory>] [--max 1.5]
//
// Every <name>.png (written by render.mjs) is compared with <dir>/out/fig-<name>.png (posted
// back by the build recipe). One line per frame:
//   A1-order-detail browser:1440x900 figma:1440x900 differs:0.62% area:x 232-1400, y 24-560 ok
// and a picture <dir>/out/diff-<name>.png with the differing pixels in red.
//
// Both pictures are compared at half size. That hides the different antialiasing of the two
// text renderers, which is all a faithful copy differs by (about 0.5 to 1.5 percent on a
// screen full of text), and keeps what matters: a block that moved, a wrong colour, a
// missing layer, a line that wraps elsewhere. Exit code 1 when a frame is above --max
// percent or the sizes differ. Then open the diff picture: one red band is one wrong layer.
import fs from 'node:fs';
import path from 'node:path';
import { launch, parseArgs } from './lib.mjs';

const { files, flags } = parseArgs(process.argv.slice(2), { dir: process.env.FIGMA_BRIDGE_DIR || path.join(process.cwd(), '.figma-bridge'), max: '1.5' });
if (!files.length) { console.error('usage: node compare.mjs <render.png>... [--dir <bridge work directory>] [--max 1.5]'); process.exit(2); }
const out = path.join(path.resolve(flags.dir), 'out');

const browser = await launch();
const page = await browser.newPage();
const uri = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
let failed = false;
for (const file of files) {
  const name = path.basename(file, '.png');
  const fig = path.join(out, `fig-${name}.png`);
  if (!fs.existsSync(file) || !fs.existsSync(fig)) { console.log(name, `missing ${fs.existsSync(file) ? fig : file}`); failed = true; continue; }
  const res = await page.evaluate(async ([a, b]) => {
    const load = (u) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; });
    const [ia, ib] = [await load(a), await load(b)];
    const w = Math.max(1, Math.round(Math.min(ia.width, ib.width) / 2)); const h = Math.max(1, Math.round(Math.min(ia.height, ib.height) / 2));
    const pixels = (i) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = 'high'; x.drawImage(i, 0, 0, i.width, i.height, 0, 0, Math.round(i.width / 2), Math.round(i.height / 2)); return x.getImageData(0, 0, w, h).data; };
    const da = pixels(ia); const db = pixels(ib);
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const o = x.createImageData(w, h);
    let bad = 0; let top = h; let bottom = -1; let left = w; let right = -1;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > 40) {
        bad++; o.data[i] = 230; o.data[i + 1] = 30; o.data[i + 2] = 30;
        const p = i / 4; const yy = Math.floor(p / w); const xx = p % w;
        top = Math.min(top, yy); bottom = Math.max(bottom, yy); left = Math.min(left, xx); right = Math.max(right, xx);
      } else { const g = Math.round(255 - (255 - (da[i] + da[i + 1] + da[i + 2]) / 3) * 0.25); o.data[i] = o.data[i + 1] = o.data[i + 2] = g; }
      o.data[i + 3] = 255;
    }
    x.putImageData(o, 0, 0);
    return { a: [ia.width, ia.height], b: [ib.width, ib.height], pct: (bad / (w * h)) * 100, area: bad ? `x ${left * 2}-${right * 2}, y ${top * 2}-${bottom * 2}` : '-', png: c.toDataURL('image/png').split(',')[1] };
  }, [uri(file), uri(fig)]);
  const diff = path.join(out, `diff-${name}.png`);
  fs.writeFileSync(diff, Buffer.from(res.png, 'base64'));
  const sizeOk = Math.abs(res.a[0] - res.b[0]) <= 1 && Math.abs(res.a[1] - res.b[1]) <= 1;
  const bad = !sizeOk || res.pct > Number(flags.max);
  if (bad) failed = true;
  console.log(name, `browser:${res.a.join('x')} figma:${res.b.join('x')} differs:${res.pct.toFixed(2)}% area:${res.area} ${bad ? 'CHECK ' + diff : 'ok'}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
