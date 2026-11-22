import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const HIGH_LOCKED_MSG = "High generation mode is exclusive to Creator Plan";

const LockIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
  </svg>
);

// Work level picker (Low / Default / High) shown next to the "+" in the prompt input.
// The slider snaps ONLY to the three positions.
export const LEVELS = [
  { id: "low", label: "Low", caption: "Cost\u2011effective video creation/editing" },
  { id: "default", label: "Default", caption: "Optimal video creation/editing" },
  { id: "high", label: "High", caption: "The highest\u2011quality video creation/editing" },
];

const LEVEL_KEY = "nind_level";
export const loadLevel = () => {
  try { const v = localStorage.getItem(LEVEL_KEY); return LEVELS.some((l) => l.id === v) ? v : "default"; } catch (_) { return "default"; }
};

// Dots, knob and labels share one coordinate system: the track minus its rounded ends (TRACK_INSET px each side).
const TRACK_INSET = 6;
const stopPos = (p) => `calc(${TRACK_INSET}px + (100% - ${TRACK_INSET * 2}px) * ${p})`;

export const LevelPicker = ({ value, onChange, highLocked = false }) => {
  const [open, setOpen] = useState(false);
  const [dragPct, setDragPct] = useState(null);
  const wrapRef = useRef(null);
  const trackRef = useRef(null);
  const idx = Math.max(0, LEVELS.findIndex((l) => l.id === value));
  const current = LEVELS[idx];

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const select = (i) => {
    const l = LEVELS[Math.max(0, Math.min(2, i))];
    if (l.id === "high" && highLocked) {
      toast.error(HIGH_LOCKED_MSG, { id: "high-locked" });
      return;
    }
    try { localStorage.setItem(LEVEL_KEY, l.id); } catch (_) { /* ignore */ }
    onChange && onChange(l.id);
  };

  const pctFromEvent = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - r.left - TRACK_INSET) / Math.max(1, r.width - TRACK_INSET * 2)));
    return highLocked ? Math.min(p, 0.5) : p; // the knob cannot be dragged onto a locked High
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    const move = (ev) => setDragPct(pctFromEvent(ev.clientX));
    const up = (ev) => {
      const r = trackRef.current.getBoundingClientRect();
      const rawP = (ev.clientX - r.left - TRACK_INSET) / Math.max(1, r.width - TRACK_INSET * 2);
      if (highLocked && rawP > 0.75) select(2); // shows the Creator-only message
      const p = pctFromEvent(ev.clientX);
      setDragPct(null);
      select(Math.round(p * 2)); // snap: 0 / 0.5 / 1
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    setDragPct(pctFromEvent(e.clientX));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); select(idx - 1); }
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); select(idx + 1); }
  };

  const frac = dragPct !== null ? dragPct : idx / 2;

  return (
    <div className="level-picker" ref={wrapRef}>
      <button
        type="button"
        className={`level-pill ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="level-pill"
      >
        {current.label}
      </button>
      {open && (
        <div className="level-popover" role="dialog" aria-label="Work level" data-testid="level-popover">
          <div className="level-labels">
            {LEVELS.map((l, i) => (
              <button
                key={l.id}
                type="button"
                className={`level-label ${i === idx ? "active" : ""} ${l.id === "high" && highLocked ? "locked" : ""}`}
                style={{ left: stopPos(i / 2) }}
                onClick={() => select(i)}
                aria-disabled={l.id === "high" && highLocked ? true : undefined}
                data-testid={`level-option-${l.id}`}
              >
                {l.label}
                {l.id === "high" && highLocked && <LockIcon className="level-lock" />}
              </button>
            ))}
          </div>
          <div className="level-track" ref={trackRef} onPointerDown={onPointerDown}>
            <div className="level-track-fill" style={{ width: `calc(${TRACK_INSET * 2}px + (100% - ${TRACK_INSET * 2}px) * ${frac})`, transition: dragPct !== null ? "none" : undefined }} />
            {[0, 1, 2].map((i) => (
              <span key={i} className={`level-stop ${i <= idx ? "on" : ""}`} style={{ left: stopPos(i / 2) }} data-testid={`level-stop-${i}`} />
            ))}
            <div
              className="level-knob"
              role="slider"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={2}
              aria-valuenow={idx}
              aria-valuetext={current.label}
              onKeyDown={onKeyDown}
              style={{ left: stopPos(frac), transition: dragPct !== null ? "none" : undefined }}
              data-testid="level-knob"
            />
          </div>
          <div className="level-caption" data-testid="level-caption">{current.caption}</div>
        </div>
      )}
    </div>
  );
};

export default LevelPicker;
