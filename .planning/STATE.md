# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-21)

**Core value:** Người mua lẻ có thể tìm và mua được đồ chơi phù hợp độ tuổi qua website, và đại lý có thể đăng ký tài khoản B2B, xem bảng giá sỉ riêng và đặt hàng số lượng lớn — cả hai luồng chạy trên cùng một catalog sản phẩm và tồn kho chính xác.
**Current focus:** Phase 1 — Foundation: Auth, Bilingual Catalog & Pricing

## Current Position

Phase: 1 of 7 (Foundation — Auth, Bilingual Catalog & Pricing)
Plan: 10 of 12 complete in current phase — remaining: 01-10-PLAN.md (staff admin UI), 01-11-PLAN.md (VPS deploy: docker-compose.prod.yml + Caddy/HTTPS)
Status: In Progress
Last activity: 2026-09-23 — Plan 09A (auth/session hardening: render-time cookie writes removed, open-redirect on post-login `next` param fixed, proxy `x-pathname` forwarding corrected, DB-backed pricing spec separated into its own `test:integration` command) complete, committed (`261382c`), and fully live-verified on the VPS: typecheck clean, 108 API + 54 web unit tests, 21 integration tests (against `kidtoy_test`), 156 API e2e, and a new 5-case web auth-session e2e suite (run against a real preview of both apps bound to `127.0.0.1` on the VPS, torn down afterward) — all green. One test-assertion bug found and fixed along the way (see memory).

Progress: [████████░░] 10/12 plans (83%)

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
Stopped at: Phase 1 Plan 09A complete and fully live-verified on the VPS (see Current Position). Ready to start Plan 10 (staff admin UI).
Resume file: `01-10-PLAN.md` — execute, then VPS-verify, then continue to `01-11-PLAN.md` (VPS deploy).

**Strict rule as of 2026-09-23 (see memory `feedback_deploy_location`):** never run `pnpm`/build/test/typecheck on the laptop — not even for "safe" static checks. Only git and file edits happen locally; everything else (install, typecheck, lint, test, build) runs on the VPS via ephemeral `node:24-bookworm` containers.

**VPS state at handoff:** `/root/test/kid-toy` on `69.197.177.130` is at commit `261382c` (matches GitHub `main`). Data-stack containers (`kid-toy-postgres-1`, `kid-toy-minio-1`, `kid-toy-redis-1`) are healthy, bound to `127.0.0.1` only. No preview/app containers left running. `kidtoy_test` is seeded and current.
