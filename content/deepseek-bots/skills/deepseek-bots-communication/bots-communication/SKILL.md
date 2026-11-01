---
name: bots-communication
description: Decide whether to message a person or teammate, and write the smallest message that carries the result, blocker, or decision. Use when any status update, handoff, or user-facing reply is being written, and before deciding to stay silent. Never sends progress-only or receipt-only notes, never repeats a blocked request, and never states a status that was not observed.
---

# When to use

- Use before sending any update to a person or teammate, and before deciding to stay silent.
- Use when a run finishes, fails, blocks, or finds nothing, and the choice is report or stay quiet.
- Do not use for the result text itself; the answer carries that. Use it to decide whether the answer should be sent at all.

# Steps

1. **Apply the attention test.** Message only when the reader must act on the result now, or can use it now.
   - Validate: name the action the reader takes from the message; if there is no action and no use, do not send.
2. **Classify the message.** Result, blocker, decision needed, or error.
   - Validate: the message fits exactly one class; a message that fits none is progress, and progress is not sent.
3. **Apply the deletion test to each clause.** Would deleting the clause stop the reader understanding the result or taking the action?
   - Validate: every remaining clause answers yes; every other clause is deleted rather than softened.
4. **Apply the silence rule.** A blocked, failed, or finished-with-nothing status is not by itself a reason to message. If the work can be fixed or handed off, do it quietly.
   - Validate: silence is broken only for the classes in step 2, never for a status label alone.
5. **Write the smallest message.** Status line, result, evidence, and the unblock line when blocked.
   - Validate: 150 words at most, no preamble. Evidence is a path with a line, a command with output, or a URL with a retrieval date.
6. **Check the teammate rules.** One request per teammate, no acknowledgement-only messages, and no resend to the teammate that reported blocked.
   - Validate: the thread holds no receipt-only message and no duplicate request.
7. **Label an unsent draft.** Write `draft - not sent` when the user must send it.
   - Validate: the label is present, and no message was sent on the user's behalf.

# Refusals

- Never send a progress-only update, a receipt-only acknowledgement, or a readiness announcement.
- Never state a status that you did not observe; a check that did not run is not a pass.
- Never write `likely` or `approximately` in place of a value that was not found; write `not found`.
- Never retry a failed tool more than once, and never repeat a request that a teammate reported blocked.
- Never claim a teammate did work without that teammate's reply.
- Never put a credential, a token, or private account data in a message, a log, or a handoff.
- Never fabricate a handoff, an approval, or a completed action.

# References

| File | Open when |
| --- | --- |
| `references/attention-and-deletion.md` | Step 1 and step 4, when the send-or-silent decision is unclear, and step 5, for the refusal wording to use verbatim. |

The attention, deletion, and refusal wording in this skill is paraphrased from the MIT-licensed
Superagent prototype (DeepSeek Bots master plan section 18.2; provenance in section 19). Substantial
reuse of that prototype's text carries its MIT notice.

# Checks

1. Every message names the action it lets the reader take, or it was not sent.
2. The message fits one class from step 2, and no progress-only message exists.
3. Each clause survives the deletion test, and the message is 150 words or fewer.
4. A refusal reads `not found` or `blocked: <reason>`, with the one action that unblocks it.
5. No claim about a teammate or a check exists without that reply or that tool output.
