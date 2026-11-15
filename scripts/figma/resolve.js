// Marks comment threads as resolved, after the remark is visibly handled and the reviewer
// asked for it (see feedback-loop.md). Give the thread ids from out/comments.json. Only a
// thread can be resolved, not a single reply (the server answers 400 for a reply id).
// Uses the endpoint the Figma web app itself calls, so it can change.
// args: { ids: ['<thread id>', ...] }
const key = (location.pathname.match(/\/(?:design|file|board)\/([^/]+)/) || [])[1];
if (!key) throw new Error('resolve: no file key');
if (!Array.isArray(args.ids) || !args.ids.length) throw new Error('resolve: args.ids is required');
const done = [];
for (const id of args.ids) {
  const res = await fetch(`/api/file/${key}/comments/${id}`, {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Csrf-Bypass': 'yes' },
    body: JSON.stringify({ resolved_at: new Date().toISOString() }),
  });
  done.push({ id, status: res.status });
}
return { resolved: done.filter((d) => d.status === 200).length, results: done };
