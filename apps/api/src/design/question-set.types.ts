export interface QuestionOption {
  value: string;
  label: string;
}

interface BaseQuestion {
  /** Stable key: answers and the prompt builder use it, so do not rename casually. */
  id: string;
  label: string;
  required: boolean;
  /** Shown only when another question has this answer. */
  visibleWhen?: { questionId: string; equals: string };
}

export interface ChoiceQuestion extends BaseQuestion {
  type: 'choice';
  options: QuestionOption[];
}

export interface TextQuestion extends BaseQuestion {
  type: 'text' | 'longText';
  placeholder?: string;
}

export interface UploadQuestion extends BaseQuestion {
  type: 'upload';
  maxFiles: number;
}

export type Question = ChoiceQuestion | TextQuestion | UploadQuestion;

export interface QuestionSection {
  title: string;
  questions: Question[];
}

export interface QuestionSet {
  sections: QuestionSection[];
}
