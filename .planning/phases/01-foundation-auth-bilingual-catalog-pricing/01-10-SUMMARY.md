---
phase: 01-foundation-auth-bilingual-catalog-pricing
plan: 10
subsystem: ui
tags: [nextjs, server-actions, react19, rbac, admin, i18n]

# Dependency graph
requires:
  - phase: 01-foundation-auth-bilingual-catalog-pricing
    provides: "requireStaff()/getCurrentUser() (Plan 09/09A), apiGet/apiSend with auth:true (Plan 08), the full CATALOG-01..05/09 admin API (Plan 05), PriceResolutionService admin CRUD (Plan 06), business-account approval endpoint (Plan 04)"
provides:
  - "apps/web/src/app/[locale]/admin/** — staff-gated route group: layout, landing page, product list/create/edit, business-account approval"
  - "apps/web/src/lib/admin-actions.ts — every admin Server Action wrapping the Plan 04/05/06 admin API with auth:true, a 403->Admin.errForbidden mapping that is never swallowed, and revalidatePath after every mutation"
  - "apps/web/src/components/admin/{ProductForm,VariantForm,MediaUploader,PriceStockForm,ApprovalForm}.tsx"
affects: [phase-01-plan-11 (VPS deploy will run this plan's own live-stack verify scripts), phase-07-admin-console (governed/polished successor to this minimal UI)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server Action arg-binding chain for parameterized mutations: exported actions take their identifying id(s) as LEADING params (e.g. updateVariantAction(productId, variantId, prevState, formData)), bound via `.bind(null, ...)` from the calling component so the remaining (prevState, formData) tail matches useActionState's required signature — the documented Next.js pattern for combining bound extra arguments with useActionState."
    - "A 403 from any admin API call always maps to Admin.errForbidden and is checked BEFORE the error-code lookup table, never falling through to a generic message — the UI gate (requireStaff) and the API gate (RolesGuard) must never silently disagree (T-01-75)."
    - "API error codes travel in ApiError.message (NestJS's default exception filter serializes `new BadRequestException('CODE')` as `{ message: 'CODE' }`, and api-client.ts's parseErrorBody reads that into `.message`, not `.code`) — admin-actions.ts's ERROR_KEY_MAP keys off `.message`, mirroring the same pattern Plan 09's registerBusinessAction already established."
    - "revalidatePath calls inside a Server Action cause the CURRENT route's already-fetched Server Component props to refresh in the SAME action response (per Next.js's single-roundtrip model) — client components never need to locally re-fetch or duplicate server state after a successful mutation; only VariantStockDto's returned `data` (from setStockAction) needs local rendering, since no GET endpoint exists for current stock at all."
    - "A price/stock section that CAN be gated by a real GET (price tiers — SUPER_ADMIN|SALES) is fetched server-side and replaced with a forbidden notice on 403; a section with NO GET to gate on (stock — VariantStockService is a deliberately thin Phase 1 stub) is always rendered and only reveals a role boundary when the WRITE action itself returns 403."

key-files:
  created:
    - apps/web/src/app/[locale]/admin/layout.tsx
    - apps/web/src/app/[locale]/admin/page.tsx
    - apps/web/src/app/[locale]/admin/products/page.tsx
    - apps/web/src/app/[locale]/admin/products/new/page.tsx
    - apps/web/src/app/[locale]/admin/products/[id]/page.tsx
    - apps/web/src/app/[locale]/admin/business-accounts/page.tsx
    - apps/web/src/components/admin/ProductForm.tsx
    - apps/web/src/components/admin/VariantForm.tsx
    - apps/web/src/components/admin/MediaUploader.tsx
    - apps/web/src/components/admin/PriceStockForm.tsx
    - apps/web/src/components/admin/ApprovalForm.tsx
    - apps/web/src/lib/admin-actions.ts
  modified:
    - apps/web/messages/vi.json
    - apps/web/messages/en.json
    - apps/web/next.config.ts

key-decisions:
  - "Added Server Actions bodySizeLimit: '60mb' to next.config.ts (not in this plan's file list) — Next.js Server Actions default to a 1MB request-body cap, which would 413 on every video and most image uploads through MediaUploader's own action before the API's 5MB/50MB validation ever runs (Rule 2 — missing critical functionality)."
  - "Added deletePriceEntryAction, not part of the plan's literal <interfaces> action list, because the plan's OWN behavior bullet ('deleting the last retail entry surfaces LAST_RETAIL_PRICE') has no other code path to reach from the UI without it (Rule 2)."
  - "createCategoryAction/createBrandAction were implemented (fulfilling the <interfaces> contract literally) but are not wired to any screen in this plan — categories/brands are Plan 05 seed data, and no task's <action> text asks for a taxonomy-management screen; documented here rather than silently dropped."
  - "The stock sub-form in PriceStockForm.tsx always renders regardless of role, because no admin GET exists to read current quantityOnHand/reorderThreshold at all (VariantStockService's read contract, per 01-06-SUMMARY.md, deliberately only exposes derived status, not raw numbers). The role boundary is only observable when the WRITE action itself returns 403 — this is the intentional design the plan's own behavior bullet describes ('still render the form... do not hide the section')."
  - "Price entries/tiers ARE gated by a real GET, so a CONTENT session sees a forbidden notice in place of the form entirely, rather than a broken/empty select."

requirements-completed: [AUTH-03, AUTH-04, CATALOG-01, CATALOG-02, CATALOG-03, CATALOG-04, CATALOG-05, CATALOG-06, CATALOG-08, CATALOG-09]

# Metrics
duration: ~70min
completed: 2026-09-23
---

# Phase 1 Plan 10: Staff Admin UI (Tasks 1-2 of 3) Summary

**Minimal but complete staff admin UI in `apps/web` — bilingual product CRUD with every CATALOG-01 facet, variant/SKU/carton/certification management, ordered media upload, per-tier pricing and stock, and dealer approval-onto-tier — all as Server Actions that independently handle a 403 from the API's RolesGuard rather than trusting the UI's own `requireStaff` gate.**

**Status: Tasks 1-2 of 3 complete and committed. Task 3 (human verification of the full Phase 1 walking skeleton) is a `checkpoint:human-verify` gate that only the actual user can complete — explicitly out of scope for this execution per the orchestrator's instructions. This SUMMARY covers Tasks 1-2 only; Task 3 remains pending.**

## Performance

- **Tasks:** 2/2 (of this execution's scope) completed — Task 3 pending, not started
- **Files modified:** 17 (14 created, 3 modified)

## Accomplishments

- **AUTH-04 proven twice, not once:** `/[locale]/admin/**`'s `layout.tsx` calls `requireStaff(...)` (redirect-anonymous / 404-wrong-role), and independently, every Server Action in `admin-actions.ts` maps a 403 from the API to `Admin.errForbidden` and surfaces it rather than swallowing it — the plan's own acceptance criteria treat the UI gate and the API gate as two separate things that must each be provably true, and this implementation never lets one substitute for the other.
- **CATALOG-01/09 (bilingual product CRUD):** `ProductForm.tsx` renders two fieldsets (Tiếng Việt / English), all facet controls (category/brand selects, age range, origin, gender, channelScope), and a slug-suggestion helper that strips Vietnamese diacritics (including `đ`/`Đ`, which do not decompose via Unicode NFD like the other marks) without ever overwriting a slug the user already edited. A locale left entirely blank is omitted from the submitted `translations` array (not sent with empty strings), which is what actually reaches the API's `BOTH_LOCALES_REQUIRED` code path.
- **CATALOG-02..05 (variants, carton spec, certifications, media):** `VariantForm.tsx` covers SKU (server-coerced uppercase)/barcode/carton fields plus a nested certification sub-form and delete-able list. `MediaUploader.tsx` uploads image/video with alt text and supports full-list reorder (move up/down) and delete.
- **CATALOG-06/08 (pricing, stock):** `PriceStockForm.tsx` lists/deletes price entries per tier (`unitPriceVnd` read as a string and forwarded verbatim — never `Number(...)`'d, grep-verified) and a stock fieldset that always renders and displays the derived status badge from the action's own response (there is no admin GET for raw stock numbers at all — see Decisions).
- **AUTH-03 (dealer approval loop closes):** `/admin/business-accounts` lists applications by status, offers a presigned "View licence" link (object key never in page HTML), and lets a SALES/SUPER_ADMIN session approve onto a non-default tier or reject with a required reason.
- Every mutation calls `revalidatePath` for both locales' `/catalog` and the admin product routes.

## Task Commits

1. **Task 1: Server-gated admin route group, product list, bilingual product form (CATALOG-01/09, AUTH-04)** — `aa9c9ef` (feat)
2. **Task 2: Variant/certification/media/price/stock management, dealer approval (CATALOG-02..06/08, AUTH-03/04)** — `6779ab0` (feat)

**Task 3 (human verification of the full Phase 1 walking skeleton): NOT executed.** It is a `checkpoint:human-verify` gate (`gate="blocking"`) requiring the actual user to walk through a real browser session across all five ROADMAP success criteria plus the B2B approval loop, per this execution's explicit instructions. The orchestrator should arrange this after Tasks 1-2 are verified live on the VPS.

## TDD Gate Note

Both tasks are marked `tdd="true"` in the plan, but the plan's own `type` is `execute` (not `tdd`), and neither task lists any spec/test file in its `files_modified` — mirroring 01-08-SUMMARY.md's and 01-09-SUMMARY.md's documented precedent for the identical situation. Each task's actual behavioral gate is its `<verify><automated>` live-stack script (a real browser/HTTP walkthrough against a running Next.js + NestJS + Postgres stack), not a jsdom unit/component test. Per this execution's explicit strict constraint (no `pnpm`/`node`-running-a-build-tool on this machine), RED/GREEN was reasoned through by hand against the exact backend DTOs/error codes (read directly from `apps/api/src/modules/catalog|pricing|business-accounts`'s source, not assumed), not executed. Each task landed as one `feat` commit.

## Automated Verify Blocks — Not Run Locally, Orchestrator To Run On VPS

Per this execution's strict constraint, none of the following were run. Listed exactly as they appear in `01-10-PLAN.md` so the orchestrator knows precisely what to execute against the live VPS stack:

**Task 1's `<verify><automated>`:**
```
pnpm --filter web exec tsc --noEmit && pnpm --filter web build && node -e "const{spawn}=require('child_process');const p=spawn('pnpm',['--filter','web','start'],{shell:true,stdio:'ignore',detached:true});const wait=ms=>new Promise(r=>setTimeout(r,ms));(async()=>{await wait(9000);const web='http://localhost:3000',api='http://localhost:4000';const anon=await fetch(web+'/vi/admin/products',{redirect:'manual'});if(![302,307,308].includes(anon.status))throw new Error('anon admin should redirect, got '+anon.status);const login=async(e)=>{const r=await fetch(api+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e,password:process.env.SEED_DEFAULT_PASSWORD})});return (await r.json()).accessToken};const wh=await login('warehouse@kidtoy.local');const forbidden=await fetch(api+'/api/admin/products',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+wh},body:JSON.stringify({categoryId:'x',ageRangeMin:0,ageRangeMax:1,gender:'UNISEX',origin:'VN',channelScope:'BOTH',translations:[]})});if(forbidden.status!==403)throw new Error('warehouse should get 403 from API, got '+forbidden.status);console.log('admin gates ok');process.kill(-p.pid)})().catch(e=>{try{process.kill(-p.pid)}catch{};throw e})"
```

**Task 2's `<verify><automated>`:**
```
pnpm --filter web exec tsc --noEmit && pnpm --filter web build && pnpm turbo run test && node -e "const fs=require('fs');const s=fs.readFileSync('apps/web/src/lib/admin-actions.ts','utf8');if(/Number\(\s*[^)]*unitPriceVnd/.test(s))throw new Error('unitPriceVnd coerced to Number');if(!/auth:\s*true/.test(s))throw new Error('missing authenticated calls');if(!/revalidatePath/.test(s))throw new Error('missing revalidatePath');const c=fs.readFileSync('apps/web/src/components/admin/PriceStockForm.tsx','utf8');if(/Bearer/.test(c))throw new Error('token handling in a client component');console.log('admin actions ok')"
```

**What WAS checked locally (Grep, not execution):** the same three static assertions Task 2's script makes (`Number\(\s*[^)]*unitPriceVnd` absent, `auth:\s*true` present ×18, `revalidatePath` present ×15 in `admin-actions.ts`; `Bearer` absent anywhere under `apps/web/src/components`) were verified via the Grep tool directly against the committed source — these are text-pattern checks, not code execution, so they do not fall under the laptop's no-`pnpm`/no-build-tool constraint.

**Plan-level `<verification>` (5 items) — status:**
1. `pnpm turbo run typecheck`, `pnpm turbo run test`, `pnpm --filter api run test:e2e` — not run locally, orchestrator/VPS.
2. `pnpm --filter web build` — not run locally, orchestrator/VPS.
3. Anonymous admin redirect + WAREHOUSE 403 from the API — not run locally (requires a live stack), orchestrator/VPS (same script as Task 1 above).
4. Static gates (no `Bearer` in client components, no `Number(unitPriceVnd)`, `revalidatePath` present) — **checked locally via Grep, passing**, see above.
5. Task 3's human checkpoint — not started; pending.

## Files Created/Modified

- `apps/web/src/app/[locale]/admin/layout.tsx` — `requireStaff`-gated route group wrapper, staff nav, logout
- `apps/web/src/app/[locale]/admin/page.tsx` — minimal landing page
- `apps/web/src/app/[locale]/admin/products/page.tsx` — search/paginated list with category/brand name lookup
- `apps/web/src/app/[locale]/admin/products/new/page.tsx`, `products/[id]/page.tsx` — create/edit, wiring all Task 2 components
- `apps/web/src/app/[locale]/admin/business-accounts/page.tsx` — status-filtered dealer application list
- `apps/web/src/components/admin/{ProductForm,VariantForm,MediaUploader,PriceStockForm,ApprovalForm}.tsx`
- `apps/web/src/lib/admin-actions.ts` — every admin Server Action (see key-decisions/patterns)
- `apps/web/messages/{vi,en}.json` — full `Admin` namespace (covers both tasks, added in Task 1's commit per the same "one JSON object, no natural per-task diff boundary" precedent 01-09-SUMMARY.md documents)
- `apps/web/next.config.ts` — `experimental.serverActions.bodySizeLimit: "60mb"` (Rule 2 addition)

## Decisions Made

See `key-decisions` in the frontmatter for full rationale on: (1) the `bodySizeLimit` fix; (2) `deletePriceEntryAction`'s addition; (3) taxonomy actions implemented-but-unwired; (4) the stock section's always-render-regardless-of-role design (no GET exists to gate on); (5) the price section's real-GET-based forbidden gating.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Server Actions' default 1MB body limit would break every media upload**
- **Found during:** Task 2, designing `MediaUploader.tsx`/`uploadMediaAction`
- **Issue:** Next.js Server Actions cap request bodies at 1MB by default. `media.service.ts` (Plan 05) allows images up to 5MB and video up to 50MB — every video and most real images would 413 inside Next's own action pipeline before the API's own size validation ever ran.
- **Fix:** Added `experimental.serverActions.bodySizeLimit: "60mb"` to `apps/web/next.config.ts` (not in this plan's file list).
- **Files modified:** `apps/web/next.config.ts`
- **Verification:** Read against `apps/web/node_modules/next/dist/docs/01-app/02-guides/server-actions.md`'s own documented config shape; not executable-verified locally (no `pnpm`/build allowed on this machine) — orchestrator should confirm a real video upload succeeds on the VPS.
- **Committed in:** `6779ab0`

**2. [Rule 2 - Missing Critical Functionality] No UI path existed to reach `LAST_RETAIL_PRICE`**
- **Found during:** Task 2, implementing `PriceStockForm.tsx`
- **Issue:** The plan's own behavior bullet requires "deleting the last retail entry surfaces the localized `LAST_RETAIL_PRICE` message," but the plan's literal `<interfaces>` action list only names `setPriceAction`/`setStockAction` — no delete action. Without one, that acceptance criterion has no code path.
- **Fix:** Added `deletePriceEntryAction(productId, entryId)`, calling the already-specified `DELETE /api/admin/price-entries/:entryId` endpoint, wired to a delete button per price-entry row.
- **Files modified:** `apps/web/src/lib/admin-actions.ts`, `apps/web/src/components/admin/PriceStockForm.tsx`
- **Verification:** Read against `pricing.admin.controller.ts`/`pricing.admin.service.ts` (Plan 06) to confirm the endpoint, method, and `LAST_RETAIL_PRICE` 409 code exist exactly as assumed; not executable-verified locally.
- **Committed in:** `6779ab0`

---

**Total deviations:** 2 auto-fixed (both Rule 2 — missing critical functionality). Both were necessary for the plan's own stated behavior to actually be reachable/functional, not scope creep.

## Known Stubs / Documented Non-Wiring

- `createCategoryAction`/`createBrandAction` in `admin-actions.ts` are fully implemented (calling the real Plan 05 endpoints) but are not called from any component in this plan — no task's `<action>` text asks for a taxonomy-management screen, and categories/brands are Plan 05 seed data. Not a stub (no hardcoded/empty data anywhere), simply unused by this plan's own screens; flagged here so a future admin-console phase (Phase 7) doesn't have to re-derive these actions from scratch.
- The stock sub-form in `PriceStockForm.tsx` never pre-fills `quantityOnHand`/`reorderThreshold` with the variant's current values, because no admin GET endpoint exists to read them (see key-decisions) — this is a genuine Phase 1 backend gap (VariantStockService is a deliberately thin, Phase-2-replaceable stub per 01-06-SUMMARY.md), not an oversight in this plan's frontend.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: availability | `apps/web/next.config.ts` | Raising Server Actions' `bodySizeLimit` to 60mb (needed for legitimate 50MB video uploads) also raises the ceiling for an authenticated staff session to send a large POST body to ANY Server Action in the app, not just `uploadMediaAction` — a mitigating factor is that every admin Server Action requires a valid staff session (AUTH-04) and NestJS's own `MaxFileSizeValidator` still rejects an oversized upload after transit; not in the plan's own `<threat_model>` register, flagged here for Phase 7's admin-console hardening pass to consider a per-route limit instead of a global one if it becomes a concern at scale. |

## Issues Encountered

- **No Docker/live stack on this dev machine, compounded by an explicit stricter constraint for this execution:** unlike prior plans in this phase (which could at least run `pnpm --filter web build`/`tsc --noEmit` locally even without a live database), this execution was instructed not to run ANY `pnpm`/`tsc`/`jest`/`next`/build-tool-spawning command at all, "not even safe static checks." Every line of new code was therefore reviewed by hand against the exact backend DTOs, controller routes, and error codes (read directly from `apps/api/src/modules/{catalog,pricing,business-accounts,inventory}` source) rather than confirmed via `tsc --noEmit`. The three static acceptance-criteria checks that ARE pure text-pattern matching (not code execution) were run via the Grep tool and pass (see "Automated Verify Blocks" above).
- **No admin GET endpoint for current variant stock** (see Decisions/Known Stubs) — a genuine, pre-existing Plan 06 backend gap, not something this plan's frontend could have worked around without inventing a new backend endpoint out of scope for this plan.

## User Setup Required

None — no new environment variables introduced. `next.config.ts`'s `bodySizeLimit` change requires no env var, only a rebuild.

## Next Phase Readiness

- **Blocking:** Task 3 (human verification of the full Phase 1 walking skeleton, all five ROADMAP success criteria plus the B2B approval loop) has not been attempted. The orchestrator must arrange this — start the real stack on the VPS, run the automated verify blocks listed above, then hand the `01-10-PLAN.md` Task 3 checkpoint to the actual user.
- Once Task 3 is approved, Plan 11 (VPS deploy: `docker-compose.prod.yml` + Caddy/HTTPS) is the last plan in Phase 1.
- No code-level blockers: every Server Action this plan's `<interfaces>` block specifies is implemented and exported from `admin-actions.ts` exactly as named (plus `deletePriceEntryAction`, documented above).

## Self-Check: PASSED

All 14 created files and 3 modified files verified present on disk; both task commits (`aa9c9ef`, `6779ab0`) verified present in `git log`. Grep-verified: `admin-actions.ts` contains no `Number(...unitPriceVnd...)`, contains `auth: true` (18×) and `revalidatePath` (15×); no file under `apps/web/src/components` contains the string `Bearer`.

---
*Phase: 01-foundation-auth-bilingual-catalog-pricing*
*Completed: 2026-09-23 (Tasks 1-2 only — Task 3 pending human verification)*
