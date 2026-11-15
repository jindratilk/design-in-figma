# Connecting to Figma without the MCP: the console bridge

## Why it exists

The official Figma MCP server is the easy way in, but it is not always there: it may not
be installed or logged in for this session, and on a Starter plan it stops answering after
roughly twenty read or edit calls ("You've reached the Figma MCP tool call limit"). A
design round with a hundred frames needs thousands of operations.

The bridge has no such limit, needs no token and no plugin install. It uses one fact: in
the Figma web editor, the plugin API is available as the global `figma` in the page's
JavaScript console, for any file the logged-in user can edit. Whatever a plugin can do,
a script in that console can do.

```
 your shell                         local server                    Figma tab in Chrome
 run.sh build ...   writes  ->   .figma-bridge/cmd-main.js   <- long-polled by agent.js
 prints the result  <- reads     .figma-bridge/out/result-main.json  <- POSTed by agent.js
                                 .figma-bridge/out/*.png             <- exports POSTed by scripts
```

- `scripts/bridge/server.py` serves a work directory on `127.0.0.1` and saves whatever
  the tab posts into `out/`. It refuses every browser request that does not come from a
  figma.com page. `curl -s http://127.0.0.1:48765/status` shows which file each channel
  is connected to and when the tab last asked for work.
- `scripts/bridge/agent.js` runs in the tab. It long-polls the server for the next
  command, runs it as the body of an async function, and posts the returned value back.
  There is no timer in that loop, so the tab answers in under a second even when it is in
  the background, where browsers slow timers down to one tick a minute. A script that
  never finishes does not block the next one.
- `scripts/bridge/run.sh` writes a command, waits for the answer and prints it. A command
  takes about 150 ms. With `FIGMA_BRIDGE_FILE=<fileKey>` set, a command refuses to run in
  a tab that has another file open; set it for the whole round.
- `scripts/bridge/connect.sh` opens the file and starts the agent in the tab.

## Connect

