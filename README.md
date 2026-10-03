# CoursePilot

Chrome extension viết bằng **WXT + JavaScript (ESM)** để hỗ trợ luồng học online có sự kiểm soát của người dùng: phát video, chuyển bài khi video kết thúc và tạo **bản nháp** thảo luận qua LLM gateway.

## Cấu trúc

```
entrypoints/       # Điểm vào WXT: background, content, popup, options
src/background/    # Điều phối message và tác vụ nền
src/content/       # Logic chạy trong trang LMS
src/providers/     # Adapter theo từng LMS; selector chỉ nằm ở đây
src/services/      # Tích hợp bên ngoài (LLM gateway)
src/shared/        # Settings, hằng số, browser helpers
```

## Khởi động

Yêu cầu Node.js 22+ (WXT 0.21).

```bash
npm install
npm run dev
```

WXT sẽ mở Chrome có extension ở chế độ phát triển. Khi cần phát hành:

```bash
npm run build
npm run zip
```

## Mở rộng đúng chỗ

1. Tạo `src/providers/<ten-lms>.provider.js` với `matches`, `findVideo`, `findNextButton`, `findDiscussionInput`.
2. Đăng ký adapter tại `src/providers/provider-registry.js`.
3. Cấu hình domain LMS trong Options trước khi bật hỗ trợ.
4. Triển khai LLM qua backend/gateway; không nhúng API key sản xuất vào extension.

## Liên kết một tài khoản PTTC1 với API

Khi nhấn **Đăng nhập / liên kết PTTC1**, extension mở trang PTTC1 để bạn đăng nhập trực tiếp. Sau đó nó đọc định danh hiển thị của phiên Moodle hiện tại và gửi `{ accountId, hostname }` đến `API xác minh liên kết` (nếu được cấu hình). API đó phải trả JSON `{ "authorized": true }` chỉ cho tài khoản được cấp quyền. Extension không lưu và không tự điền mật khẩu LMS.

## Nguyên tắc vận hành

- Extension không thu thập mật khẩu hay tự đăng nhập. Người dùng đăng nhập trực tiếp vào LMS.
- Tính năng tự chuyển bài mặc định tắt và chỉ hoạt động tại các domain được cho phép.
- LLM chỉ tạo bản nháp; UI gửi bài nên luôn có bước người dùng xem và xác nhận.
- Hãy tuân thủ quy chế khóa học, bản quyền và chính sách LMS của bạn.
