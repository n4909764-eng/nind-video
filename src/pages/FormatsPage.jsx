import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search } from "lucide-react";
import StyleDetailPopup from "../components/custom/StyleDetailPopup";

const FORMATS = [
  { id: 1,  slug: "captions",         name: "Captions",            subtitle: "Structured headline compositions", color: "#1F1F23" },
  { id: 2,  slug: "motion_graphics",  name: "Motion Graphics",     subtitle: "AI motion design over your footage or from scratch", color: "#3B2A6E" },
  { id: 3,  name: "Product Showcase",   subtitle: "Highlight your products",       color: "#3A4A5A" },
  { id: 4,  name: "Meme Format",        subtitle: "Fun viral content",             color: "#5A4A3A" },
  { id: 5,  name: "Before / After",     subtitle: "Transformation videos",         color: "#3A5A4A" },
  { id: 6,  name: "Tutorial",           subtitle: "Step-by-step guides",           color: "#4A4A4A" },
  { id: 7,  name: "Promo Video",        subtitle: "Marketing content",             color: "#5A3A4A" },
  { id: 8,  name: "Story Time",         subtitle: "Narrative storytelling",        color: "#3A4A4A" },
  { id: 9,  name: "Kinetic Typography", subtitle: "Bold animated text",            color: "#23223A" },
  { id: 10, name: "Logo Animation",     subtitle: "Brand identity reveal",         color: "#1F2A3A" },
  { id: 11, name: "Chat Animation",     subtitle: "Messaging-style scenes",        color: "#2A3A2A" },
  { id: 12, name: "Apple Text",         subtitle: "Premium keynote-style text",    color: "#2A2A2A" },
];

const TABS = ["Все", "Популярные", "Новые", "Тренды"];

const FormatsPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("Все");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFormat, setSelectedFormat] = useState(null);

  const handleUse = () => {
    setSelectedFormat(null);
    // After choosing a style on this page, send the user to the Create flow
    // with the style id so the prompt input can prefill defaults.
    navigate('/');
  };

  return (
    <div className="formats-page">
      {/* Header */}
      <header className="formats-page-header">
        <button 
          className="back-button"
          onClick={() => navigate(-1)}
          data-testid="back-button"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="formats-page-title">Styles</h1>
        <div className="header-spacer" />
      </header>

      {/* Search */}
      <div className="formats-search-container">
        <div className="formats-search">
          <Search className="w-5 h-5 search-icon" />
          <input
            type="text"
            placeholder="Search formats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="formats-search-input"
            data-testid="formats-search-input"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="formats-tabs-container">
        <div className="formats-tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              className={`format-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
              data-testid={`tab-${tab}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Formats Grid */}
      <div className="formats-page-content">
        <div className="formats-page-grid">
          {FORMATS.filter(f => 
            f.name.toLowerCase().includes(searchQuery.toLowerCase())
          ).map((format) => (
            <button
              type="button"
              key={format.id}
              className="format-card-page"
              onClick={() => setSelectedFormat(format)}
              data-testid={`format-${format.id}`}
              style={{ padding: 0, border: 0, cursor: 'pointer', background: 'transparent' }}
            >
              <div 
                className="format-preview-page"
                style={{ backgroundColor: format.color }}
              />
              <span className="format-name-page">{format.name}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedFormat && (
        <StyleDetailPopup
          format={selectedFormat}
          formats={FORMATS}
          onClose={() => setSelectedFormat(null)}
          onUse={handleUse}
        />
      )}
    </div>
  );
};

export default FormatsPage;
