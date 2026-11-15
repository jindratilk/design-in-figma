// Bridge agent. Runs inside a Figma browser tab (pasted once into the DevTools console by a
// loader line, see connect.sh). It long-polls the local bridge server for cmd-<channel>.js,
// runs it as the body of an async function with the plugin API global `figma` in scope, and posts
// the returned value to out/result-<channel>.json.
//
// Helpers for command scripts:
//   __post(name, body)  POST bytes or text to the server; saved as out/<name>
//   __get(path)         GET a file from the work directory or a recipe (figma/<name>.js)
//   __run(name, args)   run another recipe in the same tab and return its result
(() => {
  const cfg = window.__fb || {};
  const port = cfg.port || 48765;
  const ch = cfg.ch || 'main';
  const base = `http://127.0.0.1:${port}`;
  window.__fbAgents = window.__fbAgents || {};
  if (window.__fbAgents[ch]) { console.log(`figma bridge: channel "${ch}" already running`); return; }
  window.__fbAgents[ch] = true;
  const me = Math.random().toString(36).slice(2, 10); // this tab on this channel
  window.__post = (name, body) => fetch(`${base}/${name}`, { method: 'POST', body });
  window.__get = (path) => fetch(`${base}/${path}?t=${Date.now()}`);
  window.__run = async (name, args = {}) => {
    const src = await (await window.__get(`figma/${name}.js`)).text();
    return (0, eval)(`(async (args) => {${src}\n})`)(args);
  };
  const fileKey = () => (location.pathname.match(/\/(?:design|file|board)\/([^/]+)/) || [])[1] || null;
  const run = async (id, text) => {
    let res;
    try { res = { id, ok: true, out: await (0, eval)(`(async () => {${text}\n})()`) }; }
    catch (e) { res = { id, ok: false, err: String((e && e.stack) || e) }; }
    await window.__post(`result-${ch}.json`, JSON.stringify(res)).catch(() => {});
  };
  const loop = async () => {
    // Do not run a command left over from an earlier session.
    let last = '';
    try { const r = await fetch(`${base}/cmd-${ch}.js?t=${Date.now()}`); if (r.ok) last = (await r.text()).split('\n')[0]; } catch (e) { /* no server yet */ }
    let first = true;
    for (;;) {
      try {
        // Long poll: the server answers when a new command is there. No timer is involved,
        // so a tab in the background answers as fast as one in front.
        const r = await fetch(`${base}/poll/${ch}?last=${encodeURIComponent(last)}&agent=${me}&file=${encodeURIComponent(fileKey() || '')}${first ? '&start=1' : ''}`);
        first = false;
        // One tab per channel: a newer tab connected to this channel, so this one stops.
        if (r.status === 410) { window.__fbAgents[ch] = false; console.log(`figma bridge: channel "${ch}" was taken over by a newer tab; this tab stopped listening`); return; }
        if (r.status === 200) {
          const text = await r.text();
          const id = text.split('\n')[0];
          if (id !== last) { last = id; run(id, text); } // not awaited: a stuck script must not block the next one
        }
      } catch (e) { await new Promise((resolve) => setTimeout(resolve, 1500)); } // server down: retry
    }
  };
  window.__post(`hello-${ch}.json`, JSON.stringify({ ch, fileKey: fileKey(), figma: typeof figma, at: new Date().toISOString() }))
    .catch(() => {});
  loop();
  console.log(`figma bridge: channel "${ch}" started on ${base}`);
})();
