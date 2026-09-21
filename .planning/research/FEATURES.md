# Feature Research

**Domain:** Vietnamese toy import/export B2C retail + B2B wholesale e-commerce platform
**Researched:** 2026-09-21
**Confidence:** MEDIUM-HIGH (B2B/B2C commerce patterns HIGH — well-established, multiple corroborating sources; Vietnam-specific toy regulation HIGH — official government source; import/export document workflow MEDIUM — verified against trade-documentation software vendors, not a live customs system)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or the B2B side is unusable for real dealers.

#### Catalog (age-range/category)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-axis product classification (age range, gender/unisex, category, brand, origin, wholesale-vs-retail flag) | Parents shop toys primarily by age-appropriateness and category; this is the #1 nav pattern on every toy retailer (Amazon Toys, Shopee, Đồ Chơi Tí Hon, etc.) | MEDIUM | Model as filterable facets (not rigid single-parent category tree) — a product can be "3-6 tuổi" + "giáo dục" + "lắp ráp" simultaneously |
| Age-grade badge on every product card/PDP | Age grading is both a UX filter and (in many markets) a regulatory-adjacent label parents actively check | LOW | Store as structured min/max age (months or years), not free text — enables filter and sort |
| Safety certification / compliance info on PDP (QCVN 3:2019/BKHCN "hợp quy" CR mark for VN market; optionally CE/ASTM F963/EN71 for imported-origin transparency) | Vietnamese law requires "hợp quy" (CR — Certificate/Conformity Regulation) declaration before children's toys circulate in-market from 2021 onward (Thông tư 09/2019/TT-BKHCN, QCVN 3:2019/BKHCN). B2B buyers (schools, dealers) explicitly ask for this. | MEDIUM | Store cert type, cert number, issuing body, validity date per SKU or per import batch; surface on PDP as trust signal. This is a genuine compliance table-stake for this specific domain, not just "nice to have" |
| SKU + barcode per variant | Needed for POS-style ops, warehouse scanning, and B2B Excel ordering by SKU | LOW | Already in requirements.txt.txt — confirms domain expectation |
| Rich media (multiple images, video) | Toy buyers (especially parents) rely heavily on visual/video inspection before purchase | LOW | Standard CMS/media handling |
| Dual pricing display logic (retail price visible to B2C, wholesale price only visible to approved B2B accounts) | Core to the dual-channel business model; leaking wholesale pricing to retail undermines dealer relationships | MEDIUM | Pricing must be resolved per-viewer (auth + account tier), not a static field — architectural decision, not just UI toggle |
| Packaging/carton spec per SKU (units per inner box, units per master carton, carton dimensions/weight) | Needed to make B2B carton/container ordering (below) meaningful and to compute container fill for logistics | MEDIUM | This is a distinct data field from "quantity in stock" — must exist before carton-ordering feature can work |
| Stock-status indicator (in stock / low stock / out of stock) shown to buyer | Universal e-commerce expectation; especially important for B2B bulk buyers planning purchase timing | LOW | Depends on multi-warehouse inventory (see below) |

