import { Answers } from '../design/answers.js';
import { SpecSnapshot } from '../design/design-session.service.js';
import { Question } from '../design/question-set.types.js';
import { QUESTION_SETS } from '../design/question-sets.js';

/** Telegram's limit for a photo caption. */
export const MAX_CAPTION = 1024;

const MORE = '\n…\nXem đầy đủ sau khi nhận task.';

function answerText(question: Question, value: Answers[string]) {
  if (question.type === 'upload') return `${(value as string[]).length} ảnh tải lên`;
  if (question.type === 'choice') {
    return question.options.find((option) => option.value === value)?.label ?? String(value);
  }
  return String(value);
}

/** Everything a designer needs to decide, in the words the customer saw. */
export function taskSummary(specs: SpecSnapshot, answers: Answers, requirement: string) {
  const questions = QUESTION_SETS[specs.product.shirtType].sections.flatMap(
    (section) => section.questions,
  );
  const answered = questions
    .filter((question) => answers[question.id] !== undefined)
    .map((question) => `${question.label} ${answerText(question, answers[question.id])}`);

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
