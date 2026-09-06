'use client';

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CATEGORY_COLOR_ORDER, colorForCategory, OTHER_BUCKET_COLOR } from '@/lib/categoryColors';

export interface CategorySpend {
  category: string | null;
  total: number;
}

interface Slice {
  name: string;
  value: number;
  color: string;
}

// Folds anything outside the fixed 8-slot categorical order (including
// uncategorized/null) into a single "Other" slice, per the dataviz skill's
// rule that a 9th+ series is never a generated hue.
function toSlices(data: CategorySpend[]): Slice[] {
  const known: Slice[] = [];
  let otherTotal = 0;

  for (const row of data) {
    const category = row.category;
    if (category && (CATEGORY_COLOR_ORDER as readonly string[]).includes(category)) {
      known.push({ name: category, value: row.total, color: colorForCategory(category) });
    } else {
      otherTotal += row.total;
    }
  }

  known.sort((a, b) => CATEGORY_COLOR_ORDER.indexOf(a.name as never) - CATEGORY_COLOR_ORDER.indexOf(b.name as never));
  if (otherTotal > 0) {
    known.push({ name: 'Other', value: otherTotal, color: OTHER_BUCKET_COLOR });
  }
  return known;
}

export function CategoryDonut({ data }: { data: CategorySpend[] }) {
  const slices = toSlices(data);
  if (slices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No categorized spend yet — run categorize_transactions first.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <PieChart>
        <Pie data={slices} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2}>
          {slices.map((slice) => (
            <Cell key={slice.name} fill={slice.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) =>
            new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
              Number(value)
            )
          }
        />
        <Legend layout="vertical" align="right" verticalAlign="middle" />
      </PieChart>
    </ResponsiveContainer>
  );
}
