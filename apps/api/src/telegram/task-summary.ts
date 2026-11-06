import { answerList, Answers } from '../design/answers.js';
import { SpecSnapshot } from '../design/design-session.service.js';
import { QUESTION_SETS } from '../design/question-sets.js';

/** Telegram's limit for a photo caption. */
export const MAX_CAPTION = 1024;

const MORE = '\n…\nXem đầy đủ sau khi nhận task.';

/** Everything a designer needs to decide, in the words the customer saw. */
export function taskSummary(specs: SpecSnapshot, answers: Answers, requirement: string) {
  const answered = answerList(QUESTION_SETS[specs.product.shirtType], answers).map(
    ({ label, text }) => `${label} ${text}`,
  );

  const text = [
    `Task mới: ${specs.product.name}`,
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
