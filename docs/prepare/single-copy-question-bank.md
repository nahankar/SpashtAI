# Single-copy question bank

The user replaced Phase 2a's versioning/publication design with one mutable question per namespace/QID. This change supersedes that workflow; Phase 2b's formal evaluator is not part of it.

## Behaviour

- Admins can create, edit and delete any question, including active questions. There is no version history or fork/publish/retire operation.
- Approval and activation are separate. Bulk approve, activate, deactivate, approve-and-activate and delete accept up to 2,000 explicitly selected questions. “Select all matching” covers all matching pages, not only the visible page.
- Activation requires approval, a confirmed track, spoken suitability, and good answer points or an example answer. Approval itself does not require a formal rubric, rights declarations or complete learner content.
- Saving changes or applying changed CSV content clears approval and deactivates the question. A revision counter only prevents concurrent edits from overwriting each other; it stores no older copies.
- Every bank endpoint checks the current Admin/Super Admin role in the database. Importing never trusts spreadsheet approval/activation flags.
- Deleting removes the bank entry and nulls import-row links. Import history and audit records remain. This does not erase a past session's transcripts or feedback.
- Metadata defaults: General track/category/topic, Medium difficulty, 2-5 experience, Core frequency, Technical question type, IC role and spoken suitability enabled. Learning content remains blank until supplied; there are no fabricated answers or references.

## Copilot CSV import

Original 15 metadata/source columns remain supported. Added columns:

Good Answer Points, Learner Example Answer, Learner Explanation, Expected Depth, Verbal Suitable, Follow-up Guidance, Reference Sources, Review Notes, Approved, Active.

Use UTF-8 CSV, at most 5 MB and 10,000 rows per upload. Tags use comma-separated values; references use one per line. Boolean cells accept TRUE/FALSE, case-insensitively. Approved/Active are inspected but never applied.

Use the original namespace plus “Update existing questions by QID.” Mapped fields overwrite the existing copy; unmapped fields are preserved. A mapped blank learning-content cell explicitly clears that field. Blank classification cells preserve existing values, or use defaults for new questions. Unchanged content does not clear approval. CSV `Answer` stays private source material; use `Learner Example Answer` for the approved teaching content.

Previews capture current revisions. If a question changes before confirmation, that row is rejected rather than overwriting the edit. Uploading and previewing again uses the new revisions. Confirmations remain bounded, resumable and idempotent.

## Migration

`20261007200000_single_copy_question_bank` is a new migration; applied Phase 2a migrations are unchanged.

The migration chooses the highest-numbered existing copy of each question, preserves its ID/content/source metadata, converts rubric answer points to plain guidance, and retains rights notes as provenance notes. It deliberately consolidates older copies. Existing reviewed/published current copies become approved; only currently published copies stay active. Import result links are remapped to the retained copy. Pending old-format previews are superseded and must be uploaded again. Legacy editor URLs for the retained IDs still work.

Take a database backup before release. Validation covered clean installation, upgrade of the existing preview bank, uniqueness per namespace/QID and an empty Prisma schema diff. Main/local normal database and production have not been migrated by this implementation.

## Generated follow-ups: async handoff

The durable queue and worker are implemented but **not registered in the API process**. There is no reachable submission endpoint or running bank worker in this release. Phase 3 must supply and review the enrichment producer before registering them behind a default-off feature flag. The future interview engine must first capture the exact follow-up asked, then enrich it after the session with generic question content: track, question, good answer points, explanation, example and follow-up guidance. The reserved handoff accepts up to 50 enriched questions per request at:

`POST /internal/sessions/:sessionId/interview-followups`

The existing internal agent token is required. User JWTs cannot submit shared bank material. The session must be a completed, undiscarded INTERVIEW session. Body:

```json
{"questions":[{"turnId":"stable-actually-asked-turn-id","draft":{"questionText":"A generic interview question?","track":"Python","goodAnswerPoints":"Relevant points","explanation":"Explanation","exampleAnswer":"Example answer","followUpGuidance":"Suggestions for the next probe"}}]}
```

Other draft fields use the same schema/defaults as manually authored questions. Do not include candidate responses, names, employer-specific facts, transcripts or private session details in draft content. The API accepts only the strict authored-content shape.

Submission is idempotent per session/turn. The worker checks session status again, inserts inactive/unapproved drafts, deduplicates generated questions by normalised track/question text, and clears completed job payloads. Processing and insertion are atomic. Failures retry with backoff up to five attempts; invalid content fails without blocking the queue. Session deletion cascades queued jobs. Generic authored bank entries remain independent of the original user account/session and require Admin review before activation.

This change does **not** implement the learner interview screen, adaptive live agent, post-session LLM enrichment producer, or interview-aware Ask the session answers. The queue does not scrape communication/Prepare transcripts or make LLM calls. Those are the next interview-engine integration tasks, after the updated bank is available.

## Local verification

The branch is `codex/interviews-simple-bank`. Preview web 5174 uses API 4010 and the isolated database on 55441. Main web 5173 uses the main API/database. No `.env` files were changed.

Database tests are opt-in with `BANK_TEST_DATABASE_URL`, restricted to approved disposable database names on 127.0.0.1:55441. They cover role demotion, single-copy edits, concurrent writes, bulk atomicity, enriched imports, stale previews, deletion, async deduplication, discard handling and account deletion.

## Verified results

- Server: 438 passing tests, including 13 isolated PostgreSQL workflow tests.
- Web: 206 passing tests; type checks and full build pass.
- Lint: no errors or new warnings (existing Replay hook warning remains).
- Upgrade: all 1,691 existing preview question identities and their retained question/learner/source answer content matched the backup. The 1,649 workbook rows remain in namespace `workbook_verification`; other preview entries are earlier QA content.
- Browser: create, approve-and-activate, edit-in-place with approval reset, bulk approval/activation, and the imported PY-NEW-147 listing verified.
