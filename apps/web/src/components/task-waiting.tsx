'use client';

import { useState } from 'react';
import { ErrorNote } from '@/components/error-note';
import { Button } from '@/components/ui/button';
import { ApiError, cancelTask, DesignTask } from '@/lib/api';

const WAIT_NOTES: Record<NonNullable<DesignTask['waitReason']>, string> = {
  'out-of-hours': 'Hiện ngoài giờ làm việc. Yêu cầu của bạn sẽ được gửi lúc 9:00.',
  'no-free-designer': 'Hiện chưa có designer rảnh. Yêu cầu sẽ được gửi ngay khi có người rảnh.',
};

const when = (iso: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso));

/** A task nobody has taken yet: why it waits, and the cancel button after 48 hours. */
export function TaskWaiting({
  task,
  title = 'Đang tìm designer…',
  onChange,
}: {
  task: DesignTask;
  title?: string;
  onChange: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCancel = Date.now() >= new Date(task.cancellableAt).getTime();

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await cancelTask(task.id);
      await onChange();
    } catch (e) {
      const failure = e as ApiError;
      setError(
        failure.code === 'not-waiting'
          ? 'Designer vừa nhận yêu cầu này nên không hủy được nữa.'
          : failure.message,
      );
      await onChange();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div data-testid="task-waiting">
      <h2 className="overprint text-3xl font-extrabold">{title}</h2>
      <p className="mt-3 text-muted-foreground">Designer làm việc từ 9:00 đến 17:00 mỗi ngày.</p>
      {task.waitReason && <p className="mt-2">{WAIT_NOTES[task.waitReason]}</p>}
      {task.noTakerNotice && (
        <p role="status" className="mt-3 border-l-4 border-magenta pl-3">
          Đã hơn 2 giờ làm việc mà chưa designer nào nhận. Yêu cầu vẫn tiếp tục chờ và được gửi lại
          lúc 9:00 mỗi ngày.
        </p>
      )}
      <p className="mt-6 text-sm font-semibold">Yêu cầu của bạn</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{task.requirement}</p>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mt-6">
        {!canCancel ? (
          <p className="text-sm text-muted-foreground">
            Nếu đến {when(task.cancellableAt)} vẫn chưa ai nhận, bạn có thể hủy yêu cầu.
          </p>
        ) : confirming ? (
          <>
            <p>Hủy yêu cầu này? Bạn có thể quay lại sửa bằng AI hoặc nhờ designer lần nữa.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void cancel()}>
                Hủy yêu cầu
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Tiếp tục chờ
              </Button>
            </div>
          </>
        ) : (
          <Button variant="outline" onClick={() => setConfirming(true)}>
            Hủy yêu cầu
          </Button>
        )}
      </div>
    </div>
  );
}
