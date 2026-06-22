"use client";

import { useRef, useState } from "react";
import { Volume2, Pause } from "lucide-react";

// "Hear Mark" — plays the mascot's AI voice greeting (cool, calm, insightful).
export function CediVoice({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (playing) {
      a.pause();
      a.currentTime = 0;
      setPlaying(false);
    } else {
      a.play().catch(() => {});
      setPlaying(true);
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className={`inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50 ${className}`}
    >
      {playing ? <Pause className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      {playing ? "Mark's talking…" : "🔊 Hear Mark"}
      <audio ref={ref} src="/cedi-greeting.mp3?v=mark3" preload="none" onEnded={() => setPlaying(false)} />
    </button>
  );
}
