/**
 * Cấu hình Phong cách nhận xét AI (Preset Styles) & Tùy chỉnh tiêu chí (Custom Criteria)
 */

export const COMMENT_STYLE_STORAGE_KEY = 'commentStyleConfig';

export const DEFAULT_COMMENT_STYLE_CONFIG = {
  mode: 'preset', // 'preset' | 'custom'
  presetId: 'standard',
  customCriteria: '',
  outputFormat: 'paragraph' // 'paragraph' | 'bullets'
};

export const COMMENT_PRESETS = [
  {
    id: 'standard',
    name: 'Chuẩn sư phạm',
    badge: 'Mặc định',
    description: 'Cân bằng, lịch sự, mạch lạc (3–4 câu), khách quan cả điểm mạnh lẫn điểm cần rèn thêm.',
    instruction: 'Phong cách Chuẩn sư phạm: Giọng văn cân bằng, lịch sự, mạch lạc (3–4 câu). Đánh giá khách quan cả điểm mạnh nổi bật lẫn điểm cần rèn luyện thêm.'
  },
  {
    id: 'warm',
    name: 'Ấm áp & Khích lệ',
    badge: '',
    description: 'Nhẹ nhàng, giàu cảm xúc tích cực, ghi nhận nỗ lực nhỏ của con trước khi góp ý khéo léo.',
    instruction: 'Phong cách Ấm áp & Khích lệ: Giọng văn nhẹ nhàng, giàu cảm xúc tích cực, trân trọng từng nỗ lực nhỏ của con trước khi góp ý thật khéo léo và động viên.'
  },
  {
    id: 'concise',
    name: 'Ngắn gọn & Trực diện',
    badge: '',
    description: 'Súc tích (2–3 câu, dưới 50 từ), đi thẳng vào trọng tâm kết quả buổi học, không rườm rà.',
    instruction: 'Phong cách Ngắn gọn & Trực diện: BẮT BUỘC viết thật súc tích trong đúng 2–3 câu (tổng độ dài dưới 50 từ), đi thẳng vào trọng tâm kết quả thực hành và điểm cần lưu ý, tuyệt đối không lan man.'
  },
  {
    id: 'detailed',
    name: 'Chi tiết & Chuyên sâu',
    badge: '',
    description: 'Phân tích kỹ tư duy logic, thao tác kỹ thuật/lắp ráp và gợi ý cụ thể cho buổi sau.',
    instruction: 'Phong cách Chi tiết & Chuyên sâu: Viết 4–5 câu phân tích sâu về tư duy logic, thao tác kỹ thuật/lắp ráp và đưa ra gợi ý rèn luyện cụ thể cho buổi học tới.'
  },
  {
    id: 'friendly',
    name: 'Gần gũi & Năng động',
    badge: '',
    description: 'Tự nhiên như lời trò chuyện của thầy/cô với phụ huynh, trẻ trung, tránh cảm giác văn mẫu AI.',
    instruction: 'Phong cách Gần gũi & Năng động: Giọng văn tự nhiên, trẻ trung như lời thầy/cô trực tiếp trò chuyện chia sẻ với phụ huynh, tránh cảm giác văn mẫu máy móc.'
  }
];

export const CUSTOM_CRITERIA_TEMPLATES = [
  {
    id: 'robotics',
    label: 'Robotics',
    criteria: 'Thái độ học tập, Kỹ năng lắp ráp, Kỹ năng lập trình'
  },
  {
    id: 'coding',
    label: 'Coding',
    criteria: 'Thái độ học tập, Tư duy logic & thuật toán, Hoàn thiện sản phẩm'
  },
  {
    id: 'three_parts',
    label: '3 phần chuẩn',
    criteria: 'Điểm mạnh hôm nay, Điểm cần cải thiện, Lời nhắn cho buổi sau'
  }
];

