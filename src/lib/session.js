// Server-side session token (issued by /api/auth/verify-code and Google sign-in).
// Every /api request carries it as "Authorization: Bearer <token>"; the server never trusts user ids from the client.
import axios from "axios";

const KEY = "slind_session_token";

export const getSessionToken = () => {
  try { return localStorage.getItem(KEY) || ""; } catch (_) { return ""; }
};

export const setSessionToken = (token) => {
  try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY); } catch (_) { /* ignore */ }
};

export const clearSession = () => {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem("slind_user");
  } catch (_) { /* ignore */ }
};

const isApi = (url) => {
  if (!url) return false;
  const u = String(url);
  if (u.startsWith("/api")) return true;
  try { const p = new URL(u, window.location.origin); return p.origin === window.location.origin && p.pathname.startsWith("/api"); } catch (_) { return false; }
};

let redirecting = false;
const onAuthRequired = () => {
  // signed-in state in the browser but the server has no session (expired / signed out elsewhere)
  if (redirecting || !localStorage.getItem("slind_user")) return;
  redirecting = true;
  clearSession();
  if (!window.location.pathname.startsWith("/auth")) window.location.assign("/auth");
};

export function installSessionInterceptors() {
  axios.interceptors.request.use((config) => {
    const t = getSessionToken();
    if (t && isApi(config.url)) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${t}`;
    }
    return config;
  });
  axios.interceptors.response.use(
    (r) => r,
    (err) => {
      if (err?.response?.status === 401 && err?.response?.data?.error === "auth_required") onAuthRequired();
      return Promise.reject(err);
    }
  );
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url;
    const t = getSessionToken();
    if (t && isApi(url)) {
      const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined) || {});
      headers.set("Authorization", `Bearer ${t}`);
      init = { ...init, headers };
    }
    return origFetch(input, init);
  };
}
