# Pitfalls Research

**Domain:** B2C + B2B toy import/export e-commerce (Node.js/NestJS + Next.js + PostgreSQL, single VPS Docker deployment, Vietnamese payment gateways)
**Researched:** 2026-09-21
**Confidence:** MEDIUM-HIGH (architecture/inventory/costing patterns verified across multiple independent sources; VNPay/MoMo/ZaloPay specifics verified against integration guides and QA write-ups but not against a live merchant account; single-VPS Docker pitfalls verified against multiple production post-mortems)

## Critical Pitfalls

### Pitfall 1: Building the schema "B2C-first" and bolting B2B on as flags

**What goes wrong:**
Product, customer, and order tables are designed around a single consumer and a single price, then B2B is retrofitted with boolean flags (`is_wholesale`), a second price column (`gia_si`), or a "discount %" field on the customer row. This works for the demo but breaks the moment a real dealer needs a *tier-specific* price list, a *quantity-break* discount, a *carton/pack* minimum order quantity, and a credit limit simultaneously. Retrofitting a pricing engine after the schema is live means a painful migration of every existing order/quote record.

**Why it happens:**
The spec (`requirements.txt.txt`) literally lists "giá bán lẻ, giá sỉ" as two fields per SKU, which reads like "just add a column." The real requirement is far richer: dealer tiers (cấp đại lý), quantity/volume discounts, carton/kiện/container order units, quote requests (yêu cầu báo giá), and Excel bulk ordering — all of which need list-price + rule-based pricing, not a static second price column.

**How to avoid:**
- Model `price_list` (or `price_tier`) as a first-class entity: `product_variant_id`, `customer_tier_id | customer_id`, `min_qty`, `unit_price`, `currency`, `valid_from/to`. Retail price is just the default/public tier.
- Model dealer tier (cấp đại lý) as its own table with a foreign key from customer, not an enum baked into the customer table — tiers will need to carry their own discount rules and credit terms.
- Model order/pack quantity (quy cách đóng thùng, số lượng tối thiểu) at the product-variant level (units per carton, min order qty in cartons) so both B2C (sold as single unit) and B2B (sold as carton multiples) read from the same source without duplicating catalog data.
- Do NOT duplicate the product catalog for B2B vs B2C — one catalog, one inventory, multiple price/order-rule views. This matches the project's own stated architecture ("cùng một backend quản trị dùng chung").

**Warning signs:**
- Any table with a column literally named `gia_si` / `wholesale_price` sitting next to `gia_le` / `retail_price`.
- Pricing logic implemented as `if (customer.type === 'dealer') price *= 0.8` scattered in service code rather than centralized in a pricing resolution service.
- No way to represent "this SKU is retail-only" or "this SKU is wholesale-only" (per requirements: "hàng sỉ, hàng lẻ" classification) without a new boolean per rule.

**Phase to address:**
Phase covering data model / catalog schema design (should be one of the first phases, before either B2C or B2B storefront work begins, since both depend on it).

---

### Pitfall 2: Inventory oversell across B2C + B2B channels sharing one stock pool

**What goes wrong:**
B2C checkout and B2B order approval both read `available_qty` and decrement it as two separate steps ("check stock" then "reduce stock"). Under concurrent load — e.g., a B2C flash sale and a B2B dealer bulk order landing at the same moment — both transactions pass the availability check before either commits the decrement, resulting in negative stock or double-committed inventory. This gets worse with two channels because a B2B order can be for large quantities (a carton/kiện/container), so a single race can oversell far more units than a typical B2C race.

**Why it happens:**
Naive implementations treat "read stock, then write stock" as safe because each step individually looks correct; the bug only appears under concurrency, which rarely shows up in manual testing or demos with one browser tab.

**How to avoid:**
- Make check-and-reserve one atomic operation: `UPDATE inventory SET available_qty = available_qty - :qty WHERE sku_id = :id AND available_qty >= :qty` (conditional update, not read-then-write) or `SELECT ... FOR UPDATE` inside a transaction before decrementing.
- Introduce an explicit `reserved_qty` state distinct from `available_qty` and `on_hand_qty` — reserve at "order placed / awaiting payment," commit the decrement at "payment confirmed / order approved," release the reservation on cancel/timeout. This matters doubly here because COD orders (no upfront payment) and B2B credit orders (no upfront payment) both need a stock hold without a payment event to trigger it.
- B2B "yêu cầu báo giá" (quote requests) and B2B cart-hold behavior should NOT reserve stock — only a confirmed order should. Otherwise dealers browsing/quoting can starve B2C availability.
- Since both channels share one warehouse pool per the schema, all reservation logic must live in one inventory service used by both B2C checkout and B2B order flows — never two separate decrement code paths.

