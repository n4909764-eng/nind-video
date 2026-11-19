import { useEffect, useState } from "react";

// Preview of an attached file inside the prompt input (images AND videos).
// Videos prefer a server-extracted JPEG thumbnail (browsers often can't
// decode HEVC .mov from iPhones, so a <video> preview would be a black square).
// If the browser can decode the file, we also try a local frame immediately
// and swap to the server thumb when it arrives.
export const AttachmentThumb = ({ attachment }) => {
  const isVideo = attachment.type === "video";
  const serverThumb = attachment.thumbnailUrl || attachment.thumbnail_url || null;
  const [localThumb, setLocalThumb] = useState(null);

  useEffect(() => {
    if (!isVideo || serverThumb || !attachment.preview) return;
    let cancelled = false;
    let objectUrl = null;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const cleanup = () => {
      try { video.removeAttribute("src"); video.load(); } catch (_) { /* noop */ }
    };
    const fail = () => { cleanup(); };

    const timer = setTimeout(fail, 2500);
    video.onerror = fail;
    video.onseeked = () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) { fail(); return; }
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 360 / Math.max(w, h));
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) { fail(); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < sample.length; i += 16) {
          sum += sample[i] + sample[i + 1] + sample[i + 2];
          n += 3;
        }
        if (n === 0 || sum / n < 8) { fail(); return; }
        canvas.toBlob((blob) => {
          cleanup();
          if (!blob || cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setLocalThumb(objectUrl);
        }, "image/jpeg", 0.8);
      } catch (_) {
        fail();
      }
    };
    video.onloadeddata = () => {
      try {
        const t = Math.min(0.5, Math.max(0, (video.duration || 1) * 0.1));
        if (video.currentTime === t || (t === 0 && video.readyState >= 2)) {
          // already at the target time — onseeked may not fire
          video.dispatchEvent(new Event("seeked"));
        } else {
          video.currentTime = t;
        }
      } catch (_) {
        fail();
      }
    };
    video.src = attachment.preview;

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cleanup();
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (_) { /* noop */ }
      }
    };
  }, [isVideo, serverThumb, attachment.preview]);

  const thumbSrc = serverThumb || localThumb;
  let media;
  if (isVideo && !thumbSrc) {
    media = (
      <video
        src={`${attachment.preview}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        className="attachment-preview rounded-[16px]"
        data-testid="attachment-video-preview"
      />
    );
  } else {
    media = (
      <img
        src={thumbSrc || attachment.preview}
        alt="Attachment"
        className="attachment-preview rounded-[16px]"
        data-testid={isVideo ? "attachment-video-preview" : undefined}
      />
    );
  }

  return (
    <div className="attachment-thumb-wrap">
      {media}
      {isVideo && !attachment.uploading && (
        <span className="attachment-video-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </span>
      )}
      {attachment.uploading && (
        <div className="attachment-uploading-mask rounded-[16px]">
          <span className="upload-progress" data-testid="attachment-upload-progress">
            {Math.round(attachment.progress || 0)}%
          </span>
        </div>
      )}
    </div>
  );
};

export default AttachmentThumb;
