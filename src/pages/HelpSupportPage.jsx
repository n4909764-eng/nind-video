import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Search, X, Headphones, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { useAppLanguage } from "../utils/translations";

// Slind AI Logo SVG
const LogoSvg = ({ className = "h-7 w-auto" }) => (
  <img src="/assets/nind-logo-white-sm.png" srcSet="/assets/nind-logo-white-sm.png 1x, /assets/nind-logo-white.png 3x" alt="nind" className={className} draggable={false} style={{ height: 32, width: "auto", display: "block" }} />
);

// Chevron Left Triangle Only Icon (No line)
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

export default function HelpSupportPage() {
  const navigate = useNavigate();
  const { t } = useAppLanguage();
  const [searchParams] = useSearchParams();
  const activeChatId = searchParams.get("chat");

  const [openFaqId, setOpenFaqId] = useState(null);
  const [highlightBackButton, setHighlightBackButton] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [questionText, setQuestionText] = useState("");

  const searchInputRef = useRef(null);
  const backBtnRef = useRef(null);

  // Support Chat state
  const [supportChats, setSupportChats] = useState(() => {
    try {
      const raw = localStorage.getItem("slind_support_chats");
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  });
  const [activeChatMessage, setActiveChatMessage] = useState("");

  // FAQ list with reactive translations
  const faqItems = [
    {
      id: 1,
      question: t("faqCreditsQ"),
      answer: t("faqCreditsA"),
    },
    {
      id: 2,
      question: t("faqHowManyVideosQ"),
      answer: t("faqHowManyVideosA"),
    },
    {
      id: 3,
      question: t("faqPrioritySupportQ"),
      answer: t("faqPrioritySupportA"),
    },
    {
      id: 4,
      question: t("faqChangeSubQ"),
      answer: t("faqChangeSubA"),
    },
  ];

  // Focus search input when search popup opens
  useEffect(() => {
    if (showSearchModal) {
      setTimeout(() => searchInputRef.current?.focus(), 150);
    }
  }, [showSearchModal]);

  // Handle "Yes!" click: smooth scroll to top & blue outline on back button
  const handleEverythingClearYes = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setHighlightBackButton(true);
    setTimeout(() => {
      backBtnRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  };

  // Handle "No" click: opens Support Chat popup
  const handleEverythingClearNo = () => {
    setShowSupportModal(true);
  };

  // Handle send in Support Chat popup
  const handleSendSupportQuestion = () => {
    if (!questionText.trim()) return;

    const newMsg = {
      id: `msg_${Date.now()}`,
      sender: "user",
      text: questionText.trim(),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    let updatedChats = [...supportChats];
    let chatIndex = updatedChats.findIndex((c) => c.id === "chat_1");

    if (chatIndex >= 0) {
      updatedChats[chatIndex].messages.push(newMsg);
      updatedChats[chatIndex].last_updated = new Date().toISOString();
    } else {
      updatedChats.push({
        id: "chat_1",
        title: t("chat1") || "Chat 1",
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        messages: [newMsg],
      });
    }

    localStorage.setItem("slind_support_chats", JSON.stringify(updatedChats));
    setSupportChats(updatedChats);
    setQuestionText("");
    setShowSupportModal(false);

    // Top toast
    toast.success(t("messageSent") || "Message sent! Check your account for a reply", {
      position: "top-center",
      duration: 5000,
    });
  };

  // Handle sending reply inside active chat
  const handleSendChatMessage = () => {
    if (!activeChatMessage.trim()) return;

    const newMsg = {
      id: `msg_${Date.now()}`,
      sender: "user",
      text: activeChatMessage.trim(),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    let updatedChats = [...supportChats];
    let chatIndex = updatedChats.findIndex((c) => c.id === (activeChatId || "chat_1"));

    if (chatIndex >= 0) {
      updatedChats[chatIndex].messages.push(newMsg);
      updatedChats[chatIndex].last_updated = new Date().toISOString();
    } else {
      updatedChats.push({
        id: activeChatId || "chat_1",
        title: t("chat1") || "Chat 1",
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        messages: [newMsg],
      });
    }

    localStorage.setItem("slind_support_chats", JSON.stringify(updatedChats));
    setSupportChats(updatedChats);
    setActiveChatMessage("");
  };

  // Filtered FAQ articles for search popup
  const filteredFaqs = faqItems.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return item.question.toLowerCase().includes(q) || item.answer.toLowerCase().includes(q);
  });

  const currentChat = supportChats.find((c) => c.id === activeChatId);

  // ==================== SUPPORT CHAT VIEW (FROM ACCOUNT) ====================
  if (activeChatId && currentChat) {
    return (
      <div className="min-h-screen bg-[#141414] text-white flex flex-col justify-between font-sans">
        {/* Chat Header */}
        <div className="w-full max-w-xl mx-auto px-5 py-4 flex items-center justify-between sticky top-0 bg-[#141414] z-10">
          <button
            onClick={() => navigate(-1)}
            className="w-12 h-12 rounded-[18px] bg-[#1D1E20] flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
          >
            <ChevronLeftTriangle className="w-5 h-5 text-white" />
          </button>

          <h2 className="text-xl font-bold text-white tracking-tight">
            {currentChat.title || "Chat 1"}
          </h2>

          <div className="w-12 h-12 flex items-center justify-center">
            <Headphones className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Messages List */}
        <div className="flex-1 w-full max-w-xl mx-auto px-5 py-6 overflow-y-auto space-y-4">
          {currentChat.messages?.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-[22px] px-5 py-3.5 text-base leading-relaxed ${
                  msg.sender === "user"
                    ? "bg-[#0096FE] text-white rounded-br-sm"
                    : "bg-[#1D1E20] text-white rounded-bl-sm"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>
              </div>
              <span className="text-xs text-[#8E8E93] mt-1.5 px-1">{msg.time}</span>
            </div>
          ))}
        </div>

        {/* Input Bar */}
        <div className="w-full max-w-xl mx-auto px-5 py-4 bg-[#141414] sticky bottom-0">
          <div className="h-14 rounded-full bg-[#1D1E20] pl-5 pr-2 flex items-center gap-3">
            <input
              type="text"
              value={activeChatMessage}
              onChange={(e) => setActiveChatMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendChatMessage();
              }}
              placeholder={t("typeYourQuestion")}
              className="flex-1 bg-transparent text-base text-white placeholder-[#8E8E93] outline-none"
            />
            <button
              onClick={handleSendChatMessage}
              disabled={!activeChatMessage.trim()}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                activeChatMessage.trim()
                  ? "bg-white text-black active:scale-95 cursor-pointer"
                  : "bg-[#2A2B2E] text-[#6E7076] cursor-not-allowed"
              }`}
            >
              <ArrowUp className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== MAIN HELP & SUPPORT PAGE ====================
  return (
    <div className="min-h-screen bg-[#141414] text-white font-sans selection:bg-[#0096FE]/30">
      {/* ================= ZONE 1: TOP AREA (OVER THE SEARCH FIELD) ================= */}
      <div className="bg-[#141414] pt-5 pb-8 px-5">
        <div className="max-w-xl mx-auto">
          {/* Header Row: Back Button & Logo */}
          <div className="flex items-center justify-between mb-8">
            <button
              ref={backBtnRef}
              onClick={() => navigate(-1)}
              data-testid="help-back-btn"
              style={
                highlightBackButton
                  ? { outline: "1px solid #0096FE", outlineOffset: "2px" }
                  : undefined
              }
              className="w-12 h-12 rounded-[18px] bg-[#1D1E20] flex items-center justify-center cursor-pointer active:scale-95 transition-all"
              title="Back"
            >
              <ChevronLeftTriangle className="w-5 h-5 text-white" />
            </button>

            <div className="flex items-center">
              <LogoSvg className="h-7 w-auto text-white opacity-95" />
            </div>
          </div>

          {/* Hero Headline: "How can we [help?]" (increased headline size) */}
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

          {/* Search Input Pill (100% rounded, taller height) */}
          <div
            onClick={() => setShowSearchModal(true)}
            className="w-full h-14 rounded-full bg-[#1D1E20] hover:bg-[#232427] pl-6 pr-2.5 flex items-center justify-between cursor-pointer transition-colors"
          >
            <span className="text-base text-[#8E8E93] select-none">
              {t("searchQuestion")}
            </span>
            <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shrink-0">
              <Search className="w-5 h-5 stroke-[2.5]" />
            </div>
          </div>
        </div>
      </div>

      {/* ================= ZONE 2: BOTTOM AREA (LIGHTER SHADE OF GRAY) ================= */}
      <div className="bg-[#1C1D20] px-5 pt-10 pb-24 min-h-[calc(100vh-270px)]">
        <div className="max-w-xl mx-auto">
          {/* Section Header: "Frequently Asked Questions" (larger text size) */}
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-6 text-left tracking-tight">
            {t("faqTitle")}
          </h2>

          {/* FAQ Accordion List (original form, sizes and smooth animations from UpgradePage) */}
          <div className="upgrade-faq-list">
            {faqItems.map((item) => (
              <div
                key={item.id}
                style={{
                  background: openFaqId === item.id ? "#161719" : "#141414",
                  borderRadius: "26px",
                  overflow: "hidden",
                  transition: "background 0.3s ease",
                }}
                className={`faq-item ${openFaqId === item.id ? "open" : ""}`}
              >
                <button
                  className="faq-question-btn"
                  onClick={() =>
                    setOpenFaqId(openFaqId === item.id ? null : item.id)
                  }
                >
                  <span className="faq-question-text">{item.question}</span>
                  <ChevronRight
                    className={`faq-arrow ${
                      openFaqId === item.id ? "open" : ""
                    }`}
                  />
                </button>

                <div className="faq-answer-wrapper">
                  <div className="faq-answer">
                    {item.answer.split("\n").map((line, idx) => (
                      <p key={idx}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Everything clear? Section (larger title & larger buttons) */}
          <div className="mt-12 pt-8">
            <h3 className="text-2xl font-bold text-white mb-5 text-left tracking-tight">
              {t("everythingClear")}
            </h3>
            <div className="flex items-center gap-4">
              <button
                onClick={handleEverythingClearYes}
                data-testid="everything-clear-yes"
                className="h-13 px-9 rounded-full bg-white text-black text-base font-semibold hover:bg-white/90 active:scale-95 transition-all cursor-pointer"
              >
                {t("yesExclamation")}
              </button>
              <button
                onClick={handleEverythingClearNo}
                data-testid="everything-clear-no"
                className="h-13 px-9 rounded-full bg-[#2A2B2E] text-white text-base font-semibold hover:bg-[#343539] active:scale-95 transition-all cursor-pointer"
              >
                {t("no")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================= 1. SEARCH BOTTOM-SHEET POPUP ================= */}
      {showSearchModal && (
        <div
          className="popup-overlay"
          onClick={() => setShowSearchModal(false)}
        >
          <div
            className="w-full max-w-[500px] bg-[#141414] rounded-t-[32px] p-6 pb-10 flex flex-col max-h-[85vh] animate-slideUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Standard Project Popup Handle */}
            <div className="popup-handle" />

            {/* Top search input pill inside popup */}
            <div className="w-full h-14 rounded-full bg-[#1D1E20] pl-5 pr-2 flex items-center justify-between mb-5">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchQuestion")}
                className="flex-1 bg-transparent text-base text-white placeholder-[#8E8E93] outline-none pr-2"
              />
              {searchQuery ? (
                <button
                  onClick={() => setSearchQuery("")}
                  className="w-9 h-9 rounded-full bg-[#2A2B2E] text-white/80 hover:text-white flex items-center justify-center mr-1"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : null}
              <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shrink-0">
                <Search className="w-5 h-5 stroke-[2.5]" />
              </div>
            </div>

            {/* Articles List */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {filteredFaqs.length === 0 ? (
                <div className="py-12 text-center text-sm text-[#8E8E93]">
                  {t("noArticlesFound")}
                </div>
              ) : (
                filteredFaqs.map((faq) => (
                  <div
                    key={faq.id}
                    style={{
                      background: openFaqId === faq.id ? "#1C1D20" : "#1D1E20",
                      borderRadius: "24px",
                      overflow: "hidden",
                    }}
                    className={`faq-item ${openFaqId === faq.id ? "open" : ""}`}
                  >
                    <button
                      className="faq-question-btn"
                      onClick={() =>
                        setOpenFaqId(openFaqId === faq.id ? null : faq.id)
                      }
                    >
                      <span className="faq-question-text">{faq.question}</span>
                      <ChevronRight
                        className={`faq-arrow ${
                          openFaqId === faq.id ? "open" : ""
                        }`}
                      />
                    </button>
                    <div className="faq-answer-wrapper">
                      <div className="faq-answer">
                        {faq.answer.split("\n").map((line, idx) => (
                          <p key={idx}>{line}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= 2. SUPPORT CHAT BOTTOM-SHEET POPUP (ON "NO") ================= */}
      {showSupportModal && (
        <div
          className="popup-overlay"
          onClick={() => setShowSupportModal(false)}
        >
          <div
            className="w-full max-w-[500px] bg-[#141414] rounded-t-[32px] p-6 pb-10 flex flex-col items-center text-center animate-slideUp relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Standard Project Popup Handle */}
            <div className="popup-handle" />

            {/* Center: Support icon (headphones), title "Support Chat", subtitle "How can we help?" */}
            <div className="w-16 h-16 rounded-full bg-[#1D1E20] flex items-center justify-center mt-3 mb-4">
              <Headphones className="w-8 h-8 text-white stroke-[1.75]" />
            </div>

            <h3 className="text-2xl font-bold text-white tracking-tight">
              {t("supportChat")}
            </h3>
            <p className="text-base text-[#8E8E93] mt-1.5 mb-8">
              {t("howCanWe")} {t("helpWord")}
            </p>

            {/* Bottom: input "Type your question…" with circular arrow send button */}
            <div className="w-full h-14 rounded-full bg-[#1D1E20] pl-5 pr-2 flex items-center gap-3">
              <input
                type="text"
                autoFocus
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSendSupportQuestion();
                }}
                placeholder={t("typeYourQuestion")}
                className="flex-1 bg-transparent text-base text-white placeholder-[#8E8E93] outline-none"
              />
              <button
                onClick={handleSendSupportQuestion}
                disabled={!questionText.trim()}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  questionText.trim()
                    ? "bg-white text-black active:scale-95 cursor-pointer"
                    : "bg-[#2A2B2E] text-[#6E7076] cursor-not-allowed"
                }`}
                title="Send"
              >
                <ArrowUp className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
