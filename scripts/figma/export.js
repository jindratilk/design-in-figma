// Posts frames back as PNG files (out/<prefix><key>.png) so you can look at what is in Figma.
// args: { page?, keys?: ['A1', 'B3'], ids?: ['12:34'], scale? = 1, prefix? = 'fig-' }
//   keys  frames named "<KEY> · ..."; without keys and ids every keyed frame of the page
const { keys, ids, scale = 1, prefix = 'fig-' } = args;
await figma.loadAllPagesAsync();
const page = args.page ? figma.root.children.find((p) => p.name === args.page) : figma.currentPage;
if (!page) throw new Error(`export: no page named ${args.page}`);
const targets = [];
if (ids) for (const id of ids) { const n = await figma.getNodeByIdAsync(id); if (n) targets.push([id.replace(':', '-'), n]); }
if (keys || !ids) {
  for (const f of page.findAll((c) => c.type === 'FRAME' && (c.parent.type === 'PAGE' || c.parent.type === 'SECTION'))) {
    const key = f.name.split(' ·')[0];
    if (keys ? keys.includes(key) : /^[A-Z]+\d+[a-z]*$/.test(key)) targets.push([key, f]);
  }
}
const done = [];
for (const [key, node] of targets) {
  await __post(`${prefix}${key}.png`, await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } }));
  done.push(key);
}
return { page: page.name, exported: done };
