# Phase 2a — versioned interview question bank

Branch: `codex/interviews-phase2-bank-evaluator`, based on `a039411`.
Pilot: **Automation Testing**. This checkpoint has no LLM calls, evaluator jobs,
answer snapshots, live attempts or changes to learner navigation. It is suitable
for a hidden content-preparation rollout. No merge or deployment is included.

## Accepted sequence

| Checkpoint | Deliverable |
| --- | --- |
| 2a.1 | Bank schema, immutable publication rules, draft/publication contracts |
| 2a.2 | Bounded CSV importer, resumable confirmation, authenticated Admin API |
| 2a.3 | Admin import, authoring, review, publication and learner preview screens |
| 2a.4 | Integration/regression evidence and the explicit handoff to Phase 2b |
| 2b | Separate evaluator configuration, snapshots, assessments, jobs, caps/usage, rubric evaluations and calibration; its own internal feature gate |

The source attachment described Phase 1 as unmerged. The requested base commit
already contains Phase 1 and its subsequent fixes; that older status is not a
reason to repeat the extraction. The existing shared live engine stays unchanged.

## Database changes

Migration: `20261007160000_interview_question_bank`. Additive only; historical
migrations and the frozen Phase 0 baseline are unchanged.

| Model | Responsibility |
| --- | --- |
| `QuestionBankItem` | Stable namespace/QID identity; pointer to the published version |
| `QuestionBankVersion` | Versioned question, taxonomy, learner explanation/example, public criteria, provenance, rights and review/publication lifecycle |
| `QuestionEvaluatorSpec` | Private rubric: required points, accepted alternatives, misconceptions, four evidence anchors and scoring notes |
| `QuestionImportBatch` | File SHA-256, namespace, mode, column mapping and resumable state; no uploaded file bytes/path/name |
| `QuestionImportRow` | Raw column/value entries, normalized draft, row errors/warnings and import outcome/version link |

Published and retired content/rubrics are protected by database triggers. A
published pointer must identify a published version belonging to the same item;
deferred constraint checks permit atomic retirement/replacement. Account deletion
nulls author/reviewer/publisher/importer foreign keys rather than deleting shared
bank content. Existing audit records retain opaque actor IDs. Draft revisions
prevent stale edits. Item locks serialize edits, forks and publication; advisory
identity locks serialize concurrent creation/import of a namespace/QID.

Lifecycle: `DRAFT → REVIEWED → PUBLISHED → RETIRED`. Editing reviewed content
returns it to `DRAFT` and clears review approval. Published/retired content must
be forked into a new draft to change it. Publishing retires the previous published
version in the same transaction. Review checks do not establish legal ownership:
the reviewer must verify the recorded evidence.

## Import workflow

1. Export the workbook's question sheet as **UTF-8 CSV**, preserving the header
   row and quoted multiline cells. XLSX uploads are deliberately unsupported in
   v1; no new parser dependency is installed.
2. Open **Admin → Interview Question Bank → Import CSV**. Inspect the columns,
   choose a stable namespace, and map QID/question plus optional metadata.
3. Preview row validation. Required identity/question errors block that row.
   Unknown metadata stays `null`; no track is guessed from a category or QID.
   Missing source answers, tracks/types/archetypes and duplicate question text
   produce warnings. Duplicate QIDs within a file are errors. Existing namespace
   QIDs are flagged before confirmation. No semantic/LLM duplicate detection is
   included in 2a.
4. Confirm valid rows as drafts. Each request processes at most 100 rows;
   committed rows survive interruption. Resume via Recent imports. Row locks
   prevent concurrent confirmations from duplicating versions.
5. Download the complete row report and correct erroneous rows in a new CSV.
   Re-uploading identical bytes with the same namespace/mode/mapping reuses the
   existing batch. `ADD_ONLY` skips existing QIDs. `UPDATE_BY_QID` creates a draft
   for changed normalized source content; unchanged source hashes are skipped.
   Published versions are never overwritten by an import.

Limits: 5 MB, 10,000 data records, 40 columns, 20,000 characters/cell. Fatal UTF-8
validation, unique non-empty headers, bounded RFC 4180 quoting, NUL/ZIP rejection,
and no spreadsheet/formula execution. File bytes live only in bounded request
memory. Logical record numbers are used for multiline CSV rows. Raw invalid row
cells are retained, including extra unmapped cells. Downloaded CSV values that
could be spreadsheet formulas are escaped; stored raw values are unchanged.
The reusable template contains a synthetic Automation Testing row.

## Review, rights and visibility

