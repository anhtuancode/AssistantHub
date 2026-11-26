/**
 * TeacherPointClient (ES Module)
 * Port từ src/services/teacherPointService.js — gọi trực tiếp Google Form từ Extension.
 */

const DEFAULT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfyK41x_vyFztgjU1sTgJGLiHE1yvf7mmHuUQe5gUQDLQcO_Q/viewform';

const ACTIVITY_REWARD_BANK = [
  'Cộng điểm thưởng và chơi minigame ạ',
  'Chơi trò chơi và nhận sticker ạ',
  'Thi đua lắp ráp robot theo nhóm ạ',
  'Thưởng kẹo và cộng điểm cuối giờ ạ',
  'Chơi Kahoot ôn bài và cộng điểm ạ',
  'Có thêm thử thách đua robot giữa các đội ạ',
  'Nhận huy hiệu hoặc sticker siêu nhân ạ',
  'Chơi trò chơi đố vui đầu giờ ạ',
  'Cộng điểm tích lũy đổi quà cuối khóa ạ',
  'Thi xem nhóm nào lập trình nhanh nhất ạ',
  'Có thêm minigame giải đố công nghệ ạ',
  'Tặng sticker và khen thưởng trước lớp ạ',
  'Tổ chức đấu robot mini cuối buổi ạ',
  'Chơi trò chơi vận động nhẹ giữa giờ ạ',
  'Cộng điểm sao cho bạn làm bài nhanh ạ',
  'Có thêm phần thử thách sáng tạo robot ạ',
  'Chơi Quizizz và nhận quà nhỏ ạ',
  'Thi thiết kế robot đẹp nhất buổi ạ'
];

const TEACHER_MESSAGE_BANK = [
  'Thầy dạy rất vui và dễ hiểu ạ',
  'Em rất thích học lớp thầy ạ',
  'Không có gì cần sửa ạ, thầy dạy rất tốt',
  'Thầy rất nhiệt tình hướng dẫn tụi em ạ',
  'Em mong thầy giữ nguyên cách dạy vui vẻ như hiện tại ạ',
  'Thầy giảng kỹ nên em làm bài rất nhanh ạ',
  'Em thích nhất những lúc thầy cho cả lớp thi đua ạ',
  'Thầy hỗ trợ rất tận tâm khi nhóm em gặp lỗi ạ',
  'Lớp học lúc nào cũng vui, em rất thích đi học ạ',
  'Thầy dạy dễ hiểu và hay khích lệ tụi em ạ',
  'Em cảm ơn thầy đã giúp em lắp ráp robot thành công ạ',
  'Thầy cứ dạy vui như vậy mãi nhé ạ',
  'Em thấy thầy dạy rất ổn rồi, không cần cải thiện gì thêm ạ',
  'Thầy giải thích câu lệnh rất rõ ràng ạ',
  'Em thích cách thầy hướng dẫn từng bước rất dễ theo ạ',
  'Thầy rất thân thiện và kiên nhẫn với tụi em ạ',
  'Mỗi buổi học với thầy đều rất thú vị ạ',
  'Em chúc thầy luôn vui vẻ và dạy lớp mình thật lâu ạ'
];

const CAMPUS_PREFIX_MAP = [
  { prefix: 'PVT', keyword: 'Phan Văn Trị' },
  { prefix: 'PXL', keyword: 'Phan Xích Long' },
  { prefix: 'QT', keyword: 'Quang Trung' },
  { prefix: 'TC', keyword: 'Trường Chinh' },
  { prefix: 'TK', keyword: 'Tô Ký' },
  { prefix: 'NX', keyword: 'Nguyễn Xí' },
  { prefix: 'SH', keyword: 'Song Hành' },
  { prefix: 'NTT', keyword: 'Nguyễn Thị Thập' },
  { prefix: 'PMH', keyword: 'Phú Mỹ Hưng' },
  { prefix: 'PNL', keyword: 'Phạm Ngũ Lão' },
  { prefix: 'LLQ', keyword: 'Lạc Long Quân' },
  { prefix: 'TT', keyword: 'Tây Thạnh' },
  { prefix: 'LBB', keyword: 'Lũy Bán Bích' },
  { prefix: 'KTL', keyword: 'Khu Tên Lửa' },
  { prefix: 'LVV', keyword: 'Lê Văn Việt' },
  { prefix: 'PVD', keyword: 'Phạm Văn Đồng' },
  { prefix: 'MK', keyword: 'Minh Khai' },
  { prefix: 'NCT', keyword: 'Nguyễn Chí Thanh' },
  { prefix: 'NPS', keyword: 'Nguyễn Phong Sắc' },
  { prefix: 'HDT', keyword: 'Hoàng Đạo Thúy' },
  { prefix: 'NVC', keyword: 'Nguyễn Văn Cừ' },
  { prefix: 'LB', keyword: 'Long Biên' }
];

