import type { ReactNode } from "react";

// Mark the spokes-owl, talking. A speech bubble in his voice. Cool, calm, and
// insightful. Use across the site so the mascot has a real personality.
export function CediBubble({
  children, size = 56, center = false, className = "",
}: { children: ReactNode; size?: number; center?: boolean; className?: string }) {
  return (
    <div className={`flex w-full max-w-full items-end gap-2 sm:gap-3 ${center ? "justify-center" : ""} ${className}`}>
      <img
        src="/mark-owl.png"
        alt="Mark. The all-knowing Fetti owl"
        width={Math.round(size * 0.69)}
        height={size}
        style={{ height: size, width: "auto" }}
        className="shrink-0 drop-shadow-md"
      />
      <div className="relative min-w-0 max-w-[15rem] sm:max-w-sm rounded-2xl rounded-bl-sm border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-left text-sm font-medium text-slate-700 shadow-sm">
        {children}
        <span aria-hidden className="absolute -left-1.5 bottom-3 h-3 w-3 rotate-45 border-b border-l border-emerald-100 bg-emerald-50" />
      </div>
    </div>
  );
}
