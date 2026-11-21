import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

export const AuthCallback = () => {
  const navigate = useNavigate();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const processAuth = async () => {
      const params = new URLSearchParams(window.location.search);
      const ticket = params.get("ticket");

      if (!ticket) {
        navigate("/auth?error=" + encodeURIComponent("Google sign-in did not complete. Please try again."), { replace: true });
        return;
      }

      try {
        const response = await fetch(`/api/auth/google/complete?ticket=${encodeURIComponent(ticket)}`, {
          credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.user) {
          throw new Error(data.error || "Google sign-in failed");
        }
        localStorage.setItem("slind_user", JSON.stringify(data.user));
        navigate("/", { replace: true });
      } catch (error) {
        const message = error?.message || "Google sign-in failed. Please try again.";
        navigate(`/auth?error=${encodeURIComponent(message)}`, { replace: true });
      }
    };

    processAuth();
  }, [navigate]);

  return (
    <div className="auth-callback" style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#0C0C0E"
    }}>
      <div className="loading-spinner" style={{
        width: 40,
        height: 40,
        border: "3px solid rgba(255,255,255,0.1)",
        borderTopColor: "#00DDFF",
        borderRadius: "50%",
        animation: "spin 1s linear infinite"
      }} />
    </div>
  );
};

export default AuthCallback;