class TeacherPointClient {
  constructor() {
    this.schemaCache = new Map();
  }

  getDefaultFormUrl() {
    return DEFAULT_FORM_URL;
  }

  validateEligibility(classCode = '', sessionNumber = null) {
    const code = String(classCode || '').trim();
    const sNum = parseInt(sessionNumber, 10);
    const isRob = code.toUpperCase().includes('ROB');
    const isValidSession = sNum === 4 || sNum === 8;
    const eligible = isRob && isValidSession;

    return {
      eligible,
      classCode: code,
      sessionNumber: Number.isNaN(sNum) ? null : sNum,
      reason: eligible
        ? 'Hợp lệ'
        : `Phiếu khảo sát Teacher Point chỉ áp dụng cho khối lớp Robotics (ROB) tại Buổi 4 và Buổi 8. (Hiện tại: ${code || 'Chưa chọn lớp'} — ${Number.isNaN(sNum) ? 'Chưa chọn buổi' : `Buổi ${sNum}`}).`
    };
  }

  suggestCampus(classCode = '', campuses = []) {
    const upper = String(classCode || '').toUpperCase();
    for (const rule of CAMPUS_PREFIX_MAP) {
      if (upper.startsWith(rule.prefix) || upper.includes(`${rule.prefix}-`)) {
        const match = campuses.find(c => c.toLowerCase().includes(rule.keyword.toLowerCase()));
        if (match) return match;
      }
    }
    return campuses[0] || '';
  }

  async parseGoogleForm(formUrl = DEFAULT_FORM_URL, forceRefresh = false) {
    const targetUrl = (formUrl && formUrl.trim()) ? formUrl.trim() : DEFAULT_FORM_URL;
    if (!forceRefresh && this.schemaCache.has(targetUrl)) {
      return this.schemaCache.get(targetUrl);
    }

    const res = await fetch(targetUrl);
    if (!res.ok) {
      throw new Error(`Không thể tải Google Form (HTTP ${res.status}).`);
    }

    const html = await res.text();
    const m = html.match(/var\s+FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
    if (!m) {
      throw new Error('Không tìm thấy dữ liệu FB_PUBLIC_LOAD_DATA_ trong Google Form.');
    }

    const data = JSON.parse(m[1]);
    const fbzxMatch = html.match(/name="fbzx"\s+value="([^"]+)"/);
    const fbzx = fbzxMatch ? fbzxMatch[1] : '';

    const rawItems = (data[1] && Array.isArray(data[1][1])) ? data[1][1] : [];
    let pageBreaks = 0;
    const fields = [];
    let campuses = [];

    rawItems.forEach(item => {
      const title = String(item[1] || '').trim();
      const type = item[3];
      if (type === 8) {
        pageBreaks++;
        return;
      }
      const entryBlock = item[4] && item[4][0];
      if (!entryBlock) return;
      const entryId = entryBlock[0];
      const options = Array.isArray(entryBlock[1]) ? entryBlock[1].map(o => String(o[0] || '')) : [];

      if (/cơ sở/i.test(title) && options.length > 0) {
        campuses = options;
      }
      fields.push({ entryId: String(entryId), title, type, options });
    });

    const pageHistory = Array.from({ length: pageBreaks + 1 }, (_, i) => i).join(',');
    const submitUrl = targetUrl.replace(/\/viewform(\?.*)?$/i, '/formResponse');

    const schema = {
      formUrl: targetUrl,
      submitUrl,
      fbzx,
      pageHistory,
      campuses,
      fields
    };

    this.schemaCache.set(targetUrl, schema);
    return schema;
  }

  _pickWeighted5Or4() {
    return Math.random() < 0.8 ? 5 : 4;
  }

  _pickUniqueFromBank(bank, usedSet) {
    if (usedSet.size >= bank.length) usedSet.clear();
    const available = bank.map((_, i) => i).filter(i => !usedSet.has(i));
    const idx = available[Math.floor(Math.random() * available.length)];
    usedSet.add(idx);
    return bank[idx];
  }