**Warning signs:**
- Stock decrement code exists in more than one place (e.g., separate B2C `checkout.service.ts` and B2B `order.service.ts` both directly `UPDATE`-ing inventory).
- No `reserved_qty` concept — only `on_hand_qty`, meaning a cart or pending COD order doesn't actually hold stock.
- Load-testing two simultaneous large B2B orders against low stock produces negative `available_qty`.

**Phase to address:**
Inventory/warehouse core phase, before B2C checkout and B2B ordering phases are built on top of it — both consume the same reservation API.

---

### Pitfall 3: Landed cost treated as "purchase price only," average/FIFO cost not tracked per batch

**What goes wrong:**
"Giá vốn sau nhập khẩu" (post-import cost) is set once at PO creation using only the supplier invoice price, ignoring freight, customs duty, VAT on import, port/handling fees, and the exchange rate at time of payment (which for imported toys can differ materially from the rate at PO time or at customs declaration time). This produces wrong COGS, wrong margin reporting per product/dealer/salesperson (an explicit requirement: "Báo cáo theo sản phẩm, khách hàng, đại lý"), and wrong minimum wholesale pricing (selling below true cost without knowing it).

**Why it happens:**
Landed cost math is easy to describe but easy to under-scope: teams implement "purchase price + shipping" and stop, missing customs duty, VAT, insurance, and — critically for cross-border toy imports — the fact that freight/duty/handling costs are usually known and paid at the *shipment* level (one bill of lading covering many SKUs and quantities) and must be *allocated* down to each SKU/lot, typically by value or by volume/weight, not simply added as a flat per-unit number.

**How to avoid:**
- Model landed cost as: `unit_supplier_price (in original currency) × exchange_rate_at_settlement + allocated_freight + allocated_duty + allocated_insurance + allocated_handling`, where allocation happens per shipment (per lô hàng / container) and is distributed across the SKUs/quantities in that shipment by value or weight.
- Store exchange rate as its own versioned entity ("Quản lý tỷ giá" is explicitly in scope) — snapshot the rate used per shipment/lot at the time landed cost is finalized, never recompute historical COGS with today's rate.
- Attach landed cost to the **lot/batch**, not the SKU — the same SKU imported in two different shipments will have two different landed costs if the exchange rate or freight cost changed. This is why batch/lot tracking (Pitfall 4) and landed cost calculation are the same underlying data problem, not two separate features.
- Decide and document the cost flow method explicitly (FIFO by lot is the natural fit here since lots are already tracked for the batch-tracking requirement) rather than letting each report compute margin differently.

**Warning signs:**
- A single `cost_price` column on the product/SKU table with no link to a shipment or lot.
- No exchange-rate history table — only "current rate" used everywhere.
- Margin reports that don't reconcile with finance/accounting because COGS was computed from list price, not landed cost.

**Phase to address:**
Import/export management phase (PO, commercial invoice, customs, C/O) combined with warehouse batch/lot phase — landed cost calculation should be designed alongside batch receiving, not after.

---

### Pitfall 4: Batch/lot tracking added on top of an already-built SKU-only inventory model

**What goes wrong:**
Inventory is first built as `stock(sku_id, warehouse_id, qty)` because it's the fastest way to get B2C/B2B ordering working. Batch/lot tracking ("tồn kho theo lô", "quản lý lô hàng và ngày nhập kho") is then added later, requiring a schema migration that splits every stock row into per-lot rows, rewrites every stock-adjustment code path, and — worst case — requires reconciling historical orders that only reference a SKU with no lot, so nobody can answer "which lot did this sold unit come from" for anything sold before the migration.

**Why it happens:**
SKU-level stock is simpler to reason about and ships faster, so it's tempting to defer lot tracking as a "phase 2 enhancement." But lot tracking here isn't a nice-to-have — it's required for import traceability (which shipment/C/O a unit came from, relevant for safety-certification recalls on children's toys) and for the landed-cost-per-batch requirement above.

**How to avoid:**
- Design inventory from the start as `stock_lot(sku_id, warehouse_id, lot_id, qty)` with `available_qty`/`reserved_qty` at the (sku, warehouse, lot) grain, and a `stock_summary` view/materialized aggregate at (sku, warehouse) grain for fast catalog "in stock" checks.
- Decide lot consumption order up front (FEFO if any age/quality-expiry consideration applies to certain toy categories — e.g., electronic toy batteries, food-contact-adjacent items; otherwise FIFO by receipt date) and implement it as the single source of truth for stock deduction, not left to whichever lot the fulfillment picker grabs.
- Every sales order line should record which lot(s) it was fulfilled from at commit time — this is what makes the landed-cost-per-unit and recall-traceability requirements actually answerable later.

**Warning signs:**
- `stock` table has no `lot_id` foreign key, or lot tracking exists only as a free-text note field.
- Sales order lines reference only `sku_id`, not the lot(s) consumed.
- "Which units came from shipment X" requires a manual cross-reference instead of a query.

**Phase to address:**
Warehouse/inventory core phase — must be designed before any inventory-consuming feature (checkout, B2B ordering, stock reports) is built, since retrofitting is expensive.

