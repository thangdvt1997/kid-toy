# Requirements: Kid Toy Import-Export Platform

**Defined:** 2026-09-21
**Core Value:** Người mua lẻ có thể tìm và mua được đồ chơi phù hợp độ tuổi qua website, và đại lý có thể đăng ký tài khoản B2B, xem bảng giá sỉ riêng và đặt hàng số lượng lớn — cả hai luồng chạy trên cùng một catalog sản phẩm và tồn kho chính xác.

## v1 Requirements

### Authentication & Access (AUTH)

- [ ] **AUTH-01**: Admin/staff can log in with email+password; session persists across refresh
- [ ] **AUTH-02**: Retail customer can register and log in with email/password
- [ ] **AUTH-03**: Business can register a B2B account with business license/mã số thuế and business type (cửa hàng/trường học/nhà phân phối)
- [ ] **AUTH-04**: System enforces role-based access control across distinct staff roles (super admin, sales, warehouse, content)
- [ ] **AUTH-05**: User can reset password via email link

### Product Catalog (CATALOG)

- [ ] **CATALOG-01**: Admin can create/edit product with age-range, category, brand, origin, gender facets
- [ ] **CATALOG-02**: Admin can attach multiple images and video per product
- [ ] **CATALOG-03**: Admin can set SKU and barcode per product variant
- [ ] **CATALOG-04**: Admin can record safety certification info (QCVN "hợp quy" cert number, issuing body, validity date) per SKU/batch
- [ ] **CATALOG-05**: Admin can set packaging/carton spec per SKU (units per inner box, units per master carton, carton dimensions/weight)
- [ ] **CATALOG-06**: System resolves retail price for B2C viewers and tier-based wholesale price for approved B2B viewers, based on viewer identity
- [ ] **CATALOG-07**: Customer can browse and filter catalog by age range, category, brand, origin
- [ ] **CATALOG-08**: Product page shows a stock-status indicator (in stock / low stock / out of stock)
- [ ] **CATALOG-09**: Catalog and core site content available in Vietnamese and English

### B2C Retail (B2C)

- [ ] **B2C-01**: Customer can add products to cart and adjust quantity
- [ ] **B2C-02**: Customer can check out with cash-on-delivery (COD)
- [ ] **B2C-03**: Customer can check out with an online payment gateway (VNPay for v1; MoMo/ZaloPay added after)
- [ ] **B2C-04**: System calculates shipping fee at checkout
- [ ] **B2C-05**: Customer can track order status after placing an order
- [ ] **B2C-06**: Customer can view their purchase history
- [ ] **B2C-07**: Customer can submit a product review/rating after purchase

### B2B Wholesale & Dealers (B2B)

- [ ] **B2B-01**: Business can submit a dealer registration application with proof documents
- [ ] **B2B-02**: Admin can review and approve/reject a dealer application with a reason
- [ ] **B2B-03**: Admin can assign an approved dealer to a pricing tier
- [ ] **B2B-04**: Approved dealer sees their tier-resolved wholesale price list instead of retail pricing
- [ ] **B2B-05**: System applies quantity-break volume discounts on top of tier price
- [ ] **B2B-06**: Dealer can order in carton/case multiples (toggle units vs. carton) with MOQ enforced at cart
- [ ] **B2B-07**: Dealer can submit a request-for-quote (RFQ/báo giá) for large or custom-scale orders; sales staff responds with a quote convertible to an order
- [ ] **B2B-08**: Dealer can bulk-reorder via SKU list or Excel upload, validated against MOQ/carton multiples and resolved at their tier price
- [ ] **B2B-09**: Dealer has a self-service portal with order history, invoices, and debt/credit status
- [ ] **B2B-10**: System soft-blocks and flags orders that would exceed a dealer's credit limit

### Inventory & Warehouse (INV)

