---
name: ops-channels
description: Run work across a channel team with a lead, members, one request per teammate, and one handoff shape. Use when a task is delegated inside a channel or handed back to a lead. Use also when a reply must be accepted or rejected on evidence. Never sends acknowledgement-only messages, never repeats a blocked request, and never claims a teammate did work without that teammate's reply.
---

# When to use

- Use when a channel lead splits work, when a member reports back, or when a request moves between agents.
- Use when a task names a capability another teammate owns, such as a specialist profile, skill, or connected service.
- Do not use when the work is local and one agent can finish it; do it instead of delegating.
- Do not use to send a status update to the user; use the answer itself.

# Steps

1. **Decide local or delegated.** Delegate only when a teammate owns the capability, and say why in one line.
   - Validate: the reason names a capability, not a preference; if no teammate owns it, keep the work local.
2. **Write the request in the handoff shape.** Read `references/handoff-shape.md` and fill task, expected result, evidence, deadline, and unblock path.
   - Validate: all five fields are present, and the expected result can be accepted or rejected without a follow-up question.
3. **Send once.** One request to one teammate, with the request text unchanged when it is repeated after a failure.
   - Validate: one request per teammate; a duplicate queued request is cancelled before it starts.
4. **Accept or reject on evidence.** Read the reply against the stated evidence, and do not redo the work.
   - Validate: the decision names the evidence line; a reply with no evidence is `unverified`, not accepted.
5. **Handle a blocked reply.** Take the unblock action, or give the requester the blocker and the one action that clears it.
   - Validate: no repeat of the same request, and no resend to the teammate that reported blocked.
6. **Keep routine exchanges internal.** The user sees outcomes, blockers, decisions, and required input only.
   - Validate: the user-visible thread holds no progress-only or receipt-only message.
7. **Close with the reply shape.** Status, result, evidence, and unblock when blocked.
   - Validate: every field is present, and the reply starts with the teammate's name when it reports that teammate's result.

# Refusals

- Never send a message that only acknowledges receipt or confirms a plan.
- Never claim a teammate completed work without that teammate's reply.
- Never send the same request to the teammate that reported blocked, and never loop a retry.
- Never address the user when the requester is a teammate; answer the requester.
- Never widen the requester's scope silently, and never hand back a result that changes what was asked without saying so.
- Never put a credential, a token, or private account data in a channel message.
- Never fabricate a handoff, a reply, or an approval.

# References

| File | Open when |
| --- | --- |
| `references/handoff-shape.md` | Step 2, to write the request, and step 7, to write the reply. |

# Checks

1. The delegation names a capability a teammate owns, or the work stayed local.
2. The request holds all five fields and one acceptable result shape.
3. One request per teammate, and no acknowledgement-only message was sent.
4. Every accepted result names its evidence line; a reply without evidence is unverified.
5. A blocked reply names the unblock action, and no duplicate request follows it.
