import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { X, ChevronDown, Check, ChevronRight } from "lucide-react";
import { useAppLanguage } from "../utils/translations";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

// Credits icon (exact same as in Profile page)
const CreditsIcon = ({ className, color = "currentColor" }) => (
  <svg viewBox="0 0 1024 1024" fill={color} className={className}>
    <path d="M 498.04 902.32 C487.03,900.01 475.94,891.85 469.24,881.12 C466.30,876.39 464.43,871.45 454.27,841.50 C449.60,827.75 442.50,806.83 438.48,795.00 C434.46,783.17 424.65,754.60 416.68,731.50 C408.71,708.40 399.39,681.40 395.98,671.50 C388.62,650.16 385.22,643.34 378.45,636.41 C370.67,628.43 369.90,628.12 300.00,604.00 C285.98,599.16 263.25,591.29 249.50,586.52 C235.75,581.74 212.35,573.65 197.50,568.54 C161.94,556.30 145.49,550.28 139.99,547.49 C127.63,541.24 116.17,529.21 111.93,518.06 C104.36,498.12 110.23,477.38 127.50,463.09 C139.35,453.28 138.70,453.53 288.34,404.03 C330.05,390.24 366.01,378.02 368.23,376.88 C374.55,373.66 381.40,366.60 384.85,359.76 C386.58,356.32 398.77,321.33 411.93,282.00 C448.35,173.17 459.60,140.54 463.46,132.51 C472.77,113.15 492.48,102.78 514.11,105.84 C532.90,108.49 546.88,120.13 553.76,138.82 C555.11,142.49 572.11,192.83 591.54,250.67 C610.97,308.52 627.63,357.34 628.57,359.17 C631.46,364.83 636.05,369.98 641.39,373.58 C646.67,377.15 663.73,382.97 789.00,424.00 C873.18,451.56 877.75,453.41 890.17,464.84 C907.43,480.74 911.43,504.29 900.21,524.00 C891.35,539.58 880.18,546.86 848.50,557.74 C841.35,560.19 819.30,567.74 799.50,574.52 C691.95,611.32 651.67,625.51 645.98,628.61 C639.57,632.10 632.84,638.77 629.14,645.31 C626.23,650.46 617.93,673.51 600.98,723.50 C589.01,758.79 554.96,857.43 551.01,868.23 C545.18,884.21 537.37,893.59 525.12,899.32 C519.44,901.99 517.22,902.46 509.50,902.63 C504.55,902.74 499.39,902.60 498.04,902.32 Z"/>
  </svg>
);

