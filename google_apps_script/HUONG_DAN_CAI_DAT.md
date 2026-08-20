# Hướng Dẫn Kích Hoạt Tự Động Hóa Google Apps Script (Email: maiduc2311@gmail.com)

Hướng dẫn này giúp bạn kết nối hộp thư `maiduc2311@gmail.com` với hệ thống CRM Fanpage chỉ trong 3 phút.

---

## 🛠️ Bước 1: Mở Google Apps Script

1. Đăng nhập vào trình duyệt bằng tài khoản **`maiduc2311@gmail.com`**.
2. Truy cập vào đường link: [https://script.google.com/home/start](https://script.google.com/home/start)
3. Bấm nút **"+ Dự án mới" (New project)** ở góc trên bên trái.
4. Đổi tên dự án từ "Dự án không có tiêu đề" thành **`Fanpage Karma CRM Sync`**.

---

## 💻 Bước 2: Dán mã nguồn

1. Mở file [fanpage_karma_sync.gs](file:///Users/maivanduc/.gemini/antigravity/CRM%20fanpage/google_apps_script/fanpage_karma_sync.gs).
2. Xóa toàn bộ nội dung mặc định trong cửa sổ `Mã.gs` (Code.gs) của Google Apps Script.
3. Dán toàn bộ nội dung của file `fanpage_karma_sync.gs` vào.
4. Cập nhật biến `CRM_WEBHOOK_URL`:
   - Nếu bạn chạy CRM trên máy tính nội bộ và muốn public ra Internet: Sử dụng **Ngrok** hoặc **Cloudflare Tunnel** (ví dụ: `https://your-domain.ngrok-free.app/api/webhook/fanpagekarma`).
   - Nếu CRM được deploy lên VPS/Cloud: Điền URL domain của CRM.
5. Bấm biểu tượng **💾 Lưu dự án (Save)** hoặc nhấn `Ctrl + S` (`Cmd + S` trên Mac).

---

## 🧪 Bước 3: Chạy thử kiểm tra kết nối (Test)

1. Ở thanh công cụ trên cùng, tại ô chọn hàm thực thi, chọn **`testSendSampleData`**.
2. Bấm nút **▶ Chạy (Run)**.
3. Lần đầu tiên chạy, Google sẽ hỏi cấp quyền truy cập:
   - Bấm **Xem xét quyền (Review permissions)**.
   - Chọn tài khoản `maiduc2311@gmail.com`.
   - Bấm **Nâng cao (Advanced)** ➔ Chọn **Đi tới Fanpage Karma CRM Sync (không an toàn)**.
   - Bấm **Cho phép (Allow)**.
4. Nhìn vào khung **Nhật ký thực thi (Execution log)** ở dưới:
   - Khi thấy thông báo `✅ TEST THÀNH CÔNG!`, bạn mở trang CRM lên sẽ thấy dữ liệu mẫu đã xuất hiện tức thì.

---

## ⏰ Bước 4: Cài đặt lịch chạy tự động hàng ngày (Scheduled Trigger)

1. Tại ô chọn hàm thực thi, chọn hàm **`createDailyTrigger`**.
2. Bấm **▶ Chạy (Run)**.
3. Thông báo xuất hiện: `⏰ Đã cài đặt lịch tự động quét email mỗi ngày vào 7h sáng!`
4. Hoàn tất! Từ bây giờ, mỗi khi Fanpage Karma gửi email báo cáo về `maiduc2311@gmail.com`, hệ thống sẽ tự động bóc tách số liệu Views, Posts/day và nạp thẳng vào CRM.

---

## 🔍 Kiểm tra lịch sử Webhook trên CRM
- Bạn có thể vào tab **⚙️ Cài đặt & Webhook** trên giao diện CRM để xem nhật ký các lần Google Apps Script đẩy dữ liệu về (thời gian, số dòng, trạng thái thành công/thất bại).
