'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function DeleteMemoryButton({ memoryId, accessToken }: { memoryId: string; accessToken: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/memories/${memoryId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="destructive" size="sm" onClick={handleClick} disabled={loading}>
      {loading ? 'Deleting…' : 'Delete'}
    </Button>
  );
}
