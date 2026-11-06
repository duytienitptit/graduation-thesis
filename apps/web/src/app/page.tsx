'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { ErrorNote } from '@/components/error-note';
import { buttonVariants } from '@/components/ui/button';
import { ApiError, DesignSession, listSessions } from '@/lib/api';
import { useUser } from '@/lib/use-user';

const STATUS_LABELS: Record<DesignSession['status'], string> = {
  ANSWERING: 'Đang trả lời câu hỏi',
  ANSWERED: 'Đang thiết kế',
  VIEWS: 'Đang duyệt các góc',
  LOCKED: 'Đã chốt sản phẩm',
  DESIGNER: 'Đang làm với designer',
};

export default function HomePage() {
  const router = useRouter();
  const { user, error: userError } = useUser();
  const [sessions, setSessions] = useState<DesignSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === 'DESIGNER') router.replace('/designer');
  }, [router, user]);

  useEffect(() => {
    if (user?.role !== 'CUSTOMER') return;
    listSessions()
      .then(setSessions)
      .catch((e: ApiError) => setError(e.message));
  }, [user]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <AppHeader user={user} />

      <main className="mt-10">
        {userError && <ErrorNote>{userError}</ErrorNote>}

        {user?.role === 'MANAGER' && (
          <p className="text-muted-foreground">Khu vực dành cho vai trò của bạn chưa được mở.</p>
        )}

        {user?.role === 'CUSTOMER' && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h1 className="overprint text-6xl font-extrabold sm:text-7xl">Áo của bạn</h1>
              <Link href="/design/new" className={buttonVariants({ size: 'lg' })}>
                Thiết kế áo mới
              </Link>
            </div>

            {error && <ErrorNote>{error}</ErrorNote>}

            {sessions?.length === 0 && (
              <p className="mt-8 text-muted-foreground">
                Bạn chưa có thiết kế nào. Hãy chọn một loại áo để bắt đầu.
              </p>
            )}

            {!!sessions?.length && (
              <ul className="mt-8 divide-y divide-mist border-y border-mist">
                {sessions.map(({ id, status, specSnapshot: spec }) => (
                  <li key={id}>
                    <Link
                      href={`/design/${id}`}
                      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-1 py-4 outline-none transition-colors hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="flex items-center gap-3 font-medium">
                        <span
                          aria-hidden
                          className="size-4 rounded-full border border-mist"
                          style={{ background: spec.colour.hex }}
                        />
                        {spec.product.name}, {spec.colour.name.toLowerCase()}
                      </span>
                      <span className="text-sm text-muted-foreground">{STATUS_LABELS[status]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
