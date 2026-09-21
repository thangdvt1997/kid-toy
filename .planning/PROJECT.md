# Kid Toy Import-Export Platform

## What This Is

Nền tảng thương mại điện tử cho một công ty xuất nhập khẩu, bán sỉ và bán lẻ đồ chơi trẻ em. Gồm hai khu vực dùng chung dữ liệu: website B2C bán lẻ cho người tiêu dùng, và cổng B2B bán sỉ cho đại lý/cửa hàng/trường học/nhà phân phối, cùng một backend quản trị dùng chung (sản phẩm, kho, đơn hàng, khách hàng, xuất nhập khẩu).

## Core Value

Người mua lẻ có thể tìm và mua được đồ chơi phù hợp độ tuổi qua website, và đại lý có thể đăng ký tài khoản B2B, xem bảng giá sỉ riêng và đặt hàng số lượng lớn — cả hai luồng chạy trên cùng một catalog sản phẩm và tồn kho chính xác.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Trang giới thiệu doanh nghiệp (công ty, năng lực nhập khẩu, kho/đại lý, giấy phép, chính sách chất lượng)
- [ ] Danh mục sản phẩm với phân loại đầy đủ (độ tuổi, giới tính, danh mục, thương hiệu, xuất xứ, hàng sỉ/lẻ) và thông tin chi tiết từng SKU (ảnh, video, mã vạch, kích thước, tồn kho, giá lẻ/giá sỉ)
- [ ] B2C: giỏ hàng, checkout, thanh toán COD + cổng thanh toán nội địa (VNPay/MoMo/ZaloPay), tính phí vận chuyển, theo dõi đơn hàng, lịch sử mua, đánh giá sản phẩm
- [ ] B2B: đăng ký & duyệt tài khoản đại lý, bảng giá riêng theo cấp đại lý, chiết khấu theo số lượng, đặt hàng theo thùng/kiện, yêu cầu báo giá, đặt hàng nhanh bằng SKU/Excel
- [ ] Quản lý xuất nhập khẩu: nhà cung cấp nước ngoài, PO, commercial invoice, packing list, bill of lading, C/O, trạng thái thông quan, giá vốn sau nhập khẩu
- [ ] Quản lý kho: đa kho, nhập/xuất/chuyển kho, tồn kho theo SKU và theo lô, cảnh báo sắp hết hàng, in mã vạch/QR
- [ ] Quản lý bán hàng: đơn bán lẻ/bán sỉ, hóa đơn, trạng thái thanh toán, công nợ khách hàng, báo cáo doanh thu
- [ ] Quản lý khách hàng: hồ sơ khách lẻ và doanh nghiệp/đại lý, phân nhóm, hạn mức công nợ
- [ ] Quản trị hệ thống: dashboard, RBAC theo vai trò, nhật ký thao tác, import/export Excel, đa ngôn ngữ (Việt/Anh)
- [ ] Nội dung & marketing cơ bản: tin tức/bài viết, banner, flash sale, combo sản phẩm, SEO cơ bản

### Out of Scope

- Crawl/sao chép dữ liệu sản phẩm từ Shopee/Lazada/TikTok Shop hoặc website đối thủ — rủi ro bản quyền cho một site thương mại cạnh tranh; dùng seed data giả lập cho dev, dữ liệu thật do công ty nhập sau
- Đồng bộ Shopee/Lazada/TikTok Shop, ERP/CRM/kế toán, chatbot AI, ứng dụng nhân viên bán hàng riêng, AI gợi ý sản phẩm, BI nâng cao — thuộc "phần mở rộng" trong spec gốc, để v2+ sau khi core platform chạy ổn
- Đa tiền tệ (multi-currency) ngoài VNĐ — chưa cần ở v1, chỉ song ngữ Việt/Anh cho nội dung
- Hóa đơn điện tử, quét mã vạch bằng điện thoại, tích hợp CRM/ERP ngoài — để giai đoạn sau

## Context

- Nguồn yêu cầu gốc: `requirements.txt.txt` (liệt kê 10 nhóm chức năng + phần mở rộng cho một nền tảng xuất nhập khẩu/bán sỉ/bán lẻ đồ chơi trẻ em); đã tóm tắt trong `DEV_PROMPT.md`.
- Repo git local tại `D:\Work\Work-out\kid-toy`, chưa có commit/remote trước khi khởi tạo GSD.
- Deploy target duy nhất: VPS Docker tại `69.197.177.130`, thư mục `/root/test/kid-toy`. Thông tin xác thực SSH nằm trong `.env.deploy` (gitignored) — không đưa vào bất kỳ file planning/commit nào.
- Dữ liệu sản phẩm ban đầu là seed data giả lập (AI sinh, hợp lý theo ngành đồ chơi), không crawl từ nền tảng khác.

## Constraints

- **Tech stack**: Node.js (NestJS) backend + Next.js frontend + PostgreSQL — do người dùng chọn, ưu tiên TypeScript toàn bộ và dev nhanh
- **Deploy**: phải chạy được dạng container hoá gọn (docker compose) trên một VPS duy nhất, không tách microservices ngay từ đầu
- **Thanh toán v1**: COD + cổng thanh toán nội địa (VNPay/MoMo/ZaloPay) — không cần thanh toán quốc tế ở v1
- **Ngôn ngữ**: song ngữ Việt/Anh ngay từ v1; không cần đa tiền tệ
- **Ưu tiên roadmap**: B2C và B2B triển khai song song ngay từ MVP đầu tiên (không làm B2C xong mới tới B2B)
- **Bảo mật**: không lưu mật khẩu/SSH key/secrets trong repo hay planning docs — chỉ trong `.env.deploy` (gitignored) hoặc biến môi trường CI

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Stack: NestJS + Next.js + PostgreSQL | TypeScript toàn bộ, hệ sinh thái e-commerce mạnh, dễ tuyển dev VN, đóng gói Docker gọn cho VPS đơn | — Pending |
| B2C và B2B triển khai song song | Cả hai là nguồn giá trị cốt lõi ngay từ đầu theo yêu cầu người dùng | — Pending |
| Thanh toán v1: COD + VNPay/MoMo/ZaloPay | Đáp ứng cả khách lẻ (COD phổ biến) và cần cổng thanh toán online ngay | — Pending |
| Song ngữ Việt/Anh từ v1, không đa tiền tệ | Có nhu cầu khách quốc tế nhưng chưa cần đa tiền tệ | — Pending |
| Không crawl dữ liệu đối thủ | Rủi ro bản quyền/pháp lý cho site thương mại cạnh tranh; seed data giả lập thay thế | ✓ Good |
| Deploy Docker trên 1 VPS (69.197.177.130) | Ngân sách hạ tầng đơn giản, đủ cho giai đoạn đầu | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-21 after initialization*
