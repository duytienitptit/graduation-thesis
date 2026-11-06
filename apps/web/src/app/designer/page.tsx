'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { ErrorNote } from '@/components/error-note';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiError, createTelegramLink, DesignerSummary, getDesignerMe } from '@/lib/api';
import { useUser } from '@/lib/use-user';

const STATE_LABELS: Record<DesignerSummary['state'], string> = {
  FREE: 'Rảnh',
  BUSY: 'Bận',
  PAUSED: 'Tạm dừng',
};

export default function DesignerPage() {
  const { user } = useUser();
  const [me, setMe] = useState<DesignerSummary | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getDesignerMe()
      .then(setMe)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    if (user?.role !== 'DESIGNER') return;
    load();
    // Linking finishes in Telegram, so check again on return to this tab.
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load, user]);

  async function createLink() {
    setBusy(true);
    setError(null);
    try {
      setLinkUrl((await createTelegramLink()).url);
    } catch (e) {
      const failure = e as ApiError;
      setError(
        failure.status === 503
          ? 'Bot Telegram chưa chạy. Hãy báo quản lí.'
          : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <AppHeader user={user} />

      <main className="mt-10">
        <h1 className="overprint text-6xl font-extrabold sm:text-7xl">Khu vực designer</h1>

        {error && <ErrorNote>{error}</ErrorNote>}

        {me && (
          <>
            <p className="mt-6">
              Trạng thái của bạn: <span className="font-semibold">{STATE_LABELS[me.state]}</span>
            </p>

            <section className="mt-8 max-w-lg border-t border-mist pt-6">
              <h2 className="font-semibold">Telegram</h2>
              {me.telegramLinked ? (
                <p className="mt-2 text-muted-foreground" data-testid="telegram-state">
                  Đã liên kết{me.telegramUsername ? ` với @${me.telegramUsername}` : ''}. Bạn sẽ nhận
                  task mới trên Telegram.
                </p>
              ) : (
                <p className="mt-2 text-muted-foreground" data-testid="telegram-state">
                  Liên kết Telegram để nhận task mới.
                </p>
              )}

              {linkUrl ? (
                <>
                  <a
                    href={linkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`${buttonVariants({ size: 'lg' })} mt-4`}
                  >
                    Mở Telegram
                  </a>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Link dùng một lần, hết hạn sau 15 phút. Mở xong bấm Start trong Telegram.
                  </p>
                </>
              ) : (
                <Button size="lg" className="mt-4" disabled={busy} onClick={() => void createLink()}>
                  {me.telegramLinked ? 'Liên kết lại' : 'Liên kết Telegram'}
                </Button>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
