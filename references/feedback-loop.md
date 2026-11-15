# Working with the people who review the design

A design round is a conversation. The agent's part is to make it cheap for the reviewers:
show them pictures, ask only what cannot be found out, and prove that every remark was
understood before acting on it.

## Before drawing

- Research first: the current screens, the code behind them, the texts, the rules. Then
  say in your own words what is wanted and what you will draw, and let the owner correct
  it. A wrong assumption costs one message now and a whole round later.
- If a first attempt in code missed, do not patch it. Go back to design: agree on the
  picture, then build it.
- State the scope: which screens, which states, desktop and phone. Ask whether anything
  is missing from the list ("are these all the screens, or did we forget one?") before
  the round is called complete.

## Questions

- Try to answer every open question yourself first: in the code, in contracts and terms,
  in the data, on the live product. In one round 27 of 103 "questions for the owner"
  turned out to be answerable that way.
- What is left goes on a decisions page in the Figma file, so the owner can go through it
  with colleagues. Each item has the context in one or two plain sentences, the options as
  yes / no or A / B / C, and your recommendation. A question without context or without
  options comes back as "I don't understand what you are asking".
- Recommend, do not survey. And when the owner answers "1A, 2B, 3B", that is the
  decision: record it on the page and in the mockups.

## Reading comments

Reviewers pin comments on frames. Read them all, with the bridge:

```bash
scripts/bridge/run.sh comments          # -> .figma-bridge/out/comments.json
```

Each thread has its number, text, replies, author, whether it is resolved, the frame it
sits on and the pin's offset inside that frame. Use the offset to see what the pin points
at: open the frame's export and look at that spot. A frame that was rebuilt after the
comment has a new node id, so the thread comes back without a frame; match it by offset
and by the thumbnail of the older version.

- Threads ticked as resolved may have been ticked by accident. If the remark is not
  visibly handled in the current frame, treat it as open and say so.
- A later comment can replace an earlier one on the same spot. Keep the latest.
- If there is a recording of the review meeting, transcribe it and read it with the
  comments. Decisions are often spoken, not written.

## Turning feedback into work

1. Write a digest: one numbered line per remark, grouped by page and frame, in the
   reviewers' own meaning, with the comment number. Mark what is a decision, what is a
   wish, and what contradicts something else.
2. Send the digest back as your understanding and let the owner correct it. Then it is
   binding for everyone who draws.
3. Change the design first. The Figma file is the source of truth; code follows it.
4. When the new version is up, say per remark what changed. Resolve the old threads only
   when asked to, or when the frame they point at is gone:
   `scripts/bridge/run.sh resolve 60 '{"ids":["<thread id>"]}'`.

## From Figma to the product

- Build exactly what the approved frames show. If something cannot be built as drawn,
  say so and change the frame first.
- Compare the real screen with the frame at 1440 px and 390 px in a browser, side by
  side, before calling it done. Passing tests do not show a raw pop-up, a wrapped word or
  a helper sentence nobody asked for.
- If other agents implemented parts, the lead looks at each of their screens the same
  way. Owners notice at once when nobody did.
- When the build changes a text or a layout for a good reason, update the mockup and the
  frame so the file stays true.
