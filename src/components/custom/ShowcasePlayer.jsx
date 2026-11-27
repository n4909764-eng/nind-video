import { useEffect, useRef, useState } from "react";

// Landing "Explore nind ai" showcase: Create → Edit → Change play one after another, looping.
// Plays only while the player is on screen; the round button pauses/resumes playback.
const CLIPS = [
  { key: "create", title: "Create", name: "showcase-create" },
  { key: "edit", title: "Edit", name: "showcase-edit" },
  { key: "change", title: "Change", name: "showcase-change" },
];
const BASE = "/assets/home/";

const pickSize = () =>
  typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 767px)").matches ? "-720" : "";

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1.2" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" />
  </svg>
);

export default function ShowcasePlayer() {
  const rootRef = useRef(null);
  const videoRefs = useRef([]);
  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [userPaused, setUserPaused] = useState(false);
  const [size] = useState(pickSize);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting && e.intersectionRatio >= 0.35), {
      threshold: [0, 0.35, 0.6, 1],
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onVis = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const playing = inView && pageVisible && !userPaused;

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
    const next = videoRefs.current[(active + 1) % CLIPS.length];
    if (next && next.preload !== "auto") next.preload = "auto";
  }, [active, playing]);

  const onEnded = (i) => {
    if (i !== active) return;
    const n = (i + 1) % CLIPS.length;
    const v = videoRefs.current[n];
    if (v) { try { v.currentTime = 0; } catch (_) {} }
    setActive(n);
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
      <button
        type="button"
        className="showcase-toggle"
        onClick={() => setUserPaused((p) => !p)}
        aria-label={userPaused ? "Play video" : "Pause video"}
        title={userPaused ? "Play" : "Pause"}
      >
        {userPaused ? <PlayIcon /> : <PauseIcon />}
      </button>
    </div>
  );
}
