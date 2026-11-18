# nhà mình. — Sổ thu chi

Ứng dụng Next.js với số điện thoại và mật khẩu, sổ riêng theo tài khoản, và giao dịch định kỳ hàng tháng. Tính năng máy chủ chỉ hoạt động khi đã tạo và cấu hình Supabase như dưới đây; mã nguồn không tự tạo tài khoản, database hay dịch vụ bên ngoài.

## Cấu hình Supabase

1. Tạo một dự án Supabase mới. Giữ thông tin đăng nhập và khóa bí mật ngoài GitHub và ngoài cuộc trò chuyện.
2. Trong Authentication → Sign In / Providers, bật Phone. Theo lựa chọn không gửi SMS, tắt yêu cầu xác nhận số điện thoại cho đăng ký. Cấu hình chính sách mật khẩu phía Supabase tối thiểu 10 ký tự, thêm giới hạn truy cập và chống đăng ký tự động. Số điện thoại khi đó **chỉ là tên đăng nhập chưa được xác minh**, và người khác có thể đăng ký trước số đó. Chưa có cách tự khôi phục mật khẩu; hãy lưu mật khẩu an toàn. Trước khi mở đăng ký rộng rãi, cân nhắc xác minh số, khôi phục tài khoản và MFA.
3. Trên một database mới, chạy toàn bộ `supabase/migrations/202611170001_ledger.sql` trong SQL Editor. Migration tạo bảng riêng theo `auth.uid()`, không cấp quyền truy cập bảng trực tiếp; các hàm đọc/ghi kiểm tra chủ tài khoản và version. Không chạy lại trên database đã có bảng cùng tên.
4. Bật Supabase Cron (`pg_cron`), kiểm tra lịch hiện có, sau đó chạy `supabase/migrations/202611170002_recurring_reliability.sql` bằng tài khoản quản trị. Tác vụ thử lại mỗi 15 phút, bắt đầu xử lý các kỳ của ngày mới lúc 07:00 giờ Việt Nam. Các sổ đang bị khóa sẽ được thử lại; lỗi từng sổ hiện trong ứng dụng. Tác vụ chạy bù và không nhân đôi cùng một kỳ. Nếu tạm dừng rồi tiếp tục, các kỳ đã tới hạn trong thời gian tạm dừng sẽ được ghi bù.
5. Sao chép `.env.example` thành `.env.local`, đặt `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` từ cài đặt API của dự án. Có thể dùng khóa anon công khai tương thích nếu dự án chưa có publishable key. **Không bao giờ** đưa service role key, secret key, mật khẩu hoặc chuỗi kết nối database vào biến `NEXT_PUBLIC_*`, source code hay Git.
6. Đặt hai biến công khai tương tự trong Vercel Project Settings → Environment Variables (Production và Preview nếu cần), sau đó deploy lại. Không triển khai thay thế bản hiện tại trước khi thiết lập và kiểm thử xong các bước này.

## Kiểm tra Supabase định kỳ

- Trên database đã cấu hình, chạy `supabase/migrations/202611180003_availability_probe.sql` trong SQL Editor. Hàm chỉ trả `true`, không truy cập sổ; quyền ẩn danh đối với bảng `ledgers` không thay đổi.
- Trong GitHub Actions secrets của repository, đặt `SUPABASE_PROBE_URL` và `SUPABASE_PROBE_KEY` bằng URL và publishable/anon key của đúng dự án. Không dùng service role key. Workflow `Supabase availability` kiểm tra API database mỗi 6 giờ và có thể chạy thủ công trong Actions.
- Đây là kiểm tra cố gắng duy trì hoạt động, không bảo đảm dự án Free không bị tạm dừng hoặc dịch vụ không gián đoạn. Xem kết quả trong GitHub Actions và email cảnh báo của Supabase. GitHub có thể tự tắt lịch của repository công khai sau 60 ngày không có hoạt động; khi đó cần bật lại workflow. Gói Pro tránh tạm dừng do không hoạt động nhưng có phí.

## Chạy trên máy

```bash
npm install
npm run dev
```

Mở URL Local được in ra. Kiểm tra `npm run lint` và `npm run build`. Nếu thiếu cấu hình, ứng dụng hiển thị thông báo thay vì giả lập đăng nhập.