---

### Pitfall 5: Trusting the payment gateway's redirect/return URL instead of the server-to-server IPN

**What goes wrong:**
VNPay, MoMo, and ZaloPay all provide a browser return URL (user redirected back after paying) *and* a separate server-to-server callback (VNPay: IPN; MoMo/ZaloPay: webhook/notify URL). Teams under time pressure mark the order "paid" based on the return URL alone, because it's simpler (no separate endpoint, no signature parsing) — but the return URL can be skipped by the user closing the browser tab, can be replayed/forged by an attacker since it's a GET/POST directly from the client, and is not guaranteed to fire at all on some payment failures. The correct order-paid trigger is the signed server callback; the return URL is for UX display only.

**Why it happens:**
The return URL is what shows up first in every tutorial ("redirect user back, show success page") and looks like the payment confirmation. The IPN/webhook requires exposing a public endpoint, handling signature verification, and handling retries/duplicate deliveries — extra plumbing that's easy to under-build under deadline pressure.

**How to avoid:**
- Treat the IPN/webhook (VNPay) or notify callback (MoMo, ZaloPay) as the **only** source of truth for marking an order paid. The return URL only reads order status from your own DB to render success/failure — it never writes payment status.
- Verify the signature on every callback (VNPay: HMAC-SHA512 over sorted params with secret key; MoMo/ZaloPay: their respective HMAC schemes) and reject unsigned/mismatched requests — an unverified "payment success" callback is a direct free-goods exploit vector.
- Handle callback idempotency: the same IPN can be delivered more than once; use the gateway's transaction ID as a unique constraint so a duplicate callback doesn't double-fulfill or double-credit an order.
- Handle amount-format quirks explicitly and test them: VNPay amount is the VND value × 100 as an integer; MoMo/ZaloPay use plain integer VND. A float or wrong multiplier breaks signature verification silently (signature mismatch, not a helpful error).
- Log the raw signature string and full payload for every callback attempt during integration — signature mismatches from encoding/parameter-order differences are the most common and hardest-to-debug failure mode reported by teams integrating these gateways.

**Warning signs:**
- Order status is set to "paid" inside the controller handling the browser redirect route, not inside the IPN/webhook handler.
- No idempotency key / duplicate-callback test exists.
- No negative test case (wrong signature → must reject) in the payment integration tests — only the happy path is tested.

**Phase to address:**
B2C payment integration phase — must include IPN/webhook handling, signature verification, and idempotency as part of the definition of done, not deferred to a "hardening" pass.

---

### Pitfall 6: Single VPS + Docker Compose treated as "set it up once and forget it"

