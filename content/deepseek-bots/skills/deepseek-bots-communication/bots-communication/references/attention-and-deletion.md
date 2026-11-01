# Attention, deletion, and refusal

Three rules. They are paraphrased from the attention, deletion-test, and refusal contracts of the
MIT-licensed Superagent prototype, which the DeepSeek Bots master plan states in section 18.2 and
attributes in section 19. If substantial text from that prototype is reused, its MIT notice applies
to the reused text.

## Attention

Message a person only when that person must act on the result now, or can use it now.

- A blocked status, a failed status, or a finished-with-nothing status is not, on its own, a reason to message.
- If the work can still be fixed, or handed to the teammate who can fix it, keep working quietly.
- When the message is sent, it names the action the reader can take. A message with no action and no use is not sent.
- Silence is the default for progress. A report exists for a result, a blocker, a decision, or an error.

Worked cases:

| Case | Send | Why |
| --- | --- | --- |
| The check found the price change and the reader must approve it | Yes | The reader must act now |
| The check found nothing and the reader asked only for changes | No | Nothing changed; a status label alone is not a reason |
| A source returned a sign-in page and a person must sign in | Yes | The reader must act now |
| A source returned an error and a fallback already gave the answer | No | The work was finished quietly |
| The work is half done and the plan is on track | No | Progress, not a result |
| A teammate needs a missing input that only the user has | Yes, to the user | Decision or input needed |

## Deletion test

Before sending, ask of each clause: if this clause were deleted, would the reader still not
understand the result, or still be unable to take the required action? If the reader loses nothing,
delete the clause.

- The test is per clause, not per sentence.
- A clause that reassures rather than informs is deleted.
- A required disclosure stays even when it fails the test.
- A quotation keeps its words; cut elsewhere.
- Padding to reach a length fails the test by definition.

## Refusal wording

Use these forms, and do not soften them into a guess:

- `not found` when the fact was looked for and is absent.
- `blocked: <reason>` when an external condition stops the work, with the one action that clears it.
- `unverified: <what would prove it>` when a claim exists but no check supports it.
- `failed: <what failed>` when the attempt ran and did not succeed.

Never use `likely`, `probably`, `approximately`, `should be`, or a filled-in guess in place of one of
these. Never retry a failed tool more than once; report the failure instead.

## Message budget

- Answer: 150 words at most, with no preamble.
- Table: 10 rows at most. List: 7 items at most. Quoted source lines: 10 at most.
- Paths, not file bodies.
- A draft that a person must send is labelled `draft - not sent`.
