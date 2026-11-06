'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, devLogin, listDevUsers, ROLE_LABELS, User } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  useEffect(() => {
    listDevUsers()
      .then(setUsers)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  async function login(email: string) {
    setBusyEmail(email);
    setError(null);
    try {
      await devLogin(email);
      router.replace('/');
    } catch (e) {
      setError((e as ApiError).message);
      setBusyEmail(null);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-6xl items-center gap-12 px-4 py-12 sm:px-8 lg:grid-cols-[1.25fr_1fr] lg:gap-20">
      <h1 className="overprint text-[clamp(3.75rem,11vw,8.5rem)] font-extrabold">
        Áo in theo đúng ý bạn
      </h1>

      <section aria-labelledby="login-heading">
        <h2 id="login-heading" className="text-lg font-semibold">
          Chọn tài khoản để vào
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Đây là đăng nhập tạm của bản thử, không cần mật khẩu.
        </p>

        {error && (
          <p role="alert" className="mt-4 border-l-4 border-magenta pl-3 text-sm">
            {error}
          </p>
        )}

        {!users && !error && <p className="mt-6 text-sm text-muted-foreground">Đang tải…</p>}

        <ul className="mt-6 divide-y divide-mist border-y border-mist">
          {users?.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                disabled={busyEmail !== null}
                onClick={() => login(user.email)}
                className="group flex w-full items-baseline justify-between gap-4 px-1 py-4 text-left outline-none transition-colors hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
              >
                <span className="font-medium group-hover:text-cobalt">{user.name}</span>
                <span className="text-sm text-muted-foreground">
                  {busyEmail === user.email ? 'Đang vào…' : ROLE_LABELS[user.role]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