const USER_REVIEWS = [
  {
    id: 1,
    author: "MiniKimji",
    stars: 5,
    title: "My new favorite AI tool",
    text: "I’ve tried nind to quite a few video generators, but having both creation and editing in one place on nind ai makes such a difference. Been using it way more than I expected.",
  },
  {
    id: 2,
    author: "Ana",
    stars: 5,
    title: "The Nind is so easy to use.",
    text: "I love how simple the whole process is. I can have an idea, experiment with it and actually turn it into a video without spending hours editing.",
  },
  {
    id: 3,
    author: "i love so",
    stars: 4,
    title: "There are so many…",
    text: "There are so many possibilities here. I especially like being able to experiment with different ideas and bring them to life so easily.",
  },
  {
    id: 4,
    author: "Reiulis",
    stars: 5,
    title: "Exactly what I was looking for",
    text: "Finally, a platform where I don’t need to jump between different tools just to make one video. Everything feels much more convenient.",
  },
  {
    id: 5,
    author: "Tessa",
    stars: 5,
    title: "Absolutely love the results",
    text: "I’ve been using nind for my social media content and it’s made the creative process so much easier. Definitely one of my favorite discoveries lately.",
  },
  {
    id: 6,
    author: "Mark D.",
    stars: 4,
    title: "A Solid platform",
    text: "The combination of AI video generation and editing is great. Still room for improvement, but the overall experience has been really good.",
  },
  {
    id: 7,
    author: "kel8970",
    stars: 5,
    title: "Didn’t expect it to be this good",
    text: "Just wanted to test it out at first. Ended up spending hours creating different videos. Pretty impressive honestly.",
  },
  {
    id: 8,
    author: "Nick",
    stars: 5,
    title: "Saves me a lot of time,",
    text: "I create content regularly, so anything that speeds up my workflow is welcome. nind has been genuinely useful so far.",
  },
  {
    id: 9,
    author: "envy",
    stars: 4,
    title: "Pretty impressive stuff",
    text: "The creative possibilities are what got me hooked. There’s always something new to try, and I like that.",
  },
  {
    id: 10,
    author: "Dv",
    stars: 5,
    title: "This is actually useful",
    text: "Not just another AI platform that looks cool but has no practical use. I’ve already started incorporating it into my workflow.",
  },
  {
    id: 11,
    author: "Altar Erbas",
    stars: 5,
    title: "Creating videos feel so easier now.",
    text: "I used to spend so much time on the technical side of editing. Now I can focus more on the actual content. Love it.",
  },
  {
    id: 12,
    author: "Mmmk",
    stars: 4,
    title: "Cool",
    text: "Wasn’t sure what to expect, but the results are genuinely nice. Still exploring all the features.",
  },
  {
    id: 13,
    author: "Finn Makloven",
    stars: 5,
    title: "A great tool for creators",
    text: "I’ve been looking for a way to make my video production more efficient. nind brings together exactly the kind of tools I need.",
  },
  {
    id: 14,
    author: "Plein",
    stars: 5,
    title: "I think it’s very nice for…",
    text: "I love being able to take an idea and experiment with it in so many different ways. Makes the whole process much more enjoyable.",
  },
  {
    id: 15,
    author: "Kirill",
    stars: 5,
    title: "Finally found something convenient",
    text: "The best thing for me is that I can create and edit videos without constantly switching between applications. Really good experience.",
  },
  {
    id: 16,
    author: "Non",
    stars: 4,
    title: "Has a lot of potential, I…",
    text: "I’ve only recently started using it, but I’m already enjoying the experience. Would love to see where the platform goes next.",
  },
  {
    id: 17,
    author: "John",
    stars: 5,
    title: "Way better than my old workflow",
    text: "I’ve been making videos for a while, and this has genuinely helped me save time. The AI features make experimenting much easier.",
  },
  {
    id: 18,
    author: "piperday",
    stars: 5,
    title: "Best AI video tool",
    text: "Every time I open nind I come up with another idea to try. It’s become a really fun part of my creative routine.",
  },
  {
    id: 19,
    author: "Super",
    stars: 5,
    title: "Super",
    text: "A really convenient way to create video content with AI. I like how much I can do without having to use several different platforms.",
  },
];

