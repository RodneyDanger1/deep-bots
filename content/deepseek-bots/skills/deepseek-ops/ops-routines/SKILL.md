---
name: ops-routines
description: Set up and report scheduled routine runs that stay quiet when nothing changed and report failures honestly. Use when defining a schedule, a watch, a digest, or a run report for an agent routine. Never claims a run happened when it did not. Never invents a change, retries beyond one attempt, or hides a failure behind a quiet run.
---

# When to use

- Use when creating or revising a routine: a watch, a digest, a threshold alert, a reconciliation, or an inbound check.
- Use when a run must decide between reporting, staying quiet, and reporting a failure.
- Do not use for a one-off task, or for a long manual job that nobody scheduled.

# Steps

1. **State the one job.** One sentence: what the routine checks or produces, on which source, and what a good run looks like.
   - Validate: one job, one source, and a success sentence that can be true or false.
2. **Pick the pattern.** Read `references/routine-patterns.md` and choose watch, digest, threshold, or reconcile.
   - Validate: the pattern's trigger, quiet rule, and failure rule are all copied into the routine plan.
3. **Write the schedule.** Interval, timezone, and the missed-run policy.
   - Validate: the timezone is named; a missed occurrence has a stated policy, and no backlog beyond one run.
4. **Define no news.** No news is an answer of only the quiet marker, or a call to the routine no-update tool.
   - Validate: the quiet condition is one rule that a run can evaluate without judgement.
5. **Define the failure contract.** A run that cannot do the task calls the routine failure tool with a short reason.
   - Validate: each failure path names its reason text; a failed run is never quiet.
6. **Bound the work.** One source per watch, at most one retry per tool, and a stop rule for the check.
   - Validate: the retry count and the stop rule are written; no loop can run without an end condition.
7. **Write the run report.** Report a change only with the old value and the new value from the same URL, each with its retrieval date.
   - Validate: a change claim carries both values and both dates; unchanged means quiet, not a status sentence.

# Refusals

- Never report a run as done when it did not run, or when its source did not answer.
- Never claim a change without the old and the new text from the same URL.
- Never retry a failed tool more than once, and never retry a failed run inside the same occurrence.
- Never message a person with a progress-only update, or with a status sentence that only says the run finished.
- Never add a second source to a watch without asking, and never widen a schedule silently.
- Never reuse a stale snapshot as if it were read now; a snapshot carries its own timestamp.
- Never put a credential or a session token in a routine report, log, or snapshot.

# References

| File | Open when |
| --- | --- |
| `references/routine-patterns.md` | Step 2, to choose the pattern and copy its quiet, failure, and limit rules. |

# Checks

1. The plan names one job, one source, and a success condition that can be false.
2. The schedule names a timezone and a missed-run policy.
3. The quiet condition and the failure reason are both explicit, and a failure is never quiet.
4. The retry count and the stop rule are written, and the worst case terminates.
5. A change report carries old value, new value, and two retrieval dates from the same URL.
