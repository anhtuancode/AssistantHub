# Phân tích Kiến trúc & Hiện trạng Dự án — Tứng Mèo Hub (MindX Teacher Assistant)

> Ngày cập nhật: 28/11/2026

---

## 1. Tổng quan công nghệ & Kiến trúc (Tech Stack & Architecture)

### Công nghệ & Thư viện
- **Nền tảng chạy chính:** Chrome Extension **Manifest V3** (`manifest.json`).
- **Frontend:** Vanilla JavaScript (**ES Modules** thuần, không dùng React/Vue/bundler), HTML5 (`index.html`), CSS3 thuần (`css/styles.css` ~45 KB), icon SVG nội tuyến (`js/services/icons.js`) và bộ sinh mã QR offline (`js/services/qrGenerator.js`).
- **Node.js / Testing:** `package.json` khai báo `express`, `cors`, `dotenv`, `playwright` (di sản từ bản server cũ; hiện `src/server.js` không còn tồn tại) và bộ kiểm thử tự động `node src/tests/run_tests.js` (29 test cases).
- **Tích hợp ngoài:** MindX LMS GraphQL API + DOM fallback, Google Gemini / OpenAI / Groq / DeepSeek / OpenRouter, Google Forms (Teacher Point), TinyURL API (`api-create.php`).

### Cấu trúc thư mục
| Thư mục / File | Vai trò chính |
| :--- | :--- |
| `index.html`, `css/styles.css` | Giao diện 1 trang (SPA 7 tab) + hệ thống modal (StudentBook, Build URL, QR) + Log Drawer. |
| `js/main.js` | Bộ điều phối chính: chuyển tab (`switchTab`), đồng bộ trạng thái Topbar & Sidebar. |
| `js/tabs/` (8 files) | Controller từng màn hình: `config.js`, `classes.js`, `students.js`, `review.js`, `curriculum.js`, `zalo.js`, `teacherPoint.js`, `automation.js`. |
| `js/services/` (8 files) | Tầng nghiệp vụ & giao tiếp: `apiBridge.js` (định tuyến message tới Extension), `curriculum.js`, `geminiClient.js`, `teacherPointClient.js`, `qrGenerator.js`, `sessionGuard.js`, `toast.js`, `icons.js`. |
| `js/config/` (2 files) | Cấu hình AI: `aiProviders.js` (nhận diện provider, chọn model kinh tế), `commentStyles.js` (5 preset phong cách & prompt builder). |
| `extension/` (5 files) | Lõi tự động hóa Chrome Extension: `background.js` (Service Worker), `lmsApiClient.js` & `lmsQueries.js` (GraphQL Zero-Tab), `content-lms.js` (fallback DOM), `main-world.js` (SPA `pushState`). |
| `data/curriculum/` (25 files) | `index.json` + 24 file JSON giáo trình (9 khóa Robotics + 15 khóa Coding - C4K). |
| `src/tests/run_tests.js` | Bộ unit & integration test (mock DOM/fetch/chrome API). |

### Luồng dữ liệu & Quản lý State
- **Không có Backend/Database tập trung.** Toàn bộ dữ liệu chạy cục bộ trên trình duyệt:
  1. **Dữ liệu tĩnh (`data/curriculum/*.json`):** Đọc qua `fetch('./data/curriculum/...')` và cache trong bộ nhớ ở `CurriculumService`.
  2. **`localStorage`:** Lưu cấu hình người dùng, ghi đè StudentBook (`mindx_studentbook_overrides`), ghi đè buổi học (`mindx_curriculum_overrides`), cache Short URL (`mindx_short_url_cache`), cấu hình phong cách nhận xét AI.
  3. **`chrome.storage.local`:** Lưu trạng thái tiến trình tự động hóa (`mindx_automation_state`), nhật ký (`mindx_automation_logs`), cache danh sách lớp & buổi học có TTL 30 phút (`mindx_classes_cache`, `mindx_sessions_cache`).
  4. **API ngoài:** MindX LMS (`lms-api.mindx.edu.vn`), LLM APIs, Google Forms (`docs.google.com/forms`), TinyURL (`tinyurl.com`).
- **Quản lý State:** Phân tán qua biến module cục bộ trong từng tab (`selectedCourseCode`, `activeQrState`...), thuộc tính `window.__mindxActiveClassCode`, và đồng bộ qua `chrome.runtime.sendMessage`.

---