Admin can import, author/edit/fork, review and inspect learner previews.
**SUPER_ADMIN alone can publish or retire** (enforced by the API, not just UI).
All bank endpoints require login and Admin access, independently of the hidden
learner Interviews flag. No public/learner bank endpoint is introduced here.
The existing `interviews` flag/defaults and grants are unchanged.

Publication requires track/category/topic/difficulty/experience, an evaluation
mode, suitability for speaking, expected depth, learner explanation/example,
reviewed reference sources, and matching public/private rubric criteria with
complete anchors. Partial rubric drafts can be saved for continued authoring.

Record **OWNED** or **LICENSED** content rights with evidence, or **REWRITTEN**
provenance with independent learner rewriting and rubric-authorship attestations.
Rewritten questions cannot exactly copy the source question; explanation/example
cannot exactly copy the source answer. Exact-copy checks normalize case and
whitespace, but are not a copyright determination. Human review remains necessary.
Imported answers are private reference material, never automatically copied into
learner fields or rubric points. There is no AI rubric drafting in this checkpoint.
Future drafting must produce independently authored rubrics rather than copy
source text, and stay within recorded usage rights.

Learner preview is an explicit server allowlist: question, taxonomy/tags,
explanation, example answer, expected depth, criterion IDs/labels. It excludes
source text, private points/anchors/misconceptions/notes and rights metadata.
It previews the saved version and is visibly marked Admin-only. Future practice
screens must obtain only published versions through a feature-gated learner API,
and enforce mode-specific timing for displaying learner example answers.

## API and code map

API prefix `/api/admin/interview-bank`:

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /questions` | Paginated list / create draft |
| `GET/PUT /versions/:id` | Admin detail / revision-checked edit |
| `POST /versions/:id/fork` | New numbered draft |
| `POST /versions/:id/review,publish,retire` | Separate lifecycle actions (individual paths) |
| `GET /versions/:id/learner-preview` | Saved learner allowlist |
| `POST /imports/inspect,preview` | Bounded multipart file inspection / persisted row preview (individual paths) |
| `GET /imports` | Recent batches |
| `GET /imports/template` | CSV template |
| `GET /imports/:id` | Paginated rows and full status totals |
| `POST /imports/:id/confirm` | One resumable confirmation chunk |
| `GET /imports/:id/report` | Complete spreadsheet-safe row report |

Server logic: `src/interviews/bank/{schemas,csv,import,service,views}.ts` and
`src/routes/admin/interview-bank.ts`. A 1 MB JSON limit is scoped to this Admin
API for rubric editing; multipart uploads have their separate 5 MB limit.
Content is not written into request/application logs. Lifecycle actions and
import preview/progress/completion are audited with IDs/hashes/counts.

Web: `QuestionBank`, `QuestionBankImports`, `QuestionBankEditor`; transport/types
in `src/lib/interview-bank.ts`. The user-facing navigation is unchanged.

## Validation and rollout boundary

An isolated PostgreSQL 16 container on `127.0.0.1:55441` is used for migration
and integration verification. The production/main databases are not migrated.
The opt-in database tests explicitly reject URLs outside the disposable test
database; ordinary test runs skip those tests.

Read-only workbook reconciliation: 1,649 data rows, 140 Automation Testing,
1,359 blank tracks. All 1,649 became unpublished drafts in the isolated test
database; blanks stayed unknown. `PY-NEW-002` has no source answer, remains a
draft and needs editorial completion. The original workbook is unchanged and
is not copied into the repository.

Run the normal server/web suites, typechecks, lint and build. Then run:

```sh
BANK_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55441/postgres \
  npm --workspace apps/server test -- test/interview-bank-database.test.ts