export function parseCustomCriteria(raw = '') {
  return String(raw || '')
    .split(/[,\n]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export function normalizeStyleConfig(input) {
  if (!input) return { ...DEFAULT_COMMENT_STYLE_CONFIG };
  if (typeof input === 'string') {
    const matched = COMMENT_PRESETS.find(p => p.id === input);
    return {
      ...DEFAULT_COMMENT_STYLE_CONFIG,
      mode: 'preset',
      presetId: matched ? matched.id : 'standard'
    };
  }
  const mode = input.mode === 'custom' ? 'custom' : 'preset';
  const presetExists = COMMENT_PRESETS.some(p => p.id === input.presetId);
  const outputFormat = input.outputFormat === 'bullets' ? 'bullets' : 'paragraph';
  return {
    mode,
    presetId: presetExists ? input.presetId : 'standard',
    customCriteria: typeof input.customCriteria === 'string' ? input.customCriteria : '',
    outputFormat
  };
}

export function buildStylePrompt(styleConfig) {
  const cfg = normalizeStyleConfig(styleConfig);
  const commonConstraints = [
    'TUYỆT ĐỐI KHÔNG tự bịa hoặc chèn họ tên riêng của học viên vào nội dung nhận xét.',
    'TUYỆT ĐỐI KHÔNG dùng ký tự Markdown (không dùng **, ##, *, `).',
    'Chỉ dùng đại từ xưng hô là "con" (viết hoa "Con" ở đầu câu), văn phong tiếng Việt sạch đẹp để hiển thị trực tiếp trên MindX LMS.'
  ].join('\n- ');

  if (cfg.mode === 'custom') {
    const criteriaList = parseCustomCriteria(cfg.customCriteria);
    if (criteriaList.length > 0) {
      const numbered = criteriaList.map((c, idx) => `${idx + 1}. ${c}`).join('\n');
      const formatInstruction = cfg.outputFormat === 'bullets'
        ? `Định dạng đầu ra BẮT BUỘC: Tách rõ từng dòng theo đúng tên tiêu chí (VD:\n${criteriaList.map(c => `- ${c}: [nội dung nhận xét]`).join('\n')}\n).`
        : 'Định dạng đầu ra BẮT BUỘC: Lồng ghép mượt mà tất cả các tiêu chí trên theo đúng thứ tự thành 1 đoạn văn liền mạch, tự nhiên.';

      return `CHẾ ĐỘ TÙY CHỈNH TIÊU CHÍ (CUSTOM CRITERIA):
Bắt buộc nhận xét đầy đủ 100% ${criteriaList.length} tiêu chí sau theo ĐÚNG THỨ TỰ, kết hợp dữ liệu từ Summary buổi học, xếp loại (Giỏi/Khá/...) và ghi chú riêng của học viên:
${numbered}

${formatInstruction}

Ràng buộc chung:
- ${commonConstraints}`;
    }
    // Fallback an toàn khi customCriteria rỗng -> quay về preset 'standard'
    cfg.mode = 'preset';
    cfg.presetId = 'standard';
  }

  const preset = COMMENT_PRESETS.find(p => p.id === cfg.presetId) || COMMENT_PRESETS[0];
  return `PHONG CÁCH HÀNH VĂN (${preset.name}):
${preset.instruction}

Ràng buộc chung:
- ${commonConstraints}`;
}

export function formatStyleSummaryLabel(styleConfig) {
  const cfg = normalizeStyleConfig(styleConfig);
  if (cfg.mode === 'custom') {
    const criteria = parseCustomCriteria(cfg.customCriteria);
    if (criteria.length > 0) {
      const fmtLabel = cfg.outputFormat === 'bullets' ? 'Gạch đầu dòng' : 'Đoạn văn';
      return `✨ Tiêu chí tùy chỉnh (${criteria.length} mục • ${fmtLabel})`;
    }
  }
  const preset = COMMENT_PRESETS.find(p => p.id === cfg.presetId) || COMMENT_PRESETS[0];
  return `✨ Phong cách AI: ${preset.name}`;
}

export function getStyleSignature(styleConfig) {
  const cfg = normalizeStyleConfig(styleConfig);
  return `${cfg.mode}|${cfg.presetId}|${cfg.customCriteria.trim()}|${cfg.outputFormat}`;
}

export async function loadCommentStyleConfig() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(COMMENT_STYLE_STORAGE_KEY);
      if (raw) {
        return normalizeStyleConfig(JSON.parse(raw));
      }
    }
  } catch (_) {}

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get(COMMENT_STYLE_STORAGE_KEY);
      if (res && res[COMMENT_STYLE_STORAGE_KEY]) {
        const cfg = normalizeStyleConfig(res[COMMENT_STYLE_STORAGE_KEY]);
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(COMMENT_STYLE_STORAGE_KEY, JSON.stringify(cfg));
          }
        } catch (_) {}
        return cfg;
      }
    }
  } catch (_) {}

  return { ...DEFAULT_COMMENT_STYLE_CONFIG };
}

export async function saveCommentStyleConfig(styleConfig) {
  const normalized = normalizeStyleConfig(styleConfig);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COMMENT_STYLE_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch (_) {}

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [COMMENT_STYLE_STORAGE_KEY]: normalized });
    }
  } catch (_) {}

  return normalized;
}
