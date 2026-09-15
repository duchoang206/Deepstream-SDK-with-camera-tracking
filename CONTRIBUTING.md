# Hướng Dẫn Đóng Góp Dự Án (Contribution Guidelines)

Cảm ơn bạn đã quan tâm và đóng góp cho dự án **DeepStream Multi-Camera Tracking Platform**!

---

## 1. Quy Trình Phát Triển & Nhánh Git (Git Workflow)

1. **Fork** repository về tài khoản GitHub của bạn.
2. Tạo nhánh tính năng mới từ nhánh `main`:
   ```bash
   git checkout -b feat/ten-tinh-nang-moi
   ```
3. Tuân thủ định dạng commit chuẩn **Conventional Commits**:
   - `feat(...)`: Thêm tính năng mới
   - `fix(...)`: Sửa lỗi
   - `docs(...)`: Cập nhật tài liệu
   - `perf(...)`: Tối ưu hóa hiệu năng
   - `refactor(...)`: Tái cấu trúc mã nguồn
   - `chore(...)`: Cập nhật cấu hình, dependency

---

## 2. Tiêu Chuẩn Mã Nguồn (Code Standards)

### Backend (Python / C++)
- Sử dụng **PEP 8** và type annotations đầy đủ cho hàm và lớp.
- Kiểm tra cú pháp và định dạng code với `black` và `flake8`:
  ```bash
  black backend/
  flake8 backend/
  ```

### Frontend (Next.js / TypeScript)
- Chạy linter trước khi tạo PR:
  ```bash
  cd web-dashboard
  npm run lint
  ```

---

## 3. Tạo Pull Request (PR)

- Đảm bảo mã nguồn đã được kiểm thử cục bộ thành công.
- Cung cấp mô tả chi tiết về thay đổi trong phần mô tả của PR.
- Đính kèm ảnh chụp màn hình hoặc log kiểm thử nếu có thay đổi liên quan đến giao diện UI hoặc DeepStream pipeline.