#### Dealer account approval & tiered pricing

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| B2B registration form capturing business proof (business license/mã số thuế, business type — cửa hàng/trường học/nhà phân phối) | Standard B2B onboarding pattern; also a practical anti-fraud gate before exposing wholesale pricing | LOW-MEDIUM | Requirements already specify this |
| Manual admin approval queue for dealer applications | Universal B2B pattern — wholesale pricing/credit is a business risk decision, not self-serve | LOW | Simple state machine: pending → approved/rejected, with reason |
| Tiered/group pricing (dealer tier → price list) | Standard B2B wholesale pattern (confirmed across OroCommerce, WizCommerce, industry sources) — different dealer tiers (e.g., đại lý cấp 1/2, trường học) get different price books | MEDIUM-HIGH | Model as price-list-per-tier (or per-account for VIP), not per-product-per-customer hardcoded rules — scales better |
| Quantity-break / volume discounts on top of tier price | Explicitly requested in source spec ("chiết khấu theo số lượng hoặc doanh số") and standard in every B2B platform researched | MEDIUM | Layer on top of tier price list: tier resolves base wholesale price, quantity breaks apply discount curve |
| Minimum order quantity (MOQ) enforcement at SKU or order level | Universal wholesale expectation, explicitly in source spec | LOW-MEDIUM | Must validate at cart/checkout, not just display |
| B2B-only self-service portal (separate login area, own dashboard: order history, invoices, debt/credit status) | B2B buyers expect to self-serve without calling a sales rep for routine reorders | MEDIUM | Shares product/inventory data with B2C per PROJECT.md decision, but is a distinct UI area with distinct nav/permissions |
| Credit limit (hạn mức công nợ) tied to dealer account, enforced at order time | Explicitly in source spec; standard B2B credit-risk practice — orders should soft-block or flag when exceeding limit | MEDIUM-HIGH | Requires AR (accounts receivable) balance tracking tied into order placement — cross-cuts sales + customer modules |
| Quick reorder / bulk order by SKU list or Excel upload | Explicitly in source spec, and confirmed as a standard high-value B2B feature (CSV/Excel quick-order forms) across every B2B platform researched | MEDIUM | Needs SKU validation, MOQ/carton-multiple validation, and price resolution against the uploader's own tier — non-trivial validation logic |

#### Container/carton bulk ordering

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Order quantity in carton/case multiples (not just "units") for B2B cart | Confirmed as a standard wholesale/toy-industry ordering mechanism (case-pack increments) across B2B platform research | MEDIUM | UI must let dealer choose "units" vs "thùng/kiện" and convert; validate against carton size from catalog data |
| Carton-level pricing display alongside unit pricing | Dealers think in "price per thùng," not just "price per unit," when planning bulk buys | LOW | Derived field: unit price × units-per-carton, shown alongside |
| Request-for-quote (RFQ/báo giá) flow for large/custom orders | Explicitly in source spec; standard for container-level or negotiated deals that don't fit a fixed price list | MEDIUM | Simple: dealer submits desired SKUs+qty, sales rep responds with a quote object that can convert to an order |

**Note on "container ordering":** True full-container-load (FCL) ordering (i.e., a dealer buying an entire 20ft/40ft container directly, pre-import) is a materially different and rarer workflow than carton/case ordering — it implies the dealer is essentially co-importing or pre-ordering against a future shipment, which overlaps with the import/export module rather than standard B2B checkout. Treat "carton/kiện" ordering as table stakes; treat true container-level pre-order/pre-book as a differentiator or defer it (see below).

