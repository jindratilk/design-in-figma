// How is a frame put together? Shows which boxes are auto layout (direction, gap, padding,
// alignment, fill / hug) and which are still positioned absolutely. Run it after build to
// see what a designer who opens the frame will find.
// args: { name? , id?, depth? = 3 }   name: the frame name in Figma (or its "<KEY> ·" prefix)
const page = figma.currentPage;
const root = args.id ? await figma.getNodeByIdAsync(args.id)
  : page.findOne((n) => n.type === 'FRAME' && (n.parent.type === 'PAGE' || n.parent.type === 'SECTION') && (n.name === args.name || n.name.startsWith(`${args.name} ·`)));
if (!root) throw new Error('layout: frame not found on the open page (pass name or id)');
const depth = args.depth || 3;
const walk = (n, d) => {
  const kids = 'children' in n ? n.children : [];
  const how = n.type !== 'FRAME' ? n.type.toLowerCase()
    : n.layoutMode === 'NONE' ? (kids.length ? 'absolute positions' : 'box')
    : `${n.layoutMode === 'VERTICAL' ? 'column' : 'row'}, gap ${n.itemSpacing}, padding ${[n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].join(' ')}, ${n.primaryAxisAlignItems}/${n.counterAxisAlignItems}, ${n.layoutSizingHorizontal} x ${n.layoutSizingVertical}`;
  const row = { name: n.name, layout: how };
  if (d < depth && kids.length && n.type === 'FRAME') row.children = kids.map((k) => walk(k, d + 1));
  else if (kids.length) row.layers = kids.length;
  return row;
};
const parents = [root, ...root.findAllWithCriteria({ types: ['FRAME'] })].filter((f) => f.children.length);
return { frame: root.name, boxesWithChildren: parents.length, autoLayout: parents.filter((f) => f.layoutMode !== 'NONE').length, tree: walk(root, 0) };
