'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { ErrorNote } from '@/components/error-note';
import { QuestionField } from '@/components/question-field';
import { Button } from '@/components/ui/button';
import {
  AnswerError,
  Answers,
  ApiError,
  DesignSession,
  getQuestions,
  getSession,
  Question,
  QuestionSet,
  saveAnswers,
  submitAnswers,
} from '@/lib/api';
import { useUser } from '@/lib/use-user';

const AUTOSAVE_MS = 800;

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed';

const SAVE_LABELS: Record<SaveState, string> = {
  idle: '',
  dirty: 'Có thay đổi chưa lưu',
  saving: 'Đang lưu…',
  saved: 'Đã lưu nháp',
  failed: 'Chưa lưu được. Hãy kiểm tra các câu được đánh dấu.',
};

const isVisible = (question: Question, answers: Answers) =>
  !question.visibleWhen || answers[question.visibleWhen.questionId] === question.visibleWhen.equals;

export default function DesignSessionPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const [session, setSession] = useState<DesignSession | null>(null);
  const [questions, setQuestions] = useState<QuestionSet | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<AnswerError[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Saves run one after another, so an older save can never land last.
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestAnswers = useRef<Answers>({});

  useEffect(() => {
    if (!user) return;
    getSession(id)
      .then(async (loaded) => {
        const set = await getQuestions(loaded.specSnapshot.product.id);
        latestAnswers.current = loaded.answers;
        setAnswers(loaded.answers);
        setQuestions(set);
        setSession(loaded);
      })
      .catch((e: ApiError) =>
        setPageError(e.status === 404 || e.status === 403 ? 'Không tìm thấy thiết kế này.' : e.message),
      );
  }, [id, user]);

  const save = useCallback(() => {
    clearTimeout(timer.current);
    setSaveState('saving');
    const run = saveChain.current.then(async () => {
      await saveAnswers(id, latestAnswers.current);
      setSaveState('saved');
      setErrors([]);
    });
    saveChain.current = run.catch(() => undefined);
    return run;
  }, [id]);

  const autosave = useCallback(() => {
    save().catch((e: ApiError) => {
      setSaveState('failed');
      setErrors(e.answerErrors);
    });
  }, [save]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function change(questionId: string, value: string | string[] | undefined) {
    const next = { ...latestAnswers.current };
    if (value === undefined) delete next[questionId];
    else next[questionId] = value;
    latestAnswers.current = next;
    setAnswers(next);
    setErrors((current) => current.filter((error) => error.questionId !== questionId));
    setSaveState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(autosave, AUTOSAVE_MS);
  }

  async function submit() {
    setSubmitting(true);
    setPageError(null);
    try {
      await save();
      setSession(await submitAnswers(id));
      setSaveState('idle');
      window.scrollTo({ top: 0 });
    } catch (e) {
      const error = e as ApiError;
      setSaveState('idle');
      setErrors(error.answerErrors);
      if (error.answerErrors.length) {
        const first = error.answerErrors[0].questionId;
        document.getElementById(`question-${first}`)?.scrollIntoView({ block: 'center' });
      } else {
        setPageError(error.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const spec = session?.specSnapshot;
  const answered = session?.status === 'ANSWERED';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-24 sm:px-8">
      <AppHeader user={user} />

      <main className="mt-10">
        {pageError && <ErrorNote>{pageError}</ErrorNote>}

        {spec && questions && (
          <>
            <h1 className="overprint text-6xl font-extrabold sm:text-7xl">{spec.product.name}</h1>
            <p className="mt-3 text-muted-foreground">
              {spec.colour.name}, {spec.material.name.toLowerCase()}, size {spec.size}, số lượng{' '}
              {spec.quantity}
            </p>

            {answered && (
              <p role="status" className="mt-6 border-l-4 border-cobalt pl-3">
                Bạn đã gửi câu trả lời. Các câu trả lời bên dưới không thể sửa nữa.
              </p>
            )}

            {questions.sections.map((section) => (
              <section key={section.title} className="mt-12">
                <h2 className="overprint text-3xl font-extrabold">{section.title}</h2>
                {section.questions
                  .filter((question) => isVisible(question, answers))
                  .map((question) => (
                    <QuestionField
                      key={question.id}
                      question={question}
                      value={answers[question.id]}
                      error={errors.find((error) => error.questionId === question.id)?.code}
                      disabled={answered}
                      onChange={(value) => change(question.id, value)}
                    />
                  ))}
              </section>
            ))}

            {!answered && (
              <div className="mt-12 flex flex-wrap items-center gap-4">
                <Button size="lg" onClick={() => void submit()} disabled={submitting}>
                  {submitting ? 'Đang gửi…' : 'Gửi câu trả lời'}
                </Button>
                <p aria-live="polite" className="text-sm text-muted-foreground" data-testid="save-state">
                  {SAVE_LABELS[saveState]}
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
