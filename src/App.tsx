import "@/index.css";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import MainPage from "@/pages/MainPage";
import CreatePage from "@/pages/CreatePage";
import VideoPage from "@/pages/VideoPage";
import FormatsPage from "@/pages/FormatsPage";
import AuthPage from "@/pages/AuthPage";
import AuthCallback from "@/components/custom/AuthCallback";
import UpgradePage from "@/pages/UpgradePage";
import VoiceAssistantPage from "@/pages/VoiceAssistantPage";
import { initThemeFromStorage } from "@/components/custom/AppearancePopup";

import HelpSupportPage from "@/pages/HelpSupportPage";
import SubscriptionSuccessPage from "@/pages/SubscriptionSuccessPage";
import InfoLayout from "@/pages/info/InfoLayout";
import { INFO_PAGES } from "@/pages/info/routes";

// Initialize theme from localStorage before render
if (typeof window !== "undefined") {
  initThemeFromStorage();
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<MainPage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/create" element={<CreatePage />} />
      <Route path="/video/:id" element={<VideoPage />} />
      <Route path="/formats" element={<FormatsPage />} />
      <Route path="/upgrade" element={<UpgradePage />} />
      <Route path="/subscription/success" element={<SubscriptionSuccessPage />} />
      <Route path="/voice" element={<VoiceAssistantPage />} />
      <Route path="/help" element={<HelpSupportPage />} />
      <Route path="/support-chat" element={<HelpSupportPage />} />
      <Route path="/terms-of-service" element={<InfoLayout page={INFO_PAGES["/terms"]} />} />
      <Route path="/privacy-policy" element={<InfoLayout page={INFO_PAGES["/privacy"]} />} />
      {Object.entries(INFO_PAGES).map(([path, page]) => (
        <Route key={path} path={path} element={<InfoLayout page={page} />} />
      ))}
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App min-h-screen bg-[#141414] text-white">
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
      <Toaster
        position="top-center"
        duration={8000}
        swipeDirections={["top"]}
        closeButton={false}
        toastOptions={{
          duration: 8000,
          style: {
            background: "#FFFFFF",
            border: "none",
            borderRadius: "24px",
            color: "#000",
          },
        }}
      />
    </div>
  );
}
