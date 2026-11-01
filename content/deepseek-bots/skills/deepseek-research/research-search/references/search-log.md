# Source log

One row for each source that supports a claim. The log is the evidence table in the answer, or its
head when the answer shows a short version.

## Shape

| # | Claim it supports | Source title (as printed) | Opened URL | Printed date | Retrieved | Tier | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  | found / weak / not found |
| 2 |  |  |  |  |  |  |  |

## Rules

1. One row per source per claim. A page that supports three claims is three rows, or one row that names all three claims.
2. The title is the page's own title. Never write "source" or "article" as a title.
3. The URL is the page you opened, without tracking parameters and without a search redirect.
4. Printed date is what the page shows, in the form the page shows it. If none, write `date not stated`.
5. Retrieved is today's date, local time, as `YYYY-MM-DD`.
6. Status `not found` rows carry the query that was tried and what would settle the question. They are evidence of a gap, not a failure to hide.
7. Sort rows by sub-question, then by tier.
8. When two rows support the same claim with different values, add a `Note` entry. It says which value is newer and which unit or period each row uses.
9. Cap the visible table at ten rows. When the log is longer, save the full log as a Markdown file in the workspace. Show the ten strongest rows, with the file path beside the caption.
10. A row that no claim uses is deleted. An uncited claim gets a `not found` row, not a guessed row.
