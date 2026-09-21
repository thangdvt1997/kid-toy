# Roadmap: Kid Toy Import-Export Platform

## Overview

This roadmap delivers a shared-backend, dual-channel commerce platform for a Vietnamese toy import/export company. The build order front-loads the two things every later phase depends on — authenticated identity with viewer-aware pricing (Phase 1) and a single batch-tracked inventory ledger (Phase 2) — because retrofitting either after B2C or B2B ordering exists is a high-cost migration. Once that shared foundation exists, B2C retail purchasing (Phase 3) and B2B dealer purchasing (Phase 4) are built as two independent phases with no dependency on each other, so they can be planned and executed in parallel — honoring the project's explicit requirement that B2C and B2B launch side by side rather than one after the other. Import/export and landed-cost tracking (Phase 5) can likewise proceed in parallel with Phase 3/4 once inventory exists, since batch identity originates at import. The journey closes with cross-channel operations — unified sales/customer/reporting views (Phase 6) — and an admin console, content/marketing tools, and bilingual polish (Phase 7) once real transactional data exists to report on.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation — Auth, Bilingual Catalog & Pricing** - Users of every type can authenticate correctly and browse a bilingual, viewer-priced product catalog
- [ ] **Phase 2: Multi-Warehouse Batch-Tracked Inventory Core** - Admin manages one shared, atomic stock ledger across warehouses and batches, ready for both channels
- [ ] **Phase 3: B2C Storefront — Retail Purchasing** - Retail customers can browse, buy, pay, and track orders end to end
- [ ] **Phase 4: B2B Dealer Portal — Wholesale Purchasing** - Approved dealers can register, see tiered pricing, and place bulk/carton orders within their credit limit
- [ ] **Phase 5: Import/Export & Landed Cost** - Admin tracks a shipment from foreign supplier through customs into a cost-accurate, traceable inventory batch
- [ ] **Phase 6: Sales, Customers & Reporting** - Admin has one unified view of orders, invoices, debt, customer profiles, and revenue across both channels
- [ ] **Phase 7: Admin Console, Content & Marketing, i18n Polish** - Admin has a governed control center with audit logging, Excel import/export, and basic content/marketing tools

## Phase Details

### Phase 1: Foundation — Auth, Bilingual Catalog & Pricing
**Goal**: Every user type (staff, retail customer, business applicant) can authenticate with the right access level, and a fully-attributed bilingual product catalog exists with server-resolved, viewer-aware pricing — the schema every later phase builds on.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, CATALOG-01, CATALOG-02, CATALOG-03, CATALOG-04, CATALOG-05, CATALOG-06, CATALOG-07, CATALOG-08, CATALOG-09
**Success Criteria** (what must be TRUE):
  1. Admin/staff can log in with email+password, stay logged in across a browser refresh, and only see actions permitted by their assigned role (super admin, sales, warehouse, content)
  2. Retail customer can register, log in with email/password, and reset a forgotten password via an emailed link
  3. A business can submit a B2B registration with tax ID/business license and a business type (cửa hàng/trường học/nhà phân phối)
  4. Admin can create a product with age-range, category, brand, origin, and gender facets; attach multiple images/video; set SKU/barcode per variant; record safety-certification info; and set carton/packaging spec — all viewable in both Vietnamese and English
  5. The same SKU shows retail price and a stock-status indicator to an anonymous/retail viewer, and shows tier-resolved wholesale price instead to an approved B2B viewer, and customers can filter the catalog by age range, category, brand, and origin
**Plans**: TBD

### Phase 2: Multi-Warehouse Batch-Tracked Inventory Core
**Goal**: Admin manages accurate stock across multiple warehouses at SKU × Warehouse × Batch/lot granularity through one shared, atomically-reserved ledger — so neither channel built on top of it can oversell the other.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: INV-01, INV-02, INV-03, INV-04, INV-05, INV-06, INV-07, INV-08
**Success Criteria** (what must be TRUE):
  1. Admin can view and manage stock levels per SKU across multiple warehouse locations
  2. Admin can record a stock in/out/transfer between warehouses and see balances update immediately
  3. Stock is tracked at SKU × Warehouse × Batch/lot granularity, and concurrent reservation attempts against the same batch are decremented atomically with no oversell
  4. Admin receives a low-stock alert when a SKU crosses its reorder threshold, and can generate/print a barcode/QR label for a given SKU/batch
  5. Admin can reconcile a stock-take/physical count and flag defective or returned goods as a distinct, non-sellable inventory state
**Plans**: TBD

### Phase 3: B2C Storefront — Retail Purchasing
**Goal**: A retail customer can find an age-appropriate toy, add it to cart, check out with COD or online payment, and track the resulting order — a complete, independently shippable retail buying journey.
**Mode:** mvp
**Depends on**: Phase 1, Phase 2
**Requirements**: B2C-01, B2C-02, B2C-03, B2C-04, B2C-05, B2C-06, B2C-07
**Success Criteria** (what must be TRUE):
  1. Customer can add products to a cart and adjust quantities, reflecting live retail price and stock
  2. Customer can check out with cash-on-delivery or with the VNPay online payment gateway, and an order is only marked paid from a verified server-to-server payment confirmation — never from the browser return page alone
  3. Checkout calculates and displays a shipping fee before payment
  4. Customer can track their order's status after placing it and can view their full purchase history
  5. Customer can submit a product review/rating after a completed purchase
