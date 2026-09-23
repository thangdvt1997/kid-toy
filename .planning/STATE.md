# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-21)

**Core value:** Người mua lẻ có thể tìm và mua được đồ chơi phù hợp độ tuổi qua website, và đại lý có thể đăng ký tài khoản B2B, xem bảng giá sỉ riêng và đặt hàng số lượng lớn — cả hai luồng chạy trên cùng một catalog sản phẩm và tồn kho chính xác.
**Current focus:** Phase 1 — Foundation: Auth, Bilingual Catalog & Pricing

## Current Position

Phase: 1 of 7 (Foundation — Auth, Bilingual Catalog & Pricing)
Plan: 10 of 12 — Tasks 1-2 done (code), Task 3 (blocking human-verification checkpoint) NOT started. Remaining: 01-10 Task 3, then 01-11-PLAN.md (VPS deploy: docker-compose.prod.yml + Caddy/HTTPS)
Status: In Progress — PAUSED mid-verification at user's request (low on tokens)
Last activity: 2026-09-23 — Plan 10 Tasks 1-2 (staff admin UI: product/variant/media/price/stock forms, dealer approval screen) executed and committed (`aa9c9ef`, `6779ab0`, `3bce839`). VPS verification in progress when paused:
  - ✅ typecheck: FAILED first pass (2 real `noUncheckedIndexedAccess` TS errors in admin UI — array index access without bounds-proof), fixed (`e3313eb`), re-verified clean on VPS.
  - ✅ unit tests: 108 API + 54 web, all green on VPS.
  - ⏳ lint (`pnpm --filter web lint`): was mid-run on VPS when paused, result NOT yet confirmed either way.
  - ❌ NOT YET RUN: `pnpm --filter api run test:e2e`, `pnpm --filter web build`, the plan's own automated verify-block checks (anonymous admin redirect, WAREHOUSE 403 from API, grep checks for `Bearer`/`Number(unitPriceVnd)`/`revalidatePath` — executor already confirmed these via static grep, but the plan's literal `<verify><automated>` scripts that actually boot the stack and hit live endpoints have not run).
  - ❌ Task 3 (human-verification checkpoint) not started at all — this requires the actual user to walk through 6 steps in a browser (see 01-10-PLAN.md's `<how-to-verify>`) and type "approved" or list defects. Nothing can substitute for this.

**Resume here:** re-run `pnpm --filter web lint` on VPS, then `pnpm --filter api run test:e2e` and `pnpm --filter web build`, then the plan's automated verify scripts, fixing forward anything that fails — exactly the established pattern. Once all green, set up a 127.0.0.1-bound preview (API + web pointed at the VPS's `kidtoy` dev DB, not `kidtoy_test`) and give the user SSH tunnel instructions to do Task 3's 6-step walkthrough themselves.

Progress: [████████░░] 10/12 plans (83%) — Plan 10 counted as in-progress, not complete, until Task 3 passes.

Every completed plan (01–09) has been verified against the LIVE VPS Docker stack (not just static/mocked tests) — see each `01-0N-SUMMARY.md`'s "Orchestrator" verification notes and .claude/projects/D--Work/memory/project_kid_toy_ecommerce.md for the running list of real bugs this caught (Docker Hub image change, missing @HttpCode decorators, non-unique JWTs, ES2023 class-field/whitelist interaction, unsafe test slug seeds, missing --experimental-vm-modules flag, cross-locale slug navigation).

Phase 2 (Multi-Warehouse Batch-Tracked Inventory Core) research is already done (`02-RESEARCH.md`, committed) — done in parallel via a git worktree while Phase 1 was still executing. Not yet planned or executed.

## Performance Metrics

**Velocity:**
- Total plans completed: 10 (Phase 1: 01–09, 09A)
- Average duration: ~35-100 min per plan (executor time only, excludes orchestrator live-verification pass)
- Total execution time: not precisely tracked

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 10/12 | - | ~50 min |

**Recent Trend:**
- Last 5 plans (06-09A): all landed with 0-4 real bugs each, caught and fixed via live VPS testing before moving on
- Trend: steady; live-verification loop is working as intended, including a mid-phase review (09A) inserted by a separate session — the loop tolerates handoffs between sessions/accounts cleanly

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: PROJECT_MODE=mvp (vertical slices) — B2C (Phase 3) and B2B (Phase 4) are structured as two independent phases with no dependency on each other, both depending only on Phase 1 (auth/catalog/pricing) and Phase 2 (inventory), so they can be planned/executed in parallel instead of sequentially.
- [Roadmap]: Import/Export & landed cost (Phase 5) can proceed in parallel with Phase 3/4 once Phase 2 (batch-tracked inventory) exists, since batch identity originates at import.
- [Roadmap]: Cross-channel reporting (Phase 6) and admin/content polish (Phase 7) are sequenced last since they depend on real transactional data from both channels.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- [Phase 3/5]: MoMo/ZaloPay have no trustworthy first-party npm SDK — VNPay only for v1 payment gateway; direct REST+HMAC needed if MoMo/ZaloPay added later (v2, PAY-01).
- [Phase 5]: Landed-cost allocation formula (by value/weight/volume) needs a concrete spec decision before implementation; simple-average accepted for v1.
- [Phase 4]: Credit-limit breach behavior (hard block vs. sales-rep approval queue) needs resolution before building B2B-10.
- [Phase 1, resolved]: ~~Execute `01-09A-PLAN.md`~~ — done 2026-09-23, see Current Position.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-09-23
Stopped at: Plan 10 Tasks 1-2 committed; VPS verification mid-way (typecheck fixed+clean, unit tests green, lint/e2e/build/behavioral-gates and Task 3 human walkthrough NOT yet done). Paused at the user's explicit request (low on tokens) — see Current Position for the exact resume point.
Resume file: `01-10-PLAN.md` Task 3 — but first finish the VPS verification steps listed under Current Position, then hand Task 3's browser walkthrough to the user, then continue to `01-11-PLAN.md` (VPS deploy).

**Strict rule as of 2026-09-23 (see memory `feedback_deploy_location`):** never run `pnpm`/build/test/typecheck on the laptop — not even for "safe" static checks. Only git and file edits happen locally; everything else (install, typecheck, lint, test, build) runs on the VPS via ephemeral `node:24-bookworm` containers.

**VPS state at handoff:** `/root/test/kid-toy` on `69.197.177.130` is at commit `e3313eb` (matches GitHub `main`). Data-stack containers (`kid-toy-postgres-1`, `kid-toy-minio-1`, `kid-toy-redis-1`) are healthy, bound to `127.0.0.1` only. No preview/app containers left running. `kidtoy_test` is seeded and current (last seeded during Plan 09A's web e2e verification).
