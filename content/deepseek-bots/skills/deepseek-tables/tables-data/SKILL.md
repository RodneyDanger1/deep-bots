---
name: tables-data
description: Build, fill, or read a table or spreadsheet with a schema first, a source for each cell, and a read-back after every save. Use when work produces rows, totals, comparisons, or a reconciliation. Never invents a cell value, never puts a credential or private key in a table, and never reports a total it did not compute.
---

# When to use

- Use when the deliverable is a table, a spreadsheet, a comparison matrix, an inventory, or a reconciliation.
- Use when rows must be merged, deduplicated, totalled, or saved to a file.
- Do not use for a one-line list of three items, or for prose that happens to contain numbers.

# Steps

1. **Write the schema first.** Read `references/table-schema.md` and list columns with a type, a unit, and a source.
   - Validate: every column has a type or unit and a named source; a column with no source is dropped.
2. **Define the key and the merge rule.** Name the column that identifies a row, and say how a duplicate is merged.
   - Validate: no two rows can share a key after the merge rule is applied.
3. **Fill cells from sources.** Write `not found` rather than a guess, and keep a blank different from a zero.
   - Validate: each cell traces to a source row or is `not found`; no cell is filled from memory.
4. **Bound the shape.** At most 10 rows in an answer and 7 columns unless the user sets another limit.
   - Validate: the row and column counts are measured from the table, not estimated.
5. **Compute totals with a tool.** Run the sum, count, or difference, and keep the command or formula.
   - Validate: each total shows its computation, and one edge case (empty set, single row, one negative) is recomputed.
6. **Read back after saving.** Open the saved file and compare three cells, including the last row.
   - Validate: the read-back output is quoted; a mismatch restores the previous file version.
7. **Redact before sharing.** Scan for credentials, tokens, and personal data that the table does not need.
   - Validate: the scan output is clean, or each remaining item is justified in one line.

# Refusals

- Never put a password, token, key, session cookie, or account number in a cell, a comment, a sheet name, or a file name.
- Never invent a cell value to complete a row. Write `not found` and say what would fill it.
- Never report a total that was not computed by a tool or a formula you can show.
- Never overwrite the user's file without a copy or a versioned name, and never delete rows to make a check pass.
- Never present a partial table as complete; state the missing rows and the reason.
- Never mix units or currencies in one column without a unit column.
- Never treat a blank as a zero, or a zero as a blank.

# References

| File | Open when |
| --- | --- |
| `references/table-schema.md` | Step 1, to write the schema, and step 6, for the read-back and redaction procedure. |

# Checks

1. Every column has a type or unit and a source, and every row has a unique key.
2. No cell is filled from memory; gaps read `not found`.
3. Each total shows its computation, and one edge case was recomputed.
4. The read-back quotes three cells from the saved file, including the last row.
5. The redaction scan is clean, or each retained item is justified in one line.