**Plans**: TBD
**UI hint**: yes

### Phase 4: B2B Dealer Portal — Wholesale Purchasing
**Goal**: A business can apply for a dealer account, get approved onto a pricing tier, and place bulk orders — in carton multiples, via RFQ, or via Excel reorder — against their own credit limit. Built independently of Phase 3 so both channels launch together.
**Mode:** mvp
**Depends on**: Phase 1, Phase 2
**Requirements**: B2B-01, B2B-02, B2B-03, B2B-04, B2B-05, B2B-06, B2B-07, B2B-08, B2B-09, B2B-10
**Success Criteria** (what must be TRUE):
  1. A submitted dealer registration application (with proof documents) can be reviewed and approved or rejected with a reason by admin, then assigned to a pricing tier
  2. An approved dealer sees their tier-resolved wholesale price list instead of retail pricing, with quantity-break volume discounts applied automatically on top of tier price
  3. Dealer can toggle between unit and carton/case ordering, with MOQ enforced at the cart
  4. Dealer can submit an RFQ for a large/custom order and receive a sales-staff quote convertible into an order, and can bulk-reorder via a SKU list or Excel upload validated against MOQ/carton multiples at their tier price
  5. Dealer has a self-service portal showing order history, invoices, and debt/credit status; an order that would exceed the dealer's credit limit is soft-blocked and flagged rather than silently accepted
**Plans**: TBD
**UI hint**: yes

### Phase 5: Import/Export & Landed Cost
**Goal**: Admin can track a shipment from a foreign supplier through customs clearance into a received, cost-accurate, traceable inventory batch.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: IMPORT-01, IMPORT-02, IMPORT-03, IMPORT-04, IMPORT-05, IMPORT-06, IMPORT-07
**Success Criteria** (what must be TRUE):
  1. Admin can register a foreign supplier (name, country, port of origin, contact, contract terms) and create a Purchase Order linked to that supplier
  2. Admin can record Commercial Invoice, Packing List, Bill of Lading, and C/O as structured records with file attachments, linked to a shipment
  3. Admin can track a shipment through its status pipeline (ordered → shipped → in transit → customs clearance → received) and capture the exchange rate used per PO/shipment
  4. A received shipment creates/links inventory batch records with a computed landed cost (product cost + freight + duty/tax, simple-average allocation), traceable back to its shipment/PO
**Plans**: TBD

### Phase 6: Sales, Customers & Reporting
**Goal**: Admin has one unified operational view of orders, invoicing, payment/debt status, customer relationships, and revenue across both retail and wholesale channels.
**Mode:** mvp
**Depends on**: Phase 3, Phase 4, Phase 5
**Requirements**: SALES-01, SALES-02, SALES-03, SALES-04, SALES-05, CUST-01, CUST-02, CUST-03
**Success Criteria** (what must be TRUE):
  1. Admin can view and manage retail and wholesale orders together in one place, with a sales invoice generated for each order
  2. Admin can track payment status per order and view a customer's debt/AR balance
  3. Admin can view revenue/sales reports broken down by product, customer, and dealer
  4. Admin can view a retail customer's profile and purchase history, and a business/dealer's profile with tier, credit limit, and debt status
  5. Admin can group/segment customers
**Plans**: TBD

### Phase 7: Admin Console, Content & Marketing, i18n Polish
**Goal**: Admin operates from a governed, auditable control center, can move product/order data in bulk via Excel, and can run basic bilingual content/marketing campaigns.
**Mode:** mvp
**Depends on**: Phase 1, Phase 6
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, CONTENT-01, CONTENT-02, CONTENT-03, CONTENT-04
**Success Criteria** (what must be TRUE):
  1. Admin dashboard shows an overview of orders, revenue, and inventory alerts, available in Vietnamese and English
  2. Key admin actions are recorded in an activity/audit log
  3. Admin can import/export product and order data via Excel
  4. Admin can publish news/blog articles, manage homepage banners, create a time-limited flash-sale campaign, and create a combo/bundle product
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → (3 and 4 in parallel) → 5 (parallel with 3/4 once Phase 2 is done) → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation — Auth, Bilingual Catalog & Pricing | 0/TBD | Not started | - |
| 2. Multi-Warehouse Batch-Tracked Inventory Core | 0/TBD | Not started | - |
| 3. B2C Storefront — Retail Purchasing | 0/TBD | Not started | - |
| 4. B2B Dealer Portal — Wholesale Purchasing | 0/TBD | Not started | - |
| 5. Import/Export & Landed Cost | 0/TBD | Not started | - |
| 6. Sales, Customers & Reporting | 0/TBD | Not started | - |
| 7. Admin Console, Content & Marketing, i18n Polish | 0/TBD | Not started | - |
