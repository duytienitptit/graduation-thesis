'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, AnswerError, getImageUrl, Question, uploadImage } from '@/lib/api';

const ERROR_LABELS: Record<AnswerError['code'], string> = {
  required: 'Hãy trả lời câu này.',
  invalid: 'Câu trả lời này không hợp lệ.',
  'too-long': 'Nội dung quá dài. Hãy rút ngắn lại.',
  'too-many-files': 'Có quá nhiều ảnh. Hãy bỏ bớt.',
  unknown: 'Câu hỏi này không còn dùng nữa.',
};

const INPUT =
  'mt-3 block w-full border border-mist bg-white px-3 py-2 outline-none disabled:opacity-70 focus-visible:border-cobalt focus-visible:ring-3 focus-visible:ring-ring/50';

const OPTION =
  'cursor-pointer border border-mist bg-white/60 px-4 py-2 transition-colors hover:border-cobalt has-checked:border-cobalt has-checked:bg-cobalt has-checked:text-white has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:cursor-default has-disabled:hover:border-mist';

interface FieldProps<Value> {
  question: Question;
  value: Value;
  error?: AnswerError['code'];
  disabled: boolean;
  onChange: (value: Value) => void;
}

function Label({ question }: { question: Question }) {
  return (
    <>
      {question.label}
      {!question.required && (
        <span className="ml-2 text-sm font-normal text-muted-foreground">Không bắt buộc</span>
      )}
    </>
  );
}

function UploadField({ question, value, disabled, onChange }: FieldProps<string[]>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxFiles = question.type === 'upload' ? question.maxFiles : 0;

  useEffect(() => {
    // Links expire, so saved images get a fresh one when the screen opens.
    for (const id of value) {
      if (urls[id]) continue;
      getImageUrl(id)
        .then((url) => setUrls((current) => ({ ...current, [id]: url })))
        .catch(() => undefined);
    }
  }, [value, urls]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { fileId, url } = await uploadImage(file);
      setUrls((current) => ({ ...current, [fileId]: url }));
      onChange([...value, fileId]);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <p className="font-semibold">
        <Label question={question} />
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        PNG hoặc JPG, tối đa 10 MB, tối đa {maxFiles} ảnh.
      </p>

      {value.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3">
          {value.map((id) => (
            <li key={id} className="w-28">
              {urls[id] && (
                // eslint-disable-next-line @next/next/no-img-element -- expiring storage link
                <img src={urls[id]} alt="Ảnh đã tải lên" className="size-28 border border-mist bg-white object-contain" />
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((other) => other !== id))}
                  className="mt-1 text-sm text-muted-foreground underline outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  Bỏ ảnh này
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && value.length < maxFiles && (
        <label className="mt-3 flex min-h-20 cursor-pointer items-center justify-center border-2 border-dashed border-muted-foreground/50 px-4 text-center transition-colors hover:border-cobalt focus-within:ring-3 focus-within:ring-ring/50">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            aria-label={question.label}
            className="sr-only"
            disabled={busy}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <span className="font-medium">{busy ? 'Đang tải ảnh lên…' : 'Chọn ảnh'}</span>
        </label>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-magenta">
          {error}
        </p>
      )}
    </div>
  );
}

export function QuestionField(props: FieldProps<string | string[] | undefined>) {
  const { question, value, error, disabled, onChange } = props;

  const field = (() => {
    switch (question.type) {
      case 'choice':
        return (
          <fieldset>
            <legend className="font-semibold">
              <Label question={question} />
            </legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {question.options.map((option) => (
                <label key={option.value} className={OPTION}>
                  <input
                    type="radio"
                    name={question.id}
                    className="sr-only"
                    disabled={disabled}
                    checked={value === option.value}
                    onChange={() => onChange(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        );
      case 'text':
      case 'longText': {
        const shared = {
          id: question.id,
          value: (value as string) ?? '',
          disabled,
          placeholder: question.placeholder,
          className: INPUT,
        };
        return (
          <>
            <label htmlFor={question.id} className="font-semibold">
              <Label question={question} />
            </label>
            {question.type === 'text' ? (
              <input {...shared} maxLength={300} onChange={(e) => onChange(e.target.value)} />
            ) : (
              <textarea {...shared} rows={3} maxLength={2000} onChange={(e) => onChange(e.target.value)} />
            )}
          </>
        );
      }
      case 'upload':
        return (
          <UploadField
            question={question}
            value={(value as string[]) ?? []}
            disabled={disabled}
            onChange={onChange}
          />
        );
    }
  })();

  return (
    <div className="mt-8" id={`question-${question.id}`}>
      {field}
      {error && (
        <p role="alert" className="mt-2 text-sm text-magenta">
          {ERROR_LABELS[error]}
        </p>
      )}
    </div>
  );
}
