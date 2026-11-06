'use client';

import { FormEvent, useState } from 'react';
import { ErrorNote } from '@/components/error-note';
import { Button } from '@/components/ui/button';
import {
  addExtraView,
  ApiError,
  approveView,
  generateView,
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
          : failure.message,
      );
      return false;
    } finally {
      setBusy(false);
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
              </div>

              <div className="mt-2 flex items-baseline justify-between gap-3">
                <h3 className="font-semibold">{label}</h3>
                {view.status === 'APPROVED' && (
                  <span className="text-sm text-cobalt">Đã duyệt</span>
                )}
              </div>

              {failed && (
                <p role="alert" className="mt-1 text-sm text-magenta">
                  Không tạo được ảnh. Lượt này không bị tính.
                </p>
              )}

              {!locked && !generating && (
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
                </div>
              )}
            </li>
          );
        })}
      </ul>

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
                  disabled={!allApproved || working}
                  onClick={() => setConfirmingLock(true)}
                >
                  Chốt sản phẩm
                </Button>
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
