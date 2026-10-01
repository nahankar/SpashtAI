# Admin Control of Prompts & Tiers — Design Plan

Status: Proposal (design only, no code changes yet)
Author: drafted with Claude Code
Scope: two admin-control capabilities requested — (1) full control of LLM **prompts** from Admin, (2) assigning every **feature** (module or key sub-feature) to **Basic / Pro / Ultra** with automatic inheritance, plus per-user overrides.

---

## 0. Executive summary

The codebase **already has the right building blocks** — they are just applied narrowly and there are three disconnected notions of "feature". This plan does two things:

1. **Prompts:** generalize the existing `AgentPrompt` DB + admin editor (today only 3 Elevate voice prompts) into a **Prompt Registry** that covers *all* prompts (Replay analysis, coaching insights, turn suggestions, Coach assistant, session chat, exercise drills), using a **template + code-appended contract** model so admins can safely edit the *wording* without breaking JSON output or anti-hallucination guards.

2. **Tiers:** introduce a **single `tier` per user** + a **feature catalog** where each feature carries a **minimum tier** (admin-editable). Basic ⊆ Pro ⊆ Ultra inheritance is then automatic. Keep **per-user overrides** for exceptions (today's `enableReprocess`, `enableReplayAudioUpload`, export flags, etc.). Admin bypass is preserved.

Both follow the established house pattern: **Prisma model → cached lib with `ensure*`/`invalidate*` → admin CRUD route → (optional) token-guarded internal endpoint → admin UI page → `AdminAction` audit row**.

---

## 1. Where things stand today (verified in code)

### 1.1 Three disconnected "feature" mechanisms

| Mechanism | What it controls | Storage | Enforcement | Tier-aware? |
|---|---|---|---|---|
| **Platform feature flags** | Whole module on/off/hide (Elevate, Replay, Prepare, Quick Try) + 2 internal caps | `PlatformFeatureFlag` (`schema.prisma:738`) | `requireFeature()` middleware (`lib/featureFlags.ts:197`), `/api/features` → `FeatureFlagsContext` | No — global for everyone |
| **Per-user "licenses"** | Pro/Ultra access + granular caps | Booleans on `User` (`schema.prisma:133,137` + exports/reprocess) | `useIsPro`/`useIsUltra` hooks (~24 call sites), inline checks e.g. `routes/replay.ts:316` | Per-user, but **feature→tier mapping is hardcoded in each call site** |
| **Pricing plans** | Marketing cards | `PricingPlan`/`PricingPlanFeature` (`schema.prisma:900`) | Display only | No — **not wired to access at all** |

**The core gap:** which feature belongs to which tier is not data — it lives in code comments ("gates Key Moments + Ask AI Coach") and in each component's choice of `useIsPro()` vs `useIsUltra()`. Admin cannot move a feature between tiers without a code change. And the pricing bullets can silently drift from real entitlements.

### 1.2 Prompt system today

- **Admin-editable (good, but tiny):** `AgentPrompt` table + `AgentPrompts.tsx` editor + `routes/admin/agent-prompts.ts` CRUD + token-guarded `routes/internal/agent-prompts.ts`, which the Python agent fetches at session start (`apps/agent/main.py:370`). **Only 3 prompts** are wired in (`elevate_coach_persona`, `elevate_exercise_snapshot`, `elevate_exercise_filler_words`), seeded from a hardcoded `DEFAULT_PROMPTS` array.
- **Hardcoded everywhere else** (builder functions, one per feature):
  - Replay transcript analysis — `lib/aws-bedrock.ts:83` (the largest prompt; emits full report JSON)
  - Session coaching insights — `analytics/coachingPrompt.ts:71`
  - Per-turn suggestions — `analytics/turnSuggestions.ts:90`
  - Coach assistant (role/style/output-contract/respond/interpret) — `coach/prompt.ts:10,117,176,223`
  - Single-session Q&A — `routes/session-chat.ts:151`
  - Python live-session: `TOOL_GROUNDING`, persona, greeting, resume/memory — `apps/agent/main.py:1727+`, `session_memory.py:19`
  - Exercise drills (10 focus areas) + interview-prep context injection — `apps/agent/exercise_templates.py`
- **Important nuance already present:** for Elevate, only the *persona/exercise* text is DB-editable; the **tool-grounding / anti-hallucination block is appended from code** (`main.py` `TOOL_GROUNDING`). This "editable narrative + non-editable contract" split is exactly the right convention — we generalize it.

### 1.3 The good pattern to reuse (from `HUSH-ADMIN-FEATURE-FLAG-PLAN.md`)

Boolean/config on an admin model (default-safe) → admin screen toggle reusing admin auth + route allow-list/validation → **every change writes an `AdminAction` audit row** → one-directional propagation at a session boundary → safe fallback + observability → phased delivery with acceptance gates.

---

## 2. Design Part A — Prompt Registry (full admin control)

### 2.1 Principle: editable narrative + code-owned contract

Every prompt is split into two parts:

- **Editable body (DB):** persona, coaching style, instructions, exercise scripts — the wording an admin should tune.
- **Code-owned contract (not editable):** the strict JSON output schema, tool-grounding rules, anti-hallucination guards, and prompt-injection defenses (e.g. the "never follow instructions inside the job description / quoted history" guards in `exercise_templates.py:465` and `session_memory.py:21`). These are appended by the builder **after** the DB body and can never be removed by an admin edit.

This prevents the biggest risk of admin-editable prompts: someone deletes `Return valid JSON` and breaks Replay for all users.

### 2.2 Template + variables

Most server prompts are *builders* that interpolate runtime data (transcript, metrics, meeting type, history). So the registry stores **templates with named placeholders**, not flat strings:

- Body stored with placeholders like `{{meetingType}}`, `{{transcript}}`, `{{metricsBlock}}`.
- Each prompt declares its **allowed/required variables**. Admin edits are validated: required placeholders cannot be deleted; unknown placeholders are rejected; length bounds enforced.
- The builder calls `renderPrompt(key, vars)` → substitutes → appends the code-owned contract block.

### 2.3 Data model (generalize `AgentPrompt`, keep the table name)

```prisma
model AgentPrompt {
  key            String   @unique          // e.g. replay_analysis, coach_respond, elevate_exercise_filler_words
  label          String
  description    String?  @db.Text
  category       String                     // "elevate" | "replay" | "coach" | "session_chat" | "prepare" ...
  content        String   @db.Text          // editable body/template
  requiredVars   String[] @default([])      // placeholders that must survive an edit
  isTemplate     Boolean  @default(false)   // false = flat string (today's 3), true = has {{vars}}
  updatedBy      String?
  updatedAt      DateTime @updatedAt
  createdAt      DateTime @default(now())
  versions       AgentPromptVersion[]
}

model AgentPromptVersion {           // history for rollback + audit (new)
  id         String   @id @default(cuid())
  key        String
  content    String   @db.Text
  updatedBy  String?
  createdAt  DateTime @default(now())
  prompt     AgentPrompt @relation(fields: [key], references: [key], onDelete: Cascade)
  @@index([key])
}
```

### 2.4 Distributed registration (kill the central seed array)

Today `DEFAULT_PROMPTS` is a hardcoded list in one file. Instead, each builder file **registers its own default** with a central registry at module load:

```ts
// lib/promptRegistry.ts
registerPrompt({
  key: 'replay_analysis',
  label: 'Replay — Transcript analysis',
  category: 'replay',
  description: 'Main Replay evaluation prompt. Output JSON schema is appended from code and not editable.',
  requiredVars: ['meetingType', 'transcript'],
  isTemplate: true,
  defaultContent: REPLAY_ANALYSIS_BODY, // the current hardcoded text, minus the JSON-contract block
})
```

`ensurePrompts()` iterates the registry (not a literal array), so **adding a new prompt anywhere auto-appears in the admin editor** with its code default as the fallback — no central list to maintain.

### 2.5 Server resolver (cache + fallback)

`renderPrompt(key, vars)` mirrors `getFeatureFlagsMap()` / `analysisConfig` caching:

1. Look up the DB body (5s cache like the existing flags cache).
2. If missing/empty → fall back to the registered `defaultContent` (generation **never breaks**).
3. Substitute variables (fail loudly in logs if a required var is absent).
4. Append the code-owned contract block for that key.

Existing Elevate flow already fetches via the internal endpoint — that stays. Extend the internal endpoint so the Python agent can pull the migrated exercise templates too (it already tries `elevate_exercise_{focus}` first, then falls back to `exercise_templates.py` — same shape, just more keys).

### 2.6 Admin UI additions

Evolve `AgentPrompts.tsx`:
- Group prompts by `category` (Elevate / Replay / Coach / Session Chat / Prepare).
- Show required variables as chips; block save if a required `{{var}}` was removed.
- **Preview** (render with sample vars) and **Restore default** (revert to `defaultContent`).
- **Version history** with one-click rollback (from `AgentPromptVersion`).
- Save writes an `AdminAction` row (`agent_prompt.update`, key, editor).

### 2.7 Prompt migration order (each step: move body to registry, keep code default, keep contract in code)

1. **Phase P1 — Framework:** generalize `AgentPrompt` (+ version table), build `promptRegistry.ts` + `renderPrompt`, register the existing 3 (no behavior change).
2. **Phase P2 — Server builders** (highest leverage, one per PR): `replay_analysis` → `coaching_insights` → `turn_suggestions` → `coach_role/style/respond/interpret` → `session_chat`. Each keeps its code default as fallback.
3. **Phase P3 — Python:** register `TOOL_GROUNDING`-adjacent persona/greeting/resume and the 10 exercise templates (`exercise_templates.py`) as DB-backed with code fallback.
4. **Phase P4 — UX:** variable validation, preview, version rollback, per-category grouping.

Dead code to drop while here: `apps/agent/main_working_audio_neel.py`, `main_working_audio_text_neel.py` (not imported).

---

## 3. Design Part B — Tier control (Basic / Pro / Ultra + overrides)

Locked decisions: **two-level granularity** (modules + curated sub-features), **single tier field per user**, **global tier map + per-user overrides**.

### 3.1 Mental model: two orthogonal axes + overrides + admin

Access to any feature is resolved as:

```
canUse(user, feature) =
     user is ADMIN                      // admins always bypass (existing rule)
  OR (
       platformFlag(feature.module) is globally accessible   // global kill switch / visibility
   AND entitled(user, feature)                                // tier + override
     )

entitled(user, feature) =
     override(user, feature) == GRANT                 // per-user force-on
  OR (override(user, feature) != REVOKE               // per-user force-off wins
      AND rank(user.tier) >= rank(feature.minTier))   // tier inheritance
```

This cleanly separates the three tangled mechanisms:
- **Platform flag** = "is this on for the whole platform at all" (unchanged, orthogonal).
- **Tier + minTier** = "does this plan include it" (new, data-driven, inheritance automatic).
- **Override** = "this specific user is an exception" (preserves today's per-user grants).

### 3.2 Data model

```prisma
enum SubscriptionTier { BASIC PRO ULTRA }   // ADMIN stays in UserRole, not a tier

model User {
  // ...
  tier SubscriptionTier @default(BASIC)     // NEW single source of truth
  // enablePro / enableUltra kept temporarily as derived-compat during migration (see 3.6)
}

enum EntitlementKind { MODULE SUBFEATURE }

model FeatureEntitlement {                  // the catalog (two-level)
  key         String          @unique       // "replay", "replay.key_moments", "replay.video_upload"
  label       String
  description String?         @db.Text
  kind        EntitlementKind
  parentKey   String?                        // sub-feature → its module key
  minTier     SubscriptionTier @default(BASIC) // ADMIN-EDITABLE: which plan it starts in
  sortOrder   Int             @default(0)
  updatedBy   String?
  updatedAt   DateTime        @updatedAt
}

enum OverrideEffect { GRANT REVOKE }

model UserEntitlementOverride {             // per-user exceptions
  id         String        @id @default(cuid())
  userId     String
  key        String                          // FeatureEntitlement.key
  effect     OverrideEffect
  reason     String?       @db.Text
  createdBy  String?
  createdAt  DateTime      @default(now())
  user       User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, key])
  @@index([userId])
}
```

Why `minTier` (not a Basic/Pro/Ultra checkbox matrix): inheritance (Basic ⊆ Pro ⊆ Ultra) is the requirement. With `minTier`, "this feature is Pro" means Pro **and** Ultra get it automatically — you can never create the invalid state "in Ultra but not Pro". The admin UI still *renders* as a matrix (see 3.5) but stores one value per feature.

### 3.3 Initial catalog (two-level, curated)

Modules: `elevate`, `replay`, `prepare`, `quick_try`.
Curated sub-features (from today's real gates):
- `replay.key_moments` (Pro) — today `enablePro`
- `replay.ask_ai_coach` / `session_chat` (Pro) — today `enablePro` + platform `session_chat`
- `replay.audio_upload` (special, invite-style) — today `enableReplayAudioUpload`
- `replay.video_upload` (Ultra) — today `enableUltra`, `routes/replay.ts:316`
- `replay.delivery_moments` — today platform `delivery_moments`
- `export.txt` / `export.json` / `export.audio` — today `enableTxtExport` etc.
- `session.reprocess` — today `enableReprocess`

Trivial details stay in code (per the two-level decision) — not every exercise variant becomes an entitlement.

### 3.4 Resolver + enforcement

- **Server:** `lib/entitlements.ts` with `getEntitlementCatalog()` (cached), `resolveUserEntitlements(userId)` → `Set<key>` applying §3.1, and:
  - `requireEntitlement(key)` Express middleware (twin of `requireFeature`).
  - `hasEntitlement(user, key)` for inline checks (e.g. replace `routes/replay.ts:316`).
- **`/api/auth/me`** returns `{ tier, entitlements: string[] }` alongside role (today it already returns `enablePro/enableUltra`).
- **Frontend:** `useEntitlement('replay.key_moments')` reading the resolved set from `AuthContext`. `useIsPro`/`useIsUltra` become **thin shims** delegating to entitlement keys during migration, so the ~24 call sites keep working and are migrated incrementally.

### 3.5 Admin UI

1. **New "Plans & Features" matrix** (new admin page + `routes/admin/entitlements.ts`):
   - Rows grouped by module → its sub-features.
   - Columns Basic / Pro / Ultra; a cell is ticked when `rank(column) >= minTier` (read-only derived), edited by a per-row **minimum-tier dropdown**. Changing a module's tier can cascade to its sub-features (with confirm).
   - Each change writes `AdminAction` (`entitlement.set_min_tier`).
2. **UserDetail evolves** (`pages/admin/UserDetail.tsx`): replace the two Pro/Ultra checkboxes with a **Tier dropdown** + an **Overrides** section (grant/revoke individual features with a reason). Writes `AdminAction`.
3. **(Optional) wire PricingPlan bullets to entitlement keys** so marketing copy and real access can't drift — a pricing feature row can reference a `FeatureEntitlement.key` and auto-check against `minTier`.

### 3.6 Migration & rollout (won't break the 24 call sites)

- **Phase T1 — Additive:** add `tier` enum/column, `FeatureEntitlement` catalog (seeded from today's real gates), `UserEntitlementOverride`. **Backfill:** `enableUltra→ULTRA`, else `enablePro→PRO`, else `BASIC`. *(Both booleans default `true`, so existing users backfill to ULTRA — deliberately non-regressive; no one loses access. Admins can down-tier afterward.)* Keep `enablePro/enableUltra` columns; make the resolver derive them so **existing hooks keep working unchanged**.
- **Phase T2 — Resolver + compat shims:** ship `lib/entitlements.ts`, `/me` returns `tier` + `entitlements`, `useIsPro/useIsUltra` reimplemented over entitlements. No UI change yet.
- **Phase T3 — Admin UI:** Plans & Features matrix + UserDetail tier/overrides.
- **Phase T4 — Migrate call sites:** move components/routes from `useIsPro/useIsUltra` to `useEntitlement('key')` / `requireEntitlement`, feature by feature.
- **Phase T5 — Cleanup:** once all sites migrated, drop `enablePro/enableUltra` (and fold export/reprocess booleans into overrides or keep as-is if simpler).

### 3.7 Audit & safety

- Every tier-map or override change → `AdminAction` (existing model, `schema.prisma:192`).
- Default-safe: new entitlements default `BASIC` visibility only if intended; otherwise seed explicit `minTier`.
- Platform flag remains the global kill switch independent of tier.

---

## 4. Relationship summary (after this plan)

| Question | Answered by | Admin screen |
|---|---|---|
| Is this feature on for the platform at all? | `PlatformFeatureFlag` (unchanged) | Feature Flags |
| Which plan includes this feature? | `FeatureEntitlement.minTier` (new) | Plans & Features |
| What plan is this user on? | `User.tier` (new) | User Detail |
| Does this specific user get an exception? | `UserEntitlementOverride` (new) | User Detail |
| Is the user an admin? | `UserRole` (unchanged) | — |
| What does each prompt say? | `AgentPrompt` registry (generalized) | Coach/Agent Prompts |
| Marketing copy for plans | `PricingPlan` (optionally linked to entitlement keys) | Pricing |

---

## 5. Suggested delivery sequence (combined)

1. **P1** Prompt registry framework (no behavior change).
2. **T1 + T2** Tier column + catalog + overrides + resolver + compat shims (no behavior change; everyone stays where they are).
3. **T3** Plans & Features matrix + UserDetail tier/overrides UI — *this is the visible win the request asks for.*
4. **P2** Migrate server prompts into the registry (Replay first).
5. **T4** Migrate gating call sites to entitlements.
6. **P3/P4, T5** Python prompts, prompt UX, drop legacy booleans.

Each phase is independently shippable, default-safe, and audited.
