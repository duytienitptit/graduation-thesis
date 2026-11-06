'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, getMe, getToken, setToken, User } from '@/lib/api';

/** The logged-in user. Sends anyone without a valid login to the login screen. */
export function useUser() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return router.replace('/login');
    getMe()
      .then(setUser)
      .catch((e: ApiError) => {
        if (e.status === 401) {
          setToken(null);
          router.replace('/login');
        } else {
          setError(e.message);
        }
      });
  }, [router]);

  return { user, error };
}
