# Prompt khởi động dự án: Website xuất nhập khẩu & bán sỉ/lẻ đồ chơi trẻ em

> Dùng prompt này để bắt đầu một phiên code dev mới (Claude Code, hoặc agent khác).
> Nguồn yêu cầu gốc: [requirements.txt.txt](requirements.txt.txt).

---

## Bối cảnh

Xây dựng nền tảng thương mại điện tử cho công ty xuất nhập khẩu, bán sỉ và bán lẻ đồ chơi trẻ em. Hệ thống chia làm hai khu vực dùng chung dữ liệu (sản phẩm, kho, đơn hàng, khách hàng):

- **Website B2C** — bán lẻ cho người tiêu dùng.
- **Cổng B2B** — bán sỉ cho đại lý, cửa hàng, trường học, nhà phân phối (cần duyệt tài khoản, bảng giá riêng theo cấp, đặt hàng theo thùng/kiện/container).
- **Backend quản trị** dùng chung: sản phẩm & danh mục, kho, đơn hàng, khách hàng, xuất nhập khẩu, bán hàng, marketing, phân quyền.

Toàn bộ danh sách tính năng chi tiết (10 nhóm chức năng + phần mở rộng) nằm trong `requirements.txt.txt` — coi đó là spec nguồn, không lặp lại ở đây.

## Việc cần làm

1. **Đề xuất kiến trúc & tech stack**, tối ưu để deploy bằng **Docker** trên **một VPS duy nhất** (`69.197.177.130`, thư mục deploy `/root/test/kid-toy`; thông tin xác thực nằm ở `.env.deploy` local, không commit). Ưu tiên stack đóng gói được thành vài container gọn nhẹ (vd. 1 backend + 1 DB + 1 reverse proxy, qua `docker compose`) thay vì tách microservices ngay từ đầu.
2. **Chia roadmap theo giai đoạn (phase)** thay vì làm toàn bộ spec một lần — vì phạm vi rất lớn (10+ module). Đề xuất một lộ trình MVP hợp lý, ví dụ:
   - Phase 0: hạ tầng nền (auth, RBAC cơ bản, schema sản phẩm/kho/khách hàng, CI/CD tới VPS trên).
   - Phase 1: catalog sản phẩm + B2C mua hàng cơ bản (giỏ hàng, checkout, thanh toán, theo dõi đơn).
   - Phase 2: cổng B2B (đăng ký đại lý, bảng giá theo cấp, đặt hàng số lượng lớn, công nợ).
   - Phase 3: quản lý xuất nhập khẩu (PO, invoice, packing list, C/O, thông quan, giá vốn).
   - Phase 4: kho nâng cao (đa kho, theo lô, cảnh báo tồn, barcode/QR).
   - Phase 5: CRM, marketing, báo cáo BI, tích hợp mở rộng (vận chuyển, cổng thanh toán, sàn TMĐT, ERP/CRM, chatbot...).
   (Điều chỉnh lại nếu có ưu tiên kinh doanh khác — ví dụ B2B sỉ là nguồn doanh thu chính thì đẩy Phase 2 lên trước Phase 1.)
3. **Xác nhận các quyết định còn mở** trước khi code:
   - Ngôn ngữ/framework backend & frontend ưa thích của team (nếu có), hay để tự đề xuất.
   - Cổng thanh toán nội địa nào cần hỗ trợ trước (COD trước, hay cần VNPay/MoMo/ZaloPay ngay từ MVP).
   - Đơn vị vận chuyển tích hợp trước (GHN, GHTK, Viettel Post...).
   - Có cần đa ngôn ngữ/đa tiền tệ ngay từ đầu hay để sau (spec liệt kê nhưng có thể là "nice-to-have" giai đoạn sau).
4. **Thiết lập pipeline build/test/deploy** dạng Docker, nhắm tới VPS `69.197.177.130`, thư mục `/root/test/kid-toy` — repo Git local hiện chưa có remote và chưa có commit nào; cần khởi tạo remote (GitHub/GitLab...) và commit đầu tiên trước khi dựng CI/CD. Đọc thông tin kết nối từ `.env.deploy` (đã gitignore), không hardcode secrets vào Dockerfile/compose/CI config.

## Ràng buộc

- Không commit `.env.deploy` hay bất kỳ mật khẩu/SSH key nào vào repo hoặc CI logs. Khuyến nghị chuyển sang xác thực bằng SSH key thay vì mật khẩu ngay khi bắt đầu dựng CI/CD.
- Giữ backend admin dùng chung dữ liệu cho cả hai khu vực B2C/B2B, tránh trùng lặp schema sản phẩm/kho/khách hàng.
- Thiết kế module hoá theo từng nhóm chức năng trong `requirements.txt.txt` để có thể triển khai tăng dần theo phase mà không phải viết lại nền tảng.

## Output mong muốn của phiên dev tiếp theo

- Một tài liệu kiến trúc/roadmap ngắn gọn (hoặc chạy `/gsd:new-project` nếu dùng bộ công cụ GSD đã cài) trước khi viết code.
- Scaffold dự án ban đầu theo Phase 0 ở trên.
- File cấu hình CI/CD trỏ tới VPS deploy target.
