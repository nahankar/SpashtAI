# Forced-tool grading preview — 8 November 2026

Policy 12 is a preview only. Current learner policy remains 8. No merge, deployment or adaptive enablement.
Owner accepts AI-led technical adjudication; it is not independent human validation. Policy 11's real-model
failures remain recorded in `INTERVIEWS-GRADING-POLICY-11.md`.

## Why this candidate exists

Policy 11 produced malformed fields on eight initial cases and contradictory coverage/gaps on two others.
This candidate uses the same model, semantic criteria, exact-evidence validation and ambiguity disposition.
It requests one named `grade_interview_answer` data tool instead of free-form JSON. No tool action executes,
no result is sent back, and there is no automatic model retry or second grading call. The response still
passes the strict schema and subject-consistency guards; tool calling is not an accuracy guarantee.

AWS lists client-side tool calling as supported for Nova 2 Lite but native structured outputs as unsupported:
[model capabilities](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html).
[The Nova tool documentation](https://docs.aws.amazon.com/nova/latest/nova2-userguide/prompting-tools-function.html)
describes using a named tool and input schema for structured responses. This is that supported transport,
not native constrained JSON-schema generation or a change of model.

## Frozen configuration and acceptance

- Prompt 14 SHA256: `0a94fdba6ce1d119151c859ea3d93f41c3adce7cce491e7f92dbbaa2e175c96f`.
- Config canonical hash: `c7e0c6c598ce93aad3c157e32b7d416d76221e8a91e5e619c176aaf05ab5e981`.
- Tool schema canonical hash: `aa6c68551a91d14d0239d55386dec4632fb8de5b8bf1d9f7cb90502194a0b894`.
- Original policy configurations and prompt hashes remain pinned; only policy 12 sets `responseFormat: tool`.
- Reject missing/wrong/multiple tool submissions, nonobject input, unexpected termination, invalid fields,
  unsupported evidence and contradictory findings. Preserve usage and content-free failure reasons.
- Validated uncertainty remains ungraded, nonretryable and excluded from score-driven selection.

`policy-12-ai-review-1` freezes 65 distinct answers across reviewed, formerly heldout, pilot, reasoning,
ASR, fresh-policy-9 and readiness sets. Source-case provenance is retained and checks are merged without
relaxing labels. These are now regression inputs, not an unseen validation set. The only new disposition
is the already documented P2-08 review requirement; historical fixtures and reports stay unchanged.
`policy-12-repeat-1` selects six critical inputs for fresh, independently accounted invocations. Preserve
initial evidence before replacing only fictional Admin snapshots; verify input/config hashes and usage.
Repeated errors are never counted as stable grades.

Promotion requires all declared safety/semantic checks, intended review outcome, accurate grade/routing
labels and repeated usable outcomes. Any failed case remains a blocker to score-driven adaptation.
Broader domain coverage and real integrated voice/workspace checks remain separate release work.

## Verification so far

- Focused evaluator tests: 82 passed, including transport schema/name, review outcome, invalid envelopes,
  invented evidence, contradiction, usage retention and old-policy request compatibility.
- Full server: 664 passed, 290 optional/database tests skipped. Initial sandbox listener denial was rerun
  with local listeners allowed; the successful run is the reported result. Server build passed.
- Actual SDK HTTP against the owned local simulation: nine assertions passed, including old-policy behavior,
  new valid tool input, review-required, wrong/duplicate tool envelope and throttling. This is fixture-only
  transport evidence, not a real-provider grading result.
- No policy-12 provider call or real spoken test yet. Normal Admin allowance for 8 November UTC is exhausted
  by the twenty policy-11 calls. No private override has been applied. An explicitly approved additional
  bounded local allowance or the next normal quota day is required for the 65-case set and six repeats.

Repeatable no-provider HTTP command is in the policy-11 document; the launcher now includes policy 12.
Private evidence: `/private/tmp/spasht-grading-validation/policy-12-focused.log`, `policy-12-server-tests.log`,
`policy-12-http-results.json` and `policy-12-simulation.ndjson`. No credentials, auth state or recordings
belong in Git. Production and shared voice services were untouched.
