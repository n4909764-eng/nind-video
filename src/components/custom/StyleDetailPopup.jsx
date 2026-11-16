import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Style detail popup — bottom sheet with horizontal swipe navigation between
 * styles, vertical drag-to-dismiss with continuous follow.
 *  - ONE tall tile fills the sheet down to the CTA button
 *  - title + subtitle overlaid on the tile
 *  - top-LEFT close X: 44x44 rounded-square, matte frosted bg, BLACK X icon
 *  - swipe LEFT/RIGHT cycles through `formats` (clamped at ends)
 *  - swipe DOWN drags the sheet with the finger and releases either back
 *    to rest or out of view (like message swipe-to-dismiss)
 */

// "Use Style" icon — user-provided SVG
const UseStyleIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 1024 1024"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M 311.04 836.57 C296.83,838.34 272.25,838.26 261.14,836.40 C248.78,834.32 232.08,828.41 222.20,822.62 C205.97,813.09 190.78,795.71 182.77,777.50 C171.94,752.86 171.31,720.46 180.91,681.50 C193.18,631.73 220.02,573.38 256.31,517.60 L 262.75 507.70 L 252.08 491.10 C232.86,461.22 226.05,449.48 212.58,422.97 C190.31,379.16 177.15,338.76 173.01,301.50 C171.03,283.63 172.69,263.19 177.46,246.72 C188.49,208.69 216.53,184.46 256.38,178.54 C273.58,175.99 289.01,176.81 312.69,181.55 C366.64,192.34 445.17,228.76 500.77,268.77 L 511.04 276.16 L 520.77 269.25 C584.70,223.83 660.85,189.89 722.50,179.35 C737.09,176.85 762.47,177.03 775.01,179.71 C824.39,190.27 854.73,234.73 851.63,292.00 C848.67,346.81 822.75,411.63 772.68,489.47 C766.68,498.80 761.57,506.97 761.32,507.62 C761.07,508.27 763.95,513.46 767.72,519.15 C802.49,571.64 829.31,628.80 842.00,677.50 C847.55,698.80 849.06,708.33 849.71,726.25 C850.39,744.86 849.08,756.48 844.83,769.49 C833.89,803.04 805.47,827.20 767.00,835.64 C755.22,838.22 720.89,838.23 707.00,835.65 C663.72,827.63 611.37,807.15 562.00,778.94 C549.41,771.74 524.34,755.44 517.45,749.96 C515.40,748.33 513.09,747.00 512.32,747.00 C511.55,747.00 508.57,748.72 505.71,750.83 C474.11,774.07 426.91,800.17 390.00,814.83 C360.88,826.40 334.66,833.62 311.04,836.57 ZM 268.00 763.18 C276.38,765.97 300.07,765.19 317.50,761.54 C341.19,756.58 370.58,745.43 396.50,731.58 C414.18,722.12 447.78,701.74 452.94,697.33 C453.18,697.12 452.28,696.19 450.94,695.25 C436.18,684.97 397.14,651.03 386.73,639.43 C383.55,635.88 381.49,634.17 381.24,632.23 C380.92,629.73 383.56,626.86 390.59,619.21 C391.83,617.86 393.20,616.36 394.72,614.69 C406.64,601.60 424.87,584.21 429.00,582.00 C431.08,580.89 431.92,581.45 439.88,589.25 C465.39,614.26 502.81,645.37 534.99,668.31 C568.05,691.87 600.59,712.87 623.83,725.64 C697.76,766.26 756.14,776.46 772.74,751.65 C777.44,744.63 778.33,740.22 777.66,727.50 C777.08,716.63 776.38,713.11 771.32,695.50 C761.33,660.76 738.56,612.86 716.69,580.56 L 712.67 574.62 L 710.08 578.01 C698.97,592.63 682.63,611.30 667.00,627.25 L 648.50 646.12 L 642.50 642.39 C628.68,633.80 607.09,614.58 594.58,599.72 L 589.71 593.94 L 609.13 574.22 C637.74,545.18 655.80,524.63 676.57,497.50 C732.29,424.74 767.11,358.98 779.07,303.96 C781.99,290.50 782.21,273.88 779.56,266.50 C775.27,254.56 766.82,249.02 751.70,248.24 C719.55,246.57 666.22,265.12 610.00,297.52 C593.76,306.88 572.00,320.90 572.00,321.99 C572.00,322.43 572.59,323.01 573.32,323.29 C575.80,324.24 599.50,343.89 611.20,354.69 C617.64,360.64 626.55,369.46 631.00,374.30 L 639.09 383.09 L 635.80 387.27 C625.32,400.52 603.56,422.36 592.84,430.36 L 589.19 433.09 L 571.81 417.30 C510.64,361.67 455.90,321.71 396.22,289.10 C342.38,259.68 289.24,243.74 263.83,249.39 C249.38,252.61 243.18,260.50 242.24,276.84 C240.59,305.79 261.17,365.35 288.58,411.00 C299.34,428.91 311.12,446.28 311.90,445.39 C312.33,444.90 314.89,441.58 317.59,438.00 C336.51,412.95 374.78,373.00 379.84,373.00 C382.53,373.00 396.29,384.16 409.35,396.94 C421.34,408.66 432.72,421.58 431.87,422.49 C431.67,422.71 424.05,430.45 414.93,439.69 C374.26,480.96 324.62,548.29 292.11,606.30 C277.02,633.22 266.63,656.23 258.14,681.50 C246.79,715.28 243.78,736.57 248.81,747.50 C252.71,755.99 257.03,759.52 268.00,763.18 Z"
      fill="currentColor"
    />
  </svg>
);

