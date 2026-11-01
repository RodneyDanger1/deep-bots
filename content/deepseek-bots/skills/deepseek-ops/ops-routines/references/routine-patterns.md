# Routine patterns

Four patterns. Each one gives the trigger, the quiet rule, the failure rule, and the limits. Copy all
four into the routine plan. Do not blend patterns in one routine.

## 1. Watch

Use to notice a real change on one page or one feed.

- Trigger: an interval, at least 15 minutes, in a named timezone.
- Work: read the source, normalize it, compare with the last snapshot from the same URL.
- Quiet rule: the normalized text is equal, or the only difference is a timestamp, a view counter, an advertisement slot, or whitespace.
- Report rule: a change report quotes the old and the new text, both retrieval dates, and the section the change sits in.
- Failure rule: the source returned an error, a sign-in page, or a page with no matching section: report the failure with the HTTP status or the missing element.
- Limits: one source; one retry; stop after two reads.

## 2. Digest

Use to summarize a bounded list of sources on a schedule.

- Trigger: daily or weekly, in a named timezone.
- Work: read each source once, keep the items inside the window, drop duplicates by canonical URL.
- Quiet rule: the window holds no new item.
- Report rule: at most seven items, each with title, source, printed date, and one-line reason it matters.
- Failure rule: one source failed: report which source failed and continue with the rest; all sources failed: report one failure line.
- Limits: at most ten sources; one retry per source.

## 3. Threshold

Use to alert on a number that crosses a boundary.

- Trigger: the same interval as the source's own update rate, or slower.
- Work: read the number, its unit, its period, and its source date.
- Quiet rule: the value stays on the same side of the boundary as the last run.
- Report rule: name the boundary, the value, the unit, the period, and the source; state whether it crossed up or down.
- Failure rule: the number is missing or undated: report `not found`, with the source that was read.
- Limits: one number; one boundary; a hysteresis band so a value that sits on the line does not alert on every run.

## 4. Reconcile

Use to compare a local table with an external list.

- Trigger: daily, after the source's own update time.
- Work: pair rows by the key, compare the money or count field, and list rows present on one side only.
- Quiet rule: every row pairs, and every compared field is equal after rounding to the source's own precision.
- Report rule: totals for both sides, the row count, and the unmatched rows with their key.
- Failure rule: the external list did not load, or a row has no key: report the failure and the offending row, and do not write to the table.
- Limits: read-only on the source; no write to the local table without the owner's approval.

## Snapshot rules

- A snapshot carries its URL, its normalized text hash, its retrieval date, and the value read.
- A stale snapshot is never presented as current; name its date.
- A snapshot of a page that now redirects is expired; re-read the new URL and say so.
- Never store a session cookie, a token, or a signed-in page body in a snapshot.
