---
description: Tự động commit và push code lên GitHub sau mỗi lần chỉnh sửa
---

# Quy tắc Tự động đồng bộ GitHub (Auto Git Sync)

Mỗi khi hoàn thành bất kỳ chỉnh sửa nào trên website (mã nguồn, giao diện, tính năng, cấu hình...):
1. Kiểm tra trạng thái Git (`git status`).
2. Tự động thêm các file thay đổi (`git add .`).
3. Tạo commit với nội dung mô tả rõ ràng, ngắn gọn về thay đổi vừa thực hiện.
4. Tự động đẩy lên GitHub (`git push origin main`).
