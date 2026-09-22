# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-21)

**Core value:** Người mua lẻ có thể tìm và mua được đồ chơi phù hợp độ tuổi qua website, và đại lý có thể đăng ký tài khoản B2B, xem bảng giá sỉ riêng và đặt hàng số lượng lớn — cả hai luồng chạy trên cùng một catalog sản phẩm và tồn kho chính xác.
**Current focus:** Phase 1 — Foundation: Auth, Bilingual Catalog & Pricing

## Current Position

Phase: 1 of 7 (Foundation — Auth, Bilingual Catalog & Pricing)
Plan: 9 of 11 complete in current phase — remaining: 01-10-PLAN.md (staff admin UI), 01-11-PLAN.md (VPS deploy: docker-compose.prod.yml + Caddy/HTTPS)
Status: In Progress
Last activity: 2026-09-22 — Plan 09 (browser-reachable auth UI: login/register/forgot-password/reset-password) complete, committed (`f1e5b85`), and live-verified against the real VPS Docker stack (typecheck clean across all 3 packages; backend regression 156/156 e2e still green)

Progress: [████████░░] 9/11 plans (82%)

Every completed plan (01–09) has been verified against the LIVE VPS Docker stack (not just static/mocked tests) — see each `01-0N-SUMMARY.md`'s "Orchestrator" verification notes and .claude/projects/D--Work/memory/project_kid_toy_ecommerce.md for the running list of real bugs this caught (Docker Hub image change, missing @HttpCode decorators, non-unique JWTs, ES2023 class-field/whitelist interaction, unsafe test slug seeds, missing --experimental-vm-modules flag, cross-locale slug navigation).

Phase 2 (Multi-Warehouse Batch-Tracked Inventory Core) research is already done (`02-RESEARCH.md`, committed) — done in parallel via a git worktree while Phase 1 was still executing. Not yet planned or executed.

## Performance Metrics

**Velocity:**
- Total plans completed: 9 (Phase 1: 01–09)
- Average duration: ~35-85 min per plan (executor time only, excludes orchestrator live-verification pass)
- Total execution time: not precisely tracked

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 9/11 | - | ~50 min |

**Recent Trend:**
- Last 5 plans (05-09): all landed with 0-4 real bugs each, caught and fixed via live VPS testing before moving on
- Trend: steady; live-verification loop is working as intended

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

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-09-22
Stopped at: Phase 1 Plan 09 complete and live-verified; user asked to save state and pause for an account switch before continuing.
Resume file: None — resume via `/gsd:execute-phase 1` (or equivalent: spawn a gsd-executor for `01-10-PLAN.md`) then repeat the established push→VPS-pull→live-test→fix-forward loop before starting `01-11-PLAN.md` (VPS deploy).

**VPS state at handoff:** `/root/test/kid-toy` on `69.197.177.130` is at commit `f1e5b85` (matches GitHub `main`). Data-stack containers (`kid-toy-postgres-1`, `kid-toy-minio-1`, `kid-toy-redis-1`) are running and healthy, bound to `127.0.0.1` only. No preview/live app containers are running (deliberately torn down at handoff — see memory `feedback_deploy_location` for why they should always be re-created bound to `127.0.0.1` unless the user explicitly asks otherwise, and never left running unattended).
