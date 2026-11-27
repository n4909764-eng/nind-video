import { useEffect, useRef, useState, useCallback } from "react";

// Landing "Explore nind ai" showcase: plays Create → Edit → Change in a loop.
// Videos are always muted; the round button toggles a separate background music loop.
// Everything plays only while the player is on screen.
const CLIPS = [
  { key: "create", title: "Create", name: "showcase-create" },
  { key: "edit", title: "Edit", name: "showcase-edit" },
  { key: "change", title: "Change", name: "showcase-change" },
];
const BASE = "/assets/home/";

const pickSize = () =>
  typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 767px)").matches ? "-720" : "";

const SpeakerOff = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6.5 8.5H3.5v7h3L11 19V5Z" fill="currentColor" stroke="none" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </svg>
);
const SpeakerOn = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6.5 8.5H3.5v7h3L11 19V5Z" fill="currentColor" stroke="none" />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);

export default function ShowcasePlayer() {
  const rootRef = useRef(null);
  const videoRefs = useRef([]);
  const audioRef = useRef(null);
  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [muted, setMuted] = useState(true);
  const [size] = useState(pickSize);

  // Visible on screen?
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting && e.intersectionRatio >= 0.35), {
      threshold: [0, 0.35, 0.6, 1],
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Browser tab hidden?
  useEffect(() => {
    const onVis = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const playing = inView && pageVisible;

  // Play only the active clip, only while visible.
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      if (i === active && playing) {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } else {
        v.pause();
      }
    });
    // warm up the next clip
    const next = videoRefs.current[(active + 1) % CLIPS.length];
    if (next && next.preload !== "auto") next.preload = "auto";
  }, [active, playing]);

  // Music follows visibility + mute state.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = 0.6;
    if (!muted && playing) {
      const p = a.play();
      if (p && p.catch) p.catch(() => setMuted(true));
    } else {
      a.pause();
    }
  }, [muted, playing]);

  const goTo = useCallback((i) => {
    const v = videoRefs.current[i];
    if (v) { try { v.currentTime = 0; } catch (_) {} }
    setActive(i);
  }, []);

  const onEnded = (i) => {
    if (i !== active) return;
    goTo((i + 1) % CLIPS.length);
  };

  const toggleMute = () => {
    const a = audioRef.current;
    const next = !muted;
    // start audio inside the click (user gesture) so browsers allow it
    if (!next && a && playing) {
      const p = a.play();
      if (p && p.catch) p.catch(() => setMuted(true));
    }
    setMuted(next);
  };

  return (
    <div className="showcase-player" ref={rootRef}>
      {CLIPS.map((c, i) => (
        <video
          key={c.key}
          ref={(el) => (videoRefs.current[i] = el)}
          className={`showcase-video ${i === active ? "is-active" : ""}`}
          src={`${BASE}${c.name}${size}.mp4`}
          poster={`${BASE}${c.name}.jpg`}
          muted
          playsInline
          disablePictureInPicture
          preload={i === 0 ? "auto" : "metadata"}
          onEnded={() => onEnded(i)}
          aria-label={`nind ai — ${c.title}`}
        />
      ))}
      <audio ref={audioRef} src={`${BASE}showcase-music.m4a`} loop preload="none" />

      <div className="showcase-dots" role="tablist" aria-label="Showcase videos">
        {CLIPS.map((c, i) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={`showcase-dot ${i === active ? "is-active" : ""}`}
            onClick={() => goTo(i)}
          >
            {c.title}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="showcase-mute"
        onClick={toggleMute}
        aria-pressed={!muted}
        aria-label={muted ? "Turn sound on" : "Turn sound off"}
        title={muted ? "Sound on" : "Sound off"}
      >
        {muted ? <SpeakerOff /> : <SpeakerOn />}
      </button>
    </div>
  );
}