## 2. Phân tích chi tiết từng chức năng & Nhiệm vụ

| Tính năng | File chịu trách nhiệm chính | Nhiệm vụ cốt lõi | Luồng hoạt động (Input → Xử lý → Output) | Tình trạng |
| :--- | :--- | :--- | :--- | :--- |
| **1. Cấu hình & Bảo mật** | `js/tabs/config.js`, `js/config/aiProviders.js`, `js/config/commentStyles.js` | Nhập tài khoản LMS, API Key AI (Gemini/OpenAI/Groq/OpenRouter/DeepSeek), chọn phong cách nhận xét & kiểm tra kết nối. | Nhập key/preset → Tự nhận diện provider & lọc model → Lưu `localStorage`/`chrome.storage`. | **Hoàn thiện** |
| **2. Lớp & Buổi học** | `js/tabs/classes.js`, `js/services/apiBridge.js` | Tải danh sách lớp đang dạy và danh sách các buổi học (1–14) từ LMS. | Click đồng bộ → `apiBridge` gọi `background.js` → `lmsApiClient` (GraphQL) hoặc `content-lms.js` (DOM) → Cache 30p & render. | **Hoàn thiện** |
| **3. Học viên & Tạo nhận xét AI** | `js/tabs/students.js`, `js/services/geminiClient.js` | Soạn tóm tắt buổi học và sinh nhận xét cá nhân hóa hàng loạt cho từng học sinh bằng AI. | Chọn buổi + từ khóa/điểm từng HS → `geminiClient` dựng prompt theo giáo trình & style → Trả về nhận xét từng HS. | **Hoàn thiện** |
| **4. Duyệt & Lưu lên LMS** | `js/tabs/review.js`, `extension/lmsApiClient.js` | Rà soát nội dung nhận xét lần cuối và đẩy trực tiếp lên MindX LMS. | Sửa/duyệt text → Gửi batch tới `background.js` → Gọi mutation `UpdateSlotComment` (fallback DOM) → Báo kết quả & log. | **Hoàn thiện** |
| **5. Kho Giáo trình MindX** | `js/tabs/curriculum.js`, `js/services/curriculum.js`, `js/services/qrGenerator.js` | Tra cứu 24 khóa học (Robotics & Coding), mở Slide, mở Link lắp ráp (1 hoặc nhiều mô hình), chiếu mã QR + Short URL, mở StudentBook. | Chọn nhóm & mã khóa → Render danh sách buổi 1 cột → Bấm Mở Slide / Lắp ráp / Mã QR (tạo SVG offline + TinyURL cache). | **Hoàn thiện** (dữ liệu link lưu tĩnh trong JSON; một số khóa Coding chưa đủ 14 link Slide) |
| **6. Báo bài Zalo Phụ huynh** | `js/tabs/zalo.js` | Tạo mẫu tin nhắn báo bài chuẩn gửi phụ huynh (kèm tóm tắt, link tài liệu ôn tập, BTVN trang StudentBook). | Chọn khóa, buổi, nhập trang SB → Kết hợp dữ liệu JSON + `localStorage` → Sinh mẫu tin & copy clipboard. | **Hoàn thiện** |
| **7. Teacher Point (Khảo sát)** | `js/tabs/teacherPoint.js`, `js/services/teacherPointClient.js` | Gửi nhanh phiếu khảo sát Teacher Point (Google Form) cho khối Robotics tại Buổi 4 & 8. | Chọn cơ sở, mã lớp, GV → Random câu nhận xét từ bank tích cực & submit Google Form ẩn/tab. | **Hoàn thiện** (dùng URL Google Form & danh sách cơ sở hardcode) |
| **8. Nhật ký & Automation Drawer** | `js/tabs/automation.js`, `extension/background.js` | Theo dõi tiến trình chạy ngầm, hủy tác vụ, xem log lỗi/thành công. | Lắng nghe thay đổi `chrome.storage.local` → Cập nhật badge số log & render drawer. | **Hoàn thiện** |

---

## 3. Đánh giá kỹ thuật & Điểm nghẽn (Tech Debt & Risks)

