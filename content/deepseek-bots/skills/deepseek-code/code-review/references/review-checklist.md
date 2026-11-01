# Review checklist

Answer each class for the changed lines, in this order. A class with no changed line gets `not
applicable` and a reason, not silence.

## 1. Boundary input

- Is every external input checked for type, range, length, encoding, and null?
- Does a limit accept and save the same maximum, or does one side allow more?
- Is a default safe when the field is absent, and is it explicit?

## 2. Error path

- Does each failure reach the caller with context, or is it swallowed by a bare catch?
- Does a retry have an idempotency key, or can it duplicate a write?
- Does a fallback return a real result, or a fabricated success?

## 3. Resource release

- Is every file, socket, subscription, timer, and lock released on every path, including the throw path?
- Is a cleanup registered once, and does it match the acquisition?

## 4. Concurrency and atomicity

- Is the concurrency bounded, and is the bound enforced where the work starts?
- Can two writers interleave on the same record, and is the write serialized or made atomic?
- Does a read-modify-write hold a version or a transaction?

## 5. Secrets and privacy

- Does any diff line add a key, token, password, cookie, or private identifier?
- Is a secret logged, echoed in an error, or placed in a file name?
- Is personal data collected beyond the need, and redacted on log and export paths?

## 6. Dead and leftover code

- Is there commented-out code, debug output, an unused import, or a flag with one setting?
- Does a new branch have a reachable path, and a removed branch have no caller left?

## 7. Test parity

- Does the happy path have a matching error-path test that has run?
- Does the test assert behaviour and data, not markup or elapsed time?
- Is a new test wired into the runner, or does it pass only when run by hand?

## 8. Contract and compatibility

- Does the change alter a released wire format, a stored schema, or a public name?
- Is a migration reversible, and does it keep existing rows?
- Does a removed field still decode for an older client?

## 9. Observability truth

- Does the log or receipt say what actually happened, including the failure?
- Can a silent success hide an unperformed action?

## Severity scale

| Severity | Meaning |
| --- | --- |
| Blocker | Data loss, security, corruption, or a failure that lies about success. Must be fixed before merge. |
| Major | A real failure on a reachable path, or a contract break. Should be fixed before merge. |
| Minor | A weakness with a bounded effect. Fix now or record it. |
| Question | A design doubt with no proven failure. Ask, do not assert. |

## Finding format

```
<severity> path/to/file.ext:LINE - <the defect in one sentence>
Scenario: <input or sequence> leads to <wrong result>.
Evidence: <command and output, or the quoted lines that prove it>.
```

A finding without a line and a scenario is a question. Move it to the question list.