- [ ] **INV-01**: Admin can manage multiple warehouse locations with per-warehouse stock levels
- [ ] **INV-02**: Admin can record stock in/out/transfer between warehouses
- [ ] **INV-03**: System tracks inventory at SKU × Warehouse × Batch/lot granularity
- [ ] **INV-04**: System reserves/decrements one shared inventory ledger atomically at checkout for both B2C and B2B (no oversell across channels)
- [ ] **INV-05**: Admin receives a low-stock alert when stock crosses a reorder threshold
- [ ] **INV-06**: Admin can generate and print barcode/QR labels per SKU/batch
- [ ] **INV-07**: Admin can record a stock-take/physical count reconciliation
- [ ] **INV-08**: Admin can flag defective/returned goods as a distinct, non-sellable inventory state

### Import/Export Management (IMPORT)

- [ ] **IMPORT-01**: Admin can manage a foreign supplier registry (name, country, port of origin, contact, contract terms)
- [ ] **IMPORT-02**: Admin can create a Purchase Order (PO) linked to a supplier
- [ ] **IMPORT-03**: Admin can record Commercial Invoice, Packing List, Bill of Lading, and C/O as structured records (key fields) with file attachment, linked to a shipment
- [ ] **IMPORT-04**: Admin can track shipment status through a pipeline (ordered → shipped → in transit → customs clearance → received into warehouse)
- [ ] **IMPORT-05**: Admin can capture the exchange rate per PO/shipment at time of transaction
- [ ] **IMPORT-06**: System calculates landed cost per batch (product cost + freight + duty/tax, simple-average allocation for v1)
- [ ] **IMPORT-07**: A received shipment creates/links inventory batch records so a batch is traceable back to its shipment/PO

### Sales & Reporting (SALES)

- [ ] **SALES-01**: Admin can view and manage retail and wholesale orders in one place
- [ ] **SALES-02**: System generates a sales invoice for each order
- [ ] **SALES-03**: Admin can track payment status per order
- [ ] **SALES-04**: Admin can view customer debt/AR balance
- [ ] **SALES-05**: Admin can view revenue/sales reports by product, customer, and dealer

### Customer Management (CUST)

- [ ] **CUST-01**: Admin can view retail customer profiles and purchase history
- [ ] **CUST-02**: Admin can view business/dealer profiles with tier, credit limit, and debt status
- [ ] **CUST-03**: Admin can group/segment customers

### System Administration (ADMIN)

- [ ] **ADMIN-01**: Admin dashboard shows an overview of orders, revenue, and inventory alerts
- [ ] **ADMIN-02**: System logs key admin actions (activity/audit log)
- [ ] **ADMIN-03**: Admin can import/export product and order data via Excel
- [ ] **ADMIN-04**: Admin interface available in Vietnamese and English

### Content & Marketing (CONTENT)

- [ ] **CONTENT-01**: Admin can publish news/blog articles
- [ ] **CONTENT-02**: Admin can manage homepage banners
- [ ] **CONTENT-03**: Admin can create flash-sale campaigns with time-limited pricing
- [ ] **CONTENT-04**: Admin can create combo/bundle products

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Pricing & Inventory

- **PRICE-01**: Sophisticated landed-cost allocation by weight/value/volume across multi-SKU shipments
- **INV-09**: Traceability report (batch → shipment → cert) surfaced to B2B buyers as a trust feature

### Payments & Security

- **PAY-01**: Second/third online payment gateway (MoMo, ZaloPay)
- **AUTH-06**: Two-factor authentication for admin/B2B accounts

### B2B

- **B2B-11**: Contract/hợp đồng management and assigned sales rep per dealer account

### Marketing

- **CONTENT-05**: Loyalty/membership tier program for B2C customers
- **CONTENT-06**: Affiliate/referral program

### Operations

- **INV-10**: Dedicated stock-take/kiểm kê workflow tooling beyond basic adjustment

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Crawl/copy product data from Shopee/Lazada/TikTok Shop or competitor sites | Copyright/legal risk for a competing commercial site — use seed data for dev, real data entered by the company later |
| Marketplace sync (Shopee/Lazada/TikTok Shop) | Each marketplace has its own schema/inventory semantics; risks the exact oversell failure mode the unified-inventory core value is meant to avoid — defer until the internal ledger is proven |
| Full ERP/accounting/CRM integration | Unbounded integration scope, not needed to validate core B2C+B2B value prop |
| AI product recommendations / AI chatbot | Cold-start problem on a greenfield platform with no behavioral data yet |
| Multi-currency checkout | VNĐ-only per project scope; bilingual content covers international visibility without foreign-currency transactions |
| Full customs-compliant auto-generated trade documents (e-signature-ready C/O, legally formatted invoices) | Jurisdiction-specific legal/compliance risk; platform tracks structured metadata + staff-attached official PDFs instead of generating documents of record |
| Mobile barcode-scanning app for warehouse staff | Real second-client scope; v1 uses label printing + keyboard-wedge USB/Bluetooth scanner input into normal web forms |
| Full container (FCL) self-service pre-booking by dealers | Closer to co-import negotiation than checkout; v1 routes container-scale requests through the RFQ flow with sales-rep involvement |
| E-invoice (hóa đơn điện tử) integration | Deferred per project scope |

