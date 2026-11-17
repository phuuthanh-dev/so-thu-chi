# nhà mình. — Sổ thu chi

Ứng dụng Next.js với số điện thoại và mật khẩu, sổ riêng theo tài khoản, và giao dịch định kỳ hàng tháng. Tính năng máy chủ chỉ hoạt động khi đã tạo và cấu hình Supabase như dưới đây; mã nguồn không tự tạo tài khoản, database hay dịch vụ bên ngoài.

## Cấu hình Supabase

1. Tạo một dự án Supabase mới. Giữ thông tin đăng nhập và khóa bí mật ngoài GitHub và ngoài cuộc trò chuyện.
2. Trong Authentication → Sign In / Providers, bật Phone. Theo lựa chọn không gửi SMS, tắt yêu cầu xác nhận số điện thoại cho đăng ký. Cấu hình chính sách mật khẩu phía Supabase tối thiểu 10 ký tự, thêm giới hạn truy cập và chống đăng ký tự động. Số điện thoại khi đó **chỉ là tên đăng nhập chưa được xác minh**, và người khác có thể đăng ký trước số đó. Chưa có cách tự khôi phục mật khẩu; hãy lưu mật khẩu an toàn. Trước khi mở đăng ký rộng rãi, cân nhắc xác minh số, khôi phục tài khoản và MFA.
3. Trên một database mới, chạy toàn bộ `supabase/migrations/202611170001_ledger.sql` trong SQL Editor. Migration tạo bảng riêng theo `auth.uid()`, không cấp quyền truy cập bảng trực tiếp; các hàm đọc/ghi kiểm tra chủ tài khoản và version. Không chạy lại trên database đã có bảng cùng tên.
4. Bật Supabase Cron (`pg_cron`) và chạy `supabase/schedule.sql` bằng tài khoản quản trị. Lịch mặc định chạy mỗi ngày lúc 07:00 giờ Việt Nam, tạo các giao dịch đã đến hạn; lần chạy thất bại cần kiểm tra trong Cron Dashboard. Tác vụ khóa từng sổ, chạy bù và không nhân đôi cùng một kỳ. Nếu tạm dừng rồi tiếp tục, các kỳ đã tới hạn trong thời gian tạm dừng sẽ được ghi bù.
5. Sao chép `.env.example` thành `.env.local`, đặt `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` từ cài đặt API của dự án. Có thể dùng khóa anon công khai tương thích nếu dự án chưa có publishable key. **Không bao giờ** đưa service role key, secret key, mật khẩu hoặc chuỗi kết nối database vào biến `NEXT_PUBLIC_*`, source code hay Git.
6. Đặt hai biến công khai tương tự trong Vercel Project Settings → Environment Variables (Production và Preview nếu cần), sau đó deploy lại. Không triển khai thay thế bản hiện tại trước khi thiết lập và kiểm thử xong các bước này.

## Chạy trên máy

```bash
npm install
npm run dev
```

Mở URL Local được in ra. Kiểm tra `npm run lint` và `npm run build`. Nếu thiếu cấu hình, ứng dụng hiển thị thông báo thay vì giả lập đăng nhập.

## Đồng bộ và dữ liệu cũ

- Người dùng mới bắt đầu với một ví tiền mặt rỗng, không có dữ liệu mẫu.
- Khi ghi, server so sánh version. Nếu hai thiết bị cùng sửa, bản cũ bị từ chối thay vì âm thầm ghi đè. Bản nháp chỉ còn trong màn hình cho tới khi tải lại hoặc rời trang; hãy ghi lại thông tin cần giữ trước khi tải phiên bản mới.
- Ứng dụng đọc lại dữ liệu khi quay lại cửa sổ và khoảng mỗi 20 giây khi không sửa hoặc có bản nháp chưa lưu. Cần kết nối mạng.
- Dữ liệu `localStorage` của bản thử trước **không tự đưa lên server và không bị xóa**. Để chuyển, trên đúng trình duyệt và đúng domain cũ, đăng nhập vào sổ còn trống, vào Cài đặt → Chuyển dữ liệu. Chỉ làm sau khi kiểm tra dữ liệu mẫu vì các giao dịch mẫu cũng sẽ được chuyển. Cần xác nhận thao tác; sổ đang có giao dịch/quy tắc/ngân sách không bị ghi đè. Việc đồng bộ tài khoản còn phụ thuộc cấu hình Supabase.
- Dữ liệu hiện lưu dạng một tài liệu JSON trên mỗi tài khoản, tối đa 2 MB. Cần chuyển sang bảng giao dịch phân trang và bổ sung sao lưu/khôi phục trước khi mở rộng đáng kể; không coi đây là nền tảng sản xuất hoàn chỉnh cho nhiều dữ liệu hoặc sử dụng chung sổ.

## Kiểm thử database cục bộ

Với PostgreSQL dùng riêng cho kiểm thử (không dùng database cá nhân), chạy `tests/ledger-setup.sql`, migration rồi `tests/ledger-test.sql` bằng `psql -v ON_ERROR_STOP=1`. Script setup mô phỏng Supabase Auth, không dùng trên Supabase thật. Kiểm tra bao gồm cách ly tài khoản, từ chối version cũ, quyền chạy job, chạy lại không tạo trùng và ngày cuối tháng. Test này không thay thế việc thử đăng nhập bằng mật khẩu, nhiều trình duyệt, cấu hình RLS và cron trên Supabase thực tế.

## Phạm vi còn lại

Màn hình lịch, báo cáo năm, khôi phục tài khoản, sao lưu/khôi phục, quản lý đầy đủ danh mục/ví, chia sẻ sổ, export (P1), PWA và ngân sách theo danh mục chưa hoàn thành. Không có kết nối ngân hàng, chuyển tiền hoặc thanh toán.
