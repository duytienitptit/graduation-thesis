'use client';

import { FormEvent, useState } from 'react';
import { ErrorNote } from '@/components/error-note';
import { TaskChatPanel } from '@/components/task-chat';
import { TaskWaiting } from '@/components/task-waiting';
import { Button } from '@/components/ui/button';
import {
  addExtraView,
  ApiError,
  approveView,
  createViewTask,
  generateView,
  isOpenTask,
  lockProduct,
  ProductView,
  regenerateView,
  Workspace,
} from '@/lib/api';

const MAX_EXTRA_VIEWS = 2;

interface Props {
  sessionId: string;
  workspace: Workspace;
  hasLogo: boolean;
  logoPosition?: string;
}

function viewLabel(view: ProductView, hasLogo: boolean) {
  switch (view.type) {
    case 'FRONT':
      return 'Mặt trước';
    case 'BACK':
      return 'Mặt sau';
    case 'CLOSE_UP':
      return hasLogo ? 'Cận logo' : 'Cận hình in';
    case 'EXTRA':
      return view.description ?? 'Góc thêm';
  }
}

export function ProductViews({
  sessionId,
  workspace,
  hasLogo,
  logoPosition,
  reload,
}: Props & { reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extra, setExtra] = useState('');
  const [confirmingLock, setConfirmingLock] = useState(false);
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const [requirement, setRequirement] = useState('');

  const { usage, status } = workspace;
  const locked = status === 'LOCKED';
  // An extra view left unapproved is not part of the locked product.
  const views = locked
    ? workspace.views.filter((view) => view.status === 'APPROVED')
    : workspace.views;
  const extras = views.filter((view) => view.type === 'EXTRA');
  const required = views.filter((view) => view.type !== 'EXTRA');
  const allApproved = required.length === 3 && required.every((view) => view.status === 'APPROVED');
  const working = views.some(
    (view) => view.jobStatus === 'QUEUED' || view.jobStatus === 'RUNNING',
  );
  const noCredits = usage.remaining === 0;
  const withDesigner = views.filter((view) => isOpenTask(view.task));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      const failure = e as ApiError;
      setError(
        failure.code === 'daily-limit'
          ? 'Bạn đã hết lượt hôm nay. Hãy quay lại sau 00:00.'
          : failure.code === 'view-with-designer'
            ? 'Góc này đang có designer làm. Hãy chờ designer xong.'
            : failure.message,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitViewTask(event: FormEvent, viewId: string) {
    event.preventDefault();
    if (!requirement.trim()) return;
    if (await run(() => createViewTask(sessionId, viewId, requirement))) {
      setAskingFor(null);
      setRequirement('');
    }
  }

  async function submitExtra(event: FormEvent) {
    event.preventDefault();
    if (extra.trim() && (await run(() => addExtraView(sessionId, extra)))) setExtra('');
  }

  return (
    <section aria-label="Các góc của sản phẩm" className="mt-8">
      {locked ? (
        <p role="status" className="border-l-4 border-cobalt pl-3 font-medium">
          Sản phẩm đã được chốt. Bạn không thể sửa ảnh nữa.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Duyệt từng góc. Góc chưa ưng có thể tạo lại riêng, các góc đã duyệt giữ nguyên.
        </p>
      )}

      {hasLogo && logoPosition && (
        <p className="mt-2 text-sm text-muted-foreground">
          Vị trí logo bạn đã chọn: {logoPosition.toLowerCase()}. Ảnh có thể đặt logo khác đi, còn áo
          thật sẽ in theo vị trí bạn đã chọn.
        </p>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {views.map((view) => {
          const generating = view.jobStatus === 'QUEUED' || view.jobStatus === 'RUNNING';
          const failed = view.jobStatus === 'FAILED';
          const label = viewLabel(view, hasLogo);
          const designerOpen = isOpenTask(view.task);
          const canAskDesigner =
            view.type !== 'FRONT' && view.status !== 'APPROVED' && !generating && !designerOpen;
          return (
            <li key={view.id} data-testid={`view-${view.type}`}>
              <div className="relative flex aspect-square items-center justify-center overflow-hidden border border-mist bg-white">
                {view.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- expiring storage link
                  <img src={view.imageUrl} alt={label} className="size-full object-contain" />
                ) : (
                  !generating && (
                    <p className="px-4 text-center text-sm text-muted-foreground">Chưa có ảnh.</p>
                  )
                )}
                {generating && (
                  <p
                    role="status"
                    className="absolute inset-x-0 bottom-0 bg-cobalt px-3 py-2 text-center text-sm font-medium text-white motion-safe:animate-pulse"
                  >
                    Đang tạo ảnh…
                  </p>
                )}
                {designerOpen && (
                  <p
                    role="status"
                    className="absolute inset-x-0 bottom-0 bg-ink px-3 py-2 text-center text-sm font-medium text-white"
                  >
                    {view.task!.status === 'ASSIGNED' ? 'Designer đang làm góc này' : 'Đang tìm designer'}
                  </p>
                )}
              </div>

              <div className="mt-2 flex items-baseline justify-between gap-3">
                <h3 className="font-semibold">{label}</h3>
                {view.status === 'APPROVED' && (
                  <span className="text-sm text-cobalt">Đã duyệt</span>
                )}
              </div>

              {failed && !designerOpen && (
                <p role="alert" className="mt-1 text-sm text-magenta">
                  Không tạo được ảnh. Lượt này không bị tính.
                </p>
              )}
              {view.task?.status === 'CLOSED' && view.status !== 'APPROVED' && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Designer đã đóng yêu cầu: {view.task.closeReason}
                </p>
              )}

              {!locked && !generating && !designerOpen && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {view.status === 'READY' && (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void run(() => approveView(sessionId, view.id))}
                      >
                        Duyệt
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || noCredits}
                        onClick={() => void run(() => regenerateView(sessionId, view.id))}
                      >
                        Tạo lại
                      </Button>
                    </>
                  )}
                  {view.status === 'PENDING' && (
                    <Button
                      size="sm"
                      disabled={busy || noCredits}
                      onClick={() => void run(() => generateView(sessionId, view.id))}
                    >
                      Tạo ảnh góc này
                    </Button>
                  )}
                  {canAskDesigner && askingFor !== view.id && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setAskingFor(view.id);
                        setRequirement('');
                      }}
                    >
                      Nhờ designer
                    </Button>
                  )}
                </div>
              )}

              {!locked && askingFor === view.id && canAskDesigner && (
                <form onSubmit={(event) => void submitViewTask(event, view.id)} className="mt-3">
                  <label htmlFor={`view-task-${view.id}`} className="text-sm font-semibold">
                    Góc này cần sửa gì?
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Miễn phí. Designer nhận mặt trước đã chọn và câu trả lời của bạn.
                  </p>
                  <textarea
                    id={`view-task-${view.id}`}
                    rows={3}
                    maxLength={2000}
                    value={requirement}
                    onChange={(event) => setRequirement(event.target.value)}
                    className="mt-2 block w-full border border-mist bg-white px-3 py-2 text-sm outline-none focus-visible:border-cobalt focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" type="submit" disabled={busy || !requirement.trim()}>
                      Gửi cho designer
                    </Button>
                    <Button size="sm" type="button" variant="outline" onClick={() => setAskingFor(null)}>
                      Thôi
                    </Button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {withDesigner.map((view) => (
        <section
          key={view.id}
          aria-label={`Designer làm góc ${viewLabel(view, hasLogo).toLowerCase()}`}
          className="mt-10 border-t border-mist pt-6"
          data-testid={`view-task-${view.type}`}
        >
          {view.task!.status === 'WAITING' ? (
            <TaskWaiting
              task={view.task!}
              title={`Đang tìm designer cho ${viewLabel(view, hasLogo).toLowerCase()}`}
              onChange={reload}
            />
          ) : (
            <>
              <h2 className="overprint text-3xl font-extrabold">
                {view.task!.designerName} đang làm {viewLabel(view, hasLogo).toLowerCase()}
              </h2>
              <TaskChatPanel taskId={view.task!.id} />
            </>
          )}
        </section>
      ))}

      {!locked && (
        <>
          {extras.length < MAX_EXTRA_VIEWS && (
            <form onSubmit={submitExtra} className="mt-10 max-w-lg">
              <label htmlFor="extra-view" className="font-semibold">
                Thêm góc khác
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  Không bắt buộc, tối đa {MAX_EXTRA_VIEWS} góc, mỗi góc dùng 1 lượt
                </span>
              </label>
              <div className="mt-3 flex gap-2">
                <input
                  id="extra-view"
                  value={extra}
                  maxLength={300}
                  disabled={noCredits}
                  onChange={(event) => setExtra(event.target.value)}
                  placeholder="Ví dụ: cận tay áo"
                  className="block w-full border border-mist bg-white px-3 py-2 outline-none focus-visible:border-cobalt focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <Button type="submit" variant="outline" disabled={busy || noCredits || !extra.trim()}>
                  Thêm góc
                </Button>
              </div>
            </form>
          )}

          <p className="mt-6 text-sm text-muted-foreground" data-testid="usage">
            {noCredits
              ? `Bạn đã dùng hết ${usage.limit} lượt hôm nay.`
              : `Còn ${usage.remaining} trong ${usage.limit} lượt hôm nay.`}
          </p>

          <div className="mt-8 border-t border-mist pt-6">
            {confirmingLock ? (
              <>
                <p>Sau khi chốt, ảnh không sửa được nữa. Muốn đổi, bạn phải thiết kế lại từ đầu.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="lg"
                    disabled={busy}
                    onClick={() =>
                      void run(() => lockProduct(sessionId)).then(() => setConfirmingLock(false))
                    }
                  >
                    Chốt sản phẩm
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => setConfirmingLock(false)}>
                    Xem lại
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Button
                  size="lg"
                  disabled={!allApproved || working || withDesigner.length > 0}
                  onClick={() => setConfirmingLock(true)}
                >
                  Chốt sản phẩm
                </Button>
                {withDesigner.length > 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Đang có designer làm một góc. Chốt được khi designer làm xong.
                  </p>
                )}
                {!allApproved && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Hãy duyệt đủ mặt trước, mặt sau và ảnh cận để chốt.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
