---
name: research-brief
description: Turn verified findings into a cited decision brief with a could-not-verify list. Use when the user asks for a brief, comparison, recommendation, or memo that needs sources. Never publishes or sends the brief, never invents a source to fill a gap, and never presents one source's figure as settled when sources disagree.
---

# When to use

- Use when the user asks for a brief, a recommendation, a comparison, or a decision memo, and the answer needs sources.
- Use when findings already exist and need one shape, one recommendation, and one next action.
- Do not use to gather sources; run `research-search` first. Do not use for a chat answer under 100 words that needs no source.

# Steps

1. **Name the decision.** Write one line: the decision the brief serves, the reader, and the word cap (default 400).
   - Validate: the line names a decision and a reader; if the user gave no cap, state 400 and continue.
2. **Sort findings into supported and unsupported.** Keep claims that have a source-log row from `research-search` or an attached log. Move the rest to the could-not-verify list.
   - Validate: every claim in the outline maps to a row; a claim without a row is not in the brief.
3. **Pick the shape.** Read `references/brief-template.md` and choose recommendation, comparison, or decision memo.
   - Validate: every heading that the chosen shape requires is present, in order.
4. **Cite while drafting.** Use the format in `references/citation-format.md`: link text plus retrieval date.
   - Validate: every external claim has a citation; prose carries at most five, and the evidence table carries the rest.
5. **Write the could-not-verify list.** For each gap, name the unresolved fact, what was searched, and the one action that would settle it.
   - Validate: every gap has all three parts; a gap with no next action is not finished.
6. **Check every number.** Unit, period, currency, basis, and the source's own rounding.
   - Validate: each number appears in its source with the same unit and period, or it is removed.
7. **Close with action and label.** End with the recommendation, the next action with an owner, and the draft label.
   - Validate: the brief is within the word cap, the next action has an owner and a source, and the label reads `draft - not sent`.

# Refusals

- Never publish, send, schedule, or post the brief. Output only.
- Never fill a gap with `likely`, `approximately`, or a guessed number. Write `not found`.
- Never cite a source that is absent from the log, and never cite more sources than the log holds.
- Never merge a source's conclusion with the recommendation. Label which sentence is the source's and which is the brief's.
- Never present a single-source figure as settled when a second source disagrees.
- Never restate the request in a preamble, and never open with "here is the brief".
- Never quote more than ten words from one source without a section or page anchor.

# References

| File | Open when |
| --- | --- |
| `references/brief-template.md` | Step 3, to choose the shape and copy its headings. |
| `references/citation-format.md` | Step 4, and again during the final read to fix citation form. |

# Checks

1. Every external claim has a link with a retrieval date, and every cited source has a log row.
2. Every required heading of the chosen shape is present.
3. The could-not-verify list exists when any claim lacked a source, and each entry names a settling action.
4. Every number carries its unit and period, and every action has an owner.
5. The draft is within the cap, carries `draft - not sent`, and makes no publish or send claim.
