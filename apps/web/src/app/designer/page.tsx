'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { AppHeader } from '@/components/app-header';
import { ErrorNote } from '@/components/error-note';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  ApiError,
  apiUrl,
  createTelegramLink,
  DesignerSummary,
  DesignerTaskRow,
  getDesignerMe,
  getDesignerTasks,
  getToken,
} from '@/lib/api';
import { useUser } from '@/lib/use-user';

const STATE_LABELS: Record<DesignerSummary['state'], string> = {
  FREE: 'Rảnh',
  BUSY: 'Bận',
  PAUSED: 'Tạm dừng',
};

const doneDate = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(iso))
    : '';

function TaskRow({ task }: { task: DesignerTaskRow }) {
  return (
    <Link
      href={`/designer/tasks/${task.id}`}
      className="group block py-3 outline-none hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="flex items-baseline justify-between gap-4">
        <span className="font-medium group-hover:text-cobalt">
          {task.productName}
          {task.viewLabel && (
            <span className="font-normal text-muted-foreground">, chỉ {task.viewLabel}</span>
          )}
        </span>
        <span className="text-sm text-muted-foreground">
          {task.status === 'DONE'
            ? doneDate(task.doneAt)
            : task.status === 'CLOSED'
              ? `Đã đóng ${doneDate(task.closedAt)}`
              : `Khách: ${task.customerName}`}
        </span>
      </span>
      <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.requirement}</span>
    </Link>
  );
}

export default function DesignerPage() {
  const { user } = useUser();
  const [me, setMe] = useState<DesignerSummary | null>(null);
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof getDesignerTasks>> | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([getDesignerMe(), getDesignerTasks()])
      .then(([summary, list]) => {
        setMe(summary);
        setTasks(list);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    if (user?.role !== 'DESIGNER') return;
    load();
    // Linking finishes in Telegram, so check again on return to this tab.
    window.addEventListener('focus', load);
    // A task taken on Telegram shows up here without a reload.
    const socket = io(apiUrl, { auth: { token: getToken() } });
    socket.on('design.task', load);
    return () => {
      window.removeEventListener('focus', load);
      socket.disconnect();
    };
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

            <section className="mt-8 border-t border-mist pt-6" data-testid="current-task">
              <h2 className="font-semibold">Task đang làm</h2>
              {tasks?.current ? (
                <TaskRow task={tasks.current} />
              ) : (
                <p className="mt-2 text-muted-foreground">
                  Bạn chưa có task nào. Task mới được gửi qua Telegram.
                </p>
              )}
            </section>

            <section className="mt-8 border-t border-mist pt-6">
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

            {!!tasks?.past.length && (
              <section className="mt-8 border-t border-mist pt-6" data-testid="past-tasks">
                <h2 className="font-semibold">Task đã làm</h2>
                <ul className="mt-2 divide-y divide-mist">
                  {tasks.past.map((task) => (
                    <li key={task.id}>
                      <TaskRow task={task} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