**What goes wrong:**
Postgres runs in a container with a bind-mounted data directory and no tested backup/restore process — the team discovers there is no working backup only after data loss (disk failure, `docker compose down -v`, bad migration). Separately, `restart: no` (Docker's default) on services means a crashed container (OOM, unhandled exception) stays down until someone notices, and Docker's own iptables rules can expose the Postgres port to the public internet even when the host firewall (ufw) appears to block it — because Docker manipulates iptables directly and bypasses ufw's rules.

**Why it happens:**
A single VPS with `docker compose up -d` looks "production ready" the moment the app responds over HTTPS, but reliability (backups, restart policy, network exposure, resource limits) is invisible until something actually fails — which, for a small team without a staging environment, often means failing directly in production.

**How to avoid:**
- Use named Docker volumes for Postgres data (not ad-hoc bind mounts), and set up an automated `pg_dump` cron job (or `pg_basebackup`/WAL archiving for point-in-time recovery) that writes to a location *outside* the container and ideally off-VPS (object storage). Actually test a restore, not just confirm the dump file exists.
- Set `restart: unless-stopped` on every service in `docker-compose.yml` and add container healthchecks so `depends_on` ordering and orchestration actually reflect service readiness (e.g., app container should wait for Postgres healthcheck, not just container-started).
- Never map `5432:5432` (or any DB port) to the host's public interface in production compose files — bind to `127.0.0.1:5432:5432` or keep Postgres on an internal Docker network only, reachable exclusively by the app container. Explicitly verify with `docker port` and an external port scan, since ufw alone will not reliably block it.
- Since this is a single point of failure by design (one VPS, no redundancy), define and document what "acceptable downtime" and "acceptable data loss window" (RPO) are early, and size the backup frequency accordingly — this is a conscious tradeoff for a small-team MVP, not an oversight, but it must be a *decided* tradeoff with a monitoring/alerting plan, not silence.
- Set resource limits (`mem_limit`/`cpus` or Compose `deploy.resources`) on containers, especially Postgres and Next.js SSR — an unbounded Node process on a small VPS can OOM-kill Postgres itself if they share the same host without limits.

**Warning signs:**
- No entry in crontab / no backup container in `docker-compose.yml`.
- `docker compose config` shows no `restart:` policy or `restart: no` on app/db services.
- `docker ps` or an external `nmap` scan from outside the VPS shows port 5432 reachable.
- No documented restore runbook / restore has never been rehearsed.

**Phase to address:**
Should be addressed explicitly in the deployment/infrastructure phase, ideally early (a "walking skeleton" deploy phase) rather than only at final launch — retrofitting backup/security onto a live system with real customer/order data is much riskier than building it in from the first deploy.

---

### Pitfall 7: Credit limit (hạn mức công nợ) checked in the UI but not enforced atomically at order commit

**What goes wrong:**
A dealer's credit limit and outstanding debt (công nợ) are displayed and checked when the B2B order form is submitted, but the actual limit check happens as a separate read before the order-and-invoice write. Two orders placed close together (or one large order plus a delayed payment reconciliation) can both pass the check before either updates the outstanding balance, letting a dealer's debt silently exceed their approved limit. This is the accounts-receivable equivalent of the inventory oversell bug (Pitfall 2), and Vietnamese B2B trade specifically relies on credit terms (bán chịu / công nợ) being trustworthy for both the seller's risk management and the dealer relationship.

**Why it happens:**
Credit-limit validation is naturally implemented as a pre-submit form check ("does this order push them over their limit?") because that's where the business rule is easiest to express, but if it isn't re-verified inside the same DB transaction that commits the order and updates the running balance, it's just advisory, not enforced.

**How to avoid:**
- Enforce credit limit as a conditional update inside the same transaction that creates the order/invoice: `UPDATE customer SET outstanding_debt = outstanding_debt + :amount WHERE id = :id AND outstanding_debt + :amount <= credit_limit`, and reject the order if the update affects zero rows — mirrors the inventory reservation pattern in Pitfall 2.
- Keep a single ledger table for debt movements (invoice issued, payment received, credit note) rather than only a running `outstanding_debt` counter on the customer row — the counter should be derived/cached from the ledger, not the sole source of truth, so it can always be reconciled and audited.
- Decide explicitly whether credit-limit breach blocks the order outright or routes it to a manual approval queue (common in B2B — "nhân viên kinh doanh phụ trách" suggests a sales-rep-mediated approval flow is expected) and implement that as a real order status, not a UI warning that can be dismissed.

**Warning signs:**
- Credit limit check exists only as client-side or a pre-submit API call separate from the order-creation transaction.
- No debt ledger — only a single mutable `outstanding_debt` number with no audit trail of how it changed.
- No defined behavior for "what happens when a dealer exceeds credit limit" beyond a UI error message.

**Phase to address:**
B2B ordering/customer-debt phase — should be designed alongside the order-commit transaction, not as a separate "credit management" feature bolted on afterward.

---

### Pitfall 8: Multi-warehouse transfer modeled as two independent stock adjustments instead of one atomic transfer with in-transit state

**What goes wrong:**
A warehouse-to-warehouse transfer ("chuyển kho") is implemented as "decrement source warehouse, increment destination warehouse" as two separate operations (sometimes even two separate user actions: one clerk marks it shipped, another marks it received days later). Stock temporarily "disappears" from both totals during transit, or worse, a partial failure (app crash between the two writes, or a transfer that's cancelled mid-transit) leaves stock decremented at the source but never credited at the destination — silent shrinkage that's invisible until a physical stock count (kiểm kê kho) disagrees with the system.

**Why it happens:**
Transfer looks like "just move the number from column A to column B," but physically a transfer has a real transit period (goods are in a truck/container, not in either warehouse) that the schema needs to represent, especially relevant here since some "transfers" are actually the *first* placement of an imported lot into a warehouse after customs clearance — the same in-transit modeling applies to inbound shipments, not just inter-warehouse moves.

**How to avoid:**
- Model transfers as their own entity with a state machine: `pending → in_transit → received` (or `cancelled`), decrementing source stock at `in_transit` and crediting destination stock only at `received`, with an explicit "in-transit" quantity bucket that's excluded from both warehouses' sellable `available_qty` but still visible in total company-wide stock reporting.
- Apply the same state machine to inbound import shipments (goods clear customs → arrive at warehouse → counted/received) rather than treating "hàng nhập kho" as an instant one-step stock increment — this reuses the same in-transit pattern and keeps the model consistent between import receiving and inter-warehouse transfer.
- Reconcile with kiểm kê kho (stock count) as a first-class adjustment type (with a reason code) rather than a manual UPDATE — every stock quantity mutation in the system should go through one auditable movement log (nhập/xuất/chuyển/kiểm kê/hàng lỗi-đổi trả), never a direct UPDATE to the quantity column from application code outside that log.

**Warning signs:**
- Transfer is implemented as two independent API calls with no linking transfer/shipment record between them.
- Stock movement history can't answer "how much stock is currently in transit between warehouse A and B right now."
- Physical stock counts require manual spreadsheet reconciliation because system stock and physical stock drift with no attributable cause.

**Phase to address:**
Warehouse/multi-warehouse phase, designed together with the import-receiving flow so both use the same movement-log/state-machine pattern.

---

### Pitfall 9: Bilingual (VN/EN) content modeled as duplicate rows or JSON blobs bolted on late

**What goes wrong:**
Product names, descriptions, category names, and articles start as single VARCHAR columns; Vietnamese content ships first (since the primary market and requirements text is Vietnamese), and English is added later either as a parallel duplicate table (doubling every query and risking the two falling out of sync) or as an unstructured JSON column added post-hoc, requiring a migration of everything already written and breaking any full-text search / SEO slug logic that assumed one language.

**Why it happens:**
Under schedule pressure, "song ngữ Việt/Anh ngay từ v1" (explicit requirement) is easy to deprioritize during initial schema design because the Vietnamese content is what's visible in demos first, and bilingual infrastructure has no visible UI payoff on day one.

**How to avoid:**
- Decide the i18n storage pattern explicitly before building catalog/CMS tables: either (a) translatable-fields tables (`product_translation(product_id, locale, name, description, slug)`) or (b) structured JSONB columns (`name: {vi: "...", en: "..."}`) — both are workable, but pick one and apply it consistently to every user-facing text field (product, category, brand, article/news, banner, SEO metadata) from the first migration, not per-feature.
- SEO slugs need per-locale uniqueness constraints (`unique(locale, slug)`), not a single global slug — this is easy to miss if slugs are added before bilingual support and only discovered when the English site needs its own URL structure.
- Decide the fallback behavior when a translation is missing (fall back to Vietnamese, or show empty) as a product decision up front, since partial-translation content is the normal state during ongoing operations, not an edge case.

**Warning signs:**
- Only one language column exists per text field, with no `locale` dimension anywhere in the schema.
- Admin UI has no way to see "which products are missing English translation."
- Slug uniqueness constraint is global rather than per-locale.

**Phase to address:**
Catalog/CMS schema phase — cheap to build in from the start, expensive to retrofit across every content table later.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Single `gia_si`/`gia_le` columns instead of a price-list/tier engine | Faster to ship first catalog page | Full pricing-engine migration once first dealer tier or volume discount is needed | Never for this project — B2B pricing tiers are in v1 scope from day one |
| SKU-only stock (no lot) at MVP | Simpler queries, faster checkout build | Painful backfill of lot data for already-sold units; no import traceability | Never — lot tracking is explicit v1 scope, and toy safety/recall traceability depends on it |
| Landed cost = purchase price only, no freight/duty allocation | Faster PO/inventory feature | Wrong margin reports, wrong minimum wholesale price, distrust from finance once numbers don't reconcile | Only acceptable as a temporary placeholder if clearly flagged "not final cost" in the UI — must be fixed before any margin reporting ships |
| Trusting payment return-URL instead of building the IPN/webhook handler | Payment "works" in manual demo faster | Free-goods exploit, orders stuck "unpaid" after real payments, no reconciliation with gateway | Never in production |
| No automated Postgres backup at initial VPS deploy | Faster initial deploy | Total data loss on disk failure/bad migration with no recovery path | Only for a throwaway dev/staging box — never for the environment holding real orders/customer debt |
| Direct `UPDATE stock SET qty = ...` from multiple services instead of one movement-log service | Faster to wire up each feature independently | Untraceable stock drift, no audit trail for kiểm kê kho reconciliation | Acceptable only inside a single internal admin "manual adjustment" path that itself writes to the movement log — never bypassed entirely |
| Global (non-locale) SEO slugs while VN-only content exists | One less migration in week 1 | Slug collisions / broken URLs when English content is added | Never — bilingual is explicit v1 scope |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| VNPay | Marking order paid from the browser return URL instead of the IPN; sending `vnp_Amount` as a float or without ×100 | Only the signed IPN endpoint writes payment status; amount is an integer VND×100; verify HMAC-SHA512 signature on every callback and log raw payload for debugging |
| MoMo | Same return-URL-as-truth mistake; not handling MoMo's `resultCode` variations (success, cancelled, failed all look similar without careful status mapping) | Use MoMo's IPN/notify callback exclusively for status; map every `resultCode` to an explicit internal order-payment state, not just success/fail |
| ZaloPay | Skipping ZaloPay's own QC/review step before going to production credentials, discovering integration issues only after go-live | Budget time for ZaloPay's sandbox → QC review → production credential issuance cycle in the payment phase timeline, not assumed to be instant |
| All three gateways together | Writing three separate, inconsistent payment integrations with duplicated signature/callback logic | Build one internal `PaymentGateway` interface/adapter with provider-specific implementations, shared order-state-transition logic, and a single idempotent "record payment callback" entrypoint used by all three |
| Excel import/export (đặt hàng nhanh bằng SKU/Excel, import/export Excel admin) | Accepting uploaded Excel with no schema/row validation, silently creating malformed products or orders with wrong SKUs/quantities | Validate every row against the same DTOs/schema used by the API before committing; reject the whole batch (or clearly flag per-row errors) rather than partially importing bad data |
| Docker on VPS | Publishing DB port to `0.0.0.0`, assuming host `ufw` blocks it | Bind DB port to `127.0.0.1` only or omit host port mapping entirely, keep DB reachable only via the internal Docker network |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Computing "available stock" with a live aggregate query (`SUM` over lots/movements) on every catalog page load | Product listing/search pages slow down as order/movement history grows | Maintain a denormalized `available_qty` per (sku, warehouse) updated transactionally on every movement, with the movement log as the audit source of truth, not the read path | Noticeable once movement history reaches tens of thousands of rows per SKU (a few months of active operation) |
| Recomputing landed cost / margin reports on-demand from raw shipment+order data at request time | Admin dashboard/report pages time out or become very slow | Precompute/cache landed cost per lot at receiving time; use materialized views or scheduled aggregation for revenue/margin reports rather than live joins across orders, lots, and shipments | Once order volume + multi-year shipment history makes the join expensive — plan for it from the reporting phase, not after complaints |
| Single Postgres instance handling both OLTP (checkout, orders) and heavy reporting queries with no read replica/connection pool tuning | Checkout slows down or times out when someone runs a big admin report | Use PgBouncer/connection pooling from the start on a single VPS; keep an eye on long-running report queries and consider a read replica or scheduled report generation as usage grows | Becomes visible once concurrent admin report usage overlaps with peak storefront traffic — realistic risk even at modest scale on a single shared VPS |
| Unbounded Next.js SSR/ISR revalidation hitting the API for every product page on every request | Slow product pages, high API load under traffic spikes (e.g., flash sale) | Use ISR/static generation with sensible revalidation windows for catalog pages; treat "flash sale" pages as a case needing explicit cache-busting, not default revalidation | Breaks first during marketing-driven traffic spikes (flash sale is explicit v1 scope) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Not verifying payment gateway callback signatures | Attacker forges "payment successful" IPN/webhook, gets goods without paying | Verify HMAC signature on every callback before touching order state; reject on mismatch, log the attempt |
| Publishing Postgres port on the VPS's public interface | Direct internet access to production DB, especially dangerous with customer PII + debt/credit data | Bind DB to loopback/internal Docker network only; verify with an external port scan post-deploy |
| Default-permissive RBAC (new admin roles get broad access unless explicitly restricted) | A junior staff account or compromised credential can see/modify customer debt, pricing, or other departments' data | Design RBAC as deny-by-default with explicit per-role grants; audit "nhật ký thao tác" (activity log) from day one so privilege misuse is detectable, not just preventable |
| Storing customer/dealer documents (business license, contracts — "quản lý hợp đồng") or payment callback payloads with no access control on file storage | Sensitive business documents (used for B2B approval/credit decisions) exposed via guessable URLs | Serve uploaded documents through an authenticated endpoint with role checks, not a public static file path |
| Weak/no two-factor auth on admin accounts (requirement explicitly lists "bảo mật đăng nhập và xác thực hai lớp") | Admin account compromise exposes pricing, customer debt, and order data across both B2C and B2B | Implement 2FA for admin/back-office roles before granting access to financial/pricing data, not as a post-launch add-on |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| B2C shoppers seeing wholesale-only SKUs or wholesale pricing/minimum-order-quantity language | Confusing, unprofessional storefront; retail customers can't tell what they can actually buy | Filter catalog visibility by channel/audience using the "hàng sỉ, hàng lẻ" classification, and render price/MOQ fields conditionally per channel, not per user guesswork |
| B2B dealer signup with no clear status feedback while awaiting admin approval ("phê duyệt tài khoản bán sỉ") | Dealer registers, sees nothing happen, assumes it failed, abandons or double-registers | Explicit account states (pending/approved/rejected) with email/Zalo notification on status change, and a visible "pending approval" state in the dealer's own login |
| Stock shown as a binary "in stock / out of stock" while actual availability differs per warehouse or is partially in-transit | Customer orders something the fulfilling warehouse doesn't actually have on hand yet | Show accurate available-to-promise per warehouse/lot state (excluding in-transit/reserved), and be explicit at checkout about estimated fulfillment source if multi-warehouse |
| COD orders and B2B credit (net-terms) orders both treated identically to prepaid orders in the order-status flow | Staff and customers can't tell whether money has actually been collected vs. just an order placed | Separate "order status" (placed/shipped/delivered) from "payment status" (unpaid/partial/paid) as two distinct fields everywhere they're displayed and reported |

## "Looks Done But Isn't" Checklist

- [ ] **Inventory oversell prevention:** Looks done when a single checkout succeeds — verify with a concurrency test placing two simultaneous orders (one B2C, one B2B) against low stock and confirming no negative stock results.
- [ ] **Payment gateway integration:** Looks done when the happy-path redirect shows "Payment Successful" — verify the IPN/webhook handler independently with a forged/invalid signature test (must reject) and a duplicate-callback test (must not double-fulfill).
- [ ] **Landed cost / giá vốn:** Looks done when a PO has a "cost" field populated — verify it includes freight/duty/exchange-rate allocation per lot, and that margin reports reconcile against it, not against list/purchase price.
- [ ] **Batch/lot tracking:** Looks done when a lot number is stored on the product — verify that a completed sales order line records which specific lot(s) fulfilled it, and that a lot's remaining quantity updates on sale.
- [ ] **Multi-warehouse transfer:** Looks done when stock moves from warehouse A to B on a single button click — verify an in-transit intermediate state exists and that a cancelled/failed transfer doesn't leave stock double-counted or vanished.
- [ ] **Credit limit enforcement:** Looks done when the order form warns "exceeds credit limit" — verify the check is enforced inside the same DB transaction as order commit (test with two near-simultaneous orders that individually fit but combined exceed the limit).
- [ ] **Bilingual content:** Looks done when the language switcher changes UI chrome text — verify product/category/article content actually has translated rows/fields, not just static UI strings, and that missing translations have a defined fallback.
- [ ] **VPS backups:** Looks done when a `pg_dump` cron job exists — verify by actually restoring the dump into a fresh database and confirming the app runs against it.
- [ ] **RBAC:** Looks done when roles exist in the admin UI — verify by attempting a restricted action (e.g., view customer debt) as a low-privilege role and confirming it's blocked at the API layer, not just hidden in the UI.
- [ ] **Excel import/export:** Looks done when a sample file imports successfully — verify with a deliberately malformed file (wrong SKU, negative quantity, missing required column) and confirm it's rejected with a clear error, not silently partially imported.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| B2C-first schema retrofitted for B2B pricing | HIGH | Introduce price-list/tier tables alongside existing price columns, backfill tier data from existing dealer discount conventions, migrate read paths to the new pricing service incrementally, then drop legacy columns once all call sites are migrated |
| Oversold inventory discovered in production | MEDIUM | Reconcile affected orders manually (contact affected customers, offer backorder/refund), then retrofit atomic reservation logic (conditional UPDATE or SELECT FOR UPDATE) before reopening the affected SKUs to sale |
| Landed cost computed wrong historically | MEDIUM-HIGH | Recompute landed cost per lot from original shipment records (freight/duty/exchange-rate history) if still available; if shipment-level cost detail wasn't retained, historical COGS may be unrecoverable — this is the strongest argument for getting the model right from the first import phase |
| SKU-only inventory needing lot retrofit | HIGH | Requires backfilling lot assumption for all existing stock (often "unknown lot" bucket for pre-migration stock) and rewriting every stock-mutation code path to the new (sku, warehouse, lot) grain — budget this as a dedicated migration phase, not a quick patch |
| Postgres data loss with no working backup | HIGH (potentially unrecoverable) | If no backup exists, data is likely gone; recovery is limited to whatever can be reconstructed from application logs, payment gateway transaction records, or manual customer/dealer reconciliation — this is why backup verification must happen before, not after, real data accumulates |
| Payment IPN not implemented, orders marked paid from return URL only | MEDIUM | Retrofit the IPN/webhook endpoint, then reconcile currently "paid" orders against the gateway's actual transaction history/reporting API to find any falsely-marked-paid orders |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Consumer-first schema for B2B pricing | Data model / catalog schema phase (before B2C and B2B storefronts) | Price-list/tier tables exist and are the only pricing code path; no hardcoded discount conditionals |
| Inventory oversell across channels | Inventory/warehouse core phase (before checkout and B2B ordering) | Concurrency test: simultaneous B2C + B2B orders against low stock never produce negative stock |
| Landed cost miscalculation | Import/export + batch/lot phase | Margin report for a sample lot reconciles manually against freight+duty+exchange-rate inputs |
| Batch/lot tracking retrofit | Warehouse/inventory core phase (same phase as oversell prevention) | Every sold unit traces back to a specific receiving lot |
| Payment IPN/return-URL confusion | B2C payment integration phase | Automated test: forged signature rejected; duplicate callback does not double-fulfill; return-URL page never writes payment state |
| Single-VPS Docker reliability | Deployment/infrastructure phase (early "walking skeleton" deploy, revisited before real launch) | Backup successfully restored to a fresh DB; DB port unreachable from outside the VPS; all services have `restart: unless-stopped` |
| Credit limit race condition | B2B ordering/customer-debt phase | Concurrency test: two near-simultaneous orders that individually fit but jointly exceed credit limit — only one commits |
| Multi-warehouse transfer atomicity | Warehouse/multi-warehouse phase | Cancelled/interrupted transfer never results in stock existing in neither or both warehouses |
| Bilingual content retrofit | Catalog/CMS schema phase (before content is authored) | Every user-facing text field has a `locale` dimension; slugs are unique per locale |

## Sources

- [Preventing Overselling: Inventory Locks Under Concurrent Checkouts](https://dev.to/iurii_rogulia/preventing-overselling-inventory-locks-under-concurrent-checkouts-3m7e) — inventory reservation / SELECT FOR UPDATE pattern (MEDIUM confidence, community source, pattern is standard and consistent with PostgreSQL docs behavior)
- [SELECT FOR UPDATE in PostgreSQL — Stormatics](https://stormatics.tech/blogs/select-for-update-in-postgresql) — row-level locking mechanics (MEDIUM-HIGH, technical vendor blog consistent with Postgres documentation)
- [The textbook says cross-service inventory needs a coordinator — DEV Community](https://dev.to/danzizhangdev/the-textbook-says-cross-service-inventory-needs-a-coordinator-this-checkout-has-none-lcm) — atomic reserve pattern (MEDIUM)
- [fix(inventory): serialize concurrent reservation mutations — medusajs/medusa PR #16575](https://github.com/medusajs/medusa/pull/16575) — real-world oversell bug fix in a production open-source commerce platform (MEDIUM-HIGH, verifiable code change)
- [B2B B2C hybrid commerce: architecture on one platform — Bluepes](https://bluepes.com/blog/b2b-b2c-hybrid-commerce-architecture) — consumer-schema-first pitfall for hybrid B2B/B2C (MEDIUM, vendor blog but consistent with independent Centarro/Kibo sources)
- [B2B Product Catalog Management at Scale — Centarro](https://www.centarro.io/blog/b2b-product-catalog-management-scale) — B2B pricing/catalog architecture differences (MEDIUM)
- [Solving Core B2B Challenges in Complex Catalogs and Logic — Kibo Commerce](https://kibocommerce.com/blog/solving-core-b2b-challenges-strategies-for-complex-catalogs-logic/) — pricing engine requirements (MEDIUM)
- [Landed cost: The hidden factor in your pricing formula — Fishbowl](https://www.fishbowlinventory.com/blog/landed-cost) — landed cost components (MEDIUM-HIGH, consistent across multiple inventory-software vendor sources)
- [Why You Need to Calculate Landed Cost — NetSuite](https://www.netsuite.com/portal/resource/articles/inventory-management/landed-cost.shtml) — landed cost / COGS impact (MEDIUM-HIGH)
- [Landed Cost: Complete Guide — Descartes Finale](https://www.finaleinventory.com/guides/landed-cost/) — cost allocation methodology (MEDIUM)
- [FIFO Method: Complete Guide — Descartes Finale / ordersinseconds](https://ordersinseconds.com/fifo-method-complete-guide/) — batch/lot FIFO costing pitfalls (MEDIUM)
- [Docker Compose in Production on a Single VPS: An Honest Audit](https://jguillaumesio.com/blog/docker-compose-production-single-vps/) — bind-mount data loss, restart policy, Docker/iptables/ufw bypass (MEDIUM-HIGH, detailed first-hand production account, corroborated by general Docker networking documentation)
- [Docker Compose Production VPS Architecture For Small SaaS Apps — dchost](https://www.dchost.com/blog/en/docker-compose-production-vps-architecture-for-small-saas-apps/) — named volumes, healthchecks, backup practices (MEDIUM)
- [Testing VN Payment Gateways — VNPay sandbox — vietnamcos.com](https://vietnamcos.com/courses/lesson/api-testing-with-postman-advanced/testing-vn-payment-gateways-vnpay-sandbox) — IPN vs return URL, amount×100, signature/encoding pitfalls (MEDIUM, QA training content specific to VNPay, cross-checked against general payment-gateway webhook-vs-redirect best practice which is HIGH confidence and widely documented industry-wide)
- [Integration Process — Zalopay Docs](https://docs.zalopay.vn/docs/developer-tools/integration-guide/) — sandbox → QC review → production credential flow (MEDIUM, official docs page, specific approval-timeline details not independently verified)
- [How to Solve B2B Teams' Top Four Accounts Receivable Challenges — k-ecommerce](https://k-ecommerce.com/blog/4-common-accounts-receivable-challenges) — credit limit / reconciliation drift pitfalls (MEDIUM)
- [Minimizing Risks With Ecommerce Credit Limits — Zoey](https://www.zoey.com/minimizing-risks-with-ecommerce-credit-limits/) — credit limit enforcement design (MEDIUM)
- Domain analysis of `.planning/PROJECT.md` and `requirements.txt.txt` — project-specific scope grounding (HIGH confidence as source-of-truth for what's in/out of scope)

---
*Pitfalls research for: B2C + B2B toy import/export e-commerce platform*
*Researched: 2026-09-21*
