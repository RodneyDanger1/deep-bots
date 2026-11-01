# Handoff shape

One request shape and one reply shape. Use them in a channel and in a direct message to a teammate.

## Request

```
Task: <one sentence, the outcome, not the activity>
Result expected: <the shape the requester can accept or reject>
Evidence: <what proves it: path and line, command and output, URL and retrieval date>
Deadline: <time, or "no deadline">
Unblock: <the one action if the task cannot proceed>
```

Rules:

- One task per request. Two outcomes need two requests.
- The result shape names the fields, not the topic: `three rows: supplier, annual price, currency`.
- Evidence is something the requester can check without asking again.
- A deadline is a time with a timezone, or the words `no deadline`.
- The unblock line names one action, not a list.

## Reply

```
Status: done | blocked | failed | not found
Result: <the outcome in one or two sentences>
Evidence: <path:line, or command plus output, or URL plus retrieval date>
Unblock: <only when status is blocked: the one action that clears it>
```

Rules:

- Status is one word from the list. `mostly done` is not a status.
- Result reports the outcome, never the process.
- Evidence is quoted, not summarized.
- A reply that reports a teammate's result starts with that teammate's name.
- A blocked reply that names no unblock action is incomplete.

## Message budget

- At most 150 words.
- No preamble, no restatement of the request, no closing courtesy.
- One link, or one path, per evidence line.
- No chain-of-thought and no narration of the steps taken.

## Never include

- A password, token, key, or private account detail.
- A claim about a service that no reply or tool output supports.
- A promise on the requester's behalf, such as a date the requester did not give.
- A copy of the requester's message back to the requester.
