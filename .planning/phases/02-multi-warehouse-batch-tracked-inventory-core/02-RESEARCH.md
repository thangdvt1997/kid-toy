# Phase 2: Multi-Warehouse Batch-Tracked Inventory Core - Research

**Researched:** 2026-09-22
**Domain:** Atomic, multi-warehouse, batch/lot-tracked inventory ledger (NestJS 11 + Prisma 7 + PostgreSQL 17) that both a not-yet-built B2C storefront (Phase 3) and B2B portal (Phase 4) will consume as their single source of stock truth
**Confidence:** MEDIUM-HIGH (schema/concurrency patterns directly apply this project's own PITFALLS.md Pitfalls 2/4/8, which are HIGH-confidence first-party research; package versions live-verified against npm registry this session; bwip-js/BullMQ API shapes verified via official docs/WebSearch aggregate — MEDIUM)

## Summary

Phase 2 replaces Phase 1's deliberately thin `VariantStock` stub with a real ledger while preserving its public read contract exactly, and it is also the **first phase in this repository to wire BullMQ/Redis, bwip-js, and qrcode** — none of these packages are installed yet (verified: no BullMQ/bwip-js/qrcode/ioredis in `apps/api/package.json`, and `docker-compose.yml`'s Redis service exists but is unused — Phase 1's own SKELETON.md explicitly deferred queue wiring: *"Redis runs in the compose stack from day one, but no queue is wired in Phase 1"*). This means Phase 2 owns not just inventory data modeling but the first production BullMQ setup for the whole project.

The core design problem, per this project's own PITFALLS.md (Pitfalls 2, 4, and 8, all HIGH-confidence first-party research), is that inventory oversell, batch/lot retrofits, and transfer atomicity are the three most expensive-to-fix mistakes in this domain, and all three are prevented by the same structural decision: **one auditable movement-log-backed ledger at (SKU × Warehouse × Batch) grain**, where every quantity mutation — receive, reserve, commit, release, transfer, adjust, defective-flag, return — goes through a single `StockLedgerService` and is recorded as an immutable `StockMovement` row. No other code path may `UPDATE` a `StockLot`'s quantity columns directly, mirroring exactly how Phase 1's `PriceResolutionService` is the sole price-computation path (ARCHITECTURE.md Anti-Pattern 3) — this phase applies the identical discipline to stock.

Atomic reservation (INV-04, the phase's single highest-value requirement) is implemented as a **conditional row-locked UPDATE per candidate lot inside a Prisma interactive transaction** — `UPDATE stock_lots SET qty_reserved = qty_reserved + $take WHERE id = $lotId AND (qty_on_hand - qty_reserved) >= $take`, checking the affected-row count — walking lots in FEFO/FIFO order until the requested quantity is satisfied or the transaction rolls back with `INSUFFICIENT_STOCK`. This is PITFALLS.md Pitfall 2's own recommended fix ("conditional update, not read-then-write"), applied per-lot instead of per-SKU so it also satisfies Pitfall 4 (batch traceability) in the same code path. Because Phase 3 (B2C) and Phase 4 (B2B) do not exist yet and are built in parallel *after* this phase, `StockLedgerService.reserve/commit/release` is designed as a **channel-agnostic public contract** (`holderType`/`holderId` strings, no FK to an `Order` table that doesn't exist yet) — this is the phase's most important forward-looking design decision and is flagged in Open Questions for confirmation once Phase 3/4 requirements are concrete.

**Primary recommendation:** Model `Warehouse`, `StockLot` (the batch/lot entity), `StockMovement` (append-only audit ledger), `StockReservation`/`StockReservationLine` (the reserve/commit/release contract), `WarehouseTransfer` (explicit in-transit state machine per Pitfall 8), and `StockTake` (physical-count reconciliation) as six new first-class Prisma models. Repurpose (not replace) `VariantStock` as a denormalized, transactionally-maintained cache of variant-level available-to-sell quantity — same field names, same `VariantStockService.getAvailability`/`getAvailabilityMany` signatures Phase 1 already locked, so CATALOG-08 does not change shape. Wire BullMQ for the first time in this repo for low-stock alerts (sync threshold check inside the same transaction as a reservation commit, async notification job) and reuse Phase 1's existing `NotificationsModule`/`MailerService` seam (currently structured-log-only) by adding one new method, rather than building a parallel notification path.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Warehouse CRUD (INV-01) | API / Backend | Database / Storage | Simple RBAC-gated admin CRUD, no special concurrency concern |
| Stock in/out/transfer recording (INV-02) | API / Backend | Database / Storage | Every mutation goes through `StockLedgerService`; DB enforces the movement-log invariant via a single write path, not a constraint |
| SKU × Warehouse × Batch tracking (INV-03) | Database / Storage | API / Backend | `StockLot` is the grain; API exposes read/write over it, never lets a caller bypass to a coarser grain |
| Atomic reservation across channels (INV-04) | API / Backend | Database / Storage | Correctness lives in the transaction boundary (conditional UPDATE + Prisma `$transaction`), enforced in the service layer, not just a DB constraint — Postgres alone can't express "walk lots in FEFO order until satisfied" |
| Low-stock alert (INV-05) | API / Backend | Redis (BullMQ) | Threshold check is synchronous (cheap, correctness-critical); the notification *send* is asynchronous (slow, external, must not block the reservation transaction) |
| Barcode/QR label generation (INV-06) | API / Backend | Object Storage (MinIO, optional) | `bwip-js` renders server-side; a single ad-hoc label streams directly as PNG, no queue needed (fast, <200ms); only a multi-label batch print reuses the existing Puppeteer/BullMQ PDF pattern from STACK.md |
| Stock-take reconciliation (INV-07) | API / Backend | Database / Storage | Reconciliation writes go through the same `StockMovement` ledger as every other mutation — no special-cased direct `UPDATE` |
| Defective/returned non-sellable state (INV-08) | Database / Storage | API / Backend | Modeled as a `StockLot.status` value excluded from the available-to-sell aggregate, not a boolean flag or a separate table — keeps one query shape for "what's sellable" |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INV-01 | Manage multiple warehouses with per-warehouse stock levels | `Warehouse` model; admin CRUD controller; live `groupBy` query over `StockLot` for per-warehouse breakdown (not cached — low query volume, admin-only) |
| INV-02 | Record stock in/out/transfer, balances update immediately | `StockLedgerService.receive/adjust`, `WarehouseTransferService` state machine (PENDING→IN_TRANSIT→RECEIVED), all logged via `StockMovement` |
| INV-03 | Track inventory at SKU × Warehouse × Batch/lot granularity | `StockLot(variantId, warehouseId, lotCode, ...)` is the grain; `@@unique([variantId, warehouseId, lotCode])` |
| INV-04 | Atomically reserve/decrement one shared ledger, no oversell across channels | `StockLedgerService.reserve/commit/release` — conditional per-lot UPDATE inside a Prisma interactive transaction, channel-agnostic `holderType`/`holderId` contract for Phase 3/4 to consume |
| INV-05 | Low-stock alert on reorder threshold crossing | Sync threshold check in the same transaction as any decrement; BullMQ job (first BullMQ wiring in this repo) dispatches the notification via `MailerService.sendLowStockAlert` (new method) |
| INV-06 | Generate/print barcode/QR labels per SKU/batch | `bwip-js` (Code128 for SKU, QR for lot/warehouse) rendered server-side; plain-text payload (not JSON) so a keyboard-wedge scanner can type it into a normal form field, per PROJECT.md's explicit "no mobile scanning app" constraint |
| INV-07 | Stock-take/physical count reconciliation | `StockTake`/`StockTakeLine` — snapshot system qty, capture counted qty, generate `ADJUSTMENT_STOCKTAKE` movements on completion |
| INV-08 | Flag defective/returned goods as distinct non-sellable state | `StockLot.status` (`DEFECTIVE`, `RETURNED_PENDING_INSPECTION`, etc.) excluded from available-to-sell aggregation; quantity is split into a new lot (`sourceLotId` self-FK) so partial-quantity flagging preserves lot history |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Deploy: single VPS, Docker Compose, **no microservices** — BullMQ workers run in-process in the same NestJS app (per STACK.md: "One NestJS app can run both HTTP server and queue workers in v1"), not a separate worker container, unless queue load later proves otherwise.
- Money: VND only, integer, `BigInt` — this phase introduces no new money fields (landed cost is explicitly Phase 5 scope, see Don't Hand-Roll), so this constraint mainly guards against a tempting-but-premature `costPriceVnd` column on `StockLot`.
- Security: no secrets in repo/planning docs — Redis connection string via `.env`/`ConfigService`, same pattern as Phase 1's `DATABASE_URL`.
- No mobile barcode-scanning app (explicit Out of Scope in REQUIREMENTS.md) — INV-06 labels must be scannable by a **keyboard-wedge USB/Bluetooth scanner typing into a normal web form**, which constrains the QR/barcode payload to a plain identifier string, not a structured JSON blob (a wedge scanner cannot parse JSON, it only emits keystrokes).
- Existing codebase convention (established Phase 1, this session's own read of `apps/api/src`): DTOs use `class-validator` with a global `whitelist: true, forbidNonWhitelisted: true` `ValidationPipe`; money-adjacent integer fields use `@IsInt() @Min(0)`; every mutating admin route is `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)` at the controller or route level; services throw `NotFoundException`/`ConflictException` with a stable string code (e.g. `'LAST_RETAIL_PRICE'`), never a raw Prisma error code, to callers.
- GSD workflow enforcement — file-changing work routes through `/gsd:execute-phase`, not raw edits.

## Standard Stack

### Core (new to this phase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bwip-js` | 4.11.4 | Barcode/QR rendering (SKU labels, lot/warehouse QR) | `[VERIFIED: npm view bwip-js version]`, 2026-09-22. Already named in STACK.md; broadest symbology support (Code128, EAN-13, QR, PDF417, Data Matrix) in pure JS, no native binary — matters for a single-VPS Docker image. |
| `qrcode` | 1.5.4 | Lightweight QR-only generation (order confirmation deep links — used by Phase 3, listed here since it shares the same rendering concern) | `[VERIFIED: npm view qrcode version]`. Phase 2 itself only strictly needs QR for lot/warehouse labels, which `bwip-js` already covers — install `qrcode` now only if a simpler QR-only API is preferred for non-label uses; otherwise `bwip-js`'s `bcid: 'qrcode'` alone covers INV-06. |
| `bullmq` | 6.3.8 | Job queue engine (low-stock alert dispatch, reservation-expiry sweep) | `[VERIFIED: npm view bullmq version]`. **First BullMQ install in this repository** — Redis has run in `docker-compose.yml` since Phase 1 Plan 01 but nothing consumes it yet. |
| `@nestjs/bullmq` | 12.0.0 | NestJS integration (`BullModule`, `@Processor`/`WorkerHost`) | `[VERIFIED: npm view @nestjs/bullmq version]`; peerDependencies confirm `"@nestjs/core": "^10.0.0 \|\| ^11.0.0 \|\| ^12.0.0"` and `"bullmq": "^3.0.0 \|\| ... \|\| ^6.0.0"` `[VERIFIED: npm view @nestjs/bullmq@12 peerDependencies]` — compatible with this project's pinned NestJS 11.2.5. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ioredis` | 6.0.0 | Redis client (BullMQ's transitive dependency; may also be injected directly for the reservation-expiry sweep's Redis-side bookkeeping if needed) | `[VERIFIED: npm view ioredis version]`. BullMQ bundles its own Redis handling internally; an explicit `ioredis` dependency is only required if `BullModule.forRootAsync` needs a shared, pre-configured connection object across multiple queues — recommended for this project since low-stock alerts and the reservation-expiry sweep are two separate queues sharing one Redis instance. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Conditional per-lot `UPDATE ... WHERE (qty_on_hand - qty_reserved) >= $take` inside a Prisma interactive transaction | `SELECT ... FOR UPDATE` via `$queryRaw` to lock candidate lots upfront, then update | `FOR UPDATE` is the textbook approach for high-contention rows and is worth switching to if load-testing later shows heavy retry/contention on the same lot (e.g. a flash-sale on one hot SKU); PITFALLS.md's own explicit recommendation is the conditional-UPDATE pattern (Pitfall 2), and it needs no raw lock statement — recommended as the Phase 2 default, with `FOR UPDATE` documented as the fallback if contention becomes a measured problem. |
| `StockLot.status` enum for defective/returned (lot-level, split on partial flag) | A separate `DefectiveStockRecord`/`ReturnRecord` table referencing the original lot | A separate table avoids ever mutating `StockLot` shape for a "non-inventory" concern, but then "what's sellable" requires a join/exclusion against two tables instead of one `WHERE status = 'AVAILABLE'` filter — status-on-lot keeps every availability query uniform, at the cost of `StockLot` carrying a few states that aren't strictly "in normal circulation." Recommended: status-on-lot. |
| `bwip-js` for both barcode and QR | `qrcode` for QR + `bwip-js` only for 1D barcodes | Marginal — `qrcode` has a slightly simpler single-purpose API; `bwip-js` alone is sufficient and avoids a second dependency for the same rendering concern. Install `qrcode` only if Phase 3's order-confirmation QR work (not this phase) wants the simpler API — not required for INV-06 itself. |
| BullMQ repeatable job (cron) as the low-stock alert trigger | Purely event-driven (check-and-fire inline on every stock decrement, no queue) | Event-driven-only misses the case where a threshold is lowered by an admin *after* stock already dropped below it (no new movement occurs to trigger a check) — recommended: event-driven trigger on every ledger mutation (fires a queued notification job, not an inline email) **plus** a nightly BullMQ repeatable job as a safety net that scans for any variant currently below threshold with no un-acknowledged alert sent in the last 24h. |

**Installation:**
```bash
pnpm --filter api add bwip-js@4.11.4 bullmq@6.3.8 @nestjs/bullmq@12.0.0 ioredis@6.0.0
# qrcode is optional for this phase specifically — bwip-js's bcid:'qrcode' covers INV-06 alone.
# Verify versions again at execution time: npm view <pkg> version — this session's checks are dated 2026-09-22.
```

**Version verification performed this session:** every row tagged `[VERIFIED: npm view ...]` above was checked live against the npm registry on 2026-09-22, following this project's own Phase 1 precedent of never trusting a bare `latest` tag or training-data version numbers.

## Package Legitimacy Audit

> `slopcheck` could not be installed/found in this environment (`command -v slopcheck` returned nothing), identical to Phase 1's finding. Per the graceful-degradation protocol, **every package below is tagged `[ASSUMED]`** — the planner must gate each install behind a `checkpoint:human-verify` task even though registry/version/postinstall checks were performed directly this session.

| Package | Registry | Age/Maturity (context) | Source Repo | slopcheck | Disposition |
|---------|----------|-------------------------|--------------|-----------|-------------|
| `bwip-js` | npm | Long-established (originally a Postscript barcode library ported to JS ~2011+), actively maintained, no postinstall script found `[VERIFIED: npm view bwip-js scripts.postinstall — empty]` | github.com/metafloor/bwip-js | not run | `[ASSUMED]` — Approved, checkpoint recommended |
| `qrcode` | npm | Long-established (soldair/node-qrcode), ~9M weekly downloads historically, no postinstall script found | github.com/soldair/node-qrcode | not run | `[ASSUMED]` — Approved, checkpoint recommended (optional install, see Alternatives Considered) |
| `bullmq` | npm | Official actively-maintained successor to Bull (taskforcesh org), no postinstall script found `[VERIFIED: npm view bullmq scripts.postinstall — empty]` | github.com/taskforcesh/bullmq | not run | `[ASSUMED]` — Approved, checkpoint recommended |
| `@nestjs/bullmq` | npm | Official NestJS org integration package, no postinstall script found | github.com/nestjs/bull (bullmq variant) | not run | `[ASSUMED]` — Approved, checkpoint recommended |
| `ioredis` | npm | Long-established, extremely widely used Redis client, transitive dependency of `bullmq` regardless of explicit install | github.com/redis/ioredis | not run | `[ASSUMED]` — Approved, checkpoint recommended |

**Packages removed due to slopcheck `[SLOP]` verdict:** none (slopcheck did not run).
**Packages flagged as suspicious `[SUS]`:** none — all five packages are long-established, officially-maintained-org or extremely high-download community packages already named in this project's own STACK.md; manual `postinstall` script inspection performed for `bwip-js` and `bullmq` this session, both empty.

## Architecture Patterns

### System Architecture Diagram (Phase 2 slice)

```
                    ┌───────────────────────────────────────────────┐
                    │  Admin UI (apps/web, existing route group)     │
                    │  Warehouse CRUD, stock-take entry, label print │
                    └───────────────────┬─────────────────────────────┘
                                         │ HTTPS (Bearer JWT, RBAC)
                                         ▼
        ┌────────────────────────────────────────────────────────────────┐
        │                    apps/api (NestJS 11 monolith)                 │
        │                                                                   │
        │  InventoryModule                                                 │
        │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
        │  │ Warehouse    │  │ StockLedger   │  │ WarehouseTransfer     │  │
        │  │ Service      │  │ Service       │  │ Service                │  │
        │  │ (CRUD)       │  │ (THE sole     │  │ (PENDING→IN_TRANSIT   │  │
        │  └──────────────┘  │  mutation      │  │  →RECEIVED state      │  │
        │                    │  path for       │  │  machine)              │  │
        │  ┌──────────────┐  │  StockLot/      │  └──────────────────────┘  │
        │  │ StockTake    │  │  StockMovement) │  ┌──────────────────────┐  │
        │  │ Service      │◀─┤                 │─▶│ BarcodeService         │  │
        │  └──────────────┘  └───────┬─────────┘  │ (bwip-js render)       │  │
        │                            │              └──────────────────────┘  │
        │  ┌──────────────┐          │             ┌──────────────────────┐  │
        │  │ VariantStock │◀─────────┘ (cache sync)│ Low-Stock BullMQ       │  │
        │  │ Service      │  reused, Phase 1 read  │ Processor + repeatable│  │
        │  │ (repurposed) │  contract unchanged    │ nightly sweep          │  │
        │  └──────┬───────┘                        └──────────┬─────────────┘  │
        │         │ CATALOG-08 unchanged                       │ notify        │
        └─────────┼────────────────────────────────────────────┼───────────────┘
                   ▼                                            ▼
          Storefront/Catalog read path              NotificationsModule.MailerService
          (Phase 1, no code change)                 .sendLowStockAlert (NEW method,
                                                       same structured-log-first seam
                                                       Phase 1 established)
```
A reader can trace INV-04 end to end: a future Phase 3/4 caller invokes `StockLedgerService.reserve({ variantId, warehouseId, qty, holderType, holderId })` → the service opens one Prisma interactive transaction → walks `StockLot` candidates for that `(variantId, warehouseId)` in FEFO/FIFO order → issues one conditional `UPDATE` per lot, checking affected-row count → on success, writes a `StockReservation`+`StockReservationLine` and a `StockMovement` row per lot touched, and adjusts the `VariantStock` cache by the same delta, all inside the same transaction → returns a reservation id. A concurrent second caller attempting to over-reserve the same lot(s) either gets a smaller allocation from later lots or a rolled-back `INSUFFICIENT_STOCK` — never a negative quantity.

### Recommended Project Structure (Phase 2 additions)
```
apps/api/src/modules/inventory/
├── inventory.module.ts                    # registers everything below + BullModule.registerQueue(...)
├── warehouse.service.ts                   # CRUD
├── warehouse.admin.controller.ts
├── stock-ledger.service.ts                # THE sole mutation path — reserve/commit/release/receive/adjust
├── stock-ledger.service.spec.ts           # database-backed spec, like price-resolution.service.spec.ts
├── stock-lot.admin.controller.ts          # read endpoints: per-warehouse/per-lot breakdowns for admin UI
├── warehouse-transfer.service.ts
├── warehouse-transfer.admin.controller.ts
├── stock-take.service.ts
├── stock-take.admin.controller.ts
├── barcode.service.ts                     # bwip-js wrapper, plain-text payload builder
├── barcode.admin.controller.ts            # GET .../label.png style endpoints
├── low-stock-alert.processor.ts           # @Processor('inventory-alerts') WorkerHost
├── low-stock-alert.scheduler.ts           # registers the nightly repeatable job
├── variant-stock.service.ts               # EXISTING FILE from Phase 1 — storage behind it changes, signatures do not
├── variant-stock.module.ts                # EXISTING FILE — unchanged
├── variant-stock.admin.controller.ts      # EXISTING FILE — unchanged
└── dto/
    ├── create-warehouse.dto.ts
    ├── receive-stock.dto.ts
    ├── reserve-stock.dto.ts               # internal/service-to-service shape, not necessarily a public HTTP DTO yet (no channel calls it until Phase 3/4)
    ├── create-transfer.dto.ts
    ├── create-stock-take.dto.ts
    └── complete-stock-take-line.dto.ts
```

### Pattern A: Single append-only movement ledger, one write path (`StockLedgerService`)
**What:** Every quantity change to a `StockLot` — receive, reserve, release, commit-sale, transfer leg, stocktake adjustment, defective split, return — is a method on `StockLedgerService`, and every one of those methods writes exactly one (or more, for a split) `StockMovement` row in the same transaction as the `StockLot` mutation. No other service, controller, or script issues a raw `prisma.stockLot.update()`.
**When to use:** Always, for this domain — directly implements PITFALLS.md Pitfall 8's closing line: *"every stock quantity mutation in the system should go through one auditable movement log... never a direct UPDATE to the quantity column from application code outside that log."*
**Trade-offs:** Slightly more ceremony per mutation (two writes instead of one), but this is exactly the cost PITFALLS.md accepts as necessary — the alternative (untraceable stock drift, no stocktake reconciliation story) is named as a HIGH recovery-cost mistake.

### Pattern B: Atomic per-lot reservation via conditional UPDATE (not SELECT FOR UPDATE)
**What:** `reserve()` resolves candidate lots for `(variantId, warehouseId, status: AVAILABLE)` ordered by `expiryDate ASC NULLS LAST, receivedAt ASC` (FEFO falling back to FIFO), then inside one `prisma.$transaction(async (tx) => {...})`, for each candidate lot in order, executes:
```typescript
// apps/api/src/modules/inventory/stock-ledger.service.ts
const affected = await tx.$executeRaw`
  UPDATE stock_lots
  SET qty_reserved = qty_reserved + ${take}
  WHERE id = ${lot.id} AND (qty_on_hand - qty_reserved) >= ${take}
`;
if (affected === 0) {
  // another transaction beat us to this lot's remaining quantity — re-fetch and retry this lot once, or move on
  continue;
}
```
accumulating `take` across lots until the requested `qty` is satisfied. If lots are exhausted before `qty` is satisfied, the function throws (e.g. `ConflictException('INSUFFICIENT_STOCK')`), and Prisma's interactive transaction automatically rolls back every partial `UPDATE`/`StockMovement`/`StockReservationLine` write already made in that call — no partial reservation ever persists.
**When to use:** This is the phase's core mechanism for INV-04. It is PITFALLS.md Pitfall 2's own named fix (*"conditional update, not read-then-write"*) applied per-lot so the same call also produces the batch traceability Pitfall 4 requires (every reservation line records exactly which lot(s) it drew from).
**Trade-offs:** Under Postgres's default `READ COMMITTED` isolation `[CITED: Prisma 7 docs — PostgreSQL's default is ReadCommitted]`, the conditional `UPDATE` itself takes an implicit row lock for the duration of the check-and-write, which is sufficient here — no explicit `SELECT ... FOR UPDATE` or non-default isolation level is required for correctness. If profiling later shows heavy retry contention on one hot lot (e.g. a flash-sale SKU), switch that specific path to `SELECT ... FOR UPDATE` to lock the row before deciding how much to take, rather than retrying — `[MEDIUM confidence: WebSearch aggregate — dev.to/iurii_rogulia, PostgreSQL FOR UPDATE mechanics, cross-referenced against Prisma's own GitHub discussion #8564 on the same pattern]`.
**Example — isolation level is explicit even though the default suffices, for clarity and future-proofing:**
```typescript
import { Prisma } from '../../prisma/generated/prisma/client';

async reserve(input: ReserveInput): Promise<StockReservationResult> {
  return this.prisma.$transaction(async (tx) => {
    const candidates = await tx.stockLot.findMany({
      where: { variantId: input.variantId, warehouseId: input.warehouseId, status: 'AVAILABLE' },
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
    });
    let remaining = input.qty;
    const allocations: { lotId: string; qty: number }[] = [];
    for (const lot of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.qtyOnHand - lot.qtyReserved);
      if (take <= 0) continue;
      const affected = await tx.$executeRaw`
        UPDATE stock_lots SET qty_reserved = qty_reserved + ${take}
        WHERE id = ${lot.id} AND (qty_on_hand - qty_reserved) >= ${take}
      `;
      if (affected === 0) continue; // lost the race for this lot's remainder — try the next candidate
      allocations.push({ lotId: lot.id, qty: take });
      remaining -= take;
    }
    if (remaining > 0) throw new ConflictException('INSUFFICIENT_STOCK'); // rolls back every partial UPDATE above
    const reservation = await tx.stockReservation.create({
      data: {
        holderType: input.holderType, holderId: input.holderId, expiresAt: input.expiresAt,
        lines: { create: allocations.map((a) => ({ lotId: a.lotId, variantId: input.variantId, qty: a.qty })) },
      },
    });
    for (const a of allocations) {
      await tx.stockMovement.create({
        data: { lotId: a.lotId, type: 'RESERVE', qtyReservedDelta: a.qty, referenceType: 'RESERVATION', referenceId: reservation.id },
      });
    }
    await tx.variantStock.update({
      where: { variantId: input.variantId },
      data: { quantityOnHand: { decrement: input.qty } }, // cache reflects AVAILABLE-TO-SELL, not raw on-hand
    });
    return { reservationId: reservation.id, allocations };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 });
}
```
Source: pattern applies this project's own PITFALLS.md Pitfall 2 to a batch-tracked grain; Prisma transaction/isolation API `[CITED: prisma.io/docs/orm/v7/prisma-client/queries/transactions — fetched this session]`.

### Pattern C: Explicit in-transit state for transfers (never a two-step "decrement/increment")
**What:** `WarehouseTransfer` has its own `PENDING → IN_TRANSIT → RECEIVED` (or `CANCELLED`) state machine. `ship()` decrements the source lot's `qtyOnHand` (logged as `TRANSFER_OUT`) and creates a `WarehouseTransferLine`, but does **not** yet create/credit a destination lot. `receive()` creates or credits the destination lot (`TRANSFER_IN`) and only then marks the transfer `RECEIVED`. A cancelled `IN_TRANSIT` transfer reverses the source decrement via a compensating `StockMovement`, never a silent delete.
**When to use:** Always for INV-02's transfer requirement — this is PITFALLS.md Pitfall 8's exact scenario (*"stock temporarily disappears from both totals during transit, or a partial failure leaves stock decremented at the source but never credited at the destination"*). The requirement's "see balances update immediately" is satisfied because the source decrement *is* immediate at `ship()` — "immediately" describes UI responsiveness, not that transfer must collapse into one atomic step; the admin UI can offer a single "complete transfer now" action that calls `ship()` then `receive()` back-to-back for same-day in-city moves, while the underlying model still supports a real multi-day transit for cross-region transfers.
**Trade-offs:** Two service calls instead of one for the simple case; the alternative (Pitfall 8's anti-pattern) is silent shrinkage that's invisible until a stock-take disagrees with the system — not an acceptable trade for the two-call ceremony.

### Pattern D: Defective/returned goods as a lot split, not a flag
**What:** `flagDefective(lotId, qty, reason)` creates a **new** `StockLot` row (`status: DEFECTIVE`, `sourceLotId` pointing at the original, same `variantId`/`warehouseId`) with `qtyOnHand = qty`, and decrements the original lot's `qtyOnHand` by the same amount via the same conditional-UPDATE mechanism as Pattern B (so a defective-flag request for more quantity than currently on-hand-and-unreserved is safely rejected, not silently allowed to go negative). Two `StockMovement` rows are written (one per lot) sharing a common `referenceId` so they can be correlated. `receiveReturn()` follows the same shape, creating a lot with `status: RETURNED_PENDING_INSPECTION`; a later `restockFromReturn()`/`disposeFromReturn()` transitions that lot's status to `AVAILABLE` or `DEFECTIVE`.
**When to use:** INV-08. Splitting into a new lot (rather than a boolean flag on the existing lot) is required because defects/returns are usually a **partial** quantity of a batch — 5 of 100 units — and the remaining 95 must stay sellable and correctly attributed to the original batch for traceability.
**Trade-offs:** More lot rows over time (each defective/return event creates one), which is the intended audit trail, not bloat — `StockLot` rows are cheap and indexed by `(variantId, warehouseId, status)`.

### Prisma schema additions — illustrative, not exhaustive
```prisma
// apps/api/prisma/schema.prisma — Phase 2 additions

enum LotStatus {
  AVAILABLE
  QUARANTINE                    // received but not yet cleared for sale (e.g. awaiting cert check)
  DEFECTIVE
  RETURNED_PENDING_INSPECTION
  DEPLETED                      // qtyOnHand reached 0; kept (not deleted) for traceability
}

model Warehouse {
  id       String  @id @default(cuid())
  code     String  @unique
  name     String
  address  String?
  isActive Boolean @default(true)

  lots StockLot[]
  transfersFrom WarehouseTransfer[] @relation("TransferSource")
  transfersTo   WarehouseTransfer[] @relation("TransferDest")
  stockTakes    StockTake[]

  @@map("warehouses")
}

model StockLot {
  id          String    @id @default(cuid())
  variantId   String
  variant     ProductVariant @relation(fields: [variantId], references: [id], onDelete: Restrict)
  warehouseId String
  warehouse   Warehouse @relation(fields: [warehouseId], references: [id], onDelete: Restrict)
  lotCode     String
  status      LotStatus @default(AVAILABLE)
  qtyOnHand   Int       @default(0)
  qtyReserved Int       @default(0)
  receivedAt  DateTime  @default(now())
  expiryDate  DateTime?
  sourceLotId String?                              // self-FK: traceability when a lot is split (defective/return)
  sourceLot   StockLot?  @relation("LotSplit", fields: [sourceLotId], references: [id])
  splitLots   StockLot[] @relation("LotSplit")
  // NOTE: no cost/landedCost column here on purpose — Phase 5 (IMPORT-06/07) adds cost
  // fields once shipment/PO linkage exists; do not add a placeholder cost field now.

  movements            StockMovement[]
  reservationLines      StockReservationLine[]
  safetyCertifications  SafetyCertification[]       // NEW back-relation, see "Modification to Phase 1 schema" below

  @@unique([variantId, warehouseId, lotCode])
  @@index([variantId, warehouseId, status])
  @@index([variantId, status, expiryDate, receivedAt]) // FEFO/FIFO candidate lookup
  @@map("stock_lots")
}

enum MovementType {
  RECEIVE
  RESERVE
  RELEASE
  COMMIT_SALE
  ADJUSTMENT_STOCKTAKE
  ADJUSTMENT_MANUAL
  TRANSFER_OUT
  TRANSFER_IN
  DEFECTIVE_FLAG
  RETURN_RECEIVE
  RETURN_RESTOCK
}

model StockMovement {
  id               String       @id @default(cuid())
  lotId            String
  lot              StockLot     @relation(fields: [lotId], references: [id], onDelete: Restrict)
  type             MovementType
  qtyOnHandDelta   Int          @default(0)  // signed
  qtyReservedDelta Int          @default(0)  // signed
  reason           String?
  referenceType    String?      // "RESERVATION" | "TRANSFER" | "STOCK_TAKE" | "MANUAL" — Phase 3/4/5 own the referenced entities
  referenceId      String?
  performedById    String?      // Account.id; null for pure system/job-triggered movements
  createdAt        DateTime     @default(now())

  @@index([lotId, createdAt])
  @@index([referenceType, referenceId])
  @@map("stock_movements")
}

enum ReservationStatus { ACTIVE COMMITTED RELEASED EXPIRED }

model StockReservation {
  id         String   @id @default(cuid())
  holderType String   // free-form string ("CART" | "ORDER" | "RFQ" | "MANUAL_HOLD"), NOT an enum —
                       // Phase 3/4 don't exist yet and may need new holder types with zero migration
  holderId   String   // no FK constraint: the referenced table doesn't exist in this phase
  status     ReservationStatus @default(ACTIVE)
  expiresAt  DateTime?         // null = held until explicitly committed/released; non-null = sweepable
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  lines StockReservationLine[]

  @@index([holderType, holderId])
  @@index([status, expiresAt])   // powers the BullMQ expiry sweep
  @@map("stock_reservations")
}

model StockReservationLine {
  id            String   @id @default(cuid())
  reservationId String
  reservation   StockReservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  lotId         String
  lot           StockLot @relation(fields: [lotId], references: [id], onDelete: Restrict)
  variantId     String   // denormalized — avoids a lot join for reporting
  qty           Int

  @@index([reservationId])
  @@index([lotId])
  @@map("stock_reservation_lines")
}

enum TransferStatus { PENDING IN_TRANSIT RECEIVED CANCELLED }

model WarehouseTransfer {
  id                String   @id @default(cuid())
  sourceWarehouseId String
  sourceWarehouse   Warehouse @relation("TransferSource", fields: [sourceWarehouseId], references: [id])
  destWarehouseId   String
  destWarehouse     Warehouse @relation("TransferDest", fields: [destWarehouseId], references: [id])
  status            TransferStatus @default(PENDING)
  createdAt         DateTime @default(now())
  shippedAt         DateTime?
  receivedAt        DateTime?
  createdById       String?

  lines WarehouseTransferLine[]

  @@index([status])
  @@map("warehouse_transfers")
}

model WarehouseTransferLine {
  id          String   @id @default(cuid())
  transferId  String
  transfer    WarehouseTransfer @relation(fields: [transferId], references: [id], onDelete: Cascade)
  sourceLotId String
  destLotId   String?  // populated only once RECEIVED
  qty         Int

  @@map("warehouse_transfer_lines")
}

enum StockTakeStatus { DRAFT IN_PROGRESS COMPLETED CANCELLED }

model StockTake {
  id          String   @id @default(cuid())
  warehouseId String
  warehouse   Warehouse @relation(fields: [warehouseId], references: [id])
  status      StockTakeStatus @default(DRAFT)
  startedAt   DateTime?
  completedAt DateTime?
  countedById String?

  lines StockTakeLine[]

  @@map("stock_takes")
}

model StockTakeLine {
  id          String    @id @default(cuid())
  stockTakeId String
  stockTake   StockTake @relation(fields: [stockTakeId], references: [id], onDelete: Cascade)
  lotId       String
  systemQty   Int                 // snapshot of qtyOnHand when the line was generated
  countedQty  Int?                // null until staff enters a count
  varianceQty Int?                // countedQty - systemQty, computed at completion
  reasonCode  String?

  @@unique([stockTakeId, lotId])
  @@map("stock_take_lines")
}
```

### Modification to Phase 1 schema (non-breaking, additive only)
- `SafetyCertification` (existing model, defined in Phase 1 Plan 02, currently has a free-text `batchLabel String?` placeholder with a code comment: *"Phase 2 links this to a real StockLot"*): add a nullable `lotId String?` + `lot StockLot? @relation(fields: [lotId], references: [id])`. **Do not remove `batchLabel`** — Phase 1 is still executing in parallel (Plans 08-11 not yet observed by this research) and may still reference it; keep it as a deprecated free-text fallback for certifications recorded before a real lot exists (e.g. at PO-creation time, before goods are received — Phase 5 territory).
- `VariantStock` (existing model, Phase 1 Plan 06): **no schema change** — only the *meaning* of `quantityOnHand` changes (see next section). No migration needed beyond what Phase 2's own new tables require.

### Repurposing `VariantStock` without breaking CATALOG-08 (explicit, load-bearing decision)
Phase 1's `VariantStockService.getAvailability`/`getAvailabilityMany`/`setStock` (file: `apps/api/src/modules/inventory/variant-stock.service.ts`) is verified, this session, to have exactly this shape:
```typescript
async getAvailability(variantId: string): Promise<{ variantId: string; status: StockStatus }>
async getAvailabilityMany(variantIds: string[]): Promise<Map<string, StockStatus>>
async setStock(variantId: string, quantityOnHand: number, reorderThreshold: number): Promise<VariantStockRecord>
```
Phase 2 must keep `getAvailability`/`getAvailabilityMany`'s signatures **byte-identical** (Phase 1's own header comment on this file makes this a hard requirement, and CATALOG-08 depends on it). The recommended change is:
1. **Keep** the `VariantStock` table and `deriveStockStatus` function exactly as-is.
2. **Change the writer, not the reader.** Instead of admin staff calling `setStock()` directly (Phase 1's manual-entry workflow), `StockLedgerService` becomes the only thing that calls `variantStock.update({ data: { quantityOnHand: { increment/decrement: delta } } })`, inside the same transaction as every `StockLot` mutation — every `reserve`/`release`/`commit`/`receive`/`adjust`/`transfer` call keeps this cache in sync via an incremental delta (not a full re-aggregation query), per PITFALLS.md's own Performance Trap #1 guidance (*"maintain a denormalized available_qty... updated transactionally on every movement"*).
3. **Redefine what the number means**, in a code comment on the field: `quantityOnHand` on `VariantStock` now represents **total available-to-sell across all `AVAILABLE`-status lots in all warehouses** (`Σ qtyOnHand - qtyReserved` for `status = AVAILABLE` lots), not "on-hand regardless of reservation" — this is a deliberate behavior change from Phase 1 (where `setStock` set a raw number with no reservation concept) and should be called out to the user/planner as a visible change: a SKU with 100 physical units but 30 already reserved by pending carts now shows `LOW_STOCK`/`OUT_OF_STOCK` sooner than Phase 1's number would have, which is the entire point of INV-04 existing.
4. **Keep `VariantStockService.setStock()` for the admin manual-override path**, but re-scope it clearly: after Phase 2, it should only be used for corrective overrides (e.g. syncing after a data issue), never as the primary write path — the primary path is now `StockLedgerService`.
5. **Admin UI expectation:** `PUT /api/admin/variants/:variantId/stock` (Phase 1's existing endpoint) either becomes read-mostly/deprecated for normal operation, or is explicitly repointed to `StockLedgerService.adjust()` with a required `warehouseId` and `reason` — flagged in Open Questions for the planner to decide, since this changes an existing Phase 1 HTTP contract's semantics (though not its shape).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic stock decrement under concurrency | Read-then-write (`SELECT qty` then `UPDATE qty = qty - N`) anywhere, even "just this once" for a quick admin tool | `StockLedgerService`'s conditional-UPDATE-in-transaction pattern (Pattern B) | This is PITFALLS.md Pitfall 2's exact failure mode; every stock decrement in this codebase must go through one code path, with zero exceptions, including admin manual adjustments |
| Barcode/QR rendering | Hand-drawing barcode bars via `canvas`/SVG path math | `bwip-js` | 100+ symbologies, checksum/quiet-zone correctness, and GS1 compliance are all solved problems — implementing Code128's own checksum algorithm by hand is a classic reinvent-the-wheel trap |
| Landed cost / COGS on a `StockLot` | A `costPriceVnd` field "for now, we'll fill it in later" | Nothing — leave it absent | PITFALLS.md Pitfall 3 explicitly names "a single `cost_price` column with no link to a shipment or lot" as the trap; Phase 5 (IMPORT-06/07) is the correct owner of cost, once shipment/exchange-rate/freight-allocation data exists. Adding an empty/placeholder column now invites a later developer to read `0` or `null` as a real cost. |
| Queue/job infrastructure | Manual `setInterval`-based polling for the low-stock sweep or a naive `setTimeout` per reservation for expiry | `@nestjs/bullmq` (`BullModule`, `@Processor`/`WorkerHost`, repeatable jobs) | Already the project's chosen standard (STACK.md); gives retry/backoff, persistence across restarts, and dedupe via deterministic job IDs for free — a hand-rolled interval loses all of this and doesn't survive a process restart |
| Reservation expiry | A cron-like check embedded in every read path ("is this reservation stale? release it now") | A BullMQ repeatable job scanning `StockReservation` where `status = ACTIVE AND expiresAt <= now`, releasing each via the same `StockLedgerService.release()` path a normal cancellation would use | Keeps exactly one code path for "release a reservation," whether triggered by a user action or by expiry — no duplicated release logic |

**Key insight:** every "don't hand-roll" item maps to a pitfall this project's own prior research already named as HIGH recovery-cost if built wrong (PITFALLS.md Pitfalls 2, 3, 8) — Phase 2's job is the same as Phase 1's: make sure the *first* implementation of each is the structurally correct one.

## Common Pitfalls

### Pitfall 1: Inventory oversell across B2C + B2B channels (imported from PITFALLS.md Pitfall 2)
**What goes wrong / why it happens / how to avoid:** See PITFALLS.md Pitfall 2 in full; this phase's `StockLedgerService.reserve()` (Pattern B) is the direct mitigation.
**Warning signs:** Any `prisma.stockLot.update()` call outside `stock-ledger.service.ts`; a `reserve`-shaped function that reads quantity then writes it in two separate statements/queries.
**Phase to address:** This phase — enforced by an automated grep gate mirroring Phase 1's price-math grep (`grep -rn "stockLot.update" apps/api/src --include=*.ts | grep -v stock-ledger.service.ts` should return nothing outside the ledger service and its spec).

### Pitfall 2: Batch/lot tracking retrofit (imported from PITFALLS.md Pitfall 4)
**What goes wrong / why it happens / how to avoid:** See PITFALLS.md Pitfall 4 in full — this phase exists specifically to build the correct grain from the start, since Phase 1's `VariantStock` was deliberately kept SKU-only precisely to avoid pretending a real ledger existed before this phase.
**Warning signs:** A code path that reserves/commits stock without recording which `lotId` fulfilled it.
**Phase to address:** This phase.

### Pitfall 3: Multi-warehouse transfer as two independent, non-atomic operations (imported from PITFALLS.md Pitfall 8)
**What goes wrong / why it happens / how to avoid:** See PITFALLS.md Pitfall 8 in full; Pattern C (explicit `WarehouseTransfer` state machine) is the mitigation.
**Warning signs:** A "transfer" implemented as two separate, unlinked `StockMovement`/lot-quantity writes with no `WarehouseTransfer`/`WarehouseTransferLine` record tying them together.
**Phase to address:** This phase.

### Pitfall 4: Treating BullMQ's low-stock check as synchronous, blocking the reservation transaction
**What goes wrong:** A tempting shortcut is to send the low-stock email/notification *inside* the same database transaction as the stock decrement ("just call `mailerService.send()` right here"). This couples a slow, potentially-failing external call (SMTP, or later a real transport) to the correctness-critical reservation transaction — a slow mail server now makes checkout slow or, worse, a thrown mail error rolls back a legitimate stock reservation.
**Why it happens:** It looks simpler to add one line inside the transaction than to wire a queue.
**How to avoid:** The *threshold check* (cheap: compare the post-mutation `VariantStock.quantityOnHand` to `reorderThreshold`) happens synchronously inside the transaction, but the *action taken* on a threshold crossing is only "enqueue a BullMQ job with a deterministic id" (e.g. `low-stock:${variantId}:${dayBucket}` so repeated crossings within the same day collapse into one alert, matching the project's own STACK.md guidance: *"Keeps request/response cycles fast... retry/backoff for flaky third-party calls"*). The actual notification send happens in the `@Processor`, entirely outside any database transaction.
**Warning signs:** `MailerService`/notification calls appearing inside `stock-ledger.service.ts`'s transaction body.
**Phase to address:** This phase, at first BullMQ wiring — this is a new pitfall specific to Phase 2 (no equivalent existed in Phase 1, which had no queue).

### Pitfall 5: QR/barcode payload encoded as JSON, unusable by a keyboard-wedge scanner
**What goes wrong:** A label is generated encoding a rich payload like `{"sku":"KT-001","lotId":"abc123","warehouseId":"xyz"}` because it seems more "complete." A USB/Bluetooth wedge scanner (the project's explicit v1 warehouse-scanning mechanism, per REQUIREMENTS.md's Out of Scope table: *"v1 uses label printing + keyboard-wedge... scanner input into normal web forms"*) just emits the decoded text as keystrokes into whatever form field has focus — it cannot parse JSON, so the staff member's cursor ends up with a raw JSON string typed into (e.g.) a plain SKU search box.
**Why it happens:** Encoding "more information" in the barcode feels more useful until you remember the decoding device has zero application logic.
**How to avoid:** Encode a single plain identifier string per label (e.g. the SKU itself for a product label, or a short lot reference code like `LOT-<lotId short form>` for a batch label) that resolves via a lookup endpoint (`GET /api/admin/inventory/lookup?code=...`) the admin form already expects text input for. Never encode structured/multi-field data in a label meant for wedge-scanner input.
**Warning signs:** `JSON.stringify(...)` anywhere near a `bwip-js` call.
**Phase to address:** This phase, at first barcode implementation.

## Code Examples

### Barcode/QR label rendering (`bwip-js`)
```typescript
// apps/api/src/modules/inventory/barcode.service.ts
import { Injectable } from '@nestjs/common';
import * as bwipjs from 'bwip-js';

@Injectable()
export class BarcodeService {
  /** SKU label — Code128, human-readable text beneath the bars. */
  async renderSkuLabel(sku: string): Promise<Buffer> {
    return bwipjs.toBuffer({
      bcid: 'code128',
      text: sku,          // PLAIN TEXT ONLY — see Pitfall 5, never JSON
      scale: 3,
      height: 10,
      includetext: true,
      textxalign: 'center',
    });
  }

  /** Lot/warehouse QR — plain identifier string, resolved via an admin lookup endpoint. */
  async renderLotQr(lotReferenceCode: string): Promise<Buffer> {
    return bwipjs.toBuffer({
      bcid: 'qrcode',
      text: lotReferenceCode, // e.g. "LOT-ck3x9f2a" — plain text, wedge-scanner-safe
      scale: 4,
    });
  }
}
```
```typescript
// apps/api/src/modules/inventory/barcode.admin.controller.ts
@Controller('admin/inventory/labels')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BarcodeAdminController {
  constructor(private readonly barcode: BarcodeService) {}

  @Get('sku/:sku')
  @Roles('SUPER_ADMIN', 'WAREHOUSE')
  async skuLabel(@Param('sku') sku: string, @Res() res: Response) {
    const png = await this.barcode.renderSkuLabel(sku);
    res.set('Content-Type', 'image/png').send(png);
  }
}
```
Source: `[CITED: npmjs.com/package/bwip-js API shape — toBuffer(options)]`, cross-referenced against project convention (`JwtAuthGuard`/`RolesGuard`/`@Roles` pattern verified live this session in `apps/api/src/common/guards/`).
For **batch label printing** (multiple SKU/lot labels on one sheet for a print run), reuse STACK.md's existing Puppeteer BullMQ pattern — build an HTML template embedding multiple `<img src="data:image/png;base64,...">` labels and render to PDF as a queued job, not inline in the request (Puppeteer is CPU/memory-heavy; a single ad-hoc label via `BarcodeService` alone is fast enough — <200ms — to stay synchronous).

### BullMQ wiring — first instance in this repository
```typescript
// apps/api/src/modules/inventory/inventory.module.ts
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    BullModule.registerQueue({ name: 'inventory-alerts' }),
  ],
  providers: [StockLedgerService, LowStockAlertProcessor, LowStockAlertScheduler /* ... */],
})
export class InventoryModule {}
```
```typescript
// apps/api/src/app.module.ts — ADD, first BullMQ root registration in this repo
BullModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    connection: { url: config.get('REDIS_URL', { infer: true }) },
  }),
}),
```
```typescript
// apps/api/src/modules/inventory/low-stock-alert.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('inventory-alerts')
export class LowStockAlertProcessor extends WorkerHost {
  constructor(private readonly mailer: MailerService, private readonly prisma: PrismaService) {
    super();
  }
  async process(job: Job<{ variantId: string }>): Promise<void> {
    // Re-fetch fresh state at execution time — never trust the job payload's
    // implied quantity, since the job may have sat in the queue for a while.
    const stock = await this.prisma.variantStock.findUnique({ where: { variantId: job.data.variantId } });
    if (!stock || stock.quantityOnHand > stock.reorderThreshold) return; // resolved itself before the job ran
    await this.mailer.sendLowStockAlert(stock.variantId, stock.quantityOnHand, stock.reorderThreshold);
  }
}
```
```typescript
// stock-ledger.service.ts — inside any decrement path, after the VariantStock cache update:
if (newQty <= reorderThreshold) {
  await this.alertsQueue.add(
    'low-stock',
    { variantId },
    { jobId: `low-stock:${variantId}:${new Date().toISOString().slice(0, 10)}` }, // dedupes same-day repeat crossings
  );
}
```
Source: `[CITED: docs.bullmq.io/guide/nestjs and docs.nestjs.com/techniques/queues]`; `[MEDIUM confidence: WebSearch aggregate on deterministic job IDs for dedupe and "fetch fresh state in the worker" as BullMQ best practice]`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Prisma raw isolation-level string (`'ReadCommitted'`) | `Prisma.TransactionIsolationLevel.ReadCommitted` enum from the generated client | Confirmed current for Prisma 7 (this session) | Copying an older tutorial's string-literal isolation level will fail type-checking against this project's Prisma 7 client |
| Bull (`bull` package) | BullMQ (`bullmq` + `@nestjs/bullmq`) | Bull is maintenance-only per STACK.md, already the project's chosen standard | No action needed — this phase installs the correct package on the first try |

**Deprecated/outdated:** None newly discovered this session beyond what STACK.md/Phase 1's RESEARCH.md already flagged (Prisma 8 RC, NestJS 12 full-ESM rewrite) — both remain correctly avoided by this phase's version pins.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `StockReservation.holderType`/`holderId` should be untyped strings with no FK, rather than waiting to design this contract until Phase 3/4 exist | Architecture Patterns, Prisma schema | LOW-MEDIUM — adding an enum or FK later is a straightforward additive migration; the bigger risk is Phase 3/4 needing a *different* reservation shape entirely (e.g. per-line reservations spanning multiple SKUs as one atomic group) — flagged in Open Questions |
| A2 | `qrcode` package is optional for Phase 2 specifically (bwip-js's `bcid:'qrcode'` covers INV-06 alone) | Standard Stack | LOW — if the planner decides Phase 2 should also stand up Phase 3's order-confirmation QR code as a "while we're here" convenience, `qrcode` install is trivial to add; not including it now does not block INV-06 |
| A3 | `VariantStock.quantityOnHand`'s redefinition (raw on-hand → available-to-sell net of reservations) is acceptable as a Phase 1 behavior change, not treated as a breaking contract violation | Architecture Patterns ("Repurposing VariantStock") | MEDIUM — Phase 1's own e2e tests assert specific `quantityOnHand` values after `setStock()`; if those tests aren't updated to account for the new reservation-aware semantics, they may start failing once Phase 2 lands, even though the *shape* of the contract is unchanged. Flagged explicitly for the planner. |
| A4 | Admin's Phase 1 `PUT /api/admin/variants/:variantId/stock` endpoint stays available post-Phase-2 as a manual-override path, rather than being removed | Architecture Patterns ("Repurposing VariantStock") point 5 | LOW — removing it would be a breaking HTTP contract change with no stated need; keeping it as a documented "corrective override only" path is the lower-risk default |
| A5 | Low-stock alert dispatch reuses the existing Phase 1 `NotificationsModule`/`MailerService` (adding one method) rather than building a separate notification path for inventory | Don't Hand-Roll, Code Examples | LOW — this mirrors exactly how Phase 1 built the seam ("a later phase swaps only this method's body... without touching any caller"); the risk of NOT reusing it is duplicated mail-transport logic |

## Open Questions

1. **Should `StockReservation` support multi-line (multi-SKU) atomic reservations in one call, or is one reservation always single-SKU?**
   - What we know: INV-04 only requires "reserve/decrement one shared inventory ledger atomically" — it doesn't explicitly require cross-SKU atomicity (e.g. "reserve these 3 different toys for one cart in one all-or-nothing transaction").
   - What's unclear: Whether Phase 3/4's checkout flow will want to reserve an entire multi-line cart atomically (all lines succeed or none do) versus line-by-line reservation calls that each succeed/fail independently.
   - Recommendation: Design `StockLedgerService.reserve()` to accept a single `(variantId, warehouseId, qty)` per call for Phase 2 (simplest, matches this phase's own scope), but keep the `StockReservation` parent/`StockReservationLine` children shape (already multi-line-capable) so Phase 3/4 can later call it once per cart line while grouping the resulting reservation ids under one cart-level concept in *their own* schema, without a Phase 2 migration. Confirm with the user/planner whether true cross-SKU atomicity is a hard Phase 3/4 requirement before those phases are planned.

2. **Does `WarehouseTransfer`'s in-transit period need its own "virtual warehouse" bucket in reporting (INV-01's per-warehouse stock levels), or is "excluded from both, visible in a separate in-transit total" sufficient?**
   - What we know: PITFALLS.md Pitfall 8 recommends showing in-transit stock "excluded from both warehouses' sellable `available_qty` but still visible in total company-wide stock reporting."
   - What's unclear: Whether INV-01's "per-warehouse stock levels" admin view needs an explicit "In Transit" row per warehouse pair, or a single global "X units in transit" figure is sufficient for v1.
   - Recommendation: Default to a single global in-transit total (sum of all `IN_TRANSIT`-status `WarehouseTransferLine.qty`) for v1 simplicity; a per-route breakdown is a cheap follow-up query against the same table if requested later.

3. **Should the reorder threshold move from per-variant-global (Phase 1's model) to per-(variant, warehouse)?**
   - What we know: Phase 1's `VariantStock.reorderThreshold` is a single global number per SKU; INV-05 says "when stock crosses a reorder threshold" without specifying per-warehouse granularity.
   - What's unclear: Whether an admin managing multiple warehouses wants "alert me when SKU X is globally low" (Phase 1's existing shape, cheapest to keep) or "alert me when warehouse Y specifically is low on SKU X even if warehouse Z has plenty" (requires a new per-warehouse threshold concept).
   - Recommendation: Keep the global threshold for Phase 2 (matches existing schema, satisfies INV-05's literal wording), and treat per-warehouse thresholds as a natural, additive v2 enhancement (a new `WarehouseVariantThreshold` table) if real usage shows the global number is too coarse — flagging rather than pre-building, since REQUIREMENTS.md doesn't ask for it explicitly.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Redis | BullMQ queue backend (first use in this repo) | ✓ (in `docker-compose.yml` since Phase 1 Plan 01, unused until now) | `redis:7-alpine` image | — |
| Docker / Docker Compose | Running the full local stack (postgres/redis/minio) to test this phase's transactions live | Not independently re-verified this session — carried from Phase 1 RESEARCH.md's finding that Docker was **not installed** on the Phase 1 research machine | — | No fallback for live integration/e2e testing of `$transaction` behavior against real Postgres row locking; schema/service code authoring is unaffected. Verify Docker availability before the first task that runs `stock-ledger.service.spec.ts` as a database-backed spec (same constraint Phase 1 hit repeatedly). |
| npm registry access | Installing `bwip-js`/`bullmq`/`@nestjs/bullmq`/`ioredis` | ✓ (all versions verified live this session) | — | — |

**Missing dependencies with no fallback:**
- Docker / Docker Compose for live database-backed test execution — same constraint every Phase 1 plan noted; verify before the first execution task that requires a live Postgres connection for concurrency-sensitive tests.

**Missing dependencies with fallback:**
- None new this phase beyond Docker (above).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (NestJS 11 default), same as Phase 1 — no new framework needed |
| Config file | `apps/api/jest.config.ts` — already exists from Phase 1 |
| Quick run command | `pnpm --filter api test -- --watch=false <pattern>` |
| Full suite command | `pnpm turbo run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|-------------|
| INV-01 | Warehouse CRUD persists and lists correctly | integration | `pnpm --filter api test -- warehouse.admin.controller.e2e-spec.ts` | ❌ Wave 0 |
| INV-02 | Stock in/out/transfer updates balances and logs a `StockMovement` per mutation | integration | `pnpm --filter api test -- stock-ledger.service.spec.ts` | ❌ Wave 0 |
| INV-03 | A lot is uniquely addressable by (variantId, warehouseId, lotCode); querying by SKU+warehouse returns only that grain's lots | unit + integration | `pnpm --filter api test -- stock-ledger.service.spec.ts` | ❌ Wave 0 |
| INV-04 | Two concurrent `reserve()` calls against a lot with exactly enough stock for one never both succeed; a reservation always traces to specific lot(s) | **concurrency** (real DB, not mocked) | `pnpm --filter api test -- stock-ledger.concurrency.spec.ts` — fire two `Promise.all`-parallel `reserve()` calls against a seeded lot with qty=1, assert exactly one succeeds | ❌ Wave 0 — this is the single most important test in the phase, per PITFALLS.md's own "Looks Done But Isn't" checklist item for inventory oversell |
| INV-05 | Crossing the reorder threshold enqueues exactly one BullMQ job per day per variant; the processor sends via `MailerService` | unit (mocked queue) + integration (real BullMQ against test Redis) | `pnpm --filter api test -- low-stock-alert.processor.spec.ts` | ❌ Wave 0 |
| INV-06 | `renderSkuLabel`/`renderLotQr` produce a decodable image buffer with the exact plain-text payload (round-trip decode assertion) | unit | `pnpm --filter api test -- barcode.service.spec.ts` | ❌ Wave 0 |
| INV-07 | A completed stock-take generates `ADJUSTMENT_STOCKTAKE` movements matching `countedQty - systemQty` per line | integration | `pnpm --filter api test -- stock-take.service.spec.ts` | ❌ Wave 0 |
| INV-08 | Flagging N defective units from a lot with qty ≥ N splits correctly; flagging more than available is rejected | unit + integration | `pnpm --filter api test -- stock-ledger.service.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted Jest file for the module touched
- **Per wave merge:** `pnpm turbo run test`
- **Phase gate:** Full suite green, **and** the INV-04 concurrency spec run at least 3x in a row (to catch flaky/rare race losses) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] A dedicated concurrency-test harness pattern (two truly-parallel `reserve()` calls against the same seeded lot) — nothing in Phase 1 exercised true concurrency (Phase 1's tests were all single-caller); this is new test infrastructure this phase must establish, not just new test files
- [ ] Seed data: at least one `Warehouse`, one `StockLot` with a known `qtyOnHand` per test-relevant `ProductVariant`, for `stock-ledger.service.spec.ts` and the concurrency spec
- [ ] Test Redis instance/connection for `low-stock-alert.processor` integration tests (BullMQ needs a real Redis, not a mock, to test queue/dedupe behavior meaningfully) — verify `docker-compose.yml`'s existing Redis service is reachable from the test run environment

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V4 Access Control | yes | Same `RolesGuard`/`@Roles()` pattern as Phase 1 — warehouse/stock mutation endpoints gated to `SUPER_ADMIN`/`WAREHOUSE`; stock-take completion and defective-flagging are high-trust actions, restrict accordingly |
| V5 Input Validation | yes | `class-validator` DTOs for every admin endpoint (quantities `@IsInt() @Min(0)`/`@Min(1)` as appropriate, never accept negative reservation/receive quantities); global `whitelist: true, forbidNonWhitelisted: true` `ValidationPipe` already established Phase 1, apply identically |
| V1 Architecture (data integrity) | yes | The single-write-path invariant (Pattern A) is itself a V1-relevant control — it's the mechanism that makes the audit trail (ADMIN-02, Phase 7) trustworthy later; a bypassable ledger undermines any future audit-log requirement |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Race condition double-reservation (the core Phase 2 threat) | Tampering / Repudiation | Pattern B's conditional-UPDATE-in-transaction; proven by a real concurrency test, not just unit-mocked assertions (PITFALLS.md's own "Looks Done But Isn't" checklist explicitly calls out that a single successful checkout is not sufficient proof) |
| Negative-quantity stock via unvalidated adjustment input | Tampering | Every DTO accepting a quantity delta validates it is a positive integer where the domain requires it; `StockLedgerService` methods that could drive `qtyOnHand`/`qtyReserved` negative reject via the conditional UPDATE's `WHERE` clause returning 0 affected rows, not via application-layer arithmetic alone (defense in depth) |
| Unauthorized stock-take completion masking real shrinkage/theft | Repudiation | `performedById` recorded on every `StockMovement`; stock-take completion restricted to `SUPER_ADMIN`/`WAREHOUSE`; large unexplained variances are a Phase 7 reporting/audit-log concern but this phase must at minimum capture *who* and *when* for every adjustment |
| Barcode/QR payload injection (a maliciously crafted lot code containing control characters typed via a spoofed wedge scanner) | Tampering | The lookup endpoint (`GET /api/admin/inventory/lookup?code=...`) must validate/sanitize the incoming code the same as any other query parameter — treat wedge-scanner input as untrusted user input, not as a safe internal channel |

## Sources

### Primary (HIGH confidence)
- `npm view <pkg> version / peerDependencies / scripts.postinstall / dependencies` — live registry checks performed this session (2026-09-22) for `bwip-js`, `qrcode`, `bullmq`, `@nestjs/bullmq`, `ioredis`, `@prisma/client@7`, `prisma@7`, `@prisma/adapter-pg@7`
- [Prisma 7 interactive transactions — official docs, v7 path](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions) — fetched this session; confirmed `Prisma.TransactionIsolationLevel` enum usage and PostgreSQL's `ReadCommitted` default
- `.planning/research/PITFALLS.md` Pitfalls 2, 4, 8 (this project's own first-party research, 2026-09-21) — HIGH confidence, direct source of the concurrency/batch/transfer design decisions in this document
- `.planning/phases/01-foundation-auth-bilingual-catalog-pricing/01-RESEARCH.md`, `01-06-SUMMARY.md`, `01-06-PLAN.md`, and live reads of `apps/api/prisma/schema.prisma`, `apps/api/src/modules/inventory/variant-stock.service.ts`, `apps/api/src/modules/notifications/mailer.service.ts`, `apps/api/src/modules/notifications/notifications.module.ts`, `apps/api/prisma.config.ts`, `apps/api/src/prisma/prisma.service.ts`, and `apps/api/src/common/guards/*` — HIGH confidence, this session's direct inspection of the actual committed Phase 1 code (not just its research doc), used to guarantee this phase's contract preservation claims are accurate as of 2026-09-22

### Secondary (MEDIUM confidence)
- [bwip-js — npm](https://www.npmjs.com/package/bwip-js) and [GitHub — metafloor/bwip-js](https://github.com/metafloor/bwip-js) — `toBuffer(options)` API shape
- [BullMQ NestJS guide — docs.bullmq.io](https://docs.bullmq.io/guide/nestjs/) and [NestJS Queues docs](https://docs.nestjs.com/techniques/queues) — `@Processor`/`WorkerHost` pattern, repeatable jobs
- WebSearch aggregate: Prisma `SELECT FOR UPDATE` via raw queries inside `$transaction` (github.com/prisma/prisma discussions #8564, #1918, #5983; dev.to/iurii_rogulia) — cross-referenced against Prisma's own transaction docs
- WebSearch aggregate: BullMQ deterministic job IDs for dedupe, "fetch fresh state in the worker, not the queued payload" best practice (dev.to, Medium, oneuptime.com)

### Tertiary (LOW confidence)
- None used without cross-verification this session.

## Metadata

**Confidence breakdown:**
- Standard stack (versions): HIGH — every new package version live-verified against npm registry this session, same discipline as Phase 1
- Package legitimacy: LOW-MEDIUM by protocol (slopcheck unavailable, all tagged `[ASSUMED]`) despite all five packages being long-established official/high-download libraries with no postinstall scripts found
- Schema/concurrency design (StockLot, StockMovement, reservation pattern): MEDIUM-HIGH — directly applies this project's own already-vetted PITFALLS.md Pitfalls 2/4/8 to Phase 2's specific requirements, and was cross-checked against the *actual currently-committed* Phase 1 Prisma schema and service code (not just Phase 1's research doc) to guarantee contract-compatibility claims are accurate
- BullMQ/barcode integration glue: MEDIUM — no single authoritative source covers this exact combination (NestJS 11 + BullMQ 6 + bwip-js in this project's specific module-per-domain convention); corroborated across official docs + community sources
- VariantStock repurposing (Architecture Patterns section): MEDIUM-HIGH for the technical mechanism, but explicitly flagged (Assumption A3) as a behavior change that needs planner/user visibility, not purely a technical risk

**Research date:** 2026-09-22
**Valid until:** ~30 days for schema/architecture guidance (stable once decided, mirrors Phase 1's own estimate); ~7-14 days for exact package versions (BullMQ/bwip-js/Prisma all ship frequently) — re-run `npm view` checks if planning is delayed beyond that window. **Additional freshness note specific to this phase:** since Phase 1 was still executing in parallel at research time (Plans 08-11 not yet observed), re-verify `apps/api/prisma/schema.prisma` and `variant-stock.service.ts` have not changed shape before planning begins, in case a later Phase 1 plan touched either file.