## Traceability

Populated during roadmap creation (`/gsd:new-project`). See `.planning/ROADMAP.md` for full phase details.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 1 | Pending |
| AUTH-04 | Phase 1 | Pending |
| AUTH-05 | Phase 1 | Pending |
| CATALOG-01 | Phase 1 | Pending |
| CATALOG-02 | Phase 1 | Pending |
| CATALOG-03 | Phase 1 | Pending |
| CATALOG-04 | Phase 1 | Pending |
| CATALOG-05 | Phase 1 | Pending |
| CATALOG-06 | Phase 1 | Pending |
| CATALOG-07 | Phase 1 | Pending |
| CATALOG-08 | Phase 1 | Pending |
| CATALOG-09 | Phase 1 | Pending |
| INV-01 | Phase 2 | Pending |
| INV-02 | Phase 2 | Pending |
| INV-03 | Phase 2 | Pending |
| INV-04 | Phase 2 | Pending |
| INV-05 | Phase 2 | Pending |
| INV-06 | Phase 2 | Pending |
| INV-07 | Phase 2 | Pending |
| INV-08 | Phase 2 | Pending |
| B2C-01 | Phase 3 | Pending |
| B2C-02 | Phase 3 | Pending |
| B2C-03 | Phase 3 | Pending |
| B2C-04 | Phase 3 | Pending |
| B2C-05 | Phase 3 | Pending |
| B2C-06 | Phase 3 | Pending |
| B2C-07 | Phase 3 | Pending |
| B2B-01 | Phase 4 | Pending |
| B2B-02 | Phase 4 | Pending |
| B2B-03 | Phase 4 | Pending |
| B2B-04 | Phase 4 | Pending |
| B2B-05 | Phase 4 | Pending |
| B2B-06 | Phase 4 | Pending |
| B2B-07 | Phase 4 | Pending |
| B2B-08 | Phase 4 | Pending |
| B2B-09 | Phase 4 | Pending |
| B2B-10 | Phase 4 | Pending |
| IMPORT-01 | Phase 5 | Pending |
| IMPORT-02 | Phase 5 | Pending |
| IMPORT-03 | Phase 5 | Pending |
| IMPORT-04 | Phase 5 | Pending |
| IMPORT-05 | Phase 5 | Pending |
| IMPORT-06 | Phase 5 | Pending |
| IMPORT-07 | Phase 5 | Pending |
| SALES-01 | Phase 6 | Pending |
| SALES-02 | Phase 6 | Pending |
| SALES-03 | Phase 6 | Pending |
| SALES-04 | Phase 6 | Pending |
| SALES-05 | Phase 6 | Pending |
| CUST-01 | Phase 6 | Pending |
| CUST-02 | Phase 6 | Pending |
| CUST-03 | Phase 6 | Pending |
| ADMIN-01 | Phase 7 | Pending |
| ADMIN-02 | Phase 7 | Pending |
| ADMIN-03 | Phase 7 | Pending |
| ADMIN-04 | Phase 7 | Pending |
| CONTENT-01 | Phase 7 | Pending |
| CONTENT-02 | Phase 7 | Pending |
| CONTENT-03 | Phase 7 | Pending |
| CONTENT-04 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 62 total
- Mapped to phases: 62/62
- Unmapped: 0

---
*Requirements defined: 2026-09-21*
*Last updated: 2026-09-21 after roadmap creation — all 62 v1 requirements mapped to 7 phases in `.planning/ROADMAP.md`*