#### Import/export document tracking

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Foreign supplier registry (name, country, port of origin, contact, contract terms) | Baseline requirement to run any import operation; explicitly in source spec | LOW-MEDIUM | Straightforward master-data entity |
| PO (Purchase Order) tracking per supplier/shipment | Core import workflow document; every export-documentation tool researched treats PO as the origin document that other docs derive from | MEDIUM | Should be the anchor record that commercial invoice, packing list, and B/L reference |
| Commercial Invoice, Packing List, Bill of Lading, C/O — stored as structured records (not just file uploads) with key fields (numbers, dates, amounts, container/seal numbers) plus file attachment | Confirmed as the standard document set across trade-documentation software (IncoDocs, Shipping Solutions, VeravalOnline) — these tools generate/sync data across this exact document set | MEDIUM-HIGH | Recommend: structured metadata + PDF/image attachment per doc, linked to a shipment/lô hàng record — not free-form file dump. Full auto-generation of customs-compliant documents (like dedicated trade-doc SaaS does) is likely overkill for v1; tracking + attachment is sufficient |
| Shipment/lô hàng status tracking (ordered → shipped → in transit → customs clearance → received into warehouse) | Explicitly in source spec ("trạng thái thông quan," "quản lý lô hàng và ngày nhập kho") and matches standard import operations workflow | MEDIUM | Simple status pipeline is sufficient for v1; do not build real customs-system integration |
| Landed cost calculation (giá vốn sau nhập khẩu) — product cost + freight + duty/tax + handling, allocated per SKU/batch | Confirmed as standard practice in importer-focused inventory tools (Finale, Xorosoft, Bizowie) — this is the number that actually drives wholesale/retail pricing decisions, not the FOB cost | HIGH | Needs an allocation method (by value, by weight, or by volume) across SKUs in a shipment — this is one of the more algorithmically complex features in the whole platform; flag for careful spec |
| Exchange rate tracking per shipment/PO (tỷ giá) | Explicitly in source spec, and mandatory since supplier invoices are in foreign currency but platform pricing is VND-only per PROJECT.md decision | MEDIUM | Rate must be captured at time of transaction for accurate landed cost, not just "today's rate" |
| Batch/lot linkage from import shipment to warehouse inventory | Explicitly in source spec and required for recall traceability (a real risk domain given toy safety regulation) | MEDIUM-HIGH | This is the join point between the import module and the warehouse module — must be designed together (see Dependencies) |

#### Multi-warehouse batch-tracked inventory

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multiple warehouse locations with per-warehouse stock levels | Explicitly in source spec; standard for any distributor with >1 physical location | MEDIUM | Confirmed as baseline in every inventory-management source researched |
| Stock in/out/transfer between warehouses | Explicitly in source spec; universal WMS-adjacent feature | MEDIUM | |
| Batch/lot-level stock tracking (not just SKU-level aggregate) | Explicitly in source spec; confirmed as standard for importers who need expiry/traceability and recall-readiness (lot-tracking is called out repeatedly in inventory-software research as the importer-specific need) | HIGH | This is architecturally significant: inventory must be tracked as (SKU × Warehouse × Batch), not just (SKU × Warehouse). Affects order allocation logic, reporting, and FIFO/cost-layer logic |
| Low-stock alerts / reorder threshold | Explicitly in source spec; universal inventory feature | LOW | |
| Barcode/QR generation and printing | Explicitly in source spec; standard warehouse-ops feature | LOW-MEDIUM | Generating/printing labels is straightforward; scanning via dedicated hardware or phone camera is a separate (deferred) concern — see Anti-Features |
| Stock take / physical count reconciliation (kiểm kê kho) | Explicitly in source spec; standard inventory-accuracy practice | MEDIUM | |
| Defective/returned goods tracking (hàng lỗi, hàng đổi trả) as a distinct inventory state | Explicitly in source spec; needed so returned stock doesn't silently re-enter sellable inventory | MEDIUM | Model as a stock status/condition flag, not a separate item type |
| Real-time stock sync between B2C storefront and B2B portal (single source of truth) | Explicitly required by PROJECT.md core value ("cả hai luồng chạy trên cùng một... tồn kho chính xác") — overselling across channels is a classic dual-channel failure mode | HIGH | This is the single most architecturally important inventory requirement — both channels must read/write the same inventory ledger with proper reservation/locking at checkout, not two separate stock counters that get reconciled later |

