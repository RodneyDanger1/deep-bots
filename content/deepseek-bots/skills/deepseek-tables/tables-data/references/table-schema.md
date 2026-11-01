# Table schema and read-back

## Schema block

Write this block before any row exists.

```
Table: <name>
Purpose: <the decision the table serves>
Key: <column name>
Columns:
  <name> | <type> | <unit> | <source> | <allowed values or range>
```

Rules:

- `type` is one of `text`, `number`, `money`, `date`, `boolean`, `enum`.
- `money` always carries a currency column or a currency in the header.
- `number` always carries a unit, or `unitless` when it truly has none.
- `source` is the document, page, file, or query the column comes from. A column with no source is not filled.
- `allowed values` either lists the accepted values, or gives a range, or says `unbounded`.
- A derived column names the formula and the columns it reads.

## Filling rules

1. One source per row, recorded in a `source` column, plus a retrieval date when the source is a page.
2. Keep the raw value and the parsed value in separate columns when parsing could lose precision.
3. Normalize numbers before comparing: same decimal separator, same thousands separator, no trailing currency symbols.
4. A blank cell means unread. A zero means measured zero. Never use one for the other.
5. A merged row keeps the earliest and the latest value when they differ, and says which is current.
6. A row with a missing key is not saved; the merge cannot place it.

## Total rules

- Sum with a tool or a formula, never by eye.
- Sum of rounded values is not the rounded sum of raw values. State which one the table shows.
- A percentage is computed from the two numbers it names, not from a third report.
- A count over a filtered set is recounted after a filter changes.
- An empty set totals to zero only when a zero was measured; otherwise show `no rows`.

## Read-back after saving

1. Reopen the saved file with the same tool that reads it later.
2. Compare three cells: the first data row's key, one computed total, and the last row's key.
3. Quote the read-back output in the reply, with the file path.
4. A mismatch is not edited blind: restore the previous version, fix the cause, and save again.

## Redaction scan

Before sharing or exporting, scan for:

- `password`, `passwd`, `secret`, `token`, `api key`, `apikey`, `bearer`, `private key`, or an armored private-key header line.
- Long random strings next to a column named for access, key, or auth.
- Email addresses, phone numbers, and postal addresses the table does not need.
- Full account or card numbers; keep only the last four digits when one is required.

Report the scan result. Never paste a suspected secret into the reply or the journal.
