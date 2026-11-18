import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Generate random stars
const generateStars = (count) => {
  return Array.from({ length: count }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: Math.random() * 2 + 1,
    delay: Math.random() * 4,
    duration: Math.random() * 3 + 2,
  }));
};

export const SubscriptionSuccessPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  
  const [status, setStatus] = useState("checking");
  const [paymentData, setPaymentData] = useState(null);
  const stars = useMemo(() => generateStars(100), []);

  useEffect(() => {
    if (!sessionId) { setStatus("error"); return; }
    let cancelled = false;
    let attempt = 0;
    // The subscription is activated by the Whop webhook, which can take a few seconds.
    const poll = async () => {
      if (cancelled) return;
      if (attempt++ >= 30) { setStatus("timeout"); return; }
      try {
        const { data } = await axios.get(`${API}/subscription/status/${sessionId}`);
        if (data.payment_status === "paid") {
          setStatus("success");
          setPaymentData(data);
          try {
            const u = JSON.parse(localStorage.getItem("slind_user") || "null");
            if (u) localStorage.setItem("slind_user", JSON.stringify({ ...u, credits: data.credits ?? u.credits, subscription_status: "active" }));
          } catch (_) { /* ignore */ }
          return;
        }
        if (data.status === "expired") { setStatus("expired"); return; }
        setTimeout(poll, 2000);
      } catch (error) {
        console.error("Error checking payment status:", error);
        setStatus("error");
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center" data-testid="subscription-success-page">
      {/* Space Background */}
      <div className="space-bg">
        <div className="stars">
          {stars.map((star) => (
            <div
              key={star.id}
              className="star"
              style={{
                left: `${star.left}%`,
                top: `${star.top}%`,
                width: `${star.size}px`,
                height: `${star.size}px`,
                animationDelay: `${star.delay}s`,
                animationDuration: `${star.duration}s`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative z-10 text-center px-4 max-w-md mx-auto">
        {status === "checking" && (
          <>
            <Loader2 className="w-16 h-16 mx-auto mb-6 text-white/80 animate-spin" />
            <h1 className="text-2xl font-bold mb-2">Confirming your payment...</h1>
            <p className="text-white/60">Please wait a moment</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-12 h-12 text-green-400" />
            </div>
            <h1 className="text-3xl font-bold mb-2">Payment successful!</h1>
            <p className="text-white/60 mb-6">
              Your subscription is active and the credits are on your balance.
            </p>
            {false && (
              <p className="text-purple-400 font-semibold mb-6">
                План: {paymentData.metadata.plan_name}
              </p>
            )}
            <button
              onClick={() => navigate("/")}
              className="px-8 py-3 rounded-xl bg-white text-black font-semibold hover:bg-white/90 transition-all"
              data-testid="start-creating-btn"
            >
              Start creating
            </button>
          </>
        )}

        {status === "timeout" && (
          <>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <Sparkles className="w-12 h-12 text-yellow-400" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Payment is processing</h1>
            <p className="text-white/60 mb-6">
              Your payment is still being processed. Credits will appear on your balance shortly.
            </p>
            <button
              onClick={() => navigate("/")}
              className="px-8 py-3 rounded-xl glass-ios text-white font-semibold hover:bg-white/10 transition-all"
            >
              Back to home
            </button>
          </>
        )}

        {(status === "error" || status === "expired") && (
          <>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <ArrowLeft className="w-12 h-12 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold mb-2">
              {status === "expired" ? "Session expired" : "Something went wrong"}
            </h1>
            <p className="text-white/60 mb-6">
              {status === "expired" 
                ? "The checkout session expired. Please try again." 
                : "We could not confirm the payment yet. If you were charged, credits will appear shortly."}
            </p>
            <button
              onClick={() => navigate("/upgrade")}
              className="px-8 py-3 rounded-xl glass-ios text-white font-semibold hover:bg-white/10 transition-all"
            >
              Back to plans
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default SubscriptionSuccessPage;
