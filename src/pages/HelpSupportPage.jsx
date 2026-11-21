import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ChevronRight, Search, X, ChevronDown, ChevronUp, Mail } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";
import { useAppLanguage } from "../utils/translations";
import { FAQ_CATEGORIES, FAQ_ITEMS } from "../data/helpFaqs";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const SUPPORT_EMAIL = "support@nind.pro";
const COLLAPSED_FULL = 4;

const LogoSvg = ({ className = "h-7 w-auto" }) => (
  <img
    src="/assets/nind-logo-white-sm.png"
    srcSet="/assets/nind-logo-white-sm.png 1x, /assets/nind-logo-white.png 3x"
    alt="nind"
    className={className}
    draggable={false}
    style={{ height: 32, width: "auto", display: "block" }}
  />
);

const ChevronLeftTriangle = ({ className = "w-5 h-5 text-white" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

function readStoredUser() {
  try {
    const raw = localStorage.getItem("slind_user");
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function renderInline(text) {
  const re = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\))/g;
  const out = [];
  let last = 0;
  let m;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) {
      out.push(
        <strong key={`b${key++}`} className="font-semibold text-white">
          {m[2]}
        </strong>
      );
    } else {
      const href = m[4];
      const internal = href.startsWith("/");
      out.push(
        internal ? (
          <Link key={`l${key++}`} to={href} className="text-[#0F7DFE] underline underline-offset-2">
            {m[3]}
          </Link>
        ) : (
          <a
            key={`l${key++}`}
            href={href}
            className="text-[#0F7DFE] underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            {m[3]}
          </a>
        )
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function FaqAnswer({ text }) {
  const blocks = String(text || "").split(/\n\n+/);
  return (
    <div className="hs-answer">
      {blocks.map((block, i) => (
        <p key={i}>
          {block.split("\n").map((line, j, arr) => (
            <span key={j}>
              {renderInline(line)}
              {j < arr.length - 1 ? <br /> : null}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

function buildMailto({ email, subject, message }) {
  const body = [`From: ${email || "(not provided)"}`, "", message || ""].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject || "Help & Support")}&body=${encodeURIComponent(body)}`;
}

export default function HelpSupportPage() {
  const navigate = useNavigate();
  const { t } = useAppLanguage();

  const [searchQuery, setSearchQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [showSupportForm, setShowSupportForm] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportFaqId, setSupportFaqId] = useState(undefined);
  const [sending, setSending] = useState(false);
  const [highlightBackButton, setHighlightBackButton] = useState(false);

  const searchInputRef = useRef(null);
  const backBtnRef = useRef(null);
  const subjectInputRef = useRef(null);

  useEffect(() => {
    const user = readStoredUser();
    if (user?.email) setSupportEmail(user.email);
  }, []);

  const query = searchQuery.trim().toLowerCase();
  const filteredFaqs = useMemo(() => {
    if (!query) return FAQ_ITEMS;
    return FAQ_ITEMS.filter(
      (item) =>
        item.question.toLowerCase().includes(query) || item.answer.toLowerCase().includes(query)
    );
  }, [query]);

  const closeOverlays = useCallback(() => {
    setOpenFaq(null);
    setShowSupportForm(false);
  }, []);

  useEffect(() => {
    if (!openFaq && !showSupportForm) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeOverlays();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFaq, showSupportForm, closeOverlays]);

  const openFaqItem = (item) => {
    setOpenFaq(item);
  };

  const openSupportForm = (itemOrSubject) => {
    const item = itemOrSubject && typeof itemOrSubject === "object" ? itemOrSubject : null;
    const subject = item ? item.question : (itemOrSubject || "");
    setOpenFaq(null);
    setSupportFaqId(item?.id);
    setSupportSubject(subject ? `Help: ${subject}` : "Help & Support");
    setSupportMessage("");
    const user = readStoredUser();
    if (user?.email && !supportEmail) setSupportEmail(user.email);
    setShowSupportForm(true);
    setTimeout(() => subjectInputRef.current?.focus(), 150);
  };

  const handleEverythingClearYes = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setHighlightBackButton(true);
    setTimeout(() => {
      backBtnRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  };

  const handleSendSupport = async () => {
    const email = supportEmail.trim();
    const subject = supportSubject.trim() || "Help & Support";
    const message = supportMessage.trim();
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (!message) {
      toast.error("Please write a short message.");
      return;
    }
    if (sending) return;
    setSending(true);
    const user = readStoredUser();
    const payload = {
      email,
      subject,
      message,
      user_id: user?.user_id || user?.id || undefined,
      faq_id: supportFaqId,
    };
    const mailto = buildMailto({ email, subject, message });
    try {
      const r = await axios.post(`${API}/support`, payload);
      setShowSupportForm(false);
      setSupportMessage("");
      if (r.data?.emailed) {
        toast.success(`Message sent. We’ll reply to ${email}.`);
      } else {
        toast.success("Opening your email app to send the message to support@nind.pro.");
        window.location.href = r.data?.mailto || mailto;
      }
    } catch (err) {
      // Store failed or endpoint missing: still let the user email support.
      toast.success("Opening your email app to send the message to support@nind.pro.");
      setShowSupportForm(false);
      window.location.href = mailto;
    } finally {
      setSending(false);
    }
  };

  const renderQuestionRow = (item) => (
    <button
      key={item.id}
      type="button"
      className="faq-question-btn"
      onClick={() => openFaqItem(item)}
      data-testid={`faq-item-${item.id}`}
    >
      <span className="faq-question-text">{item.question}</span>
      <ChevronRight className="faq-arrow" />
    </button>
  );

  const renderCollapsedList = () => {
    const flat = FAQ_ITEMS;
    const full = flat.slice(0, COLLAPSED_FULL);
    const fifth = flat[COLLAPSED_FULL];
    return (
      <div className="hs-list" data-testid="faq-collapsed-list">
        <div className="upgrade-faq-list">
          {full.map((item) => (
            <div key={item.id} className="faq-item" style={{ background: "#141414", borderRadius: 26, overflow: "hidden" }}>
              {renderQuestionRow(item)}
            </div>
          ))}
        </div>
        {fifth ? (
          <div className="hs-fifth-wrap">
            <div className="upgrade-faq-list hs-fifth-clip">
              <div className="faq-item" style={{ background: "#141414", borderRadius: 26, overflow: "hidden" }}>
                {renderQuestionRow(fifth)}
              </div>
            </div>
            <div className="hs-fifth-fade" />
            <button
              type="button"
              className="hs-more-btn"
              onClick={() => setExpanded(true)}
              data-testid="faq-more-btn"
            >
              More <ChevronDown className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const renderExpandedList = () => (
    <div className="hs-list" data-testid="faq-expanded-list">
      {FAQ_CATEGORIES.map((category) => (
        <div key={category.id} className="hs-category">
          <h3 className="hs-category-title">{category.title}</h3>
          <div className="upgrade-faq-list">
            {category.items.map((item) => (
              <div key={item.id} className="faq-item" style={{ background: "#141414", borderRadius: 26, overflow: "hidden" }}>
                {renderQuestionRow(item)}
              </div>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        className="hs-more-btn hs-more-btn-static"
        onClick={() => {
          setExpanded(false);
          searchInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        data-testid="faq-less-btn"
      >
        Less <ChevronUp className="w-4 h-4" strokeWidth={2.5} />
      </button>
    </div>
  );

  const renderSearchResults = () => (
    <div className="hs-list" data-testid="faq-search-results">
      {filteredFaqs.length === 0 ? (
        <div className="py-10 text-center text-sm text-[#8E8E93]">
          No articles found. Try another search, or send a message to {SUPPORT_EMAIL}.
        </div>
      ) : (
        <div className="upgrade-faq-list">
          {filteredFaqs.map((item) => (
            <div key={item.id} className="faq-item" style={{ background: "#141414", borderRadius: 26, overflow: "hidden" }}>
              {renderQuestionRow(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#141414] text-white font-sans selection:bg-[#0096FE]/30">
      <style>{`
        .hs-category { margin-bottom: 28px; }
        .hs-category-title {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #8E8E93;
          margin: 0 0 12px 4px;
        }
        .hs-fifth-wrap { position: relative; margin-top: 10px; }
        .hs-fifth-clip { max-height: 38px; overflow: hidden; pointer-events: none; }
        .hs-fifth-fade {
          position: absolute;
          inset: 0;
          background: linear-gradient(to bottom, rgba(28,29,32,0) 0%, #1C1D20 78%);
          pointer-events: none;
        }
        .hs-more-btn {
          position: absolute;
          left: 50%;
          bottom: 2px;
          transform: translateX(-50%);
          z-index: 2;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 999px;
          background: #2A2B2E;
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          border: none;
          cursor: pointer;
        }
        .hs-more-btn:active { transform: translateX(-50%) scale(0.97); }
        .hs-more-btn-static {
          position: static;
          transform: none;
          margin: 22px auto 0;
          display: flex;
        }
        .hs-more-btn-static:active { transform: scale(0.97); }
        .hs-answer { font-size: 15px; line-height: 1.55; color: #C8C8CC; }
        .hs-answer p { margin: 0 0 12px; }
        .hs-answer p:last-child { margin-bottom: 0; }
        .hs-popup { max-height: 85vh; overflow: auto; padding-bottom: 36px; }
        .hs-popup-title {
          font-size: 20px;
          font-weight: 700;
          color: #fff;
          text-align: left;
          line-height: 1.3;
          margin: 8px 0 14px;
          padding-right: 36px;
        }
        .hs-close {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #1D1E20;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          cursor: pointer;
        }
        .hs-help-row { display: flex; align-items: center; gap: 10px; margin-top: 22px; flex-wrap: wrap; }
        .hs-help-label { font-size: 15px; font-weight: 600; color: #fff; margin-right: 4px; }
        .hs-field {
          width: 100%;
          border-radius: 20px;
          padding: 0 20px;
          background: #1C1C1E;
          display: flex;
          align-items: center;
          transition: background 0.2s ease;
          margin-bottom: 12px;
        }
        .hs-field:focus-within { background: #2E2F33; }
        .hs-field input, .hs-field textarea {
          width: 100%;
          background: transparent;
          color: #fff;
          font-size: 16px;
          border: none;
          outline: none;
        }
        .hs-field input { height: 56px; }
        .hs-field textarea { padding: 16px 0; min-height: 120px; resize: vertical; }
        .hs-field-area { align-items: flex-start; }
      `}</style>

      <div className="bg-[#141414] pt-5 pb-8 px-5">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <button
              ref={backBtnRef}
              onClick={() => navigate(-1)}
              data-testid="help-back-btn"
              style={highlightBackButton ? { outline: "1px solid #0096FE", outlineOffset: "2px" } : undefined}
              className="w-12 h-12 rounded-[18px] bg-[#1D1E20] flex items-center justify-center cursor-pointer active:scale-95 transition-all"
              title="Back"
            >
              <ChevronLeftTriangle className="w-5 h-5 text-white" />
            </button>
            <div className="flex items-center">
              <LogoSvg className="h-7 w-auto text-white opacity-95" />
            </div>
          </div>

          <div className="mb-8">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white flex items-center flex-wrap gap-3">
              <span>{t("howCanWe")}</span>
              <span className="cta-selection-box relative inline-block px-3 py-1.5 text-white">
                <span className="sel-line sel-line-top"></span>
                <span className="sel-line sel-line-bottom"></span>
                <span className="sel-line sel-line-left"></span>
                <span className="sel-line sel-line-right"></span>
                <span className="sel-corner sel-corner-tl"></span>
                <span className="sel-corner sel-corner-tr"></span>
                <span className="sel-corner sel-corner-bl"></span>
                <span className="sel-corner sel-corner-br"></span>
                {t("helpWord")}
              </span>
            </h1>
          </div>

          <div className="w-full h-14 rounded-full bg-[#1D1E20] focus-within:bg-[#232427] pl-6 pr-2.5 flex items-center justify-between transition-colors">
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchQuestion")}
              className="flex-1 bg-transparent text-base text-white placeholder-[#8E8E93] outline-none pr-2"
              data-testid="faq-search-input"
              autoComplete="off"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                className="w-9 h-9 rounded-full bg-[#2A2B2E] text-white/80 hover:text-white flex items-center justify-center mr-1"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}
            <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shrink-0">
              <Search className="w-5 h-5 stroke-[2.5]" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#1C1D20] px-5 pt-10 pb-24 min-h-[calc(100vh-270px)]">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-6 text-left tracking-tight">
            {query ? "Search results" : t("faqTitle")}
          </h2>

          {query ? renderSearchResults() : expanded ? renderExpandedList() : renderCollapsedList()}

          {!query && (
            <div className="mt-12 pt-8">
              <h3 className="text-2xl font-bold text-white mb-5 text-left tracking-tight">
                {t("everythingClear")}
              </h3>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleEverythingClearYes}
                  data-testid="everything-clear-yes"
                  className="h-13 px-9 rounded-full bg-white text-black text-base font-semibold hover:bg-white/90 active:scale-95 transition-all cursor-pointer"
                >
                  {t("yesExclamation")}
                </button>
                <button
                  type="button"
                  onClick={() => openSupportForm("")}
                  data-testid="everything-clear-no"
                  className="h-13 px-9 rounded-full bg-[#2A2B2E] text-white text-base font-semibold hover:bg-[#343539] active:scale-95 transition-all cursor-pointer"
                >
                  {t("no")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {openFaq && (
        <div className="popup-overlay" onClick={closeOverlays} data-testid="faq-popup">
          <div
            className="confirm-popup hs-popup relative"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="faq-popup-title"
          >
            <div className="popup-handle" />
            <button type="button" className="hs-close" onClick={closeOverlays} aria-label="Close" data-testid="faq-popup-close">
              <X className="w-4 h-4" />
            </button>
            <h3 id="faq-popup-title" className="hs-popup-title">
              {openFaq.question}
            </h3>
            <FaqAnswer text={openFaq.answer} />
            <div className="hs-help-row">
              <span className="hs-help-label">Did this help?</span>
              <button
                type="button"
                onClick={closeOverlays}
                className="h-11 px-6 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 active:scale-95 transition-all"
                data-testid="faq-did-help-yes"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => openSupportForm(openFaq)}
                className="h-11 px-6 rounded-full bg-[#2A2B2E] text-white text-sm font-semibold hover:bg-[#343539] active:scale-95 transition-all"
                data-testid="faq-did-help-no"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {showSupportForm && (
        <div className="popup-overlay" onClick={() => setShowSupportForm(false)} data-testid="support-form-popup">
          <div
            className="confirm-popup hs-popup relative"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-form-title"
          >
            <div className="popup-handle" />
            <button
              type="button"
              className="hs-close"
              onClick={() => setShowSupportForm(false)}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-14 h-14 rounded-full bg-[#1D1E20] flex items-center justify-center mx-auto mt-1 mb-3">
              <Mail className="w-6 h-6 text-white stroke-[1.75]" />
            </div>
            <h3 id="support-form-title" className="confirm-popup-title" style={{ marginBottom: 8 }}>
              Contact support
            </h3>
            <p className="text-sm text-[#8E8E93] text-center mb-5">
              Your message will be sent to {SUPPORT_EMAIL}.
            </p>
            <label className="sr-only" htmlFor="support-email">Your email</label>
            <div className="hs-field">
              <input
                id="support-email"
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                placeholder="Your email"
                autoComplete="email"
                data-testid="support-email"
              />
            </div>
            <label className="sr-only" htmlFor="support-subject">Subject</label>
            <div className="hs-field">
              <input
                id="support-subject"
                ref={subjectInputRef}
                type="text"
                value={supportSubject}
                onChange={(e) => setSupportSubject(e.target.value)}
                placeholder="Subject"
                data-testid="support-subject"
              />
            </div>
            <label className="sr-only" htmlFor="support-message">Message</label>
            <div className="hs-field hs-field-area">
              <textarea
                id="support-message"
                value={supportMessage}
                onChange={(e) => setSupportMessage(e.target.value)}
                placeholder="How can we help?"
                data-testid="support-message"
              />
            </div>
            <button
              type="button"
              disabled={sending}
              onClick={handleSendSupport}
              data-testid="support-send"
              className={`w-full h-14 rounded-full font-semibold text-[16px] flex items-center justify-center transition-all ${
                sending
                  ? "bg-[#2C2C2E] text-zinc-500 cursor-not-allowed"
                  : "bg-white text-black hover:bg-zinc-200 cursor-pointer shadow-md active:scale-[0.99]"
              }`}
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
