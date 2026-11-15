// Puts a note on the canvas: an implementation rule beside a frame ("the reminder resends
// the same e-mail"), or an open decision for the team. Notes that live only in the chat are
// forgotten by the time someone builds the screen.
// args: { title, text, near?: '<frame name or node id>', page?, width? = 420, kind? = 'note' | 'decision' }
const { title = 'Note', text = '', near, width = 420, kind = 'note' } = args;
await figma.loadAllPagesAsync();
const page = args.page ? figma.root.children.find((p) => p.name === args.page) : figma.currentPage;
if (!page) throw new Error(`note: no page named ${args.page}`);
let anchor = null;
if (near) {
  anchor = /^\d+:\d+$/.test(near) ? await figma.getNodeByIdAsync(near)
    : page.findOne((n) => n.type === 'FRAME' && (n.parent.type === 'PAGE' || n.parent.type === 'SECTION') && (n.name === near || n.name.startsWith(`${near} ·`)));
  if (!anchor) throw new Error(`note: nothing called "${near}" on page ${page.name} (node ids change when a frame is rebuilt; use the frame name)`);
}
const styles = (await figma.listAvailableFontsAsync()).filter((f) => f.fontName.family === 'Inter').map((f) => f.fontName.style);
const bold = { family: 'Inter', style: styles.includes('Semi Bold') ? 'Semi Bold' : 'Bold' }; const regular = { family: 'Inter', style: 'Regular' };
await figma.loadFontAsync(bold); await figma.loadFontAsync(regular);
const parent = anchor ? anchor.parent : page;
const f = figma.createFrame(); parent.appendChild(f);
f.name = `${kind === 'decision' ? 'Decision' : 'Note'} · ${title}`;
f.layoutMode = 'VERTICAL'; f.itemSpacing = 8; f.paddingTop = f.paddingBottom = 16; f.paddingLeft = f.paddingRight = 18; f.cornerRadius = 12;
f.resize(width, 100); f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'FIXED';
f.fills = [{ type: 'SOLID', color: kind === 'decision' ? { r: 0.91, g: 0.94, b: 0.99 } : { r: 0.99, g: 0.95, b: 0.86 } }];
const add = (chars, font, size, lh) => { const t = figma.createText(); t.fontName = font; t.characters = chars; t.fontSize = size; t.lineHeight = { unit: 'PIXELS', value: lh }; t.fills = [{ type: 'SOLID', color: { r: 0.08, g: 0.08, b: 0.08 } }]; f.appendChild(t); t.layoutSizingHorizontal = 'FILL'; t.textAutoResize = 'HEIGHT'; };
add(title, bold, 15, 22); add(text, regular, 13, 20);
if (anchor) { f.x = anchor.x + anchor.width + 40; f.y = anchor.y; }
else { const others = page.children.filter((c) => c !== f); f.x = others.length ? Math.max(...others.map((c) => c.x + c.width)) + 120 : 0; f.y = others.length ? Math.min(...others.map((c) => c.y)) : 0; }
return { id: f.id, name: f.name, in: parent.name };
