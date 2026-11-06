'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { ErrorNote } from '@/components/error-note';
import { ProductViews } from '@/components/product-views';
import { TaskChatPanel } from '@/components/task-chat';
import { Button } from '@/components/ui/button';
import {
  ApiError,
  apiUrl,
  chooseMainImage,
  createImage,
  createTask,
  DesignTask,
  editImage,
  getToken,
  getWorkspace,
  Workspace,
} from '@/lib/api';

const MAX_REQUEST_LENGTH = 1000;

const resetTime = (iso: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso));

const WAIT_NOTES: Record<NonNullable<DesignTask['waitReason']>, string> = {
  'out-of-hours': 'Hiện ngoài giờ làm việc. Yêu cầu của bạn sẽ được gửi lúc 9:00.',
  'no-free-designer': 'Hiện chưa có designer rảnh. Yêu cầu sẽ được gửi ngay khi có người rảnh.',
};

function TaskPanel({ task }: { task: DesignTask }) {
  return (
    <div data-testid="task-panel">
      <h2 className="overprint text-3xl font-extrabold">Đang tìm designer…</h2>
      <p className="mt-3 text-muted-foreground">Designer làm việc từ 9:00 đến 17:00 mỗi ngày.</p>
      {task.waitReason && <p className="mt-2">{WAIT_NOTES[task.waitReason]}</p>}
      <p className="mt-6 text-sm font-semibold">Yêu cầu của bạn</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{task.requirement}</p>
    </div>
  );
}

interface StudioProps {
  sessionId: string;
  hasLogo: boolean;
  logoPosition?: string;
}

