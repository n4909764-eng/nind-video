import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { X, Download, ArrowUp, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";
import AttachmentThumb from "../components/custom/AttachmentThumb";
import { useAppLanguage } from "../utils/translations";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Inline SVGs matching MainPage
const MicIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
    <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
  </svg>
);

const PlusIconSolid = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// Rotating verbs inside the placeholder
const EDIT_VERBS = ["fix", "change", "edit", "rewrite"];

export const VideoPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentLang, t } = useAppLanguage();
  const [project, setProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [videoVersion, setVideoVersion] = useState(Date.now());

  // Rotating verb inside placeholder
  const [verbIdx, setVerbIdx] = useState(0);
  const [typedVerb, setTypedVerb] = useState("");
  const [isTypingVerb, setIsTypingVerb] = useState(true);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const voiceRecognitionRef = useRef(null);
  const pollTimerRef = useRef(null);

  useEffect(() => {
    const currentVerb = EDIT_VERBS[verbIdx];
    let timeout;
    if (isTypingVerb) {
      if (typedVerb.length < currentVerb.length) {
        timeout = setTimeout(
          () => setTypedVerb(currentVerb.slice(0, typedVerb.length + 1)),
          55
        );
      } else {
        timeout = setTimeout(() => setIsTypingVerb(false), 1700);
      }
    } else {
      if (typedVerb.length > 0) {
        timeout = setTimeout(() => setTypedVerb(typedVerb.slice(0, -1)), 32);
      } else {
        setVerbIdx((p) => (p + 1) % EDIT_VERBS.length);
        setIsTypingVerb(true);
      }
    }
    return () => clearTimeout(timeout);
  }, [typedVerb, verbIdx, isTypingVerb]);

  const fetchProject = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/video/${id}`);
      setProject(response.data);
      setIsLoading(false);
      if (response.data.status === "pending" || response.data.status === "processing") {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(fetchProject, 2000);
      } else if (response.data.status === "completed") {
        setVideoVersion(Date.now());
      }
    } catch (err) {
      console.error("Failed to fetch project:", err);
      setError("Проект не найден");
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProject();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [fetchProject]);

  const autoResize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 220) + "px";
  };

  // Microphone toggle & speech recognition
  const toggleListening = () => {
    if (isListening) {
      if (voiceRecognitionRef.current) {
        try { voiceRecognitionRef.current.stop(); } catch (_) {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error(currentLang === 'ru' ? "Распознавание речи не поддерживается в этом браузере" : "Speech recognition is not supported in this browser");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = currentLang === 'ru' ? "ru-RU" : "en-US";

      let baseText = editPrompt ? editPrompt.trim() : "";

      recognition.onresult = (event) => {
        let currentTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          currentTranscript += event.results[i][0].transcript;
        }
        currentTranscript = currentTranscript.trim();
        if (currentTranscript) {
          const combined = baseText ? `${baseText} ${currentTranscript}` : currentTranscript;
          setEditPrompt(combined);
          autoResize();
        }
      };

      recognition.onerror = (event) => {
        console.warn("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          toast.error("Доступ к микрофону отклонен");
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
      voiceRecognitionRef.current = recognition;
      setIsListening(true);
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      setIsListening(false);
    }
  };

  // File attachments handler
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      const attachId = Date.now() + Math.random();
      const isVideo = file.type.startsWith("video/");
      const previewUrl = URL.createObjectURL(file);

      setAttachments((prev) => [
        ...prev,
        {
          id: attachId,
          type: isVideo ? "video" : "image",
          preview: previewUrl,
          file,
          uploading: true,
          progress: 0,
          uploadedUrl: null,
        },
      ]);

      (async () => {
        try {
          const formData = new FormData();
          formData.append("file", file);
          const uploadRes = await axios.post(`${API}/upload`, formData, {
            headers: { "Content-Type": "multipart/form-data" },
            onUploadProgress: (progressEvent) => {
              const pct = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
              setAttachments((curr) =>
                curr.map((a) => (a.id === attachId ? { ...a, progress: pct } : a))
              );
            },
          });
          const uploadedUrl = uploadRes.data?.url || uploadRes.data?.file_url;
          const rawThumb = uploadRes.data?.thumbnail_url;
          const thumbnailUrl = rawThumb
            ? (String(rawThumb).startsWith('http') ? rawThumb : `${BACKEND_URL || ''}${rawThumb}`)
            : null;
          setAttachments((curr) =>
            curr.map((a) =>
              a.id === attachId ? { ...a, uploading: false, progress: 100, uploadedUrl, thumbnailUrl } : a
            )
          );
        } catch (err) {
          console.error("Attachment upload error:", err);
          toast.error("Не удалось загрузить файл");
          setAttachments((curr) => curr.filter((a) => a.id !== attachId));
        }
      })();
    });

    e.target.value = "";
  };

  const removeAttachment = (attachId) => {
    setAttachments((curr) => {
      const match = curr.find((a) => a.id === attachId);
      if (match?.preview && match.preview.startsWith("blob:")) {
        try { URL.revokeObjectURL(match.preview); } catch (_) {}
      }
      return curr.filter((a) => a.id !== attachId);
    });
  };

  const handleExport = async () => {
    if (!project?.video_url || exporting) return;
    setExporting(true);
    try {
      const link = document.createElement("a");
      link.href = `${BACKEND_URL}${project.video_url}`;
      link.download = `${project.title || "video"}.mp4`;
      link.click();
      toast.success("Экспорт начат");
    } catch (e) {
      toast.error("Не удалось экспортировать видео");
    } finally {
      setExporting(false);
    }
  };

  // Modify EXISTING video in-place without navigating away
  const handleEditSubmit = async () => {
    const text = editPrompt.trim();
    const anyUploading = attachments.some((a) => a.uploading);
    if ((!text && attachments.length === 0) || anyUploading || submittingEdit) return;

    setSubmittingEdit(true);
    if (isListening) {
      try { voiceRecognitionRef.current?.stop(); } catch (_) {}
      setIsListening(false);
    }

    try {
      // Send modification request for THIS video
      const r = await axios.post(`${API}/video/${id}/modify`, {
        prompt: text,
        language: currentLang,
        attachments: attachments.map((a) => ({
          uploadedUrl: a.uploadedUrl,
          type: a.type,
        })),
      });

      // Clear input and attachments
      setEditPrompt("");
      setAttachments([]);

      // Set project immediately to processing state so progress ring appears right here
      setProject({
        ...project,
        status: "processing",
        progress: 5,
        progress_message: currentLang === "ru" ? "Применяем правки к видео..." : "Applying edits to video...",
      });

      toast.success(currentLang === "ru" ? "Запрос на изменение видео принят" : "Video edit request received");

      // Start polling project status until completion
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(fetchProject, 1500);
    } catch (e) {
      console.error("modify failed:", e);
      toast.error(e?.response?.data?.message || (currentLang === "ru" ? "Не удалось отправить правки" : "Failed to apply edits"));
    } finally {
      setSubmittingEdit(false);
    }
  };

  if (isLoading) {
    return (
      <div className="video-page-loading" data-testid="video-page">
        <div className="video-page-spinner" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="video-page-loading" data-testid="video-page">
        <p className="video-page-error">{error}</p>
        <button onClick={() => navigate("/")} className="video-close-btn" data-testid="back-button">
          <X className="w-5 h-5" />
        </button>
      </div>
    );
  }

  const isProcessing = project?.status === "pending" || project?.status === "processing";
  const isCompleted = project?.status === "completed";
  const hasError = project?.status === "failed" || project?.status === "error";
  const hasVideo = project?.video_url;
  const anyUploading = attachments.some((a) => a.uploading);
  const canSend = !submittingEdit && !anyUploading && (editPrompt.trim().length > 0 || attachments.length > 0);

  return (
    <div className="video-page" data-testid="video-page">
      {/* Hidden file input for plus/attachment button */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Floating top-corner buttons — close-X on the left, white Export on the right */}
      <button
        onClick={() => navigate(-1)}
        className="video-close-btn video-close-btn--floating"
        data-testid="back-button"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
      {isCompleted && hasVideo && !isProcessing && (
        <button
          onClick={handleExport}
          className="video-export-btn video-export-btn--floating"
          data-testid="export-button"
          disabled={exporting}
        >
          <Download className="w-4 h-4" strokeWidth={2.4} />
          <span>{exporting ? (currentLang === "ru" ? "Экспорт..." : "Exporting...") : "Export"}</span>
        </button>
      )}

      <div className="video-page-main">
        {/* Video stack */}
        <div className="video-stack">
          {isProcessing && (
            <div className="video-page-processing">
              <div className="processing-ring">
                <span className="processing-pct">{project?.progress || 0}%</span>
              </div>
              <p className="processing-msg">{project?.progress_message || (currentLang === "ru" ? "Обработка..." : "Processing...")}</p>
            </div>
          )}

          {hasError && (
            <div className="video-page-error-box">
              <p className="error-title">{currentLang === "ru" ? "Ошибка" : "Error"}</p>
              <p className="error-msg">{project?.error_message || project?.error}</p>
              <button onClick={() => navigate("/")} className="error-retry-btn">
                <RotateCcw className="w-4 h-4" />
                {currentLang === "ru" ? "Попробовать снова" : "Try again"}
              </button>
            </div>
          )}

          {isCompleted && hasVideo && !isProcessing && (
            <div className="video-player-card video-player-card--small" data-testid="video-player-card">
              <video
                key={videoVersion}
                src={`${BACKEND_URL}${project.video_url}?t=${videoVersion}`}
                poster={project.poster_url ? `${BACKEND_URL}${project.poster_url}?t=${videoVersion}` : undefined}
                controls
                playsInline
                preload="auto"
                className="video-player-el"
                data-testid="video-element"
              />
            </div>
          )}
          {isCompleted && !isProcessing && Array.isArray(project?.edit_notes) && project.edit_notes.length > 0 && (
            <div className="video-edit-notes" data-testid="edit-notes">
              {project.edit_notes.map((n, i) => <p key={i}>{n}</p>)}
            </div>
          )}
        </div>

        {/* Edit prompt input area — visually IDENTICAL to MainPage */}
        <div className="create-input-area video-edit-input-area">
          <div className="input-outer">
            {/* Attachment preview chips */}
            {attachments.length > 0 && (
              <div className="attachments-row">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="attachment-item rounded-[16px] overflow-hidden">
                    <AttachmentThumb attachment={attachment} />
                    <button
                      className="attachment-remove"
                      onClick={() => removeAttachment(attachment.id)}
                      type="button"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="input-inner relative">
              {isListening && !editPrompt && (
                <div
                  className="listening-placeholder-overlay"
                  onClick={() => textareaRef.current?.focus()}
                >
                  <span>Listening</span>
                  <span className="listening-wave-dots">
                    <span className="dot dot-1">.</span>
                    <span className="dot dot-2">.</span>
                    <span className="dot dot-3">.</span>
                  </span>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={editPrompt}
                onChange={(e) => {
                  setEditPrompt(e.target.value);
                  autoResize();
                }}
                onInput={autoResize}
                placeholder={isListening ? "" : `nind ai, ${typedVerb}…`}
                className="prompt-textarea"
                rows={1}
                disabled={submittingEdit || isProcessing}
                data-testid="edit-prompt-input"
              />
            </div>

            <div className="input-bottom-row">
              <button
                className="input-icon-btn"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={submittingEdit || isProcessing}
                aria-label="Attach"
                data-testid="edit-attach-button"
              >
                <PlusIconSolid className="w-5 h-5" />
              </button>

              <div className="input-bottom-right">
                <button
                  className={`input-icon-btn ${isListening ? "active mic-recording" : ""}`}
                  type="button"
                  onClick={toggleListening}
                  disabled={submittingEdit || isProcessing}
                  aria-label="Mic"
                  data-testid="edit-mic-button"
                >
                  <MicIcon className="w-5 h-5" />
                </button>
                <button
                  className={`send-button ${canSend ? "active" : ""}`}
                  onClick={handleEditSubmit}
                  disabled={!canSend}
                  data-testid="edit-send-button"
                  type="button"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPage;
