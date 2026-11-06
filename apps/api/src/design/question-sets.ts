import { ShirtType } from '../integrations/catalog/catalog.port.js';
import { Question, QuestionOption, QuestionSection, QuestionSet } from './question-set.types.js';

// Wording follows section 4 of docs/01-ai-and-designer-design.md.
// Material, shirt colour, size and quantity come from the product step, so they are not asked here.

const YES_NO: QuestionOption[] = [
  { value: 'yes', label: 'Có' },
  { value: 'no', label: 'Không' },
];

const PATTERNS: QuestionOption[] = [
  { value: 'plain', label: 'Trơn' },
  { value: 'vertical-stripes', label: 'Sọc dọc' },
  { value: 'horizontal-stripes', label: 'Sọc ngang' },
  { value: 'diagonal-stripes', label: 'Sọc chéo' },
  { value: 'gradient', label: 'Chuyển màu' },
];

const LOGO_POSITIONS: QuestionOption[] = [
  { value: 'left-chest', label: 'Ngực trái' },
  { value: 'right-chest', label: 'Ngực phải' },
  { value: 'centre-chest', label: 'Giữa ngực' },
];

const COMMON: QuestionSection = {
  title: 'Câu hỏi chung',
  questions: [
    {
      id: 'occasion',
      type: 'choice',
      label: 'Áo dành cho ai hoặc dịp nào?',
      required: true,
      options: [
        { value: 'personal', label: 'Cá nhân' },
        { value: 'group', label: 'Nhóm hoặc lớp' },
        { value: 'team', label: 'Đội' },
        { value: 'company', label: 'Công ty' },
        { value: 'event', label: 'Sự kiện' },
        { value: 'gift', label: 'Quà tặng' },
      ],
    },
    {
      id: 'style',
      type: 'choice',
      label: 'Bạn thích phong cách nào?',
      required: true,
      options: [
        { value: 'minimal', label: 'Tối giản' },
        { value: 'energetic', label: 'Năng động' },
        { value: 'bold', label: 'Cá tính' },
        { value: 'cute', label: 'Dễ thương' },
        { value: 'classic', label: 'Cổ điển' },
      ],
    },
    {
      id: 'colours_include',
      type: 'text',
      label: 'Những màu nào nên xuất hiện?',
      required: false,
      placeholder: 'Ví dụ: xanh dương và trắng',
    },
    {
      id: 'colours_avoid',
      type: 'text',
      label: 'Những màu nào nên tránh?',
      required: false,
    },
    {
      id: 'has_text',
      type: 'choice',
      label: 'Trên áo có chữ không?',
      required: true,
      options: YES_NO,
    },
    {
      id: 'text_content',
      type: 'text',
      label: 'Nhập chính xác nội dung chữ',
      required: true,
      visibleWhen: { questionId: 'has_text', equals: 'yes' },
    },
    {
      id: 'unwanted',
      type: 'text',
      label: 'Có gì bạn không muốn xuất hiện trên áo?',
      required: false,
    },
    {
      id: 'notes',
      type: 'longText',
      label: 'Bạn muốn mô tả thêm gì không?',
      required: false,
    },
  ],
};

const logoQuestions: Question[] = [
  {
    id: 'has_logo',
    type: 'choice',
    label: 'Đội có logo không?',
    required: true,
    options: YES_NO,
  },
  {
    id: 'logo_position',
    type: 'choice',
    label: 'Logo đặt ở đâu?',
    required: true,
    options: LOGO_POSITIONS,
    visibleWhen: { questionId: 'has_logo', equals: 'yes' },
  },
  {
    id: 'logo_upload',
    type: 'upload',
    label: 'Tải logo lên',
    required: false,
    maxFiles: 1,
    visibleWhen: { questionId: 'has_logo', equals: 'yes' },
  },
];

const teamName: Question = { id: 'team_name', type: 'text', label: 'Tên đội là gì?', required: true };

const pattern: Question = {
  id: 'pattern',
  type: 'choice',
  label: 'Bạn muốn họa tiết nào?',
  required: true,
  options: PATTERNS,
};