export function DesignStudio({ sessionId, hasLogo, logoPosition }: StudioProps) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [askingDesigner, setAskingDesigner] = useState(false);
  const [requirement, setRequirement] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await getWorkspace(sessionId);
      setWorkspace(next);
      // A finished job moves the view to the newest image.
      setSelectedId((current) => {
        const known = next.versions.some((version) => version.id === current);
        const justFinished = next.latestJob?.status === 'DONE';
        return known && !justFinished ? current : (next.versions.at(-1)?.id ?? null);
      });
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [sessionId]);

  useEffect(() => {
    void reload();
    // Reloading on connect also covers anything missed while offline.
    const socket = io(apiUrl, { auth: { token: getToken() } });
    socket.on('connect', () => void reload());
    const onSessionEvent = (event: { sessionId: string }) => {
      if (event.sessionId === sessionId) void reload();
    };
    socket.on('design.image-job', onSessionEvent);
    socket.on('design.task', onSessionEvent);
    return () => {
      socket.disconnect();
    };
  }, [reload, sessionId]);

  async function run(action: () => Promise<unknown>) {
    setSending(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      const failure = e as ApiError;
      if (failure.code === 'daily-limit') await reload();
      else if (failure.status === 409) setError('Ảnh trước đang được tạo. Hãy chờ một chút.');
      else setError(failure.message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !requirement.trim()) return;
    await run(() => createTask(sessionId, selectedId, requirement));
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !editText.trim()) return;
    if (await run(() => editImage(sessionId, selectedId, editText))) setEditText('');
  }

  if (!workspace) {
    return <p className="mt-8 text-muted-foreground">{error ?? 'Đang tải…'}</p>;
  }

  if (workspace.status === 'VIEWS' || workspace.status === 'LOCKED') {
    return (
      <>
        <ProductViews
          sessionId={sessionId}
          workspace={workspace}
          hasLogo={hasLogo}
          logoPosition={logoPosition}
          reload={reload}
        />
        {workspace.task?.status === 'DONE' && (
          <details className="mt-10 border-t border-mist pt-4">
            <summary className="cursor-pointer font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Xem lại chat với designer
            </summary>
            <TaskChatPanel taskId={workspace.task.id} />
          </details>
        )}
      </>
    );
  }

  if (workspace.status === 'DESIGNER' && workspace.task?.status === 'ASSIGNED') {
    return (
      <section aria-label="Làm việc với designer" className="mt-8" data-testid="task-panel">
        <h2 className="overprint text-3xl font-extrabold">Đã có designer nhận</h2>
        <p className="mt-3">
          {workspace.task.designerName} đã nhận yêu cầu của bạn. Hai bên trao đổi ở đây. Khi ưng một
          mẫu, bạn bấm &quot;Đồng ý mẫu này&quot;.
        </p>
        <TaskChatPanel taskId={workspace.task.id} withBrief />
      </section>
    );
  }

  const { versions, latestJob, usage } = workspace;
  const selected = versions.find((version) => version.id === selectedId);
  const generating = latestJob?.status === 'QUEUED' || latestJob?.status === 'RUNNING';
  const failed = latestJob?.status === 'FAILED';
  const outOfCredits = usage.remaining === 0;
  const canWork = workspace.status === 'ANSWERED';

  return (
    <section aria-label="Ảnh thiết kế" className="mt-8">
      <div className="grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <div className="relative flex aspect-square items-center justify-center overflow-hidden border border-mist bg-white">
            {selected ? (
              // eslint-disable-next-line @next/next/no-img-element -- expiring storage link
              <img src={selected.imageUrl} alt="Ảnh áo đang xem" className="size-full object-contain" />
            ) : (
              !generating && (
                <p className="px-6 text-center text-muted-foreground">Chưa có ảnh nào.</p>
              )
            )}
            {generating && (
              <p
                role="status"
                className="absolute inset-x-0 bottom-0 bg-cobalt px-4 py-3 text-center font-medium text-white motion-safe:animate-pulse"
              >
                Đang tạo ảnh, thường mất khoảng 10 giây…
              </p>
            )}
          </div>
        </div>

        <div>
          {workspace.status === 'DESIGNER' && workspace.task && (
            <TaskPanel task={workspace.task} />
          )}

          {failed && workspace.status !== 'DESIGNER' && (
            <ErrorNote>
              Không tạo được ảnh. Lượt này không bị tính. Hãy thử lại, hoặc đổi cách diễn đạt nếu ảnh
              bị từ chối.
            </ErrorNote>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}

          {canWork && !versions.length && !generating && (
            <Button
              size="lg"
              className="mt-4"
              disabled={sending || outOfCredits}
              onClick={() => void run(() => createImage(sessionId))}
            >
              {failed ? 'Tạo lại ảnh' : 'Tạo ảnh đầu tiên'}
            </Button>
          )}

          {canWork && versions.length > 0 && !askingDesigner && (
            <form onSubmit={submitEdit}>
              <label htmlFor="edit-request" className="font-semibold">
                Bạn muốn sửa gì ở ảnh này?
              </label>
              <textarea
                id="edit-request"
                rows={4}
                maxLength={MAX_REQUEST_LENGTH}
                value={editText}
                disabled={generating}
                onChange={(event) => setEditText(event.target.value)}
                placeholder="Ví dụ: làm logo to hơn, đổi cổ áo sang cổ tròn"
                className="mt-3 block w-full border border-mist bg-white px-3 py-2 outline-none disabled:opacity-70 focus-visible:border-cobalt focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="lg"
                  disabled={sending || generating || outOfCredits || !editText.trim()}
                >
                  Sửa bằng AI
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  disabled={generating}
                  onClick={() => {
                    setRequirement(editText);
                    setAskingDesigner(true);
                  }}
                >
                  Cần designer hỗ trợ
                </Button>
              </div>
            </form>
          )}

          {canWork && askingDesigner && (
            <form onSubmit={submitTask}>
              <label htmlFor="task-requirement" className="font-semibold">
                Bạn cần designer giúp gì?
              </label>
              <p className="mt-1 text-sm text-muted-foreground">
                Miễn phí. Designer sẽ nhận ảnh đang xem và câu trả lời của bạn. Trong lúc chờ, bạn
                không sửa bằng AI được.
              </p>
              <textarea
                id="task-requirement"
                rows={4}
                maxLength={2000}
                value={requirement}
                onChange={(event) => setRequirement(event.target.value)}
                className="mt-3 block w-full border border-mist bg-white px-3 py-2 outline-none focus-visible:border-cobalt focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="submit" size="lg" disabled={sending || !requirement.trim()}>
                  Gửi cho designer
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  onClick={() => setAskingDesigner(false)}
                >
                  Quay lại
                </Button>
              </div>
            </form>
          )}

          {canWork && versions.length > 0 && !generating && !askingDesigner && (
            <div className="mt-8 border-t border-mist pt-6">
              {confirming ? (
                <>
                  <p>
                    Sau khi chọn, ảnh này không sửa được nữa. Hệ thống sẽ tạo mặt sau và ảnh cận, dùng
                    2 lượt.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      disabled={sending || !selected}
                      onClick={() =>
                        void run(() => chooseMainImage(sessionId, selected!.id)).then(() =>
                          setConfirming(false),
                        )
                      }
                    >
                      Chọn ảnh này
                    </Button>
                    <Button variant="outline" onClick={() => setConfirming(false)}>
                      Xem lại
                    </Button>
                  </div>
                </>
              ) : (
                <Button variant="outline" size="lg" onClick={() => setConfirming(true)}>
                  Tôi ưng ảnh này
                </Button>
              )}
            </div>
          )}

          {canWork && (
            <p className="mt-6 text-sm text-muted-foreground" data-testid="usage">
              {outOfCredits
                ? `Bạn đã dùng hết ${usage.limit} lượt hôm nay. Lượt mới có lúc ${resetTime(usage.resetsAt)}. Bạn vẫn có thể nhờ designer.`
                : `Còn ${usage.remaining} trong ${usage.limit} lượt hôm nay.`}
            </p>
          )}
        </div>
      </div>

      {versions.length > 1 && (
        <div className="mt-8">
          <h2 className="font-semibold">Các phiên bản</h2>
          <ol className="mt-3 flex gap-3 overflow-x-auto pb-2">
            {versions.map((version, index) => (
              <li key={version.id} className="w-28 shrink-0">
                <button
                  type="button"
                  aria-current={version.id === selectedId}
                  aria-label={`Xem phiên bản ${index + 1}`}
                  onClick={() => setSelectedId(version.id)}
                  className={`block size-28 border-2 bg-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                    version.id === selectedId ? 'border-cobalt' : 'border-mist hover:border-cobalt'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- expiring storage link */}
                  <img src={version.imageUrl} alt="" className="size-full object-contain" />
                </button>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {version.editRequest ?? `Bản đầu tiên`}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
