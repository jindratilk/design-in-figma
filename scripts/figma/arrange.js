// Files frames into lettered sections on one page and lays each section out as a grid.
// Frames are found by name "<KEY> · <title>" (also "Container (<KEY> · <title>)", the name
// the official html-to-design capture gives), where KEY is letters + number, e.g. B12 or F3a.
// args: { page, sections?: { A: 'Overview', B: 'Order detail' }, perRow? = 6, gap? = 120, minFrames? = 1 }
//   sections  letter -> section name; without it every letter found gets a section
//   A frame with a key that already exists in its section replaces the older one.
const { page: pageName, sections, perRow = 6, gap = 120, minFrames = 1 } = args;
if (!pageName) throw new Error('arrange: args.page is required');
await figma.loadAllPagesAsync();
let page = figma.root.children.find((p) => p.name === pageName);
if (!page) { page = figma.createPage(); page.name = pageName; }
const KEY = /^(?:Container \()?(([A-Z]+)\d+[a-z]*) · (.*?)\)?$/;
const loose = figma.root.children.flatMap((p) => p.children).filter((n) => n.type === 'FRAME' && KEY.test(n.name));
const fresh = loose.map((n) => { const m = n.name.match(KEY); return { node: n, key: m[1], letter: m[2], title: m[3] }; }).filter((f) => !sections || sections[f.letter]);
const already = page.children.filter((c) => c.type === 'SECTION').reduce((s, c) => s + c.children.length, 0);
if (fresh.length + already < minFrames) throw new Error(`arrange: found ${fresh.length} loose frames and ${already} filed ones, expected at least ${minFrames}. Nothing was changed.`);
const sectionFor = (letter) => {
  let s = page.children.find((c) => c.type === 'SECTION' && c.name.startsWith(`${letter} ·`));
  if (!s) { s = figma.createSection(); page.appendChild(s); }
  s.name = `${letter} · ${(sections && sections[letter]) || s.name.split(' · ')[1] || letter}`;
  return s;
};
const moved = []; const replaced = [];
for (const f of fresh) {
  const sec = sectionFor(f.letter);
  const old = sec.children.find((c) => c !== f.node && c.name.startsWith(`${f.key} ·`));
  f.node.name = `${f.key} · ${f.title}`; sec.appendChild(f.node);
  if (old) { old.remove(); replaced.push(f.key); }
  moved.push(f.key);
}
const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
const secs = page.children.filter((c) => c.type === 'SECTION').sort(natural);
let top = 0;
for (const sec of secs) {
  let x = gap; let y = gap + 40; let rowH = 0; let maxX = 0;
  [...sec.children].sort(natural).forEach((k, i) => {
    if (i && i % perRow === 0) { x = gap; y += rowH + gap * 1.5; rowH = 0; }
    k.x = x; k.y = y; x += k.width + gap; rowH = Math.max(rowH, k.height); maxX = Math.max(maxX, x);
  });
  sec.resizeWithoutConstraints(Math.max(maxX, 800), y + rowH + gap);
  sec.x = 0; sec.y = top; top += sec.height + gap * 2.5;
}
await figma.setCurrentPageAsync(page);
figma.viewport.scrollAndZoomIntoView(secs);
return { page: page.name, moved: moved.length, replaced, sections: secs.map((s) => [s.name, s.children.length]) };
