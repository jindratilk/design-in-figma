# design-in-figma

A skill for Claude Code and Codex that teaches the agent to design in Figma: how to get
into a Figma file when the Figma MCP is missing or has hit its call limit, and how to produce
many consistent screens there.

It comes out of a real redesign round: several hundred frames for an admin, a customer
area, a public website and a set of e-mails, reviewed by the product's owners in Figma
comments and in a long meeting.

## What is in it

**A bridge into Figma without the MCP.** In the Figma web editor the plugin API is
available as `figma` in the browser console. A small agent script, started once in the
user's logged-in tab, polls a local server for commands and posts results and PNG exports
back. From then on the coding agent runs plugin-API scripts from its shell: create and
change layers, arrange pages, export frames, read every comment thread. It needs no
token and no plugin, and it has no call limit.

**A mockup pipeline.** The agent draws screens as HTML, renders them, looks at the
pictures and fixes them, then replays them in Figma as editable frames: real text, vector
icons, image fills, and auto layout (direction, gap, padding, fill and hug) wherever it
reproduces the browser's picture exactly. A comparison tool then checks Figma's own export
against the browser render pixel by pixel. On real admin screens of 250 to 570 layers a
build takes about 1.5 seconds, nine boxes in ten come out as auto layout, and no layer
sits more than 1.5 px from where the browser had it.

**How to run the review.** Restating the task, questions with options and a
recommendation, reading comments, a digest of the feedback, and building from the
approved frames.

## Install

Claude Code:

```bash
git clone https://github.com/jindratilk/design-in-figma ~/.claude/skills/design-in-figma
```

Codex:

```bash
git clone https://github.com/jindratilk/design-in-figma ~/.codex/skills/design-in-figma
```

Then start a new session and ask for a design in Figma. The agent loads the skill by
itself; you can also ask for it by name.

## Requirements

- A browser logged in to Figma with edit access to the file
- Python 3 and Node.js 18 or newer
- Playwright for rendering and serialising mockups. The tools use the one in your
  project, or install it once outside it: `npm i --prefix ~/.cache/design-in-figma playwright`
- On macOS, [Peekaboo](https://github.com/steipete/Peekaboo) lets the agent open the
  console and start the bridge by itself. Without it you paste one line into the browser
  console once.

## Try it by hand

```bash
S=~/.claude/skills/design-in-figma
export FIGMA_BRIDGE_DIR="$PWD/.figma-bridge"
$S/scripts/bridge/connect.sh new                         # opens a new Figma draft and connects
$S/scripts/bridge/run.sh ping
node $S/scripts/mockup/serialize.mjs $S/examples/A1-order-detail.html
$S/scripts/bridge/run.sh build 120 '{"name":"A1-order-detail"}'
node $S/scripts/mockup/render.mjs $S/examples/A1-order-detail.html --out /tmp/a1
node $S/scripts/mockup/compare.mjs /tmp/a1/A1-order-detail.png
```

`build` creates the example screen in the draft and saves Figma's own export of it to
`.figma-bridge/out/fig-A1-order-detail.png`. `compare.mjs` puts that export next to the
browser render and prints how much of the picture differs (about half a percent, all of it
text antialiasing).

## Good to know

- The bridge acts as you, in your real files. The server listens on `127.0.0.1` only and
  refuses every browser request that does not come from a figma.com page, so no other
  website can read the work directory or write into it.
- The first connection makes Chrome ask whether figma.com may reach devices on your local
  network. Allow it.
- Use the font version Figma has. Figma ships Inter 3.19; Google Fonts now serves Inter 4,
  which sets the same text 1 to 2 percent narrower, enough to move line breaks and gaps.
  The examples load Inter 3.19.
- Figma's plugin API cannot switch a text to tabular figures, so numbers set with
  `font-variant-numeric: tabular-nums` are a little narrower in Figma. They keep their
  right edge.
- The comments recipe uses the endpoint the Figma web app itself calls, so it can change
  without notice.

## License

MIT