Requirements: a browser where the user is logged in to Figma with edit access to the
file, Python 3, and for the automatic way macOS with Chrome and
[Peekaboo](https://github.com/steipete/Peekaboo) (it needs Accessibility permission to press keys).

```bash
export FIGMA_BRIDGE_DIR="$PWD/.figma-bridge"     # keep it out of git
scripts/bridge/connect.sh "https://www.figma.com/design/<fileKey>/<name>"   # or: connect.sh new
scripts/bridge/run.sh ping
```

`connect.sh` prints the hello message of the tab (`{"ch":"main","fileKey":"…","figma":"object"}`)
when it worked. `"figma":"undefined"` means the tab has no plugin API: view-only access,
the mobile viewer, or the file is still loading.

Without Peekaboo, or on another system, `connect.sh` prints one loader line. Ask the user
to open the file, open the JavaScript console (View > Developer > JavaScript Console) and
paste it once. That is the only manual step; everything after it runs from your shell.

```js
window.__fb={port:48765,ch:'main'};fetch('http://127.0.0.1:48765/agent.js').then(r=>r.text()).then(t=>(0,eval)(t))
```

What can stop the first connection, and what to do:

| What you see | Cause and fix |
| --- | --- |
| Chrome asks whether figma.com may reach devices on the local network | Allow it once. The fetch to `127.0.0.1` waits for that answer. |
| The console says to type `allow pasting` | Chrome's paste protection on a profile that never used the console. Type it once. |
| Agent starts, `figma` is undefined | View-only access, or DevTools opened with the device toolbar on and a reload gave the mobile viewer. Switch the toolbar off and reload. |
| The key chord for the console does nothing | Use the menu item (`peekaboo menu click --path "View > Developer > JavaScript Console"`), which is what `connect.sh` does. |
| Nothing is pasted | The Chrome process id changes after a restart. `connect.sh` looks it up each time; do not hard-code it. |

Rules while driving the user's browser:

- Open a fresh tab for the bridge. An old tab can hold a stale copy of the document. A
  channel belongs to the tab that connected last: the agent in an older tab on the same
  channel stops by itself, so a command never runs twice.
- Click and type only inside DevTools. A click on the canvas selects or moves a layer.
- Close DevTools when the agent runs (`connect.sh` does). The agent keeps polling.
- Leave the tab open; it may sit in the background. If the server stops, the agent
  waits; `run.sh` restarts the server and the tab reconnects without anyone touching the
  keyboard (give the first command after a restart a timeout of a minute or two).
- Other agents or the user may be working in the same browser. Do not close or reload
  tabs you did not open.

## Run scripts

```bash
scripts/bridge/run.sh <script.js | recipe> [timeout_s] ['<json args>']
```

A script is the body of an async function. It can `await`, reads its arguments from
`args`, and returns something JSON-serialisable.

```js
// count.js — how many top-level frames does each page have?
await figma.loadAllPagesAsync();
return figma.root.children.map((p) => [p.name, p.children.length]);
```

In the tab you also have:

- `__post(name, body)` saves bytes or text as `out/<name>` (PNG exports, JSON dumps).
- `__get(path)` fetches a file from the work directory (`data/…`) or a recipe.
- `__run(name, args)` runs another recipe and returns its result.
- `fetch('/api/…', { credentials: 'include' })` calls Figma's own web endpoints as the
  logged-in user. That is how `comments` reads every comment thread.

Recipes in `scripts/figma/`:

| Recipe | What it does |
| --- | --- |
| `ping` | File name, key, pages with their sections. Run it first, every time. |
| `build` | Replays a serialised HTML mockup as editable auto-layout layers (see mockup-pipeline.md). |
| `layout` | Shows how a built frame is put together: which boxes are auto layout, with gap and padding. |
| `arrange` | Files frames named `<KEY> · <title>` into lettered sections and lays them out. |
| `export` | Posts frames back as PNG so you can look at what is really in Figma. |
| `note` | Puts an implementation note or an open decision on the canvas, beside a frame. |
| `comments` | Saves every comment thread with its frame and pin offset to `out/comments.json`. |
| `resolve` | Marks comment threads as resolved (ids from `out/comments.json`). |
| `fonts` | Styles Figma has for a family, and text layers with a missing font. |
| `measure` | How wide Figma sets a text, to check that your mockup loads the same font version. |
| `reconnect` | Brings a stale tab back online and proves it by resolving a node. |

Plugin API facts you will need when you write your own scripts:

- Call `await figma.loadAllPagesAsync()` before you touch pages other than the open one.
- Load a font before you change text: `await figma.loadFontAsync(node.fontName)`; for
  mixed text, load every font from `getStyledTextSegments(['fontName'])`.
- Use the async getters (`getNodeByIdAsync`, `setCurrentPageAsync`).
- From the console, `setPluginData` fails (no plugin id) and assigning `figma.root.name`
  does nothing. `setSharedPluginData` works. Ask the user to rename the file.
- `figma.createNodeFromSvg`, `figma.createImage(bytes)`, `exportAsync`, sections, pages,
  auto layout and variables all work.
- Prefer the smallest search that works (`findAllWithCriteria({ types: ['TEXT'] })`,
  `page.children`) over `findAll` on a file with thousands of layers.

## Several agents at once

Each agent gets its own channel so commands and results cannot collide:

```bash
FIGMA_BRIDGE_CH=mail scripts/bridge/connect.sh "<file url>"
FIGMA_BRIDGE_CH=mail scripts/bridge/run.sh ping
```

One server and one work directory can carry any number of channels. Only one agent should
arrange or delete on a page at a time. Never give two tabs the same channel: the newer
one takes it over.

## Mistakes that cost real work

- **A delete script with an empty keep-list removed a whole page of frames.** The list
  came from a shell function that passed several names as one word. Guard every script
  that deletes: refuse to run when the keep-list or the match count is implausibly small
  (`if (keep.size < 20) throw …`). `arrange` has `minFrames` for the same reason. Build
  lists in `bash -c` or an array, never from an unquoted variable in zsh.
- **A loose search moved the wrong layer.** `findOne` on "contains this text" matched a
  whole content container. Find the exact text node and walk up to the parent you mean.
- **A short timeout looked like a hang.** A tab that is syncing hundreds of new layers
  answers slowly. Use `run.sh <recipe> 900` for bulk work, and check with a count before
  you arrange.
- **A tab left in the background for hours answered from a stale copy.** New layers were
  missing and `getNodeByIdAsync` failed with "Unable to establish connection to Figma".
  Run `reconnect`, then check that a freshly created node id resolves before you change
  anything.
- **Exporting right after creating an image fill showed an empty rectangle.** Wait for
  the image (`await image.getSizeAsync()`), as `build` does.
- **Local fonts appear in Figma only after the tab is reloaded.** In the browser Figma
  reads local fonts through its font helper; install the font, install the helper, reload
  the tab, connect again. A family may lack the weights your mockup uses (600 and 800 are
  the usual ones); `build` substitutes the nearest heavier style and reports it.

## Safety

- The server listens on `127.0.0.1` only. It answers a browser only for pages of
  figma.com and refuses (403) a request sent by any other website or addressed to another
  host name, so a page open in another tab can neither read the work directory nor write
  a fake result into it. Commands are files: the agent runs whatever is in the command
  file, so the work directory must be writable only by you. Stop the server when the
  round is over.
- The first connection makes Chrome ask whether figma.com may reach devices on the local
  network. That permission stays with the browser profile; the user can take it back in
  the site settings of figma.com.
- You act as the logged-in user in their real files. Work on your own page, never delete
  or move frames you did not create unless asked, and say what you changed.
- Sample data in mockups is fictional. Never copy real customer names, e-mails or numbers
  into a design file that will be shared.

## Other ways in

- **Figma REST API** with a personal access token (`X-Figma-Token`): reads files, renders
  frames to images and reads or posts comments. It cannot create or change layers, so it
  complements the bridge but does not replace it.
- **Chrome DevTools Protocol** (not tested here): if a Chrome started with
  `--remote-debugging-port` is logged in to Figma, the loader line can be evaluated in the
  tab with Playwright's `connectOverCDP` instead of being pasted, and the rest works the
  same. Chrome refuses remote debugging on the default profile, so this needs a separate
  profile that the user logs in to once.
- **The official MCP**, when it is available and has quota: its HTML capture also turns a
  page into auto-layout frames. Capture ids are single-use and expire after about two
  hours, captures land on the page that is open in the user's tab, and text comes out a
  little wider than in the browser, so check the export. Use the bridge next to it for
  everything that would burn the call limit: arranging, renaming, bulk fixes, exports and
  comments.
