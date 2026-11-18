// Preview of an attached file inside the prompt input (images AND videos).
// Videos are shown with a <video> element (an <img> can't render a video blob,
// which used to make uploaded videos look like they never attached).
export const AttachmentThumb = ({ attachment }) => {
  const isVideo = attachment.type === "video";
  const media = isVideo ? (
    <video
      src={`${attachment.preview}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      className="attachment-preview rounded-[16px]"
      data-testid="attachment-video-preview"
    />
  ) : (
    <img src={attachment.preview} alt="Attachment" className="attachment-preview rounded-[16px]" />
  );
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
