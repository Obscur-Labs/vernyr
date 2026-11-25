# backend/

## Course catalogue

Country → university → course, in two collections plus a denormalised country
string. There is no `Country` model: a country is whatever the universities say
it is, and `GET /api/catalogue/countries` aggregates it.

- **`University`** — unique on `(country, slug)`, which is what the importer
  upserts against.
- **`Course`** — unique on `(university, name, level)`. Carries both the parsed
  value and the source's own wording: `tuition.amount`/`tuition.currency` drive
  the filters, `tuition.text` ("6,000 EUR/year") is what gets shown when the
  parse found no number. Anything the sheet had that the schema does not name
  lands in `extras`, so next year's extra column survives without a migration.

`backend/src/services/catalogue.ts` owns every parser — headers, money,
duration, intakes, deadlines, exams, degree level. **Both the importer and the
write routes run it**, so a hand-typed course and an imported one are the same
shape and equally filterable. Add a header spelling there, not in the script.

```bash
npm run import:courses -- --dir "C:/path/to/courses data"           # dry run
npm run import:courses -- --dir "C:/path/to/courses data" --apply
```

One workbook per country, one sheet per university, one row per course.
`backend/src/utils/xlsx.ts` reads .xlsx with no dependency — a zip directory
walk plus `inflateRaw` — because the alternative was a spreadsheet library in
the runtime dependencies for a job that only ever runs from a script. The
importer also handles what the real sheets do: truncated 31-character tab names
resolved against the workbook's own "University list" sheet, lone `Bachelor's`
banner rows that set the level for the block beneath them, and title rows above
the header when the tab is just `Sheet1`.

Every list endpoint under `/api/catalogue` speaks one filter vocabulary
(`q`, `country`, `level`, `intake`, `university`, `discipline`, `exam`,
`minTuition`, `maxTuition`, `sort`, `page`), so the CRM browser, a university's
page and the portal's future picker all read the same query shape. Search is a
substring regex rather than `$text`: a search-as-you-type box sends partial
words, and "engin" matches nothing under a text index.

Guarded by the `courses` module. The student and university presets already
hold `courses.read` — the catalogue is ready for the portal, which has no UI
for it yet.

## Reports

`/api/reports/{overview,finance,students,applications,visas,leads,catalogue}`,
all behind `reports.read`. Each answers with series and breakdowns rather than
finished sentences, in two uniform shapes — `{ value, count }` for a breakdown
and a parallel `months[]` + `series` for a trend — so one chart component reads
any of them. `?months=` sets the window (3–36, default 12) and gaps are filled
with zeros, because a line chart needs a point per month.
