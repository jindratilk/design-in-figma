# From an idea to frames in Figma: the mockup pipeline

Drawing a hundred consistent screens through single Figma API calls is slow and the
result drifts. HTML is a faster drawing tool for an agent: one stylesheet of tokens, real
layout, real text wrapping, and a browser that renders it in a second. So the design is
written as HTML mockups, reviewed as pictures, and only then moved into Figma, where
people comment on it.

```
write mockup (HTML)  ->  render to PNG  ->  look, fix, repeat  ->  serialize  ->  build in Figma
                                                         ->  compare with the render  ->  arrange
```

## 1. Write the mockup

One HTML file is one frame, and one frame is one state of one screen. A window with three
steps is three frames. Start from `examples/A1-order-detail.html` (desktop) and
`examples/F1-order-detail-mobile.html` (phone).

Conventions the tools rely on:

- The frame is the element `.frame`: 1440 px wide for desktop, 390 px for a phone. Its
  height grows with the content (set a `min-height` of 900 / 844).
- The file name is the frame key plus a short name: `B3-order-window-paid.html`. The
  `<title>` is `B3 · Order window – paid`; it becomes the frame name in Figma. Keys are a
  section letter and a number (`A1`, `B12`, `F3a`). `arrange` files frames by that letter.
- Tokens first: every colour, radius, size and shadow is a CSS variable at the top. No
  one-off values further down.
- Real elements only. No `::before` / `::after`, no `position: fixed`, no transforms.
  `serialize.mjs` warns about each thing it cannot turn into a layer. Form controls are
  fine: an `input`, `textarea` or `select` becomes a box with its value or placeholder.
- Lay out with flexbox (`display: flex`, `gap`, `padding`), the way you would build the
  real screen. That is what becomes auto layout in Figma. Margins between siblings,
  grids and absolute positions still arrive pixel-exact, but as fixed positions.
- Icons are inline `<svg>` (they stay vectors in Figma). Photos are `<img>` or a
  `background-image`, cropped in the file itself: `object-position` is not carried over.
- Add `data-name="Sidebar"` to the blocks a designer will look for in the layer list.
- Numbers get tabular figures and are right-aligned in tables.
- Fonts: load the font in the mockup itself (`@import` or `@font-face`), never count on
  it being installed, and load the **version Figma has**. If the browser draws a fallback
  font you are judging the wrong picture, and `render.mjs` says so (`missingFonts`). If
  Figma lacks the family, `build` falls back to Inter and tells you.
- For Inter, that version is 3.19. Google Fonts now serves Inter 4, which sets the same
  text 1 to 2 percent narrower (5 px on a 26 px headline), enough to move line breaks,
  shift gaps and make boxes miss auto layout. Use these imports, as the examples do:

  ```css
  @import url('https://cdn.jsdelivr.net/npm/@fontsource/inter@4.5.15/400.css');
  @import url('https://cdn.jsdelivr.net/npm/@fontsource/inter@4.5.15/500.css');
  @import url('https://cdn.jsdelivr.net/npm/@fontsource/inter@4.5.15/600.css');
  @import url('https://cdn.jsdelivr.net/npm/@fontsource/inter@4.5.15/700.css');
  ```

  For any other family, check once with the `measure` recipe: it returns the width Figma
  gives a text, to compare with `getBoundingClientRect().width` of the same text in the
  browser. They should agree to within half a pixel per 100 px.
- Sample data is fictional and the same in every frame: one customer, a handful of
  orders, one "today". Reviewers follow a story across screens, and consistent data makes
  inconsistencies in the design stand out.

For a big round, put the shared parts in one module (tokens, shell with sidebar, pill,
button, field, window) and generate the HTML files from small scripts, one per area. When
several agents draw, each writes only its own module, nobody edits the shared one, and
whoever leads looks at every rendered frame before it goes to Figma.

## 2. Render and look

```bash
node scripts/mockup/render.mjs mockups/*.html --out mockups/png
# B3-order-window-paid w:1440 h:1180 overflowX:0 missingFonts:-
```

`overflowX` must be 0 and `missingFonts` must be `-` (the tool exits with an error
otherwise). Content cut off on purpose by a box inside the frame, such as a scrolling plan
or a line that ends in "…", does not count as overflow. Then open every PNG and look at
it. Do not skip this because the numbers are fine. Typical finds: a clipped window, a label that wraps, a
column that is off by a few pixels, an empty half of a card, the same information twice.

`render.mjs` and `serialize.mjs` need Playwright and use the installed Chrome when there
is one. They find Playwright in the current project or in `~/.cache/design-in-figma`; if
it is in neither, the error message gives the one install command. Do not add it to the
user's project just for this.