1. **Cấu trúc & Khả năng bảo trì (Tech Debt):**
   - **File quá lớn (Monolithic files):** `geminiClient.js` (~58 KB), `content-lms.js` (~47 KB), `styles.css` (~45 KB), `index.html` (~64 KB), `background.js` (~34 KB), `run_tests.js` (~87 KB) tập trung nhiều trách nhiệm trong một file, khó đọc và dễ xung đột khi sửa song song.
   - **Dư thừa di sản:** `package.json` vẫn giữ `express`, `cors`, `playwright` và script `"start": "node src/server.js"` dù không có `src/server.js`.
   - **DOM manipulation thủ công:** Render bằng template string `innerHTML` kết hợp `querySelector` rải rác; việc thay đổi layout (như tab Giáo trình) đòi hỏi sửa đồng bộ cả `index.html`, `styles.css`, `curriculum.js` và đôi khi `main.js`.

2. **Rủi ro về Hiệu năng, Bảo mật & Mobile:**
   - **Hiệu năng:** `curriculumService.getAllCourses()` tải đồng thời toàn bộ 24 file JSON (~550 KB) ngay lần đầu mở tab Giáo trình thay vì lazy-load từng khóa.
   - **Bảo mật cục bộ:** API Key AI và thông tin cấu hình lưu dạng plain-text trong `localStorage` / `chrome.storage.local` (chỉ an toàn trong phạm vi profile Chrome cá nhân; dù badge ghi "Bảo mật cục bộ", chưa có lớp mã hóa DPAPI/WebCrypto).
   - **Trải nghiệm Mobile:** Ứng dụng hiện là Chrome Extension (`index.html` mở ở tab Chrome Desktop với Sidebar cố định trái). Dù tab Giáo trình đã responsive `< 768px`, phần Sidebar cố định và các tab khác (`classes`, `students`, `review`) chưa được tối ưu toàn diện nếu triển khai thành Web App độc lập trên điện thoại.

3. **Dữ liệu Hardcode cần tách nếu mở rộng:**
   - `DEFAULT_FORM_URL`, `CAMPUS_PREFIX_MAP`, `ACTIVITY_REWARD_BANK`, `TEACHER_MESSAGE_BANK` trong `js/services/teacherPointClient.js`.
   - Thứ tự cụm khóa học `clusterOrder` và mã khóa mặc định `'PREI'` trong `js/tabs/curriculum.js`.
   - Toàn bộ link Slide, Build PDF, StudentBook nằm trong 24 file JSON tĩnh — muốn cập nhật cho toàn bộ giáo viên phải phát hành lại bản cập nhật Extension.

---

## 4. Đề xuất các bước tiếp theo (Roadmap gợi ý)

### Ưu tiên cao (Làm ngay)
- **Dọn dẹp `package.json` & mã chết:** Gỡ bỏ `express`, `cors`, `playwright` (hoặc chuyển vào `devDependencies` nếu dùng test), xóa script `start` trỏ vào `src/server.js` không tồn tại.
- **Tách `css/styles.css` và `geminiClient.js`:** Chia CSS theo module (`layout.css`, `curriculum.css`, `modals.css`) và tách `geminiClient.js` thành `promptBuilder.js` + `llmTransport.js` + `fallbackTemplates.js`.
- **Lazy-load giáo trình:** Chỉ `fetch` JSON của khóa học đang chọn thay vì tải toàn bộ 24 file JSON cùng lúc khi mở tab Giáo trình.

### Ngắn hạn (Nâng cấp trải nghiệm)
- **Import / Export cấu hình & override:** Cho phép giáo viên xuất/nhập file JSON cấu hình + link StudentBook/Build tùy chỉnh khi đổi máy tính.
- **Tìm kiếm nhanh theo phím tắt:** Hỗ trợ phím tắt `/` để nhảy nhanh tới mã khóa học hoặc tên buổi học.
- **Hoàn thiện dữ liệu Slide & StudentBook còn trống:** Bổ sung `slideUrl` cho các khóa Coding còn thiếu và bổ sung unit test kiểm tra tính toàn vẹn schema của toàn bộ 24 file JSON.

### Dài hạn (Mở rộng quy mô)
- **Tách kho Giáo trình thành Web App / PWA độc lập:** Dựng trang Giáo trình (không phụ thuộc `chrome.*` API) deploy lên Firebase Hosting / Cloudflare Pages để giáo viên mở trực tiếp trên iPad/điện thoại khi đứng lớp.
- **Đồng bộ dữ liệu tập trung (Cloud Sync):** Đưa 24 file JSON giáo trình và link lắp ráp lên Firestore/Supabase hoặc Google Sheets API để Admin cập nhật link mới một lần, toàn bộ giáo viên nhận ngay mà không cần update Extension.
