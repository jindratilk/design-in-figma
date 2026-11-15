// A tab left in the background for hours can lose Figma's live connection and keep
// answering from a stale local copy: new layers are missing and getNodeByIdAsync fails with
// "Unable to establish connection to Figma". This nudges the tab back online without
// touching the keyboard, then proves it by resolving a node.
// args: { probeId?: '12:34', waitMs? = 20000 }
window.dispatchEvent(new Event('offline'));
await new Promise((r) => setTimeout(r, 500));
window.dispatchEvent(new Event('online'));
window.dispatchEvent(new Event('focus'));
await new Promise((r) => setTimeout(r, args.waitMs || 20000));
const out = {};
try {
  await figma.loadAllPagesAsync();
  const id = args.probeId || figma.currentPage.id;
  const n = await figma.getNodeByIdAsync(id);
  out.connected = Boolean(n); out.probe = n ? n.name : null;
} catch (e) { out.connected = false; out.error = String(e).slice(0, 160); }
out.pages = figma.root.children.map((p) => [p.name, p.children.length]);
return out;