## 3. Move it into Figma

```bash
node scripts/mockup/serialize.mjs mockups/B3-order-window-paid.html   # -> .figma-bridge/data/B3-….json
scripts/bridge/run.sh build 120 '{"name":"B3-order-window-paid","page":"Admin v2"}'
```

`build` creates the frame with real layers (frames, editable text, vector icons, image
fills, gradients at any angle, borders, shadows) and posts `out/fig-<name>.png` back. An
older frame of the same name is replaced where it stands: same section, same position,
same place in the layer list, so a rebuild needs no new `arrange`.

**Auto layout.** Every box whose children form one row or one column with one gap becomes
an auto-layout frame: direction, gap, padding, alignment, fill and hug. Wrapped text keeps
the browser's line breaks, a text in a column fills its width, a heading above a list is
nested the way a designer would nest it (the list becomes its own `stack`). Each
converted box is checked child by child and put back to fixed positions if anything would
move by more than a pixel, so auto layout never costs accuracy. The result tells you how
it went:

```json
{"layers":570,"autoLayout":225,"fixedLayout":24,"maxDrift":1.25,"hardWrapped":0,"fontSubstitutions":{}}
```

- `autoLayout` / `fixedLayout`: boxes that became auto layout, and boxes that kept fixed
  positions. Add `"explain":true` to the arguments to get the reason for each fixed one
  (`gaps between children differ (13, 0)`, `children wrap onto several lines`). To turn
  one into auto layout, change the mockup: give the children one `gap`, or wrap a group
  that belongs together in its own flex `div`.
- `maxDrift`: the largest distance in px between where a layer is and where the browser
  had it. Above 1.5 the build repeats with a stricter check and, as a last resort,
  without auto layout (`autoLayoutRevertedForDrift`).
- `hardWrapped`: wrapped texts whose line breaks had to be written into the text because
  no width reproduces them. More than a few means the font differs from Figma's.
- `scripts/bridge/run.sh layout 30 '{"name":"B3"}'` prints the structure a designer will
  find: `card: column, gap 10, padding 16 18 16 18, FILL x HUG`.

**Compare.** Do not judge the copy by eye alone:

```bash
node scripts/mockup/compare.mjs mockups/png/B3-order-window-paid.png
# B3-order-window-paid browser:1440x1085 figma:1440x1085 differs:1.00% area:x 234-1396, y 22-1014 ok
```

It compares the browser render with Figma's export and writes `out/diff-<name>.png` with
the differing pixels in red. A faithful copy differs by 0.3 to 1.5 percent, all of it thin
outlines of letters, because the two programs smooth text differently. A red block or
band is a real difference: a missing layer, a wrong colour, a line that wraps elsewhere.
Above 1.5 percent the tool exits with an error; open the diff picture and find out why
before you show the frame to anyone.

Known limits of the replay: a `border-radius: 50%` on a non-square box becomes a pill;
transforms are flattened to their bounding box; and Figma's plugin API cannot switch a
text to tabular figures, so numbers set with `tabular-nums` are a little narrower in Figma
and keep their right edge. A screen full of such numbers can read 2 percent in `compare`
for that reason alone.

## 4. Arrange the file

```bash
scripts/bridge/run.sh arrange 300 '{"page":"Admin v2","sections":{"A":"Overview","B":"Order","F":"Phone"},"minFrames":10}'
```

A file people can find their way in:

- One page per area and round: `Admin v2`, `Member area v1`, `E-mails v1`. A new round is
  a new page only when the old one must stay for comparison; otherwise frames are
  replaced in place so comment threads keep their context.
- Lettered sections per topic, frames numbered inside, phone frames in their own section
  next to the desktop ones.
- A page for open decisions (see feedback-loop.md) and frames with notes for
  implementation: rules the picture cannot show ("the reminder resends the same e-mail",
  "this document keeps the number of the order"). Notes that live only in the chat are
  forgotten by the time someone builds the screen. The `note` recipe puts one beside a
  frame: `run.sh note 30 '{"title":"Reminder","text":"Resends the same e-mail.","near":"B3"}'`.
- Variants of one screen stand under each other in one section, each named after its
  idea.

## 5. Keep mockups and Figma the same

The HTML mockups are the source you edit; Figma is what people look at. After a change:
edit the mockup, render, look, serialize, build (it replaces the frame in place), compare.
If someone edits a frame by hand in Figma, bring the change back into the mockup or it is
lost with the next build. For a small text fix on many frames, a bridge script that edits
the text nodes is faster than a rebuild; then fix the mockup too.