```

Database tests cover authenticated role boundaries, learner privacy, invalid
publication, revision races, concurrent forks/imports, immutable content/rubrics,
atomic version replacement, publication pointers, retry/update behavior,
multipart upload and preservation after author account deletion.

Final checkpoint results on 7 Oct 2026:

- Server: **429 tests pass**, including 9 opt-in PostgreSQL integration tests.
  Normal runs without the isolated database have 420 passing tests and 9 skipped.
- Web: **204 tests pass**. Both typechecks and the complete build pass.
- Lint: no errors or new warnings; the existing Replay effect dependency warning
  remains. Existing bundle-size/browser-data warnings remain unchanged.
- Clean baseline initialization + migration succeeds. An upgrade fixture with an
  existing Elevate session keeps its ID, module, purpose and context scope and
  gains all five bank tables. Prisma schema comparison produces an empty diff.
- Browser: CSV column inspection/mapping, one valid/one invalid row preview,
  confirmation/error reporting, incomplete rubric draft saving, complete manual
  authoring, review, synthetic local publication and saved learner preview pass.
  A multiline required-points field survives save. Published fields are read-only.
- Primary checkout remains clean; its existing API health check returns `ok`.
  No environment files were edited and no production/main database was migrated.

Browser checks cover narrow-screen Admin navigation, column mapping, row
validation, valid-row confirmation, draft authoring, readiness blockers and
learner preview. Separate preview ports 4010/5174 and temporary test credentials
avoid changing environment files or the user's services on 4000/5173.

Before a later authorized rollout: review the commits, apply the additive
migration through the existing maintenance deployment path, and keep Interviews
hidden. Prepare/publish only rights-cleared Automation Testing content. Content
publication here does not enable learner Interviews or factual grading.

## Phase 2b handoff — explicit scope

No snapshots/assessments/jobs are created in 2a. Implement these only in 2b:

1. Add a separate internal `interview_evaluator` feature to the existing feature
   registry/access middleware, default hidden/disabled/selected users. Admin
   testing requires both Admin role and evaluator access; a bank Admin route is
   not an evaluator bypass. Gate submission, retries and worker execution. UI
   disabling alone is insufficient.
2. Add versioned evaluator configuration separate from Replay/voice settings.
   Initial benchmark candidate: **Amazon Nova Pro, `amazon.nova-pro-v1:0`**, the
   model already listed in the local analysis configuration. This is a candidate,
   not a calibrated selection. Verify availability/IAM in the intended Bedrock
   region, benchmark early, and record exact model ID, region, configuration and
   prompt/rubric/schema versions with every result. No latency/quality claim is
   made before measurements.
3. Keep evaluator prompts/version IDs in code; no editable unversioned database
   prompt. Delimit candidate answers as untrusted data, prohibit their instructions
   from changing criteria/scoring, require strict structured output and reject
   evidence not supported by the graded snapshot. Test injection, incorrect yet
   fluent answers, correct terse answers, alternatives, uncertainty and refusals.
4. Give snapshots an explicit source enum. Only `ADMIN_TEST` is usable in 2b.
   Reserve `LIVE_ATTEMPT`/`RECORDING` values and nullable attempt/recording links;
   reject those sources until their capture/ownership contracts exist. Do not
   manufacture live attempts from an Admin test.
5. Ownership/deletion: `ADMIN_TEST` belongs to its submitting admin, carries no
   attempt/recording link, has owner/Super Admin reads and deletion cascades to
   answer content, assessments and queued jobs. Future `LIVE_ATTEMPT` belongs
   to the learner and must link to that same user's attempt; deleting the attempt
   or owner removes answer/assessment/jobs. Future `RECORDING` belongs to the
   recording owner, links to the same user's recording, and follows recording/
   owner deletion. No unrestricted nullable-link orphan is allowed. Retain only
   necessary aggregate/anonymized usage after content deletion; recheck ownership
   and existence before a worker writes results.
6. The immutable answer snapshot is authoritative graded text. Record source,
   text source/revision and hash. Later transcript corrections create a new
   snapshot and explicit stale/superseded status; do not silently rewrite a grade.
   Assessment idempotency includes snapshot hash, question version, rubric hash,
   model/config/prompt/schema versions, language and assistance policy. Same-key
   live/background work shares the persisted result or in-flight job.
7. Add durable jobs with leases, bounded retries, timeout/error states, per-user
   quotas and separate input/output-token usage/cost visibility. Record attempt
   failures rather than returning invented accuracy results. Benchmark latency
   against an expert-reviewed Automation Testing set before live integration.
   Target spoken-feedback wait budget is 5–8 seconds; reserve a clear timeout
   fallback and background reuse for Phase 3 rather than extending live silence.
8. Report per-criterion evidence/anchors and assistance flags, not an unsupported
   composite score. Calibrate against expert labels; track disagreements by
   topic/difficulty. No automatic content publication after rubric drafting.

Phase 3 retains ownership of interview launch policies/flags, retained-session
buckets, thinking pauses/turn stitching, durable live capture, hint/example/"I
don't know" behavior, speech vocabulary, Coach routing and live feedback. Existing
Elevate personalisation stays `COMMUNICATION_PROFILE`; Quick Practice remains
`SESSION_ONLY`, with continuity reserved to the relevant journey.

## Commits

| Commit | Checkpoint |
| --- | --- |
| `5476af8` | Bank schema, publication safeguards and learner contracts |
| `53cf441` | CSV importer, Admin API and database integration tests |
| `af641e9` | Admin bank UI, transport tests and shared learner wire contract |

The final documentation commit records verification and the Phase 2b handoff.
These commits are local on the requested branch; no push, merge or deploy was run.
