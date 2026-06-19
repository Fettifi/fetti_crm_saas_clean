import { Star } from "lucide-react";

// Simple 1–5 star row. Renders filled stars up to `value`, muted stars after.
export function StarRating({ value, size = 16 }: { value: number; size?: number }) {
  const v = Math.min(5, Math.max(0, Math.round(value)));
  return (
    <div className="flex items-center gap-0.5" aria-label={`${v} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          width={size}
          height={size}
          className={i < v ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200"}
        />
      ))}
    </div>
  );
}
