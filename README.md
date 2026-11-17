# nhà mình. — Bản thử nghiệm Next.js

Ứng dụng thu chi bằng tiếng Việt. Đây là bản thử nghiệm cục bộ, **chưa phải MVP có thể sử dụng cho dữ liệu tài chính thật**.

## Chạy trên máy

```bash
npm install
npm run dev
```

Mở địa chỉ Local do Next.js hiển thị. Kiểm tra bản production bằng `npm run build`.

## Các chức năng thử được

- Ghi, chỉnh sửa, xóa thu/chi; chọn ngày, ví và danh mục.
- Xem tổng thu, chi, chênh lệch theo tháng; lọc, tìm kiếm giao dịch.
- Thêm ví, danh mục; xem số dư tính từ số dư mở và giao dịch đã ghi.
- Đặt ngân sách tổng theo tháng và xem chi tiêu theo danh mục.
- Tạo quy tắc định kỳ hàng tháng, tạm dừng/tiếp tục; khi mở lại ứng dụng sẽ ghi bù các lần đến hạn.

Ứng dụng khởi tạo bằng dữ liệu mẫu. Dữ liệu thử nghiệm được lưu trong `localStorage` của trình duyệt; xóa dữ liệu trình duyệt sẽ làm mất dữ liệu. Xóa giao dịch không có chức năng khôi phục.

## Các phần còn thiếu để đạt yêu cầu

- Đăng nhập số điện thoại thực sự, xác minh OTP và khôi phục tài khoản. Cần lựa chọn và cấu hình dịch vụ SMS/xác thực.
- Cơ sở dữ liệu an toàn, quyền Owner và cách ly dữ liệu giữa người dùng, đồng bộ nhiều thiết bị, sao lưu/khôi phục.
- Bộ lập lịch chạy trên máy chủ cho giao dịch định kỳ khi người dùng không mở app; xử lý trùng lặp, múi giờ, cuối tháng và gián đoạn.
- Màn hình lịch, báo cáo năm, quản lý đầy đủ danh mục/ví, bộ lọc danh mục, cùng các ca kiểm thử tự động cho logic và bảo mật.
- Xuất dữ liệu (P1), PWA (chưa ưu tiên) và ngân sách theo danh mục (giai đoạn sau).

Chưa có kết nối ngân hàng, chuyển tiền hay thanh toán. Không đưa mật khẩu, OTP hoặc thông tin tài chính thật vào bản thử nghiệm.