  buildFormPayload(schema, { studentName, classCode, campus }, usedActivityIdx = new Set(), usedMessageIdx = new Set()) {
    const params = new URLSearchParams();
    const ratingsSummary = {};

    for (const f of schema.fields) {
      const key = `entry.${f.entryId}`;
      const lowerTitle = f.title.toLowerCase();

      if (lowerTitle.includes('tên của em')) {
        params.append(key, studentName);
      } else if (lowerTitle.includes('mã lớp')) {
        params.append(key, classCode);
      } else if (lowerTitle.includes('cơ sở')) {
        params.append(key, campus || f.options[0] || '');
      } else if (lowerTitle.includes('buổi học trước')) {
        const score = this._pickWeighted5Or4();
        const opt = f.options.find(o => o.startsWith(`${score}:`)) || f.options[f.options.length - 1];
        params.append(key, opt);
        ratingsSummary.prevSession = score;
      } else if (lowerTitle.includes('nội dung thực hành')) {
        const score = this._pickWeighted5Or4();
        const opt = f.options.find(o => o.startsWith(`${score}:`)) || f.options[f.options.length - 1];
        params.append(key, opt);
        ratingsSummary.practiceEase = score;
      } else if (lowerTitle.includes('hình ảnh và video')) {
        const opt = f.options.find(o => /có ạ/i.test(o)) || f.options[0] || 'Có ạ';
        params.append(key, opt);
      } else if (lowerTitle.includes('thích có nhiều video')) {
        const choices = f.options.filter(o =>
          /thầy trực tiếp hướng dẫn/i.test(o) || /video hướng dẫn \+ thầy hướng dẫn/i.test(o)
        );
        const picked = choices.length > 0
          ? choices[Math.floor(Math.random() * choices.length)]
          : (f.options[1] || f.options[0] || '');
        params.append(key, picked);
      } else if (lowerTitle.includes('hoạt động') || lowerTitle.includes('phần thưởng')) {
        params.append(key, this._pickUniqueFromBank(ACTIVITY_REWARD_BANK, usedActivityIdx));
      } else if (lowerTitle.includes('giảng bài dễ hiểu')) {
        const score = String(this._pickWeighted5Or4());
        params.append(key, score);
        ratingsSummary.teachingClarity = Number(score);
      } else if (lowerTitle.includes('yêu thích giáo viên')) {
        const score = String(this._pickWeighted5Or4());
        params.append(key, score);
        ratingsSummary.likeTeacher = Number(score);
      } else if (lowerTitle.includes('yêu thích mindx')) {
        const score = String(this._pickWeighted5Or4());
        params.append(key, score);
        ratingsSummary.likeMindX = Number(score);
      } else if (lowerTitle.includes('cải thiện') || lowerTitle.includes('nhắn gửi')) {
        params.append(key, this._pickUniqueFromBank(TEACHER_MESSAGE_BANK, usedMessageIdx));
      } else if (f.options && f.options.length > 0) {
        params.append(key, f.options[0]);
      }
    }

    params.append('fvv', '1');
    params.append('pageHistory', schema.pageHistory || '0,1,2');
    if (schema.fbzx) {
      params.append('fbzx', schema.fbzx);
    }

    return { params, ratingsSummary };
  }

  async submitSingleStudent({ formUrl, studentName, classCode, sessionNumber, campus, usedActivityIdx, usedMessageIdx }) {
    const eligibility = this.validateEligibility(classCode, sessionNumber);
    if (!eligibility.eligible) {
      const err = new Error(eligibility.reason);
      err.statusCode = 400;
      err.errorCode = 'TEACHER_POINT_INELIGIBLE';
      throw err;
    }

    const t0 = Date.now();
    const schema = await this.parseGoogleForm(formUrl);
    const { params, ratingsSummary } = this.buildFormPayload(
      schema,
      { studentName, classCode, campus },
      usedActivityIdx || new Set(),
      usedMessageIdx || new Set()
    );

    const res = await fetch(schema.submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const elapsedMs = Date.now() - t0;
    const html = await res.text();
    const confirmed =
      res.status === 200 &&
      (/freebirdFormviewerViewResponseConfirmationMessage/i.test(html) ||
       /đã ghi lại câu trả lời|câu trả lời của bạn đã được ghi lại|your response has been recorded/i.test(html));

    if (!confirmed) {
      throw new Error(`Google Form không xác nhận đã lưu câu trả lời (HTTP ${res.status}).`);
    }

    return {
      success: true,
      studentName,
      status: 'SUBMITTED',
      elapsedMs,
      ratingsSummary
    };
  }
}

export const teacherPointClient = new TeacherPointClient();
