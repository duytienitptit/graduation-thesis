import { answerList, Answers } from '../design/answers.js';
import { SpecSnapshot } from '../design/design-session.service.js';
import { QUESTION_SETS } from '../design/question-sets.js';

/** Telegram's limit for a photo caption. */
export const MAX_CAPTION = 1024;

const MORE = '\n…\nXem đầy đủ sau khi nhận task.';

/** Everything a designer needs to decide, in the words the customer saw. */
const VIEW_LABELS: Record<string, string> = {
  BACK: 'mặt sau',
  CLOSE_UP: 'ảnh cận logo hoặc hình in',
  EXTRA: 'góc thêm',
};

/** The view a view task is about, in the words the customer saw. */
export function viewLabel(view: { type: string; description: string | null }) {
  return view.type === 'EXTRA' && view.description
    ? view.description
    : (VIEW_LABELS[view.type] ?? view.type);
}

export function taskSummary(
  specs: SpecSnapshot,
  answers: Answers,
  requirement: string,
  targetView?: { type: string; description: string | null } | null,
) {
  const answered = answerList(QUESTION_SETS[specs.product.shirtType], answers).map(
    ({ label, text }) => `${label} ${text}`,
  );

  const text = [
    `Task mới: ${specs.product.name}`,
    ...(targetView ? [`Chỉ làm một góc: ${viewLabel(targetView)}. Ảnh gửi kèm là mặt trước đã chốt.`] : []),
    `Màu áo: ${specs.colour.name}`,
    `Chất liệu: ${specs.material.name}`,
    `Size ${specs.size}, số lượng ${specs.quantity}`,
    '',
    'Khách cần:',
    requirement,
    '',
    'Câu trả lời của khách:',
    ...answered,
  ].join('\n');

  return text.length <= MAX_CAPTION
    ? text
    : `${text.slice(0, MAX_CAPTION - MORE.length)}${MORE}`;
}
