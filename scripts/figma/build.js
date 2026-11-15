// Replays a mockup serialised by scripts/mockup/serialize.mjs as editable Figma layers.
// args: { name, title?, page?, x?, y?, replace? = true, export? = true, autoLayout? = true }
//   name        data/<name>.json in the bridge work directory
//   title       frame name in Figma (default: the HTML <title>, else name)
//   page        page name to build on (created when missing; default: the current page)
//   x, y        position; default: where the frame it replaces stood, else right of
//               everything already on the page
//   replace     replace an older frame with the same name on that page. The new frame takes
//               its place: same section, same position, same place in the layer list.
//   export      post the built frame back as out/fig-<name>.png for comparison with the render
//   autoLayout  turn boxes into auto-layout frames (direction, gap, padding, fill / hug)
//               wherever that gives exactly the picture the browser drew. Every converted
//               frame is checked child by child and put back if anything moved.
//   explain     also return, for every box that stayed absolutely positioned, why
//
// The result reports how many boxes became auto layout and maxDrift: the largest distance,
// in px, between where a layer is and where the browser had it.
const { name, replace = true, autoLayout = true } = args;
if (!name) throw new Error('build: args.name is required');
const tree = await (await __get(`data/${name}.json`)).json();
const title = args.title || tree.title || name;

await figma.loadAllPagesAsync();
let page = figma.currentPage;
if (args.page) {
  page = figma.root.children.find((p) => p.name === args.page);
  if (!page) { page = figma.createPage(); page.name = args.page; }
  await figma.setCurrentPageAsync(page);
}

