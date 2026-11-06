'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS, setToken, User } from '@/lib/api';

export function AppHeader({ user }: { user: User | null }) {
  const router = useRouter();

  function logout() {
    setToken(null);
    router.replace('/login');
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-mist pb-4">
      <Link href="/" className="font-semibold outline-none hover:text-cobalt focus-visible:ring-3 focus-visible:ring-ring/50">
        Thiết kế của tôi
      </Link>
      <div className="flex items-center gap-4">
        {user && (
          <p className="text-sm text-muted-foreground">
            {user.name}, {ROLE_LABELS[user.role].toLowerCase()}
          </p>
        )}
        <Button variant="outline" size="sm" onClick={logout}>
          Đăng xuất
        </Button>
      </div>
    </header>
  );
}