const sampleName: Question = {
  id: 'sample_name',
  type: 'text',
  label: 'Tên mẫu in trên áo',
  required: false,
  placeholder: 'Chỉ để hiện trên ảnh mẫu',
};

const sampleNumber: Question = {
  id: 'sample_number',
  type: 'text',
  label: 'Số áo mẫu',
  required: false,
  placeholder: 'Chỉ để hiện trên ảnh mẫu',
};

const PRINTED: QuestionSection = {
  title: 'Về hình in',
  questions: [
    {
      id: 'main_image',
      type: 'longText',
      label: 'Hình chính trên áo là gì?',
      required: true,
    },
    {
      id: 'image_style',
      type: 'choice',
      label: 'Hình theo kiểu nào?',
      required: true,
      options: [
        { value: 'cartoon', label: 'Hoạt hình' },
        { value: 'hand-drawn', label: 'Vẽ tay' },
        { value: 'photo', label: 'Giống ảnh chụp' },
        { value: 'text-only', label: 'Chỉ có chữ' },
      ],
    },
    {
      id: 'print_placement',
      type: 'choice',
      label: 'In ở đâu và kích thước thế nào?',
      required: true,
      options: [
        { value: 'large-centre-chest', label: 'To giữa ngực' },
        { value: 'small-left-chest', label: 'Nhỏ ở ngực trái' },
      ],
    },
    {
      id: 'back_print',
      type: 'choice',
      label: 'Mặt sau để trơn hay có in?',
      required: true,
      options: [
        { value: 'plain', label: 'Để trơn' },
        { value: 'printed', label: 'Có in' },
      ],
    },
    {
      id: 'back_description',
      type: 'text',
      label: 'Mặt sau in gì?',
      required: true,
      visibleWhen: { questionId: 'back_print', equals: 'printed' },
    },
    {
      id: 'reference_upload',
      type: 'upload',
      label: 'Tải ảnh tham khảo lên',
      required: false,
      maxFiles: 3,
    },
  ],
};

const FOOTBALL: QuestionSection = {
  title: 'Về áo đá bóng',
  questions: [
    teamName,
    pattern,
    {
      id: 'collar',
      type: 'choice',
      label: 'Bạn muốn kiểu cổ nào?',
      required: true,
      options: [
        { value: 'round', label: 'Cổ tròn' },
        { value: 'v-neck', label: 'Cổ tim' },
        { value: 'polo', label: 'Cổ polo' },
      ],
    },
    ...logoQuestions,
    sampleName,
    sampleNumber,
    { id: 'sponsor', type: 'text', label: 'Có tên nhà tài trợ không?', required: false },
  ],
};

const VOLLEYBALL: QuestionSection = {
  title: 'Về áo bóng chuyền',
  questions: [
    teamName,
    {
      id: 'sleeve',
      type: 'choice',
      label: 'Bạn muốn kiểu tay nào?',
      required: true,
      options: [
        { value: 'sleeveless', label: 'Sát nách' },
        { value: 'short', label: 'Tay ngắn' },
      ],
    },
    pattern,
    ...logoQuestions,
    {
      id: 'number_position',
      type: 'choice',
      label: 'Số áo in ở đâu?',
      required: true,
      options: [
        { value: 'front', label: 'Mặt trước' },
        { value: 'back', label: 'Mặt sau' },
        { value: 'both', label: 'Cả hai mặt' },
      ],
    },
    sampleName,
    sampleNumber,
    {
      id: 'libero',
      type: 'choice',
      label: 'Có cần áo libero khác màu không?',
      required: true,
      options: YES_NO,
    },
    {
      id: 'libero_note',
      type: 'text',
      label: 'Áo libero màu gì?',
      required: false,
      visibleWhen: { questionId: 'libero', equals: 'yes' },
    },
  ],
};

export const QUESTION_SETS: Record<ShirtType, QuestionSet> = {
  PRINTED: { sections: [PRINTED, COMMON] },
  FOOTBALL: { sections: [FOOTBALL, COMMON] },
  VOLLEYBALL: { sections: [VOLLEYBALL, COMMON] },
};
