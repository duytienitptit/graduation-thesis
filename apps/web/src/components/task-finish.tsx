'use client';

import { FormEvent, useRef, useState } from 'react';
import { ErrorNote } from '@/components/error-note';
import { Button } from '@/components/ui/button';
import { ApiError, finishTask, sendFinal, TaskDetail, uploadChatImage } from '@/lib/api';

const FAILURES: Record<string, string> = {
  'not-agreed': 'Khách chưa đồng ý mẫu nào, hoặc bạn vừa gửi mẫu mới.',
  'back-required': 'Hãy mô tả mặt sau hoặc gửi ảnh mặt sau.',
  'not-ready': 'Cần khách đồng ý mẫu và bạn đã gửi bản cuối.',
};

const failureText = (e: unknown) => {
  const failure = e as ApiError;
  return (failure.code && FAILURES[failure.code]) ?? failure.message;
};

interface ImagePickProps {
  label: string;
  testId: string;
  file: File | null;
  onPick: (file: File | null) => void;
}

/** The browser's own file box speaks the browser's language, so it stays hidden. */
function ImagePick({ label, testId, file, onPick }: ImagePickProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-4">
      <p className="font-medium">{label}</p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        aria-label={label}
        data-testid={testId}
        className="hidden"
        onChange={(event) => onPick(event.target.files?.[0] ?? null)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => input.current?.click()}>
          Chọn ảnh
        </Button>
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {file?.name ?? 'Chưa chọn ảnh (PNG hoặc JPG)'}
        </span>
      </div>
    </div>
  );
}

/** The designer's last steps: the final with back content, then "Done". */
export function TaskFinish({ task, reload }: { task: TaskDetail; reload: () => Promise<void> }) {
  const [main, setMain] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agreed = !!task.agreedVersionId;
  const hasFinal = !!task.finalVersionId;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!main || (!back && !description.trim())) return;

    setBusy(true);
    setError(null);
    try {
      const fileId = await uploadChatImage(main, 'FINAL_DESIGN');
      const backFileId = back ? await uploadChatImage(back, 'FINAL_DESIGN') : undefined;
      await sendFinal(task.id, {
        fileId,
        backFileId,
        backDescription: description.trim() || undefined,
      });
      setMain(null);
      setBack(null);
      setDescription('');
      setFormKey((key) => key + 1);
      await reload();
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  }

  async function done() {
    setBusy(true);
    setError(null);
    try {
      await finishTask(task.id);
      await reload();
    } catch (e) {
      setError(failureText(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Hoàn thành task" className="mt-8 border-t border-mist pt-6">
      <h2 className="font-semibold">Bản cuối</h2>

      {!agreed && (
        <p className="mt-2 text-muted-foreground" data-testid="final-hint">
          Bản cuối gửi được sau khi khách đồng ý một mẫu.
        </p>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {agreed && (
        <form key={formKey} onSubmit={submit} className="mt-3 max-w-lg">
          {hasFinal && (
            <p className="mb-3 text-sm text-cobalt">
              Đã gửi bản cuối. Gửi lại nếu cần thay, bản mới nhất có hiệu lực.
            </p>
          )}
          <ImagePick
            label="Ảnh chính (mặt trước)"
            testId="final-image"
            file={main}
            onPick={setMain}
          />
          <label htmlFor="back-description" className="mt-4 block font-medium">
            Mô tả mặt sau
          </label>
          <p className="text-sm text-muted-foreground">
            Bắt buộc có mô tả hoặc ảnh mặt sau, vì AI cần biết mặt sau để tạo góc này.
          </p>
          <textarea
            id="back-description"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-2 block w-full border border-mist bg-white px-3 py-2 outline-none focus-visible:border-cobalt focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <ImagePick
            label="Ảnh mặt sau"
            testId="final-back-image"
            file={back}
            onPick={setBack}
          />
          <Button
            type="submit"
            size="lg"
            variant={hasFinal ? 'outline' : 'default'}
            className="mt-4"
            disabled={busy || !main || (!back && !description.trim())}
          >
            {hasFinal ? 'Gửi lại bản cuối' : 'Gửi bản cuối'}
          </Button>
        </form>
      )}

      <div className="mt-8">
        {confirming ? (
          <>
            <p>Sau khi hoàn thành, chat sẽ đóng và hệ thống tạo các góc còn lại từ bản cuối.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="lg" disabled={busy} onClick={() => void done()}>
                Xác nhận hoàn thành
              </Button>
              <Button size="lg" variant="outline" onClick={() => setConfirming(false)}>
                Xem lại
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button size="lg" disabled={!agreed || !hasFinal} onClick={() => setConfirming(true)}>
              Hoàn thành
            </Button>
            {(!agreed || !hasFinal) && (
              <p className="mt-2 text-sm text-muted-foreground">
                Cần khách đồng ý một mẫu và bạn đã gửi bản cuối.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
