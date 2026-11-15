// Reads every comment of the open file through the logged-in tab and posts them to
// out/comments.json. Uses the endpoint the Figma web app itself calls, so it can change;
// the documented alternative is GET https://api.figma.com/v1/files/<key>/comments with a
// personal access token.
// args: { fileKey? }  (default: the file open in this tab)
const key = args.fileKey || (location.pathname.match(/\/(?:design|file|board)\/([^/]+)/) || [])[1];
if (!key) throw new Error('comments: no file key');
const res = await fetch(`/api/file/${key}/comments`, { credentials: 'include' });
if (!res.ok) throw new Error(`comments: HTTP ${res.status}`);
const all = (await res.json()).meta || [];
await figma.loadAllPagesAsync();
const frameOf = async (id) => {
  if (!id) return null;
  let n = null; try { n = await figma.getNodeByIdAsync(id); } catch (e) { return null; }
  while (n && n.parent && n.parent.type !== 'PAGE' && n.parent.type !== 'SECTION') n = n.parent;
  return n ? n.name : null;
};
const threads = [];
for (const c of all.filter((x) => !x.parent_id && !x.deleted_at)) {
  const meta = c.client_meta || {};
  threads.push({
    n: c.order_id, id: c.id, resolved: Boolean(c.resolved_at), author: c.user && c.user.handle, at: c.created_at,
    frame: await frameOf(meta.node_id), nodeId: meta.node_id || null, offset: meta.node_offset || null, pageId: c.page_id || null,
    text: c.message, thumbnail: c.thumbnail_url || null,
    replies: all.filter((r) => r.parent_id === c.id && !r.deleted_at).map((r) => ({ author: r.user && r.user.handle, at: r.created_at, text: r.message })),
  });
}
await __post('comments.json', JSON.stringify(threads, null, 1));
return { threads: threads.length, open: threads.filter((t) => !t.resolved).length, withoutFrame: threads.filter((t) => !t.frame).length, saved: 'out/comments.json' };
