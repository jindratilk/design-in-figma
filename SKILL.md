---
name: design-in-figma
description: Design user interfaces in Figma as an agent - with or without the Figma MCP. Use when asked to design, redesign or mock up screens, pages, e-mails or flows in Figma ("design it in Figma first", "put it in Figma", "make a Figma proposal we can iterate on"), when the Figma MCP is missing, not logged in or has hit its call limit, when you need to read Figma comments, arrange, export or bulk-edit frames. Covers a console bridge that drives the plugin API through the user's logged-in browser tab, an HTML-mockup-to-Figma pipeline, and how to run review rounds with the people who decide.
---

# Design in Figma

Design first, code second. A screen that is argued about in code costs a rebuild per
opinion; the same argument over a picture costs minutes. So the order of work is: agree
on the picture in Figma, iterate there with comments, and build only what was approved.

This skill gives you two things:

1. **A way into Figma that needs no MCP**: a small bridge that runs plugin-API scripts in
   the user's logged-in browser tab. No token, no plugin install, no call limit.
2. **A pipeline** that turns HTML mockups into editable Figma frames with real auto
   layout, and proves pixel by pixel that Figma shows what the browser drew. You can draw
   a hundred consistent screens and look at each one before anybody else does.

`SKILL_DIR` below is the directory this file is in.

## The loop

1. **Understand.** Read the current screens and the code behind them. Say in your own
   words what is wanted; let the owner correct it. List every existing feature so none is
   lost. → `references/feedback-loop.md`
2. **Draw as HTML mockups**, one file per frame, desktop (1440) and phone (390). →
   `references/mockup-pipeline.md`
3. **Render and look.** `node $SKILL_DIR/scripts/mockup/render.mjs <files>`, then open
   every PNG and fix what you see. Repeat until you would sign it.
4. **Connect to Figma** and move the frames in. → `references/bridge.md`
5. **Compare** each frame with its render (`compare.mjs`), then **arrange** the file so
   people can find things.
6. **Collect feedback** (comments, meeting notes), send back a digest of what you
   understood, change the design, repeat from 2.
7. **Build from the approved frames** and compare the real screen with the frame at both
   widths before you call it done.

## Which connection to use

| Situation | Use |
| --- | --- |
| Figma MCP available, a handful of reads or edits | The MCP and its own skills |
| No MCP, MCP not logged in, or the plan's call limit is hit | The bridge |
| Bulk work in any case: arranging, renaming, fixing many layers, exporting, reading all comments | The bridge |
| You only need to read a file or render frames, and have a personal access token | Figma REST API |

If the user asks for a specific way ("use the MCP, not a connector"), use that one and
keep the bridge for what it cannot do.

## Quick start (bridge)

```bash
export FIGMA_BRIDGE_DIR="$PWD/.figma-bridge"          # work directory; keep it out of git
B=$SKILL_DIR/scripts/bridge; M=$SKILL_DIR/scripts/mockup

$B/connect.sh "https://www.figma.com/design/<fileKey>/<name>"   # or: connect.sh new
$B/run.sh ping                                                  # file, pages, sections

node $M/render.mjs mockups/A1-overview.html                     # -> PNG; look at it
node $M/serialize.mjs mockups/A1-overview.html                  # -> $FIGMA_BRIDGE_DIR/data/A1-overview.json
$B/run.sh build 120 '{"name":"A1-overview","page":"Admin v1"}'  # auto-layout frame + out/fig-A1-overview.png
node $M/compare.mjs mockups/A1-overview.png                     # browser vs Figma, must say ok
$B/run.sh arrange 300 '{"page":"Admin v1","sections":{"A":"Overview","B":"Order"}}'
$B/run.sh comments                                              # -> out/comments.json
$B/run.sh my-script.js 60 '{"any":"args"}'                      # your own plugin-API script
```

`connect.sh` drives Chrome on macOS with Peekaboo. Anywhere else it prints one line for
the user to paste into the browser console once. A script is the body of an async
function with the plugin API global `figma` in scope; it reads `args` and returns JSON.
Set `FIGMA_BRIDGE_FILE=<fileKey>` and `run.sh` refuses to run in a tab that has another
file open.

## Rules

- **Look before you report.** A render or an export you have not opened is not checked.
  This applies to frames other agents made for you as well.
- **Guard anything that deletes or moves in bulk.** Refuse to run on an empty or tiny
  match list, use long timeouts for bulk work, and run `ping` or `reconnect` first when
  the tab has been idle.
- **You are in the user's real files as the user.** Work on your own pages, do not touch
  frames you did not make unless asked, and report what you changed.
- **Fictional sample data only**, the same in every frame. Never copy real customer data
  into a design.
- **No unsourced claims** in the copy of a design (prices, security, legal terms). Put
  them on the decisions page as questions.
- **Figma stays the source of truth** once frames are approved: change the frame first,
  then the code.

## Files

- `references/bridge.md` - how the bridge works, connecting, recipes, pitfalls, safety, other ways in
- `references/mockup-pipeline.md` - mockup conventions, render, serialize, build, arrange
- `references/feedback-loop.md` - restating, questions with options, comments, digests, building from Figma
- `scripts/bridge/` - `server.py`, `agent.js`, `connect.sh`, `run.sh`
- `scripts/mockup/` - `render.mjs`, `serialize.mjs`, `compare.mjs`
- `scripts/figma/` - recipes: `ping`, `build`, `layout`, `arrange`, `export`, `note`,
  `comments`, `resolve`, `fonts`, `measure`, `reconnect`
- `examples/` - a desktop and a phone mockup to start from
