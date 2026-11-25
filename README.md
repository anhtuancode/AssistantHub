Trợ lý tự động hóa miễn phí dành cho giáo viên MindX, giúp tiết kiệm thời gian sau mỗi buổi dạy:
- **Tự động đọc lớp & học viên** trực tiếp từ MindX LMS.
- **Viết nhận xét chuẩn sư phạm bằng Gemini AI** và tự động lưu lên LMS.
- **Báo bài Zalo chuẩn màu** (copy 1 chạm, dán vào Zalo PC giữ nguyên màu sắc nổi bật).
- **Teacher Point siêu tốc** dành cho khối Robotics (`ROB`) tại Buổi 4 & Buổi 8.

> **Bảo mật tuyệt đối:** Ứng dụng chạy 100% trên máy tính cá nhân của bạn. Tài khoản LMS và Gemini API Key chỉ được lưu cục bộ trên máy, không gửi lên bất kỳ máy chủ trung gian nào.

---

## 📋 Yêu cầu trước khi dùng (Chỉ cài 1 lần duy nhất)

1. Máy tính chạy **Windows 10 / 11**.
2. Cài sẵn **Node.js** (bản LTS):
   - Tải tại: [https://nodejs.org](https://nodejs.org) (chọn nút màu xanh **LTS**).
   - Mở file vừa tải → bấm **Next** liên tục cho đến khi hoàn tất.

---

## 🚀 Hướng dẫn tải và chạy (3 bước)

### Bước 1: Tải ứng dụng về máy
- Bấm nút màu xanh **`<> Code`** ở góc trên cùng bên phải trang GitHub này → chọn **`Download ZIP`**.
- Giải nén file `.zip` vừa tải vào một thư mục dễ nhớ (ví dụ: `D:\TungMeoHub`).

### Bước 2: Khởi động ứng dụng
- Mở thư mục vừa giải nén, bấm đúp vào file **`Start-MindX-Assistant.bat`** (hoặc file `.bat` khởi động trong thư mục).
- *Lưu ý:* Lần chạy đầu tiên, hệ thống sẽ tự động tải các thư viện cần thiết (mất khoảng 1–2 phút tùy tốc độ mạng). Các lần sau mở lên sẽ chạy ngay trong vài giây.
- **Không tắt cửa sổ dòng lệnh màu đen** trong lúc đang sử dụng ứng dụng.

### Bước 3: Mở giao diện làm việc
- Sau khi khởi động xong, trình duyệt sẽ tự động mở giao diện **Tứng Mèo Hub Assistant** (hoặc bạn tự mở trình duyệt và vào địa chỉ `http://localhost:3000`).

*(Nếu thư mục không có file `.bat`, bạn có thể mở Terminal/PowerShell tại thư mục đó và gõ lần lượt 2 lệnh: `npm install` rồi `npm start`.)*

---

## ⚙️ Thiết lập trong lần sử dụng đầu tiên

Vào tab **Cấu hình** trên thanh menu bên trái:
1. **Kết nối LMS MindX:** Nhập tài khoản LMS hoặc bấm **`Mở trình duyệt & Đăng nhập LMS`** để đăng nhập 1 lần (ứng dụng sẽ tự nhớ phiên đăng nhập cho các lần sau).
2. **Gemini API Key (Miễn phí):**
   - Truy cập [Google AI Studio](https://aistudio.google.com/app/apikey), đăng nhập bằng Gmail cá nhân và bấm **`Create API key`**.
   - Copy mã Key dán vào ô **Gemini API Key** trong ứng dụng → bấm **`Kiểm tra kết nối AI`** để xác nhận.

---

## ❓ Xử lý nhanh lỗi thường gặp

- **Mở file `.bat` lên rồi tự tắt ngay:** Máy bạn chưa cài Node.js (hoặc vừa cài xong chưa khởi động lại máy). Hãy cài Node.js ở bước Yêu cầu rồi thử lại.
- **LMS báo hết phiên đăng nhập:** Vào lại tab **Cấu hình** → bấm đăng nhập lại LMS là tiếp tục dùng bình thường.
- **Báo bài Zalo bị mất màu khi dán:** Hãy đảm bảo bạn đang dán vào **Zalo PC (ứng dụng trên Windows)**, không phải Zalo Web.

---

Made with ❤️ by **Anh Tuấn** • Free for Teachers.
