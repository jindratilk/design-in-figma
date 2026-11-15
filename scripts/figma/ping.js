// Is the bridge alive and connected to the live document? Returns the file and its pages.
await figma.loadAllPagesAsync();
return {
  file: figma.root.name,
  fileKey: (location.pathname.match(/\/(?:design|file|board)\/([^/]+)/) || [])[1] || null,
  editor: figma.editorType,
  currentPage: figma.currentPage.name,
  pages: figma.root.children.map((p) => ({ id: p.id, name: p.name, children: p.children.length, sections: p.children.filter((c) => c.type === 'SECTION').map((s) => `${s.name} (${s.children.length})`) })),
};
