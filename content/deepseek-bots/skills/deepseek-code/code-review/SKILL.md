---
name: code-review
description: Review a change and report findings as path with line, failure scenario, and severity. Use when the user asks for a review, a second look, or a pre-merge check of a patch, branch, or diff. Never merges, pushes, or edits the change, never reports a finding it cannot locate, and never calls a passing check ready to ship.
---

# When to use

- Use when a change must be judged before it lands: a diff, a branch, a patch file, or a pull request.
- Use when the user asks what could go wrong with a change, or asks for a second opinion before a merge.
- Do not use to write the change, or to review a whole codebase with no change to focus on.

# Steps

1. **Map the scope.** List every changed path, the base revision, and the files the change affects beyond the diff.
   - Validate: each changed path is named; a path you could not open is recorded as unread, not skipped silently.
2. **Describe the change.** One paragraph: what it does, which boundary it crosses, and who calls the changed symbols.
   - Validate: each changed public symbol has at least one caller named, or is identified as an entry point.
3. **Run the checklist.** Read `references/review-checklist.md` and answer each class for the changed lines.
   - Validate: every class is answered pass, fail, or not applicable for this change.
4. **Locate each finding.** Write path, line, the failing scenario as input leading to a wrong result, and a severity.
   - Validate: each finding points at a line opened in this review, and each states a scenario a reader could reproduce.
5. **Prove the important ones.** Run the narrow test, the command, or the read that shows the failure.
   - Validate: every blocker and major finding has a command with output, or a quoted code path; otherwise downgrade it to a question.
6. **List what is not verified.** Name every gate that did not run and the file or runtime that was not exercised.
   - Validate: the unverified list is present whenever a check was skipped, and each item says what would prove it.
7. **Give the verdict.** Approve, approve with findings, or changes required, and name the blocking findings.
   - Validate: the verdict names its blocking findings, and no finding is called ready because a check passed.

# Refusals

- Never merge, push, commit, tag, or change the branch, and never edit the reviewed change unless asked to fix it.
- Never report a finding you cannot locate in a file you opened.
- Never call a passing test, a green check, or a clean lint run proof that the change is correct.
- Never report style preferences as findings; report behaviour, contracts, safety, and observability.
- Never paste a whole file to support a one-line finding; quote the lines that matter.
- Never approve a change whose error path is unexercised without saying so in the verdict.
- Never disclose a secret found in the diff; name the file and line, and tell the author to rotate it.

# References

| File | Open when |
| --- | --- |
| `references/review-checklist.md` | Step 3, to answer each class, and step 4, for the severity scale and finding format. |

# Checks

1. Every finding has a path with a line, a scenario, and a severity.
2. Every blocker and major finding has a command with output or a quoted code path.
3. The unverified list names each gate that did not run.
4. The verdict names the blocking findings, and no green check is called readiness.
5. No write, merge, or push was made to the reviewed change.
