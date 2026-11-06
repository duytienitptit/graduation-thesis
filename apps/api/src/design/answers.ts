import { Question, QuestionSet } from './question-set.types.js';

export const MAX_TEXT_LENGTH = 300;
export const MAX_LONG_TEXT_LENGTH = 2000;

export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;

export interface AnswerError {
  questionId: string;
  code: 'unknown' | 'invalid' | 'too-long' | 'too-many-files' | 'required';
}

const questionsOf = (set: QuestionSet) => set.sections.flatMap((section) => section.questions);

function isVisible(question: Question, answers: Record<string, unknown>) {
  const rule = question.visibleWhen;
  return !rule || answers[rule.questionId] === rule.equals;
}

function checkValue(question: Question, value: unknown): AnswerError['code'] | null {
  switch (question.type) {
    case 'choice':
      return question.options.some((option) => option.value === value) ? null : 'invalid';
    case 'text':
    case 'longText': {
      if (typeof value !== 'string') return 'invalid';
      const max = question.type === 'text' ? MAX_TEXT_LENGTH : MAX_LONG_TEXT_LENGTH;
      return value.length > max ? 'too-long' : null;
    }
    case 'upload':
      if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) return 'invalid';
      return value.length > question.maxFiles ? 'too-many-files' : null;
  }
}

const isEmpty = (value: unknown) =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

/**
 * Checks a draft, which may be partial. Empty answers and answers to questions
 * that are hidden by another answer are dropped, so they never reach the prompt.
 */
export function cleanAnswers(set: QuestionSet, raw: Record<string, unknown>) {
  const questions = questionsOf(set);
  const errors: AnswerError[] = Object.keys(raw)
    .filter((id) => !questions.some((question) => question.id === id))
    .map((questionId) => ({ questionId, code: 'unknown' }));

  const answers: Answers = {};
  for (const question of questions) {
    const value = raw[question.id];
    if (isEmpty(value)) continue;

    const code = checkValue(question, value);
    if (code) errors.push({ questionId: question.id, code });
    else if (isVisible(question, raw)) {
      answers[question.id] = typeof value === 'string' ? value.trim() : (value as string[]);
    }
  }
  return { answers, errors };
}

export function missingRequired(set: QuestionSet, answers: Answers): AnswerError[] {
  return questionsOf(set)
    .filter((question) => question.required && isVisible(question, answers))
    .filter((question) => isEmpty(answers[question.id]))
    .map((question) => ({ questionId: question.id, code: 'required' }));
}

/** The uploaded file ids inside a set of answers. */
export function uploadedFileIds(set: QuestionSet, answers: Answers) {
  return questionsOf(set)
    .filter((question) => question.type === 'upload')
    .flatMap((question) => answers[question.id] ?? []);
}