## Đồng bộ và dữ liệu cũ

- Người dùng mới bắt đầu với một ví tiền mặt rỗng, không có dữ liệu mẫu.
- Trong Ví của tôi, có thể sửa tên và số dư ban đầu; thay đổi số dư ban đầu sẽ làm thay đổi số dư theo ghi chép. Ví chưa có giao dịch được xóa sau khi xác nhận. Ví đã có giao dịch được lưu trữ và có thể khôi phục, lịch sử giao dịch được giữ lại. Trước khi xóa ví gắn với quy tắc định kỳ, hãy sửa quy tắc sang ví khác; luôn cần ít nhất một ví đang sử dụng.
- Trong Cài đặt, chọn ảnh đại diện JPG/PNG/WebP tối đa 5 MB, kéo hoặc dùng thanh trượt để chỉnh vị trí và độ phóng rồi nhấn Lưu ảnh. Có thể thu nhỏ để giữ toàn bộ ảnh trong khung tròn. Ảnh được thu nhỏ và lưu cùng sổ của tài khoản để đồng bộ; ảnh chiếm một phần giới hạn 2 MB của sổ và bản nháp chưa đồng bộ có thể chứa ảnh trên trình duyệt. Nút hiệu ứng hoa đào lưu lựa chọn theo từng thiết bị và tôn trọng thiết lập giảm chuyển động của hệ điều hành.
- Khi ghi, server so sánh version. Nếu hai thiết bị cùng sửa, bản cũ bị từ chối thay vì âm thầm ghi đè. Bản nháp chưa được xác nhận được lưu riêng theo tài khoản trong trình duyệt, có thể khôi phục sau khi tải lại. Bản nháp chứa thông tin tài chính không mã hóa và không theo sang thiết bị khác; xóa dữ liệu trình duyệt có thể làm mất bản nháp. Khi xung đột, hãy đối chiếu và nhập lại thay đổi vào dữ liệu mới.
- Ứng dụng đọc lại dữ liệu khi quay lại cửa sổ và khoảng mỗi 20 giây khi không sửa hoặc có bản nháp chưa lưu. Cần kết nối mạng.
- Dữ liệu `localStorage` của bản thử trước **không tự đưa lên server và không bị xóa**. Để chuyển, trên đúng trình duyệt và đúng domain cũ, đăng nhập vào sổ còn trống, vào Cài đặt → Chuyển dữ liệu. Chỉ làm sau khi kiểm tra dữ liệu mẫu vì các giao dịch mẫu cũng sẽ được chuyển. Cần xác nhận thao tác; sổ đang có giao dịch/quy tắc/ngân sách không bị ghi đè. Việc đồng bộ tài khoản còn phụ thuộc cấu hình Supabase.
- Dữ liệu hiện lưu dạng một tài liệu JSON trên mỗi tài khoản, tối đa 2 MB. Cần chuyển sang bảng giao dịch phân trang và bổ sung sao lưu/khôi phục trước khi mở rộng đáng kể; không coi đây là nền tảng sản xuất hoàn chỉnh cho nhiều dữ liệu hoặc sử dụng chung sổ.

## Kiểm thử database cục bộ

Với PostgreSQL dùng riêng cho kiểm thử (không dùng database cá nhân), chạy `tests/ledger-setup.sql`, `tests/cron-setup.sql`, hai migration rồi `tests/recurring-reliability.sql` bằng `psql -v ON_ERROR_STOP=1`. Hai script setup mô phỏng Supabase Auth và Cron, không dùng trên Supabase thật. Test kiểm tra cách ly tài khoản, lỗi từng sổ, phục hồi và chạy lại không tạo trùng. Chạy `npm test` để kiểm tra đồng bộ, bản nháp và tính toán trên giao diện. Các test này không thay thế việc thử nhiều thiết bị và cron trên Supabase thực tế.

## Phạm vi còn lại

Màn hình lịch, báo cáo năm, khôi phục tài khoản, sao lưu/khôi phục, quản lý đầy đủ danh mục, chia sẻ sổ, export (P1), PWA và ngân sách theo danh mục chưa hoàn thành. Không có kết nối ngân hàng, chuyển tiền hoặc thanh toán.