const UpgradePage = () => {
  const navigate = useNavigate();
  const { t } = useAppLanguage();
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [proCredits, setProCredits] = useState(3000);
  const [proCreditsOpen, setProCreditsOpen] = useState(false);
  const [openFaqId, setOpenFaqId] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(null);

  useEffect(() => {
    if (!proCreditsOpen) return;
    const onPointer = (event) => {
      if (!event.target.closest?.(".pricing-credits-box.has-dropdown")) {
        setProCreditsOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") setProCreditsOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [proCreditsOpen]);

  // Opens the Whop checkout for the chosen plan; the server attaches the user id as checkout metadata.
  const startCheckout = async (planKey) => {
    let user = null;
    try { user = JSON.parse(localStorage.getItem("slind_user") || "null"); } catch (_) { /* ignore */ }
    const userId = user?.user_id || user?.id;
    if (!userId) { navigate("/auth"); return; }
    setCheckoutLoading(planKey);
    try {
      const res = await fetch(`${API}/subscription/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, tier: planKey === "pro" ? "creator" : "starter", credits: planKey === "pro" ? proCredits : 500, cycle: billingCycle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.message || "checkout_failed");
      window.location.href = data.url;
    } catch (e) {
      toast.error("Could not open checkout. Please try again.");
      setCheckoutLoading(null);
    }
  };

  const reviewsScrollerRef = useRef(null);
  const isDraggingReviews = useRef(false);
  const resumeReviewsTimer = useRef(null);

  useEffect(() => {
    const scroller = reviewsScrollerRef.current;
    if (!scroller) return;

    let animId;
    let lastTs = 0;
    // Browsers round scrollLeft to whole pixels, so tiny per-frame increments
    // (e.g. 0.45px) were silently dropped and the carousel never moved.
    // Keep a float position and write it back every frame instead.
    let pos = scroller.scrollLeft;
    const pxPerSecond = 28; // slow continuous background crawl

    const tick = (ts) => {
      const dt = lastTs ? Math.min(64, ts - lastTs) : 16;
      lastTs = ts;
      if (scroller) {
        const halfWidth = scroller.scrollWidth / 2;
        if (isDraggingReviews.current) {
          pos = scroller.scrollLeft; // follow the user's manual swipe
        } else if (halfWidth > scroller.clientWidth / 2) {
          pos += (pxPerSecond * dt) / 1000;
          if (pos >= halfWidth) pos -= halfWidth;
          scroller.scrollLeft = pos;
        }
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    const onUserInteractStart = () => {
      isDraggingReviews.current = true;
      if (resumeReviewsTimer.current) clearTimeout(resumeReviewsTimer.current);
    };

    const onUserInteractEnd = () => {
      if (resumeReviewsTimer.current) clearTimeout(resumeReviewsTimer.current);
      resumeReviewsTimer.current = setTimeout(() => {
        isDraggingReviews.current = false;
      }, 1200);
    };

    scroller.addEventListener("touchstart", onUserInteractStart, { passive: true });
    scroller.addEventListener("touchend", onUserInteractEnd, { passive: true });
    scroller.addEventListener("mousedown", onUserInteractStart);
    window.addEventListener("mouseup", onUserInteractEnd);
    const onWheel = () => {
      onUserInteractStart();
      onUserInteractEnd();
    };
    scroller.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      cancelAnimationFrame(animId);
      if (resumeReviewsTimer.current) clearTimeout(resumeReviewsTimer.current);
      scroller.removeEventListener("touchstart", onUserInteractStart);
      scroller.removeEventListener("touchend", onUserInteractEnd);
      scroller.removeEventListener("mousedown", onUserInteractStart);
      window.removeEventListener("mouseup", onUserInteractEnd);
      scroller.removeEventListener("wheel", onWheel);
    };
  }, []);

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

  // Creator plan pricing based on credits:
  // 3000 credits: $69/mo ($59/mo annually)
  // 6000 credits: $119/mo ($99/mo annually)
  // 9000 credits: $199/mo ($169/mo annually)
  const getProPricing = (credits) => {
    if (credits === 6000) {
      return { monthly: 119, annual: 99 };
    }
    if (credits === 9000) {
      return { monthly: 199, annual: 169 };
    }
    return { monthly: 69, annual: 59 };
  };

  const proPrices = getProPricing(proCredits);

  const plans = {
    starter: {
      name: t("starterPlanName") || "Starter",
      monthlyPrice: 20,
      annualPrice: 16,
      credits: 500,
      features: [
        t("starterFeature1"),
        t("starterFeature2"),
        t("starterFeature3"),
        t("starterFeature4"),
        t("starterFeature5"),
      ],
    },
    pro: {
      name: t("creatorPlanName") || "Creator",
      monthlyPrice: proPrices.monthly,
      annualPrice: proPrices.annual,
      credits: proCredits,
      features: [
        t("creatorFeature1"),
        t("creatorFeature2"),
        t("creatorFeature3"),
      ],
      hasCreditsDropdown: true,
    },
  };

  const PricingCard = ({ plan, planKey }) => {
    const isMonthly = billingCycle === "monthly";
    const price = isMonthly ? plan.monthlyPrice : plan.annualPrice;

    return (
      <div className="pricing-card">
        <div className="pricing-card-top">
          <div className="pricing-card-header">
            <h3 className="pricing-card-name">{plan.name}</h3>
            <div className="pricing-card-price-row">
              <div className="pricing-price">${price}</div>
              <span className="pricing-period">{t("perMonth")}</span>
            </div>
          </div>

          {/* Credits Box — on Creator, the whole credits pill opens the amount menu */}
          <div className={`pricing-credits-box${plan.hasCreditsDropdown ? " has-dropdown" : ""}`}>
            {plan.hasCreditsDropdown ? (
              <>
                <button
                  type="button"
                  className="pricing-credits-trigger"
                  onClick={() => setProCreditsOpen((open) => !open)}
                  aria-expanded={proCreditsOpen}
                  aria-haspopup="listbox"
                  aria-label="Select credit amount"
                  data-testid="credits-selector"
                >
                  <CreditsIcon className="pricing-credits-icon" color="#FFFFFF" />
                  <span className="pricing-credits-text">
                    {plan.credits} {t("credits")}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 pricing-credits-chevron transition-transform ${
                      proCreditsOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {proCreditsOpen && (
                  <div className="pricing-credits-dropdown-menu" role="listbox">
                    {[3000, 6000, 9000].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        role="option"
                        aria-selected={proCredits === amount}
                        onClick={() => {
                          setProCredits(amount);
                          setProCreditsOpen(false);
                        }}
                      >
                        <CreditsIcon className="pricing-credits-icon" color="#FFFFFF" />
                        <span>{amount} {t("credits")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <CreditsIcon className="pricing-credits-icon" color="#FFFFFF" />
                <span className="pricing-credits-text">
                  {plan.credits} {t("credits")}
                </span>
              </>
            )}
          </div>

          {/* Subscribe Button */}
          <button className="pricing-subscribe-btn" onClick={() => startCheckout(planKey)} disabled={!!checkoutLoading} data-testid={`subscribe-${planKey}`}>{t("upgrade")}</button>
        </div>

        <div className="pricing-card-bottom">
          {/* Features List with scrollable container */}
          <div className="pricing-features">
            <p className="pricing-features-title">{t("includes")}</p>
            <div className="pricing-features-scroll">
              <ul className="pricing-features-list">
                {plan.features.map((feature, idx) => (
                  <li
                    key={idx}
                    className={planKey === "pro" && idx === 0 ? "no-check" : ""}
                  >
                    <Check className="pricing-check-icon" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="upgrade-page">
      {/* Header with close button (left) */}
      <header className="upgrade-header">
        <button className="upgrade-close-btn" onClick={() => navigate("/")}>
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content */}
      <div className="upgrade-content">
        <h2 className="upgrade-title">{t("pickYourPlan")}</h2>
        <p className="upgrade-subtitle">{t("pickPlanSubtitle")}</p>

        {/* Billing Tabs with animation */}
        <div className="upgrade-billing-tabs">
          <div
            className="upgrade-billing-indicator"
            style={{
              width: "calc(50% - 4px)",
              left: billingCycle === "monthly" ? "4px" : "50%",
            }}
          />
          <button
            className={`upgrade-billing-tab ${
              billingCycle === "monthly" ? "active" : ""
            }`}
            onClick={() => setBillingCycle("monthly")}
          >
            {t("monthly")}
          </button>
          <button
            className={`upgrade-billing-tab ${
              billingCycle === "annually" ? "active" : ""
            }`}
            onClick={() => setBillingCycle("annually")}
          >
            {t("annually")}
          </button>
        </div>

        {/* Pricing Cards */}
        <div className="upgrade-pricing-cards">
          <PricingCard plan={plans.starter} planKey="starter" />
          <PricingCard plan={plans.pro} planKey="pro" />
        </div>

        {/* What Users Say Section */}
        <div className="upgrade-reviews-section">
          <h2 className="upgrade-reviews-title">What Users Say</h2>
          <div className="upgrade-reviews-carousel-outer" ref={reviewsScrollerRef}>
            <div className="upgrade-reviews-track">
              {[...USER_REVIEWS, ...USER_REVIEWS].map((review, idx) => (
                <div key={`${review.id}-${idx}`} className="upgrade-review-card">
                  <div className="upgrade-review-top">
                    <div className="upgrade-review-stars">
                      {[...Array(5)].map((_, sIdx) => {
                        const isFilled = sIdx < review.stars;
                        return (
                          <svg
                            key={sIdx}
                            className={`review-star-icon ${isFilled ? "filled" : "empty"}`}
                            viewBox="0 0 24 24"
                            fill={isFilled ? "#FFFFFF" : "none"}
                            stroke={isFilled ? "#FFFFFF" : "rgba(255, 255, 255, 0.25)"}
                            strokeWidth="1.2"
                          >
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        );
                      })}
                    </div>
                    <h4 className="upgrade-review-card-title">{review.title}</h4>
                    <p className="upgrade-review-card-text">{review.text}</p>
                  </div>
                  <div className="upgrade-review-bottom">
                    <div className="upgrade-review-author">{review.author}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="upgrade-faq-section">
          <h2 className="upgrade-faq-title">{t("faqTitle")}</h2>

          <div className="upgrade-faq-list">
            {faqItems.map((item) => (
              <div
                key={item.id}
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
        </div>
      </div>
    </div>
  );
};

export default UpgradePage;
