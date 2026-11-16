import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Search, X, Headphones, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { useAppLanguage } from "../utils/translations";

// Slind AI Logo SVG
const LogoSvg = ({ className = "h-7 w-auto" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="25 130 1360 420" className={className} fill="currentColor">
    <g>
      <path d="M 97.00 546.37 C64.96,542.61 38.70,519.91 29.71,488.20 C27.57,480.64 27.52,479.13 27.23,405.59 C26.95,333.02 27.00,330.43 28.98,322.59 C36.12,294.22 57.79,272.03 85.13,265.08 C104.06,260.27 118.50,261.95 137.00,271.12 C146.08,275.62 148.73,277.56 156.64,285.46 C166.43,295.25 172.10,304.58 176.02,317.36 C179.55,328.87 180.00,338.89 179.99,404.97 C179.99,483.75 179.58,487.79 169.77,506.21 C164.02,517.01 149.05,531.58 137.45,537.68 C125.31,544.06 108.34,547.70 97.00,546.37 ZM 260.50 503.84 C242.54,500.46 231.50,494.62 218.44,481.56 C207.83,470.94 203.62,464.34 198.99,451.00 C195.93,442.19 195.16,423.24 195.07,354.47 C194.98,286.29 195.32,283.21 204.83,264.50 C208.58,257.11 211.10,253.81 218.95,246.00 C229.80,235.21 236.28,231.02 248.77,226.73 C255.78,224.32 259.72,223.63 268.78,223.24 C282.25,222.65 290.32,224.26 302.63,229.98 C320.14,238.12 332.34,250.33 339.87,267.27 C346.44,282.04 347.06,288.80 347.69,353.00 C348.44,430.46 347.23,445.08 338.57,462.50 C331.58,476.58 321.19,487.69 308.04,495.15 C293.79,503.24 275.30,506.62 260.50,503.84 ZM 1209.50 500.98 C1182.05,497.49 1154.42,481.64 1137.67,459.76 C1122.41,439.83 1113.49,419.15 1109.52,394.47 C1107.54,382.16 1107.51,350.71 1109.46,338.78 C1117.87,287.48 1152.09,246.54 1196.00,235.25 C1205.58,232.79 1208.16,232.55 1225.50,232.53 C1242.33,232.51 1245.47,232.78 1253.00,234.84 C1267.96,238.93 1284.16,248.64 1289.31,256.59 C1290.51,258.45 1291.84,259.98 1292.25,259.99 C1292.66,259.99 1293.00,233.03 1293.00,200.06 C1293.00,153.20 1293.27,139.94 1294.25,139.31 C1294.94,138.86 1313.89,138.37 1336.36,138.21 C1372.09,137.95 1377.52,138.11 1379.61,139.48 L 1382.00 141.05 L 1382.00 316.94 C1382.00,413.68 1381.73,493.55 1381.39,494.42 C1380.85,495.83 1376.13,496.00 1338.41,496.00 L 1296.04 496.00 L 1295.38 493.38 C1295.02,491.93 1294.97,486.49 1295.29,481.29 L 1295.85 471.82 L 1290.44 477.81 C1281.22,487.99 1266.13,496.25 1250.53,499.65 C1242.13,501.49 1219.28,502.23 1209.50,500.98 ZM 1257.84 425.55 C1272.94,421.54 1284.68,408.23 1290.63,388.40 C1293.37,379.26 1293.14,352.90 1290.24,343.81 C1283.13,321.53 1268.48,308.09 1249.38,306.31 C1238.34,305.28 1226.06,308.93 1217.25,315.87 C1205.18,325.38 1195.96,347.79 1196.01,367.50 C1196.06,387.92 1206.51,410.38 1220.42,419.94 C1230.00,426.54 1245.44,428.85 1257.84,425.55 ZM 412.61 494.42 C411.57,491.72 411.94,240.65 412.98,239.00 C413.80,237.71 419.62,237.50 455.38,237.50 C478.18,237.50 497.08,237.75 497.39,238.06 C497.70,238.37 498.08,243.54 498.23,249.56 L 498.50 260.50 L 506.50 252.45 C515.47,243.43 523.79,238.51 536.02,234.98 C545.40,232.27 569.68,231.16 580.99,232.93 C618.09,238.71 642.85,263.57 652.28,304.50 C654.28,313.19 654.37,316.68 654.72,404.76 L 655.08 496.02 L 611.29 495.76 L 567.50 495.50 L 566.99 416.50 C566.48,338.17 566.45,337.44 564.25,331.00 C561.17,321.98 555.79,315.16 549.00,311.68 C543.78,309.00 542.94,308.88 532.50,309.20 C522.57,309.52 521.04,309.82 516.77,312.36 C511.35,315.58 507.35,319.95 505.21,325.00 C501.17,334.55 501.07,336.69 501.04,417.75 L 501.00 496.00 L 457.11 496.00 C418.00,496.00 413.15,495.83 412.61,494.42 ZM 700.41 494.85 C699.30,493.07 699.46,240.13 700.56,239.08 C701.08,238.59 720.55,238.04 743.83,237.85 C784.79,237.51 786.21,237.56 787.58,239.44 C788.79,241.09 789.00,259.96 788.99,366.44 C788.98,435.22 788.70,492.51 788.37,493.75 L 787.77 496.00 L 744.44 496.00 C712.79,496.00 700.93,495.69 700.41,494.85 ZM 835.51 492.75 C834.59,487.65 835.40,239.27 836.33,238.33 C837.25,237.42 919.49,237.15 920.40,238.07 C920.71,238.38 921.09,243.55 921.23,249.57 L 921.50 260.50 L 929.50 252.39 C936.02,245.78 939.07,243.54 946.00,240.26 C960.84,233.25 964.90,232.49 987.00,232.56 C1005.32,232.62 1007.04,232.79 1015.45,235.36 C1043.32,243.90 1062.09,262.76 1071.54,291.72 C1077.68,310.54 1077.40,305.29 1077.75,404.76 L 1078.08 496.02 L 1034.29 495.76 L 990.50 495.50 L 990.00 416.00 L 989.50 336.50 L 987.18 330.76 C982.45,319.04 976.22,312.27 968.12,310.02 C963.36,308.69 950.98,308.72 945.69,310.07 C935.91,312.56 929.03,320.19 925.93,332.01 C924.10,338.98 924.00,343.51 924.00,417.68 L 924.00 496.00 L 880.05 496.00 L 836.09 496.00 L 835.51 492.75 ZM 700.25 216.34 C699.28,215.95 699.00,207.43 699.00,178.47 L 699.00 141.11 L 701.22 139.56 C703.15,138.21 708.97,138.00 744.57,138.00 C783.14,138.00 785.79,138.11 787.35,139.83 C788.82,141.46 789.00,145.64 789.00,178.72 C789.00,211.60 788.82,215.85 787.42,216.39 C785.53,217.12 702.05,217.06 700.25,216.34 Z" />
    </g>
  </svg>
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
