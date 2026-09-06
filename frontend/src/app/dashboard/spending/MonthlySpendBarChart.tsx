'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface MonthlyTotal {
  month: string;
  total: number;
}

export function MonthlySpendBarChart({ data }: { data: MonthlyTotal[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No spending history yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        {/* Single series = magnitude, so one sequential hue, not a rainbow. */}
        <Bar dataKey="total" fill="#2a78d6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