#### General B2C table stakes (not the focus areas, but must not be skipped)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Cart, checkout, COD + local payment gateways (VNPay/MoMo/ZaloPay) | Standard VN e-commerce expectation; already decided in PROJECT.md | MEDIUM | |
| Shipping fee calculation, order tracking, purchase history | Universal B2C table stakes | LOW-MEDIUM | |
| Product reviews/ratings | Standard trust signal for toy purchases (parents rely on other parents' reviews) | LOW | |
| Order/invoice/payment-status/debt admin views, RBAC, activity log, Excel import/export, bilingual VI/EN UI | Explicit in source spec and PROJECT.md constraints | MEDIUM-HIGH | Bilingual content model touches every entity with text fields — plan i18n schema from the start, not bolted on later |

### Differentiators (Competitive Advantage)

Features that set the product apart from a generic Vietnamese e-commerce build or a generic B2B portal. Align with PROJECT.md's core value: parents find age-appropriate toys easily AND dealers self-serve wholesale on the same accurate catalog/inventory.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Unified catalog/inventory serving both B2C and B2B from one data model with per-viewer price/UX resolution | Most competitors in the VN toy space run separate systems (a Shopee/website storefront + an offline/Excel-based wholesale process) that drift out of sync. A genuinely unified backend is the platform's core differentiator per PROJECT.md | HIGH | This is the architectural bet the whole project rests on — worth the complexity because it's explicitly the stated core value, not a nice-to-have |
| Batch/lot-linked traceability from import shipment → warehouse → sale, surfaced to B2B buyers (e.g., school/institutional buyers who care about origin/cert) | Institutional B2B buyers (schools, government-adjacent buyers) in VN increasingly ask for provenance and compliance documentation; being able to answer "which shipment/C-O does this batch come from" is a trust differentiator few small toy sellers offer | MEDIUM-HIGH | Builds directly on the batch-tracking table stake — the differentiator is *surfacing* it to buyers/admin as a traceability report, not just storing it |
| Landed-cost-aware pricing suggestions (system shows true margin after freight/duty, not just FOB markup) | Most small VN importers price by gut feel off FOB cost; accurate landed cost per batch lets the business price more confidently and spot margin erosion by shipment | HIGH | Depends on the landed-cost allocation feature above — this is the "so what" that makes that complex feature pay off |
| Age-range + category faceted discovery tuned for gift-buying/occasion context (e.g., "quà sinh nhật cho bé 3 tuổi") | Toy purchases are frequently gift-driven and occasion-driven, not just category browsing; combining age+occasion+budget filters is a discovery pattern many bare-bones toy sites skip | MEDIUM | Pure UX/search-facet investment on top of the table-stake catalog model — cheap once the age/category taxonomy exists |
| Combo/bundle products and cross-sell ("mua kèm") | Explicit in source spec; increases AOV and is well-suited to toys (e.g., building-block base set + expansion packs) | MEDIUM | Genuine differentiator if done well (curated bundles), but low novelty — treat as medium priority |
| Flash sale / promotional campaign tooling | Common in VN e-commerce (heavily used by Shopee/Tiki-trained consumer expectations) — drives urgency-based conversion | MEDIUM | |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create disproportionate complexity for a v1 platform — already correctly excluded in PROJECT.md, confirmed by research as reasonable deferrals.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Marketplace sync (Shopee/Lazada/TikTok Shop) | "We're already selling there, just sync it" | Each marketplace has its own catalog schema, inventory-reservation semantics, and rate limits; building reliable two-way sync is a project of its own and risks inventory desync — the exact failure mode the unified-inventory differentiator is trying to avoid | Defer to v2; if needed sooner, do manual/CSV export first, not live API sync |
| Full ERP/accounting/CRM integration | "We already have an accounting system" | Integration scope is unbounded (varies per ERP vendor) and not needed to validate the core B2C+B2B value prop | Build sales/debt/reporting natively in-platform for v1; revisit integration once a specific ERP is chosen |
| AI product recommendations / AI chatbot advisor | Sounds modern, low perceived effort | Requires either a trained model or a paid API dependency, plus enough behavioral data to be useful — data doesn't exist yet on a greenfield platform (cold-start problem) | Start with rule-based "related products" (same category/age-range) and manually curated bundles; revisit AI once there's usage data |
| Multi-currency checkout | Toy company does import/export, "might sell internationally" | PROJECT.md already scopes this out; multi-currency touches pricing, tax, payment gateway, and reporting everywhere | VND-only checkout; bilingual content is sufficient for v1 international visibility without transacting in foreign currency |
| Full customs-compliant auto-generated trade documents (e-signature-ready C/O, commercial invoice PDF generation matching legal templates) | "The import team needs official documents" | Legally significant documents have jurisdiction-specific formatting/compliance rules; getting this wrong has real legal/customs risk, and dedicated trade-doc SaaS (IncoDocs, Shipping Solutions) exists precisely because this is a deep specialty | Track structured metadata + let staff attach the actual signed/official PDF (produced by existing customs-broker tools or Excel); platform is a tracker/repository, not a document-of-record generator |
| Mobile barcode scanning app for warehouse staff | "Warehouse needs to scan boxes" | A dedicated scanning app is a second client application with offline/hardware considerations — real scope, not a checkbox | v1: label printing (QR/barcode) + web-based manual/keyboard-wedge scanner input (any USB/Bluetooth barcode scanner types into a normal input field — no native app needed); revisit dedicated app only if warehouse volume demands it |
| Real full-container-load (FCL) direct pre-booking by dealers | "B2B spec says container ordering" | True FCL pre-booking ties a dealer's order directly into the company's own import shipment planning (mixed SKUs, shared freight cost, customs timing) — this is materially closer to a co-import negotiation than an e-commerce checkout flow | v1: treat "container" as a large carton/case-multiple order handled via the RFQ (yêu cầu báo giá) flow with sales-rep involvement, not a self-service SKU × quantity cart flow |
| Two-factor authentication as a v1 blocker | Source spec lists "bảo mật đăng nhập và xác thực hai lớp" | Not inherently problematic, but treating it as blocking-priority for v1 delays higher-value features for marginal early-stage risk reduction, given the admin user base is small internal staff initially | Implement strong password + session hygiene at v1; add 2FA as an early v1.x hardening pass, especially before exposing broader B2B self-registration |

## Feature Dependencies

```
Multi-warehouse inventory (SKU × Warehouse)
    └──requires──> Batch/lot tracking layer
                       └──requires──> Import shipment → batch linkage
                                          └──requires──> PO/Commercial Invoice/Packing List/B-L/C-O tracking (per shipment)
                                                             └──requires──> Foreign supplier registry

Landed cost calculation (per batch)
    └──requires──> Batch/lot tracking layer
    └──requires──> Exchange rate capture per PO/shipment
    └──enhances──> Wholesale/retail pricing decisions (differentiator)

Dual pricing (retail visible B2C / wholesale visible B2B)
    └──requires──> Dealer account approval (must know viewer's tier before resolving price)
                       └──requires──> B2B registration + admin approval workflow

Tiered pricing + quantity-break discounts
    └──requires──> Dealer tier assignment (from approval workflow)
    └──enhances──> Carton/bulk ordering (carton price = unit price × carton qty, tier-resolved)

Carton/bulk ordering
    └──requires──> Packaging/carton spec per SKU (units-per-carton, carton dimensions)
    └──requires──> Dual pricing / tiered pricing

Excel/SKU bulk reorder
    └──requires──> Tiered pricing (to resolve correct price per uploading dealer)
    └──requires──> MOQ/carton-multiple validation logic

Credit limit enforcement at checkout
    └──requires──> Dealer account (approved, tiered)
    └──requires──> AR/debt balance tracking (sales/customer module)

Real-time B2C/B2B stock sync (single source of truth)
    └──requires──> Multi-warehouse inventory model
    └──conflicts-if-built-separately──> Two independent stock counters (classic overselling bug — must share one inventory ledger, not sync two)

Traceability differentiator (shipment → batch → sale)
    └──requires──> Batch/lot tracking layer
    └──requires──> Import shipment tracking

Full container pre-booking (deferred)
    └──requires──> RFQ flow (not self-service cart) if implemented at all in v1
```

### Dependency Notes

- **Batch/lot tracking requires import shipment linkage:** a batch's identity (cost basis, cert/C-O, expiry if any) originates at the point of import. Building batch tracking without the import module first means retrofitting cost/traceability data later — sequence import-module-basics before or alongside batch-tracking, not after.
- **Dual pricing requires dealer approval workflow:** the system cannot decide "show retail or wholesale price" until it knows the viewer is an approved B2B account at a specific tier. This is why account approval must land in the same phase as (or before) tiered pricing, not after.
- **Carton ordering requires carton spec data + tiered pricing both:** it's a UI/validation feature sitting on top of two other features — don't schedule it before either dependency exists.
- **Real-time stock sync conflicts with building B2C and B2B inventory as separate systems:** given PROJECT.md's explicit "same inventory" requirement, the inventory ledger must be designed as one shared table/service from the start; retrofitting a merge of two separate stock-tracking systems later is a classic rewrite trigger (see PITFALLS research for detail).
- **Landed cost enhances pricing but is not a hard blocker for launch:** a v1 could launch with manually-entered landed cost per batch (simple average) and defer the allocation-algorithm sophistication (by weight/value/volume) to v1.x once real multi-SKU shipments are being processed.

## MVP Definition

### Launch With (v1)

Minimum viable product — enough to validate that B2C and B2B can genuinely run on one shared catalog/inventory, per PROJECT.md's core value.

- [ ] Product catalog with age/category/brand/origin facets + retail/wholesale flag — the shared foundation both channels read from
- [ ] Bilingual (VI/EN) content on catalog and core pages
- [ ] B2C cart/checkout/COD + 1 payment gateway (start with one of VNPay/MoMo/ZaloPay, add others after) + order tracking
- [ ] B2B registration + manual admin approval + basic dealer tiers with a price list per tier
- [ ] Carton/unit toggle ordering with MOQ enforcement (using carton spec data on SKUs)
- [ ] RFQ (yêu cầu báo giá) flow for large/custom/container-scale requests — covers "container ordering" without building a self-service FCL flow
- [ ] Excel/SKU quick reorder for B2B
- [ ] Multi-warehouse inventory with batch/lot tracking, shared ledger between B2C and B2B (single source of truth — non-negotiable per core value)
- [ ] Basic import tracking: supplier registry, PO, and simple structured record + attachment for Commercial Invoice/Packing List/B-L/C-O per shipment, with shipment status pipeline
- [ ] Manually-entered/simple-average landed cost per batch (defer sophisticated allocation)
- [ ] Debt/credit limit field per dealer account, enforced (soft-block) at checkout
- [ ] Admin: RBAC, activity log, Excel import/export, dashboard

### Add After Validation (v1.x)

Features to add once core dual-channel flow is proven working with real users.

- [ ] Sophisticated landed-cost allocation (by weight/value/volume across multi-SKU shipments) — add once shipments are complex enough to need it
- [ ] Second/third payment gateway
- [ ] 2FA for admin/B2B accounts — add before opening B2B self-registration broadly to external dealers
- [ ] Traceability report (batch → shipment → cert) surfaced to B2B buyers as a trust feature
- [ ] Combo/bundle products, flash sales, loyalty/tier program for B2C
- [ ] Contract/hợp đồng management and assigned sales rep per dealer account
- [ ] Stock-take/kiểm kê workflow tooling (beyond basic adjustment)

### Future Consideration (v2+)

Features to defer until the core platform and dual-channel model are validated and stable — matches PROJECT.md's Out of Scope section.

- [ ] Marketplace sync (Shopee/Lazada/TikTok Shop) — defer until inventory ledger has proven itself under real B2C+B2B concurrent load; syncing a third channel before the first two are solid multiplies overselling risk
- [ ] ERP/accounting/CRM integration — defer until a specific external system is actually chosen by the business
- [ ] AI recommendations/chatbot — defer until there's behavioral data to make it useful
- [ ] Full FCL container pre-booking self-service — defer indefinitely unless RFQ-based container deals prove insufficient at scale
- [ ] Dedicated mobile app for sales staff/warehouse — defer until web-based workflows prove insufficient
- [ ] Multi-currency — out of scope per PROJECT.md
- [ ] E-invoice (hóa đơn điện tử) integration — defer per PROJECT.md

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Unified catalog with age/category facets | HIGH | MEDIUM | P1 |
| Dual pricing (retail/wholesale by viewer) | HIGH | MEDIUM | P1 |
| Dealer approval workflow | HIGH | LOW-MEDIUM | P1 |
| Tiered pricing + quantity breaks | HIGH | MEDIUM-HIGH | P1 |
| Carton/case ordering with MOQ | HIGH | MEDIUM | P1 |
| Multi-warehouse batch-tracked inventory (shared ledger) | HIGH | HIGH | P1 |
| Import shipment + document tracking (structured + attachment) | HIGH | MEDIUM-HIGH | P1 |
| Simple landed cost (average) | MEDIUM-HIGH | MEDIUM | P1 |
| Credit limit enforcement | MEDIUM-HIGH | MEDIUM-HIGH | P1 |
| Excel/SKU quick reorder | HIGH | MEDIUM | P1 |
| RFQ flow | MEDIUM | MEDIUM | P1 |
| Safety cert (QCVN/hợp quy) data on PDP | MEDIUM-HIGH | LOW-MEDIUM | P1 |
| Sophisticated landed-cost allocation | MEDIUM | HIGH | P2 |
| Traceability report to B2B buyers | MEDIUM | MEDIUM | P2 |
| 2FA | MEDIUM | LOW-MEDIUM | P2 |
| Combo/bundle, flash sale | MEDIUM | MEDIUM | P2 |
| Loyalty/tier program (B2C) | LOW-MEDIUM | MEDIUM | P3 |
| Marketplace sync | MEDIUM (business wants it) | HIGH | P3 |
| AI recommendations/chatbot | LOW (unvalidated) | HIGH | P3 |
| Full FCL self-service booking | LOW (RFQ covers it) | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor / Reference Platform Analysis

| Feature | OroCommerce / WizCommerce (generic B2B) | Zoey (B2B for toy sellers specifically) | Our Approach |
|---------|------------------------------------------|-------------------------------------------|--------------|
| Tiered/contract pricing | Price-list-per-account-group, quantity breaks, rules by account/region/order-qty | Same pattern, applied to toy wholesalers/distributors | Adopt price-list-per-tier model layered with quantity-break discounts (matches researched standard) |
| Case-pack/carton ordering | Quantity-threshold rules (pallet/case/unit) | Case packs and seasonal assortments called out as toy-industry-specific ordering mechanism | Confirms carton/case ordering as table stakes specific to toys/gifting — not just generic B2B nicety |
| Self-service B2B portal | Order history, invoices, shipment tracking, reorder without sales rep | Same | Build as separate B2B area sharing backend data, per PROJECT.md architecture decision |
| Credit/payment terms | Net 30/60, credit limit per account, automated hold on limit breach | Standard | Implement soft-block + notify pattern (order flagged, not silently rejected) for v1 |
| Import/export document handling | Not a core feature of generic B2B platforms — this is specific to import/export businesses, not standard e-commerce | Not covered — Zoey is sales-side only | This module has no direct e-commerce-platform precedent; closer to trade-documentation SaaS (IncoDocs, Shipping Solutions) scoped down to tracking + attachment rather than document generation |
| Batch/lot inventory | Present in importer-focused inventory tools (Finale, Xorosoft, Bizowie), not universal in generic e-commerce platforms | Not specifically covered | Confirms this is an importer-specific need, correctly identified in source requirements — build deliberately rather than bolt onto a generic inventory model |

## Sources

- [OroCommerce — Best B2B eCommerce Platform for Wholesale](https://oroinc.com/b2b-ecommerce/blog/best-b2b-ecommerce-platform-for-wholesale/) — MEDIUM confidence (vendor content, cross-checked against multiple other sources)
- [WizCommerce — B2B E-Commerce Platform for Distributors](https://wizcommerce.com/blog/b2b-ecommerce-software-for-distributors-guide/) — MEDIUM confidence
- [Zoey — B2B Ecommerce for Toy Sellers & Distributors](https://www.zoey.com/b2b-ecommerce-for-toy-wholesalers-distributors/) — MEDIUM confidence (toy-industry-specific vendor)
- [Portalsphere — B2B Ecommerce for Distributors](https://www.portalsphere.io/articles/b2b-ecommerce-for-distributors) — MEDIUM confidence
- [Atwix — Wholesale B2B eCommerce: Features, Benefits, Types](https://www.atwix.com/ecommerce/wholesale-ecommerce-explained/) — MEDIUM confidence
- [IncoDocs — Export Document Management Software](https://incodocs.com/export-documentation) — MEDIUM confidence (vendor content describing standard document set: commercial invoice, B/L, C/O)
- [Shipping Solutions — Export Documentation Software](https://shippingsolutionssoftware.com/) — MEDIUM confidence
- [Trade.gov — Common Export Documents](https://www.trade.gov/common-export-documents) — HIGH confidence (US government source, cross-referenced for standard document set)
- [Finale Inventory — Multi-Warehouse Inventory Management](https://www.finaleinventory.com/multi-warehouse-inventory-management) — MEDIUM confidence
- [Finale Inventory — Landed Cost Guide](https://www.finaleinventory.com/guides/landed-cost/) — MEDIUM confidence
- [Bizowie — Landed Cost Accounting for Distributors](https://bizowie.com/introduction-to-landed-cost-tracking) — MEDIUM confidence
- [CPSC.gov — Toy Safety](https://www.cpsc.gov/FAQ/Toy-Safety) — HIGH confidence (US government source, used for cross-market context, not the applicable VN regulation)
- [CPSC.gov — Age Determination Guidelines PDF](https://www.cpsc.gov/s3fs-public/2020%20Age%20Determination%20Guidelines%20FINAL.pdf) — HIGH confidence
- [thuvienphapluat.vn — QCVN 3:2019/BKHCN An toàn đồ chơi trẻ em](https://thuvienphapluat.vn/TCVN/Cong-nghiep/QCVN-3-2019-BKHCN-An-toan-do-choi-tre-em-918428.aspx) — HIGH confidence (Vietnamese legal-document repository, cross-referenced with isocert.org.vn and Hà Tĩnh DOST government page for Thông tư 09/2019/TT-BKHCN, effective Jan 1 2021)
- [isocert.org.vn — Hợp quy đồ chơi trẻ em theo QCVN 3:2019/BKHCN](https://isocert.org.vn/hop-quy-do-choi-tre-em-theo-qcvn-3-2019-bkhcn) — MEDIUM-HIGH confidence
- [Akaunting — B2B Credit Risk Management](https://akaunting.com/blog/b2b-credit-risk-management) — MEDIUM confidence
- [i95dev — Company Accounts & Approval Workflows](https://www.i95dev.com/b2b-company-accounts-workflows-approval/) — MEDIUM confidence
- [Wholesale Suite — Wholesale Credit Limits & Net Terms Approval](https://wholesalesuiteplugin.com/wholesale-credit-limits/) — LOW-MEDIUM confidence (plugin vendor, used for approval-pattern corroboration only)
- Original project requirements: `D:\Work\Work-out\kid-toy\requirements.txt.txt` — HIGH confidence (primary source, cross-validated against above)
- `D:\Work\Work-out\kid-toy\.planning\PROJECT.md` — HIGH confidence (project scope/constraints source of truth)

---
*Feature research for: Vietnamese toy import/export B2C + B2B e-commerce platform*
*Researched: 2026-09-21*