export default function StyleDetailPopup({
  format,
  formats,
  initialIndex = 0,
  onClose,
  onUse,
}) {
  // List + active index for swipe navigation. If `formats` was not provided
  // we fall back to a single-item list using `format`.
  const list = Array.isArray(formats) && formats.length ? formats : [format];
  const [idx, setIdx] = useState(() => {
    const i = list.findIndex((f) => f && f.id === format?.id);
    return i >= 0 ? i : initialIndex;
  });
  const current = list[idx] || format;

  const [isClosing, setIsClosing] = useState(false);
  // dragX/dragY follow the finger continuously; axis is locked once decided
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [animateBack, setAnimateBack] = useState(false);

  const touchStart = useRef(null);
  const axis = useRef(null); // "x" | "y" | null
  const sheetRef = useRef(null);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => onClose && onClose(), 280);
  }, [isClosing, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") handleClose();
      else if (e.key === "ArrowRight" && idx < list.length - 1) setIdx(idx + 1);
      else if (e.key === "ArrowLeft" && idx > 0) setIdx(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, idx, list.length]);

  // Reset drag transforms when entering animateBack
  useEffect(() => {
    if (!animateBack) return;
    const t = setTimeout(() => {
      setDragX(0);
      setDragY(0);
      setAnimateBack(false);
    }, 280);
    return () => clearTimeout(t);
  }, [animateBack]);

  const onTouchStart = (e) => {
    if (animateBack || isClosing) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    axis.current = null;
  };

  const onTouchMove = (e) => {
    if (!touchStart.current || animateBack || isClosing) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;

    if (!axis.current && Math.hypot(dx, dy) > 8) {
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }

    if (axis.current === "x") {
      // Clamp at edges with elastic resistance
      const atStart = idx === 0 && dx > 0;
      const atEnd = idx === list.length - 1 && dx < 0;
      const damp = atStart || atEnd ? 0.35 : 1;
      setDragX(dx * damp);
    } else if (axis.current === "y" && dy > 0) {
      setDragY(dy); // 1:1 follow like message swipe-to-dismiss
    }
  };

  const onTouchEnd = () => {
    if (!touchStart.current || animateBack || isClosing) {
      touchStart.current = null;
      axis.current = null;
      return;
    }
    const dt = Date.now() - touchStart.current.time;
    const vx = dragX / Math.max(dt, 1);
    const vy = dragY / Math.max(dt, 1);

    if (axis.current === "x") {
      const threshold = 60;
      if (dragX < -threshold || vx < -0.4) {
        if (idx < list.length - 1) {
          setIdx(idx + 1);
        }
      } else if (dragX > threshold || vx > 0.4) {
        if (idx > 0) {
          setIdx(idx - 1);
        }
      }
      // Animate back to rest (and snap to new card position via re-render)
      setAnimateBack(true);
    } else if (axis.current === "y") {
      // Threshold by distance OR velocity
      if (dragY > 130 || vy > 0.55) {
        // Continue dragging out the rest of the way
        handleClose();
      } else {
        setAnimateBack(true);
      }
    }

    touchStart.current = null;
    axis.current = null;
  };

  const handleUse = () => {
    if (typeof onUse === "function") onUse(current);
  };

  if (!current) return null;

  const sample = current?.videos?.[0] || null;
  const tileBg = current.color || "#3A3A3A";

  // Combine drag transforms; X drag is on the tile only (for "card" feel);
  // Y drag moves the whole sheet
  const sheetTransform = dragY > 0
    ? `translateY(${dragY}px)`
    : undefined;

  const sheetStyle = {
    transform: sheetTransform,
    transition: animateBack ? "transform 0.28s cubic-bezier(0.2, 0.9, 0.3, 1)" : undefined,
  };

  const tileStyle = {
    backgroundColor: tileBg,
    transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
    transition: animateBack ? "transform 0.28s cubic-bezier(0.2, 0.9, 0.3, 1)" : undefined,
  };

  return (
    <div
      className={`style-popup-overlay${isClosing ? " closing" : ""}`}
      onClick={handleClose}
      data-testid="style-popup-overlay"
    >
      <div
        ref={sheetRef}
        className={`style-popup${isClosing ? " closing" : ""}`}
        style={sheetStyle}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        data-testid="style-popup"
      >
        <div
          className="style-popup-tile"
          style={tileStyle}
          data-testid="style-popup-stage"
        >
          {sample && sample.poster && (
            <img
              src={sample.poster}
              alt=""
              className="style-popup-tile-img"
              draggable={false}
            />
          )}
          {sample && sample.video_url && (
            <video
              src={sample.video_url}
              autoPlay
              loop
              muted
              playsInline
              className="style-popup-tile-img"
            />
          )}

          <div className="style-popup-tile-gradient" />

          {/* Frosted grabber pill — top-center, on the tile */}
          <div className="style-popup-grabber" aria-hidden="true" />

          {/* Close X — top-LEFT, frosted rounded-square, BLACK X icon */}
          <button
            className="style-popup-close-x"
            onClick={handleClose}
            aria-label="Close"
            data-testid="style-popup-close-x"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>

          {/* Title + subtitle on the tile */}
          <div className="style-popup-overlay-text">
            <h2 className="style-popup-title" data-testid="style-popup-title">
              {current.name}
            </h2>
            {current.subtitle && (
              <p className="style-popup-subtitle">{current.subtitle}</p>
            )}
          </div>
        </div>

        {/* Single CTA */}
        <button
          className="style-popup-use-btn"
          onClick={handleUse}
          data-testid="style-popup-use-btn"
        >
          <UseStyleIcon className="style-popup-use-icon" />
          <span>Use Style</span>
        </button>
      </div>
    </div>
  );
}