// Fonts: use the family the mockup asked for when Figma has it, otherwise Inter, and pick
// the nearest weight the family really has (a tie goes to the heavier one).
const available = await figma.listAvailableFontsAsync();
const families = new Map();
for (const f of available) { if (!families.has(f.fontName.family)) families.set(f.fontName.family, new Set()); families.get(f.fontName.family).add(f.fontName.style); }
const WEIGHTS = [[100, 'Thin'], [200, 'Extra Light', 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semi Bold', 'SemiBold', 'Demi Bold'], [700, 'Bold'], [800, 'Extra Bold', 'ExtraBold'], [900, 'Black', 'Heavy']];
const substitutions = {};
const loaded = new Set();
const fontFor = async (family, weight, italic) => {
  const fam = families.has(family) ? family : 'Inter';
  const styles = families.get(fam) || new Set(['Regular']);
  const order = [...WEIGHTS].sort((a, b) => Math.abs(a[0] - weight) - Math.abs(b[0] - weight) || b[0] - a[0]);
  let style = null;
  for (const pass of italic ? [true, false] : [false]) {
    for (const [w, ...names] of order) {
      const hit = names.map((n) => (pass ? (w === 400 ? 'Italic' : `${n} Italic`) : n)).find((n) => styles.has(n));
      if (hit) { style = hit; break; }
    }
    if (style) break;
  }
  style = style || [...styles][0];
  const want = `${family} ${weight}${italic ? ' italic' : ''}`;
  const got = `${fam} ${style}`;
  const exact = fam === family && (WEIGHTS.find((w) => w[0] === Math.round(weight / 100) * 100) || []).slice(1).some((n) => style.replace(' Italic', '') === n || (style === 'Italic' && n === 'Regular'));
  if (!exact) substitutions[want] = got;
  const font = { family: fam, style };
  if (!loaded.has(got)) { await figma.loadFontAsync(font); loaded.add(got); }
  return font;
};

const rgb = (c) => ({ r: c.r, g: c.g, b: c.b });
let TOL = 1; // how far, in px, auto layout may put a child from where the browser had it
const near = (a, b, t = TOL) => Math.abs(a - b) <= t;
const round = (v) => Math.round(v * 100) / 100;
const TRANSFORM = { right: [[1, 0, 0], [0, 1, 0]], bottom: [[0, 1, 0], [-1, 0, 1]], left: [[-1, 0, 1], [0, -1, 1]], top: [[0, -1, 1], [1, 0, 0]] };
// CSS: 0deg points up, angles run clockwise, and the gradient line is as long as the box
// is wide in that direction. Figma wants the matrix that maps the box (0..1) onto that line.
const gradientTransform = (angle, w, h) => {
  const a = (angle * Math.PI) / 180; const dx = Math.sin(a); const dy = -Math.cos(a);
  const L = Math.abs(w * dx) + Math.abs(h * dy) || 1; const nx = -dy; const ny = dx; const Lp = Math.abs(w * nx) + Math.abs(h * ny) || 1;
  const sx = w / 2 - (dx * L) / 2; const sy = h / 2 - (dy * L) / 2;
  return [[(dx * w) / L, (dy * h) / L, -(sx * dx + sy * dy) / L], [(nx * w) / Lp, (ny * h) / Lp, 0.5 - ((w / 2) * nx + (h / 2) * ny) / Lp]];
};
const images = new Map();
const imageHash = async (path) => {
  if (!images.has(path)) {
    const image = figma.createImage(new Uint8Array(await (await __get(path)).arrayBuffer()));
    await image.getSizeAsync(); // decoded now, so the export below already shows it
    images.set(path, image.hash);
  }
  return images.get(path);
};
const paints = async (fills, w, h) => {
  const out = [];
  for (const f of fills || []) {
    if (f.kind === 'solid') out.push({ type: 'SOLID', color: rgb(f.color), opacity: f.color.a });
    else if (f.kind === 'gradient') out.push({ type: 'GRADIENT_LINEAR', gradientTransform: f.angle === undefined ? TRANSFORM[f.dir] || TRANSFORM.bottom : gradientTransform(f.angle, w, h), gradientStops: f.stops.map((s) => ({ position: Math.min(1, Math.max(0, s.pos)), color: { ...rgb(s.color), a: s.color.a } })) });
    else if (f.kind === 'image' && f.img) out.push({ type: 'IMAGE', scaleMode: f.fit || 'FILL', imageHash: await imageHash(f.img) });
  }
  return out;
};

let reasons = [];
const build = async (auto) => {
  reasons = [];
  const stats = { layers: 0, autoLayout: 0, fixedLayout: 0, hardWrapped: 0 };
  const placed = []; // { node, x, y }: where each layer belongs, relative to the root frame
  const placedLocal = new Map(); // node -> its box inside its parent before any conversion

  const makeText = async (n, parent) => {
    const t = figma.createText(); parent.appendChild(t);
    t.fontName = await fontFor(n.family, n.weight, n.italic);
    t.characters = n.chars; t.fontSize = n.size; t.lineHeight = { unit: 'PIXELS', value: n.lh };
    if (n.ls) t.letterSpacing = { unit: 'PIXELS', value: n.ls };
    if (n.deco) t.textDecoration = n.deco;
    t.fills = n.color ? [{ type: 'SOLID', color: rgb(n.color), opacity: n.color.a }] : [];
    // The browser reports the glyph box; Figma places the line box. Centre one on the other.
    const glyph = n.h - (n.lines - 1) * n.lh;
    t.y = n.y + glyph / 2 - n.lh / 2;
    if (n.align !== 'left') t.textAlignHorizontal = n.align.toUpperCase();
    const anchor = (w) => (n.align === 'right' ? n.x + n.w - w : n.align === 'center' ? n.x + (n.w - w) / 2 : n.x);
    if (n.box) { t.textAutoResize = 'HEIGHT'; t.resize(Math.max(n.box, 1), n.lh); t.x = n.x; return t; } // textarea: wraps inside the control
    if (n.trunc) { t.textAutoResize = 'HEIGHT'; t.resize(Math.max(n.trunc, 1), n.lh); t.textTruncation = 'ENDING'; t.maxLines = 1; t.x = n.x; return t; }
    if (n.lines > 1) {
      // Wrapped text must break where the browser broke it. Find the widths at which Figma
      // does that: wide enough for every line, too narrow for a line plus the next word.
      // The browser's own width usually lies in that range; if no width works, the breaks
      // are written into the text.
      let width = Math.ceil(n.w) + 2; let fits = true;
      if (n.lineTexts && n.lineTexts.length === n.lines) {
        const probe = t.clone(); probe.textAutoResize = 'WIDTH_AND_HEIGHT';
        const measure = (str) => { probe.characters = str; return probe.width; };
        let lo = 0; let hi = Infinity;
        n.lineTexts.forEach((ln, i) => { lo = Math.max(lo, measure(ln)); const next = n.lineTexts[i + 1]; if (next) hi = Math.min(hi, measure(`${ln} ${next.split(' ')[0]}`)); });
        probe.remove();
        fits = lo < hi - 0.5;
        if (fits) width = Math.min(Math.max(n.w, lo + 0.25), hi - 0.25);
      }
      if (fits) { t.textAutoResize = 'HEIGHT'; t.resize(width, n.lines * n.lh); fits = near(t.height, n.lines * n.lh); }
      if (!fits && n.lineTexts) { t.characters = n.lineTexts.join('\n'); t.textAutoResize = 'WIDTH_AND_HEIGHT'; stats.hardWrapped++; }
      t.x = anchor(t.width);
      return t;
    }
    t.textAutoResize = 'WIDTH_AND_HEIGHT'; t.x = anchor(t.width);
    return t;
  };

  // Turns a built frame into auto layout when the result is the same picture. Direction,
  // gap and alignment are read from the geometry the browser produced, with the CSS (flex
  // settings, padding) as a hint; the outcome is then checked child by child.
  const tryAuto = (f, n, kids, isRoot, regrouped) => {
    const no = (why) => { if (args.explain) reasons.push(`${f.name}: ${why}`); return false; };
    if (!n.pad) return no('serialised by an older serialize.mjs');
    const flow = kids.filter((k) => !k.src.abs);
    if (!flow.length) return no('only absolutely positioned children');
    if (n.flex && /reverse/.test(n.flex.dir)) return no('reversed flex direction');
    const W = f.width; const H = f.height;
    if (!regrouped) kids.forEach((k) => placedLocal.set(k.node, { x: k.node.x, y: k.node.y, w: k.node.width, h: k.node.height }));
    const R = flow.map((k) => ({ x: k.node.x, y: k.node.y, w: k.node.width, h: k.node.height, text: k.node.type === 'TEXT' }));
    const stacked = (p, s) => R.every((r, i) => i === 0 || r[p] >= R[i - 1][p] + R[i - 1][s] - 1);
    let dir = n.flex ? (/column/.test(n.flex.dir) ? 'V' : 'H') : null;
    if (dir && !(dir === 'V' ? stacked('y', 'h') : stacked('x', 'w'))) return no('children wrap onto several lines or overlap');
    if (!dir) dir = R.length === 1 ? (R[0].text ? 'H' : 'V') : stacked('y', 'h') ? 'V' : stacked('x', 'w') ? 'H' : null;
    if (!dir) return no('children are neither one row nor one column');
    const [p, s, c, cs] = dir === 'V' ? ['y', 'h', 'x', 'w'] : ['x', 'w', 'y', 'h'];
    const PS = dir === 'V' ? H : W; const CS = dir === 'V' ? W : H;
    const gaps = R.slice(1).map((r, i) => r[p] - (R[i][p] + R[i][s]));
    const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    if (gaps.some((g) => !near(g, mean))) {
      // One gap differs from the others, at the start or at the end: a heading above a list,
      // a footer below one. A designer nests these, so do the same: wrap the even run in a
      // frame of its own and lay out [the odd one, the run].
      const even = (arr) => arr.every((g) => near(g, arr[0]));
      const cut = regrouped || gaps.length < 2 ? null : even(gaps.slice(1)) ? [1, flow.length - 1] : even(gaps.slice(0, -1)) ? [0, flow.length - 2] : null;
      const run = cut ? flow.slice(cut[0], cut[1] + 1) : [];
      const at = cut ? kids.indexOf(run[0]) : -1;
      if (cut && run.every((k, j) => kids[at + j] === k)) {
        const x0 = Math.min(...run.map((k) => k.node.x)); const y0 = Math.min(...run.map((k) => k.node.y));
        const x1 = Math.max(...run.map((k) => k.node.x + k.node.width)); const y1 = Math.max(...run.map((k) => k.node.y + k.node.height));
        const g = figma.createFrame(); g.name = dir === 'V' ? 'stack' : 'row'; g.fills = []; g.clipsContent = false;
        f.insertChild(f.children.indexOf(run[0].node), g); g.x = x0; g.y = y0; g.resize(Math.max(x1 - x0, 0.01), Math.max(y1 - y0, 0.01));
        run.forEach((k) => { const x = k.node.x - x0; const y = k.node.y - y0; g.appendChild(k.node); k.node.x = x; k.node.y = y; });
        const wrapped = tryAuto(g, { pad: [0, 0, 0, 0], bw: [0, 0, 0, 0] }, run, false, true);
        if (wrapped) {
          const next = [...kids.slice(0, at), { node: g, src: {} }, ...kids.slice(at + run.length)];
          if (tryAuto(f, n, next, isRoot, true)) { stats.autoLayout++; stats.layers++; return true; }
        }
        // It did not work out: put everything back as it was.
        if (g.layoutMode !== 'NONE') { run.forEach((k) => { try { k.node.layoutSizingHorizontal = 'FIXED'; k.node.layoutSizingVertical = 'FIXED'; } catch (e) { /* text or not resizable */ } }); g.layoutMode = 'NONE'; }
        run.forEach((k, j) => { f.insertChild(f.children.indexOf(g), k.node); });
        run.forEach((k) => { const q = placedLocal.get(k.node); if (q) { if (k.node.type !== 'TEXT') k.node.resize(Math.max(q.w, 0.01), Math.max(q.h, 0.01)); k.node.x = q.x; k.node.y = q.y; } });
        g.remove();
      }
      return no(`gaps between children differ (${gaps.map((g) => Math.round(g)).join(', ')}); auto layout has one gap`);
    }
    const spacing = n.flex && gaps.length && near(n.flex.gap, mean) ? n.flex.gap : round(mean);
    const start = R[0][p]; const end = PS - (R[R.length - 1][p] + R[R.length - 1][s]);
    if (start < -0.5) return no('first child starts outside the box');
    const between = Boolean(n.flex && n.flex.justify === 'space-between' && flow.length > 1 && end >= -1);
    const snap = kids.map((k) => ({ x: k.node.x, y: k.node.y, w: k.node.width, h: k.node.height, mode: k.node.type === 'TEXT' ? k.node.textAutoResize : null }));
    let want = snap; // where every child must be after the conversion
    const same = () => near(f.width, W, 0.5) && near(f.height, H, 0.5) && kids.every((k, i) => near(k.node.x, want[i].x) && near(k.node.y, want[i].y) && near(k.node.width, want[i].w) && near(k.node.height, want[i].h));
    const [fillC, fillP] = dir === 'V' ? ['layoutSizingHorizontal', 'layoutSizingVertical'] : ['layoutSizingVertical', 'layoutSizingHorizontal'];
    const undo = () => {
      kids.forEach((k) => { try { k.node.layoutPositioning = 'AUTO'; } catch (e) { /* not in auto layout */ } });
      f.layoutMode = 'NONE'; f.resize(W, H);
      kids.forEach((k, i) => {
        if (k.node.type === 'TEXT') { if (k.node.textAutoResize !== snap[i].mode) k.node.textAutoResize = snap[i].mode; if (snap[i].mode !== 'WIDTH_AND_HEIGHT' && !near(k.node.width, snap[i].w, 0.01)) k.node.resize(snap[i].w, snap[i].h); }
        else if (!(near(k.node.width, snap[i].w, 0.01) && near(k.node.height, snap[i].h, 0.01))) k.node.resize(Math.max(snap[i].w, 0.01), Math.max(snap[i].h, 0.01));
        k.node.x = snap[i].x; k.node.y = snap[i].y;
      });
    };
    let last = 'no alignment fits every child';

    // With a border, first try the layout a designer would make (strokes are part of the
    // layout, padding is the CSS padding), then the plain one with the border folded into
    // the padding.
    for (const strokes of n.bw.some((w) => w > 0) ? [true, false] : [false]) {
      const edge = (i) => n.pad[i] + (strokes ? 0 : n.bw[i]); // top right bottom left
      const off = (i) => (strokes ? n.bw[i] : 0);
      const [p0, p1, c0, c1, o0, o1, oc0, oc1] = dir === 'V' ? [edge(0), edge(2), edge(3), edge(1), off(0), off(2), off(3), off(1)] : [edge(3), edge(1), edge(0), edge(2), off(3), off(1), off(0), off(2)];
      const s0 = start - o0; const e0 = end - o1; // room before the first and after the last child, inside the border
      // Padding is what the CSS says, not whatever room happens to be left over: a box wider
      // than its content keeps its fixed size and its real padding. (Figma rounds text
      // widths up to whole pixels, so content may be up to 1 px wider than in the browser.)
      let main = 'MIN'; let padS = near(s0, p0) ? p0 : s0; let padE = e0 >= p1 - 1.5 ? p1 : Math.max(0, e0);
      if (!between && !near(s0, p0)) {
        if (near(e0, p1, 1.5)) { main = 'MAX'; padS = p0; }
        else if (near(s0 - p0, e0 - p1, 1.5) && s0 > p0) { main = 'CENTER'; padS = p0; padE = p1; }
      }
      if (padS < 0) continue;
      const lead = oc0 + c0; const inner = CS - lead - c1 - oc1;
      const fits = { MIN: (r) => near(r[c], lead), CENTER: (r) => near(r[c] + r[cs] / 2, lead + inner / 2), MAX: (r) => near(r[c] + r[cs], CS - c1 - oc1) };
      const stretch = R.map((r) => !r.text && near(r[c], lead) && near(r[cs], inner));
      // In a column, a text fills the width and keeps its own alignment (left, centred,
      // right), the way a designer sets a label. That also lets a left and a right aligned
      // text live in the same column.
      const textFill = R.map((r, i) => dir === 'V' && r.text && inner > 1 && fits[{ left: 'MIN', center: 'CENTER', right: 'MAX' }[flow[i].src.align || 'left']](r) && r.w <= inner + 1);
      const rest = R.filter((_, i) => !stretch[i] && !textFill[i]);
      const hint = n.flex ? ({ center: 'CENTER', 'flex-end': 'MAX', end: 'MAX' })[n.flex.align] || 'MIN' : 'MIN';
      const cross = [hint, 'MIN', 'CENTER', 'MAX'].find((a) => rest.every(fits[a]));
      if (!cross) continue;
      want = snap.map((q, i) => { const j = flow.indexOf(kids[i]); return j >= 0 && textFill[j] ? { ...q, x: lead, w: inner } : q; });
      let ok = false;
      try {
        f.layoutMode = dir === 'V' ? 'VERTICAL' : 'HORIZONTAL';
        f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
        f.resize(W, H);
        f.strokesIncludedInLayout = strokes;
        const [kS, kE, kC0, kC1] = dir === 'V' ? ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'] : ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'];
        f[kS] = round(padS); f[kE] = round(padE); f[kC0] = round(Math.max(0, c0)); f[kC1] = round(Math.max(0, c1));
        f.itemSpacing = between ? n.flex.gap : spacing;
        f.primaryAxisAlignItems = between ? 'SPACE_BETWEEN' : main;
        f.counterAxisAlignItems = cross;
        kids.forEach((k, i) => { if (k.src.abs) { k.node.layoutPositioning = 'ABSOLUTE'; k.node.x = snap[i].x; k.node.y = snap[i].y; } });
        flow.forEach((k, i) => {
          if (textFill[i]) { if (k.node.textAutoResize === 'WIDTH_AND_HEIGHT') k.node.textAutoResize = 'HEIGHT'; k.node.layoutSizingHorizontal = 'FILL'; }
          if (stretch[i]) k.node[fillC] = 'FILL';
          if (k.src.grow && n.flex && !R[i].text) k.node[fillP] = 'FILL';
        });
        ok = same();
        if (ok && !isRoot) {
          // Hug the content when that gives the same size, so the frame keeps working when edited.
          if (!between && main === 'MIN' && !flow.some((k) => k.src.grow)) { f.primaryAxisSizingMode = 'AUTO'; if (!same()) { f.primaryAxisSizingMode = 'FIXED'; f.resize(W, H); } }
          if (!stretch.some(Boolean) && !textFill.some(Boolean)) { f.counterAxisSizingMode = 'AUTO'; if (!same()) { f.counterAxisSizingMode = 'FIXED'; f.resize(W, H); } }
          ok = same();
        }
        if (!ok) last = 'auto layout would move or resize a child by more than 1 px';
      } catch (e) { ok = false; last = String(e).slice(0, 120); }
      if (ok) {
        // A text that now fills the column has a new box (its glyphs did not move).
        flow.forEach((k, i) => { if (textFill[i]) { const q = placed.find((e) => e.node === k.node); if (q) q.x += lead - snap[kids.indexOf(k)].x; } });
        return true;
      }
      undo();
    }
    return no(last);
  };

  const make = async (n, parent, ox, oy, isRoot) => {
    stats.layers++;
    let node;
    if (n.type === 'SVG') {
      node = figma.createNodeFromSvg(n.svg); parent.appendChild(node);
      node.x = n.x; node.y = n.y; node.name = n.name || 'Icon'; if (n.opacity < 1) node.opacity = n.opacity;
    } else if (n.type === 'IMAGE') {
      const r = (node = figma.createRectangle()); parent.appendChild(r);
      r.name = n.name || 'Image'; r.x = n.x; r.y = n.y; r.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
      r.fills = n.img ? [{ type: 'IMAGE', scaleMode: n.fit || 'FILL', imageHash: await imageHash(n.img) }] : [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
      [r.topLeftRadius, r.topRightRadius, r.bottomRightRadius, r.bottomLeftRadius] = n.radius;
      if (n.opacity < 1) r.opacity = n.opacity;
    } else if (n.type === 'TEXT') node = await makeText(n, parent);
    else {
      const f = (node = figma.createFrame()); parent.appendChild(f);
      f.name = n.name; f.x = n.x; f.y = n.y; f.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
      f.fills = await paints(n.fills, Math.max(n.w, 0.01), Math.max(n.h, 0.01));
      f.clipsContent = Boolean(n.clip);
      [f.topLeftRadius, f.topRightRadius, f.bottomRightRadius, f.bottomLeftRadius] = n.radius;
      if (n.bc && n.bw.some((w) => w > 0)) {
        f.strokes = [{ type: 'SOLID', color: rgb(n.bc), opacity: n.bc.a }]; f.strokeAlign = 'INSIDE';
        f.strokeTopWeight = n.bw[0]; f.strokeRightWeight = n.bw[1]; f.strokeBottomWeight = n.bw[2]; f.strokeLeftWeight = n.bw[3];
        if (n.dashed) f.dashPattern = [4, 3];
      }
      if (n.shadows.length) f.effects = n.shadows.map((sh) => ({ type: sh.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: { ...rgb(sh.color), a: sh.color.a }, offset: { x: sh.x, y: sh.y }, radius: sh.blur, spread: sh.spread, visible: true, blendMode: 'NORMAL' }));
      if (n.opacity < 1) f.opacity = n.opacity;
      const kids = [];
      for (const ch of n.children) kids.push({ node: await make(ch, f, isRoot ? 0 : ox + n.x, isRoot ? 0 : oy + n.y, false), src: ch });
      if (auto && kids.length) { if (tryAuto(f, n, kids, isRoot)) stats.autoLayout++; else stats.fixedLayout++; }
    }
    if (!isRoot) placed.push({ node, x: ox + node.x, y: oy + node.y });
    return node;
  };

  const frame = await make(tree, page, 0, 0, true);
  // Did anything end up somewhere else than the browser had it?
  const o = frame.absoluteTransform; let maxDrift = 0;
  for (const q of placed) { const m = q.node.absoluteTransform; maxDrift = Math.max(maxDrift, Math.abs(m[0][2] - o[0][2] - q.x), Math.abs(m[1][2] - o[1][2] - q.y)); }
  return { frame, stats, maxDrift: round(maxDrift) };
};

// Small shifts add up through nested frames. If any layer ends up more than 1.5 px off, build
// again with a stricter check, and as a last resort without auto layout.
let built = await build(autoLayout);
let revertedForDrift = false;
if (autoLayout && built.maxDrift > 1.5) { built.frame.remove(); TOL = 0.5; built = await build(true); }
if (autoLayout && built.maxDrift > 1.5) { built.frame.remove(); built = await build(false); revertedForDrift = true; }
const { frame, stats } = built;

// Replace the older frame of the same name where it stands, so sections stay in order and
// nobody has to arrange again after a rebuild.
const old = replace ? page.findAll((c) => c !== frame && c.type === 'FRAME' && c.name === title && (c.parent.type === 'PAGE' || c.parent.type === 'SECTION')) : [];
if (old.length) {
  const first = old[0]; const parent = first.parent;
  parent.insertChild(parent.children.indexOf(first), frame);
  frame.x = args.x !== undefined ? args.x : first.x; frame.y = args.y !== undefined ? args.y : first.y;
  old.forEach((c) => c.remove());
} else {
  const others = page.children.filter((c) => c !== frame);
  frame.x = args.x !== undefined ? args.x : others.length ? Math.max(...others.map((c) => c.x + c.width)) + 120 : 0;
  frame.y = args.y !== undefined ? args.y : others.length ? Math.min(...others.map((c) => c.y)) : 0;
}
frame.name = title;
figma.viewport.scrollAndZoomIntoView([frame]);
if (args.export !== false) await __post(`fig-${name}.png`, await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } }));
const key = (location.pathname.match(/\/(?:design|file)\/([^/]+)/) || [])[1];
return { name, title, page: page.name, id: frame.id, url: key ? `https://www.figma.com/design/${key}?node-id=${frame.id.replace(':', '-')}` : null,
  w: Math.round(frame.width), h: Math.round(frame.height), layers: stats.layers, replaced: old.length,
  autoLayout: stats.autoLayout, fixedLayout: stats.fixedLayout, autoLayoutRevertedForDrift: revertedForDrift, maxDrift: built.maxDrift, hardWrapped: stats.hardWrapped,
  fontSubstitutions: substitutions, ...(args.explain ? { notAutoLayout: reasons } : {}) };
