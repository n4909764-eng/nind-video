import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ArrowUp, X, Loader2, Search, ChevronRight, ChevronLeft, Check, MoreVertical, Download, Edit2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";
import ProfilePage from "../components/custom/ProfilePage";
import StyleDetailPopup from "../components/custom/StyleDetailPopup";
import LevelPicker, { loadLevel } from "../components/custom/LevelPicker";
import AttachmentThumb from "../components/custom/AttachmentThumb";
import { getTranslation, tr, getCurrentLang } from "../utils/translations";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Logo SVG component
const LogoSvg = ({ className }) => (
  <img src="/assets/nind-logo-white-sm.png" srcSet="/assets/nind-logo-white-sm.png 1x, /assets/nind-logo-white.png 3x" alt="nind" className={className} draggable={false} style={{ height: 32, width: "auto", display: "block" }} />
);

// Search icon SVG (user's custom)
const SearchIconCustom = ({ className }) => (
  <svg viewBox="0 0 1024 1024" fill="currentColor" className={className}>
    <path d="M 836.00 852.40 C820.81,849.66 814.26,845.70 792.75,826.24 C766.95,802.89 756.60,793.45 729.95,768.93 C717.05,757.06 698.17,739.78 688.00,730.52 C677.83,721.26 663.88,708.44 657.00,702.03 C650.12,695.63 634.71,681.27 622.74,670.12 L 600.98 649.85 L 590.24 656.62 C575.76,665.74 553.24,676.81 537.85,682.37 C492.55,698.73 443.36,703.39 393.36,696.05 C337.77,687.89 283.52,662.02 240.20,623.00 C190.47,578.20 156.55,511.80 150.08,446.58 C148.54,430.96 148.74,399.68 150.50,384.70 C158.02,320.39 186.33,263.35 232.83,218.83 C303.86,150.83 400.77,124.09 498.00,145.66 C535.80,154.04 574.87,172.12 607.00,196.07 C703.17,267.78 743.77,389.25 709.43,502.53 C701.93,527.28 691.32,549.57 676.18,572.42 L 667.62 585.33 L 672.06 589.32 C674.50,591.51 699.45,613.42 727.50,638.02 C755.55,662.63 787.50,690.75 798.50,700.53 C809.50,710.30 829.75,728.28 843.50,740.49 C879.34,772.30 883.32,776.36 887.73,785.65 C890.87,792.27 891.46,794.63 891.82,802.04 C892.04,806.80 891.73,813.05 891.11,815.92 C886.65,836.71 868.98,851.25 846.74,852.42 C842.21,852.66 837.38,852.65 836.00,852.40 ZM 465.81 646.48 C504.58,641.05 539.25,627.76 571.50,605.97 C593.33,591.22 615.67,568.78 631.19,546.00 C646.87,523.01 657.12,500.31 664.50,472.28 C675.64,429.96 673.42,381.68 658.36,338.74 C632.56,265.18 568.15,208.68 489.50,190.61 C471.78,186.54 456.39,184.94 435.00,184.93 C399.60,184.91 369.44,191.01 337.00,204.74 C296.83,221.74 260.26,252.12 236.07,288.57 C209.70,328.32 196.61,374.59 198.32,421.94 C199.55,456.16 206.94,485.09 222.46,516.50 C234.46,540.78 249.40,561.29 269.16,580.65 C309.19,619.84 363.85,644.16 421.50,648.41 C430.25,649.06 455.14,647.97 465.81,646.48 Z"/>
  </svg>
);

// Microphone icon — filled standard style (replaces previous outline custom SVG)
const MicIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
    <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
  </svg>
);

// Plus icon (solid gray like mic)
const PlusIconSolid = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// Sparkles icon
const SparklesIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
  </svg>
);

// "Use Style" / applied-style chip icon — same SVG as on the Use Style button
const UseStyleChipIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" className={className} aria-hidden="true">
    <path d="M 311.04 836.57 C296.83,838.34 272.25,838.26 261.14,836.40 C248.78,834.32 232.08,828.41 222.20,822.62 C205.97,813.09 190.78,795.71 182.77,777.50 C171.94,752.86 171.31,720.46 180.91,681.50 C193.18,631.73 220.02,573.38 256.31,517.60 L 262.75 507.70 L 252.08 491.10 C232.86,461.22 226.05,449.48 212.58,422.97 C190.31,379.16 177.15,338.76 173.01,301.50 C171.03,283.63 172.69,263.19 177.46,246.72 C188.49,208.69 216.53,184.46 256.38,178.54 C273.58,175.99 289.01,176.81 312.69,181.55 C366.64,192.34 445.17,228.76 500.77,268.77 L 511.04 276.16 L 520.77 269.25 C584.70,223.83 660.85,189.89 722.50,179.35 C737.09,176.85 762.47,177.03 775.01,179.71 C824.39,190.27 854.73,234.73 851.63,292.00 C848.67,346.81 822.75,411.63 772.68,489.47 C766.68,498.80 761.57,506.97 761.32,507.62 C761.07,508.27 763.95,513.46 767.72,519.15 C802.49,571.64 829.31,628.80 842.00,677.50 C847.55,698.80 849.06,708.33 849.71,726.25 C850.39,744.86 849.08,756.48 844.83,769.49 C833.89,803.04 805.47,827.20 767.00,835.64 C755.22,838.22 720.89,838.23 707.00,835.65 C663.72,827.63 611.37,807.15 562.00,778.94 C549.41,771.74 524.34,755.44 517.45,749.96 C515.40,748.33 513.09,747.00 512.32,747.00 C511.55,747.00 508.57,748.72 505.71,750.83 C474.11,774.07 426.91,800.17 390.00,814.83 C360.88,826.40 334.66,833.62 311.04,836.57 ZM 268.00 763.18 C276.38,765.97 300.07,765.19 317.50,761.54 C341.19,756.58 370.58,745.43 396.50,731.58 C414.18,722.12 447.78,701.74 452.94,697.33 C453.18,697.12 452.28,696.19 450.94,695.25 C436.18,684.97 397.14,651.03 386.73,639.43 C383.55,635.88 381.49,634.17 381.24,632.23 C380.92,629.73 383.56,626.86 390.59,619.21 C391.83,617.86 393.20,616.36 394.72,614.69 C406.64,601.60 424.87,584.21 429.00,582.00 C431.08,580.89 431.92,581.45 439.88,589.25 C465.39,614.26 502.81,645.37 534.99,668.31 C568.05,691.87 600.59,712.87 623.83,725.64 C697.76,766.26 756.14,776.46 772.74,751.65 C777.44,744.63 778.33,740.22 777.66,727.50 C777.08,716.63 776.38,713.11 771.32,695.50 C761.33,660.76 738.56,612.86 716.69,580.56 L 712.67 574.62 L 710.08 578.01 C698.97,592.63 682.63,611.30 667.00,627.25 L 648.50 646.12 L 642.50 642.39 C628.68,633.80 607.09,614.58 594.58,599.72 L 589.71 593.94 L 609.13 574.22 C637.74,545.18 655.80,524.63 676.57,497.50 C732.29,424.74 767.11,358.98 779.07,303.96 C781.99,290.50 782.21,273.88 779.56,266.50 C775.27,254.56 766.82,249.02 751.70,248.24 C719.55,246.57 666.22,265.12 610.00,297.52 C593.76,306.88 572.00,320.90 572.00,321.99 C572.00,322.43 572.59,323.01 573.32,323.29 C575.80,324.24 599.50,343.89 611.20,354.69 C617.64,360.64 626.55,369.46 631.00,374.30 L 639.09 383.09 L 635.80 387.27 C625.32,400.52 603.56,422.36 592.84,430.36 L 589.19 433.09 L 571.81 417.30 C510.64,361.67 455.90,321.71 396.22,289.10 C342.38,259.68 289.24,243.74 263.83,249.39 C249.38,252.61 243.18,260.50 242.24,276.84 C240.59,305.79 261.17,365.35 288.58,411.00 C299.34,428.91 311.12,446.28 311.90,445.39 C312.33,444.90 314.89,441.58 317.59,438.00 C336.51,412.95 374.78,373.00 379.84,373.00 C382.53,373.00 396.29,384.16 409.35,396.94 C421.34,408.66 432.72,421.58 431.87,422.49 C431.67,422.71 424.05,430.45 414.93,439.69 C374.26,480.96 324.62,548.29 292.11,606.30 C277.02,633.22 266.63,656.23 258.14,681.50 C246.79,715.28 243.78,736.57 248.81,747.50 C252.71,755.99 257.03,759.52 268.00,763.18 Z" fill="currentColor"/>
  </svg>
);

// Person icon SVG
const PersonIcon = ({ className }) => (
  <svg viewBox="0 0 1024 1024" fill="currentColor" className={className}>
    <path d="M 472.50 907.92 C399.79,903.47 339.60,894.58 279.93,879.46 C199.83,859.17 171.51,841.57 164.58,807.79 C160.48,787.78 164.88,739.16 174.11,702.56 C193.23,626.76 238.62,581.38 324.50,552.17 C343.87,545.58 372.91,539.00 382.61,539.00 C386.12,539.00 388.26,539.88 393.73,543.58 C413.47,556.94 443.76,567.65 476.00,572.66 C490.33,574.89 528.58,575.18 543.00,573.16 C577.95,568.29 607.96,557.82 630.43,542.68 L 636.37 538.68 L 646.06 539.81 C665.43,542.08 703.65,553.48 727.57,564.12 C788.29,591.11 823.84,627.19 843.22,681.50 C856.66,719.16 864.59,779.85 859.54,806.52 C853.77,837.05 831.12,853.72 770.58,871.98 C708.99,890.55 632.18,903.33 554.29,907.97 C534.80,909.14 491.96,909.10 472.50,907.92 ZM 491.00 493.36 C422.58,484.88 365.71,437.02 344.05,369.72 C338.60,352.77 336.94,342.22 336.31,320.50 C335.48,291.89 338.48,271.23 346.61,249.61 C361.87,208.97 393.61,173.73 432.51,154.20 C474.35,133.20 527.65,130.25 571.51,146.49 C629.04,167.79 671.99,217.51 684.59,277.39 C688.07,293.95 688.98,322.12 686.57,339.27 C679.49,389.87 653.55,433.03 612.50,462.55 C601.94,470.14 579.28,481.64 566.50,485.89 C548.85,491.76 539.55,493.16 516.00,493.49 C504.17,493.66 492.92,493.60 491.00,493.36 Z"/>
  </svg>
);

// Upgrade icon SVG (new from user)
const UpgradeIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 551 551" className={className} fill="currentColor">
    <path d="M 247.50 535.35 C237.41,534.26 217.51,530.67 206.95,528.03 C148.40,513.36 93.94,477.03 58.19,428.78 C46.79,413.40 43.43,407.94 35.20,391.50 C17.70,356.52 9.72,324.45 8.35,283.50 C6.90,240.36 15.11,201.93 33.97,163.50 C68.19,93.79 130.00,44.87 208.34,25.48 C227.53,20.73 241.29,18.96 264.00,18.32 C338.03,16.25 403.35,40.37 457.60,89.83 C480.32,110.54 499.64,136.79 514.04,166.50 C537.15,214.21 544.10,266.54 534.40,320.00 C525.80,367.48 505.11,410.49 473.56,446.50 C465.66,455.52 465.42,455.77 454.64,465.78 C422.76,495.42 382.37,517.15 338.00,528.53 C318.24,533.60 304.28,535.20 277.50,535.49 C263.20,535.65 249.70,535.58 247.50,535.35 ZM 297.04 478.57 C328.65,474.64 356.68,465.28 381.94,450.22 C411.74,432.44 437.43,406.76 455.89,376.28 C474.13,346.18 484.00,310.07 484.00,273.41 C484.00,240.17 477.24,212.88 461.30,181.69 C434.33,128.94 385.66,90.70 325.00,74.61 C308.91,70.34 298.26,68.90 278.50,68.33 C256.05,67.68 242.26,69.16 221.61,74.45 C182.38,84.51 151.23,101.90 123.89,129.00 C82.98,169.56 63.00,216.36 63.00,271.65 C63.00,298.67 65.70,316.07 73.61,340.00 C92.24,396.37 137.10,442.37 195.95,465.46 C212.94,472.12 236.88,477.79 254.50,479.32 C265.06,480.23 286.74,479.86 297.04,478.57 ZM 261.56 413.98 C255.62,411.66 248.77,405.19 245.73,399.02 L 243.50 394.50 L 243.22 312.66 L 242.94 230.83 L 217.75 255.57 C190.48,282.35 188.36,283.88 177.45,284.76 C168.31,285.49 162.03,283.08 154.91,276.11 C148.53,269.87 146.65,265.25 146.83,256.31 C147.02,246.73 149.08,244.07 177.31,216.74 C191.66,202.86 215.03,180.02 229.24,166.00 C258.98,136.65 261.86,134.56 272.50,134.56 C278.51,134.56 280.31,135.00 284.67,137.53 C287.67,139.27 304.44,154.60 325.12,174.50 C382.24,229.48 395.07,242.28 397.18,246.38 C403.61,258.90 398.29,274.09 384.86,281.53 C380.15,284.14 378.53,284.50 371.50,284.47 C364.67,284.45 362.76,284.03 358.44,281.67 C353.23,278.81 338.22,265.27 315.42,242.86 C308.23,235.79 302.04,230.00 301.67,230.00 C301.30,230.00 301.00,267.04 301.00,312.30 L 301.00 394.61 L 298.41 399.80 C291.86,412.94 275.27,419.33 261.56,413.98 Z"/>
  </svg>
);

// Plus icon SVG (for Start button)
const PlusIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500" className={className}>
    <path d="M 137.69 445.85 C128.67,444.81 113.18,440.11 104.50,435.75 C74.00,420.46 53.76,395.37 44.67,361.57 C42.51,353.52 42.50,353.20 42.50,245.00 L 42.50 136.50 L 45.16 126.88 C54.98,91.37 80.88,63.01 114.11,51.39 C131.06,45.47 126.42,45.69 240.00,45.27 C346.01,44.87 360.31,45.22 373.21,48.56 C401.61,55.90 426.21,74.77 440.92,100.48 C446.35,109.97 449.45,117.62 452.83,129.87 L 455.49 139.50 L 455.50 243.50 C455.50,357.78 455.72,353.21 449.35,372.00 C435.84,411.83 400.26,440.77 358.50,445.89 C347.51,447.24 149.52,447.20 137.69,445.85 ZM 365.28 397.75 C386.57,390.21 402.66,372.54 408.74,350.00 C410.36,344.01 410.50,335.74 410.50,244.00 L 410.50 144.50 L 407.26 135.21 C400.11,114.76 386.36,100.45 366.94,93.25 L 359.50 90.50 L 251.15 90.23 C144.19,89.96 142.70,89.98 135.11,92.03 C124.32,94.94 113.95,100.97 106.10,108.89 C95.06,120.02 89.38,131.84 87.07,148.45 C85.72,158.13 85.61,330.00 86.95,341.59 C90.13,369.25 107.94,390.86 134.00,398.67 L 141.50 400.92 L 249.50 400.71 L 357.50 400.50 L 365.28 397.75 ZM 240.50 355.85 C236.10,354.25 229.12,347.10 227.99,343.03 C227.43,341.01 227.01,323.32 227.01,301.75 L 227.00 264.00 L 188.16 264.00 C145.85,264.00 143.46,263.74 136.45,258.39 C131.59,254.69 128.02,247.10 128.01,240.45 C128.00,233.73 131.80,226.10 136.94,222.54 C144.54,217.27 147.08,217.00 188.66,217.00 L 227.00 217.00 L 227.02 181.75 C227.05,142.49 227.12,141.98 234.05,135.24 C242.08,127.43 256.88,128.41 264.65,137.26 C266.38,139.22 268.29,142.34 268.90,144.20 C270.14,147.95 270.77,164.00 270.91,195.69 L 271.00 216.87 L 310.25 217.19 C347.64,217.49 349.71,217.60 354.00,219.60 C363.78,224.15 368.41,231.69 367.83,242.08 C367.35,250.42 364.02,255.86 356.55,260.48 L 351.66 263.50 L 311.39 263.79 L 271.13 264.08 L 270.81 302.32 L 270.50 340.56 L 267.95 345.52 C264.39,352.42 258.00,356.32 249.64,356.68 C246.26,356.83 242.15,356.46 240.50,355.85 Z" fill="currentColor"/>
  </svg>
);
const PersonIconAvatar = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="759" height="759" viewBox="0 0 759 759" fill="white" className={className}>
    <g>
      <path d="M 343.14 701.46 C268.27,694.67 193.57,668.02 131.00,625.75 C112.00,612.92 88.11,593.93 86.00,590.00 C82.58,583.62 87.40,563.13 96.64,544.68 C119.28,499.50 165.14,462.32 228.67,437.63 C260.12,425.41 293.70,417.35 334.02,412.36 C350.82,410.28 397.56,409.98 416.50,411.83 C469.46,416.99 513.61,429.49 557.18,451.66 C599.23,473.05 631.06,499.84 650.83,530.50 C664.40,551.55 674.21,582.45 669.57,589.53 C663.47,598.84 620.39,629.94 591.00,646.25 C513.62,689.17 425.11,708.89 343.14,701.46 ZM 364.67 362.00 C295.24,355.35 240.74,306.03 225.83,236.38 C223.79,226.86 223.50,222.82 223.54,204.00 C223.57,185.49 223.89,181.04 225.84,172.00 C232.60,140.74 246.23,115.59 268.43,93.46 C289.18,72.76 312.27,59.56 340.00,52.54 C412.67,34.14 491.73,73.83 520.37,143.10 C533.46,174.78 536.37,210.31 528.51,242.76 C514.15,302.07 463.14,350.27 404.00,360.41 C392.68,362.35 375.54,363.04 364.67,362.00 Z" fill="white"/>
    </g>
  </svg>
);

// Format categories
const FORMAT_TABS = ["Все", "Новые", "Видео", "Фото", "Монтаж", "Анимации"];

// "Unlock more features" popup — shown on the anonymous landing when a
// non-authenticated user clicks the + (attach) or microphone icon next to
// the prompt input. It is positioned next to the icon that was clicked.
const UnlockPopup = ({ anchor, onClose, onAction, t }) => {
  const ref = useRef(null);
  const [style, setStyle] = useState({ top: 0, left: 0, opacity: 0 });

  useEffect(() => {
    if (!anchor || !ref.current) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popup = ref.current;
    const popupRect = popup.getBoundingClientRect();
    const margin = 10;

    // Default: just below the anchor, aligned to its left edge
    let top = anchorRect.bottom + margin;
    let left = anchorRect.left;

    // Keep inside viewport horizontally
    const maxLeft = window.innerWidth - popupRect.width - 12;
    if (left > maxLeft) left = maxLeft;
    if (left < 12) left = 12;

    // If not enough room below, show above
    if (anchorRect.bottom + margin + popupRect.height > window.innerHeight - 12) {
      top = anchorRect.top - popupRect.height - margin;
    }

    setStyle({ top, left, opacity: 1 });
  }, [anchor]);

  return (
    <div
      ref={ref}
      className="unlock-popup"
      style={style}
      data-testid="unlock-popup"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="unlock-popup-title">Unlock more features</div>
      <div className="unlock-popup-subtitle">Log In or Sign Up</div>
      <button
        type="button"
        className="unlock-popup-btn"
        onClick={onAction}
        data-testid="unlock-popup-cta"
      >
        {t ? t('getStarted') : 'Get started'}
      </button>
    </div>
  );
};

// Animated placeholder phrases
const PLACEHOLDER_PHRASES = [
  "create video story about…",
  "create promo video about…",
  "edit my video and add..",
  "translate my video…",
];

// Placeholder keys for translation
const PLACEHOLDER_KEYS = [
  'placeholder1', 'placeholder2', 'placeholder3', 'placeholder4',
  'placeholder5', 'placeholder6', 'placeholder7', 'placeholder8',
  'placeholder9', 'placeholder10', 'placeholder11', 'placeholder12'
];

// Placeholder formats with videos
const FORMATS = [
  { id: 1, slug: "captions", name: "Captions", subtitle: "Structured headline compositions", color: "#1F1F23", videos: [] },
  { id: 2, slug: "motion_graphics", name: "Motion Graphics", subtitle: "AI motion design over your footage or from scratch", color: "#3B2A6E", videos: [] },
  { id: 3, name: "Product Showcase", subtitle: "Highlight your products", color: "#3A4A5A", videos: [] },
  { id: 4, name: "Meme Format", subtitle: "Fun viral content", color: "#5A4A3A", videos: [] },
  { id: 5, name: "Before/After", subtitle: "Transformation videos", color: "#3A5A4A", videos: [] },
  { id: 6, name: "Tutorial", subtitle: "Step-by-step guides", color: "#4A4A4A", videos: [] },
  { id: 7, name: "Promo Video", subtitle: "Marketing content", color: "#5A3A4A", videos: [] },
  { id: 8, name: "Story Time", subtitle: "Narrative storytelling", color: "#3A4A4A", videos: [] },
];

// Example videos for carousel — updated per user spec
const EXAMPLE_VIDEOS = [
  { id: 1, title: "Content Creation", subtitle: "Clips about stories, facts, events…", color: "#1F2937", video: "/assets/home/content-creation-paris.mp4", poster: "/assets/home/content-creation-paris.jpg" },
  { id: 2, title: "Content Editing", subtitle: "Adding Subtitles, AI voice acting, Visual Effects, Frame Extraction, Graphics Elements…", color: "#1E293B" },
  { id: 3, title: "Product Promo", subtitle: "Promo video about your product", color: "#1E1B4B", video: "/assets/home/product-promo-duolingo.mp4", poster: "/assets/home/product-promo-duolingo.jpg" },
  { id: 4, title: "Video Translation", subtitle: "Translation using AI dubbing or subtitles", color: "#14532D" },
];

// Smooth progress component
const SmoothProgressCard = ({ video, onStop }) => {
  const [displayProgress, setDisplayProgress] = useState(0);
  const targetProgress = Math.min(Math.floor(video.progress || 0), 99);

  useEffect(() => {
    if (displayProgress < targetProgress) {
      const diff = targetProgress - displayProgress;
      const increment = Math.max(1, Math.ceil(diff / 20));
      const timer = setTimeout(() => {
        setDisplayProgress(prev => Math.min(prev + increment, targetProgress));
      }, 50);
      return () => clearTimeout(timer);
    } else if (displayProgress > targetProgress) {
      setDisplayProgress(targetProgress);
    }
  }, [displayProgress, targetProgress]);

  return (
    <div 
      className="creation-card generating"
      data-testid={`library-video-${video.id}`}
    >
      {video.modified_from && (
        <span
          className="modified-badge"
          data-testid={`modified-badge-${video.id}`}
        >
          modified
        </span>
      )}
      <div className="creation-generating">
        <div className="generating-percentage">{displayProgress}%</div>
        
        <div className="generating-progress-container">
          <div 
            className="generating-progress-fill"
            style={{ width: `${displayProgress}%` }}
          />
          
          <button 
            className="generating-stop-btn"
            onClick={(e) => {
              e.stopPropagation();
              onStop && onStop(video);
            }}
            title="Stop generation"
            data-testid={`stop-generation-${video.id}`}
          >
            <div className="stop-icon" />
          </button>
        </div>
      </div>
    </div>
  );
};

export const MainPage = () => {
  const navigate = useNavigate();
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-resize textarea up to ~9 lines, then scroll
  const autoResizeTextarea = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const styles = window.getComputedStyle(ta);
    const lineHeight = parseFloat(styles.lineHeight) || 24;
    const paddingTop = parseFloat(styles.paddingTop) || 0;
    const paddingBottom = parseFloat(styles.paddingBottom) || 0;
    const maxHeight = (lineHeight * 9) + paddingTop + paddingBottom;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
    ta.style.overflowY = ta.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };
  
  // State
  const [prompt, setPrompt] = useState("");
  const [user, setUser] = useState(null);

  // Pull the live credit balance from the server and persist it, so Account
  // always shows what was really charged ($0.01 API cost = 1 credit).
  const refreshUserFromServer = useCallback(async (uidArg) => {
    try {
      const raw = localStorage.getItem("slind_user");
      const local = raw ? JSON.parse(raw) : null;
      const uid = uidArg || local?.user_id || local?.id;
      if (!uid) return;
      const res = await axios.get(`${API}/users/${uid}`);
      const srv = res.data?.user;
      if (!srv) return;
      setUser(prev => {
        const merged = { ...(prev || local || {}), credits: srv.credits, available_credits: srv.available_credits, plan: srv.plan || (prev || local || {}).plan, subscription_status: srv.subscription_status };
        try { localStorage.setItem("slind_user", JSON.stringify(merged)); } catch (_) { /* ignore */ }
        return merged;
      });
    } catch (_) { /* offline — keep cached value */ }
  }, []);
  const [showProfile, setShowProfile] = useState(false);
  useEffect(() => {
    if (showProfile) refreshUserFromServer();
  }, [showProfile, refreshUserFromServer]);
  const [showFormatsPopup, setShowFormatsPopup] = useState(false);
  const [isPopupClosing, setIsPopupClosing] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [level, setLevel] = useState(loadLevel);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState("Все");
  const [searchQuery, setSearchQuery] = useState("");
  const [headerScrolled, setHeaderScrolled] = useState(false);
  
  // New states for logged-in view
  const [activeMainTab, setActiveMainTab] = useState("Creations");
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [previewFormat, setPreviewFormat] = useState(null); // for popup preview only
  const [showFormatPopup, setShowFormatPopup] = useState(false);
  const [showFormatsListPopup, setShowFormatsListPopup] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState(true);
  // Hydrate from localStorage so My Creations NEVER shows the empty
  // background while we re-fetch from the server. The cache is keyed
  // by user id so multiple accounts on the same browser don't leak.
  const _readCachedVideos = () => {
    try {
      const savedUser = localStorage.getItem("slind_user");
      if (!savedUser) return [];
      const u = JSON.parse(savedUser);
      const uid = u?.user_id || u?.id;
      if (!uid) return [];
      const cached = localStorage.getItem(`slind_user_videos_${uid}`);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  };
  const [userVideos, setUserVideos] = useState(_readCachedVideos);
  const [generatingVideos, setGeneratingVideos] = useState([]);
  // If we already have a logged-in user on mount, start in loading
  // mode so the empty-state pattern can never flash between mount and
  // the first server response.
  const [isLoadingVideos, setIsLoadingVideos] = useState(() => {
    try {
      const savedUser = localStorage.getItem("slind_user");
      return !!savedUser;
    } catch {
      return false;
    }
  });
  const [openMenu, setOpenMenu] = useState(null); // { id, top, left }
  const menuButtonRef = useRef(null);
  // Synchronous tracker of which video ids are CURRENTLY being polled.
  // setGeneratingVideos is async, so a second call to start polling for
  // the same id can sneak in before the state update lands and create a
  // duplicate progress card. This Set is checked / mutated synchronously
  // so each video id can have at most one active poll loop.
  const pollingIdsRef = useRef(new Set());
  
  // Popup swipe state
  const [popupDragY, setPopupDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const popupStartY = useRef(0);
  
  // Tick state forces "time ago" labels to refresh every 30 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Russian plural: "1 минута", "2 минуты", "5 минут"
  const ruPlural = (n, forms) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
    return forms[2];
  };

  // Helper function to calculate time ago (multilingual + grammar-correct)
  const getTimeAgo = (createdAt, completedAt) => {
    // ВСЕГДА используем created_at - время когда пользователь создал видео
    const dateToUse = createdAt;
    
    if (!dateToUse) return '';
    
    const now = new Date();
    // ВАЖНО: Если дата БЕЗ timezone (нет 'Z' или '+'), добавляем 'Z' для интерпретации как UTC
    const dateStr = typeof dateToUse === 'string' ? dateToUse : dateToUse.toString();
    const dateWithTz = (dateStr.endsWith('Z') || dateStr.includes('+')) ? dateStr : dateStr + 'Z';
    const created = new Date(dateWithTz);
    
    if (isNaN(created.getTime())) {
      console.warn('[TIME_AGO] Invalid date:', dateToUse);
      return '';
    }
    
    const diffMs = Math.max(0, now - created);
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    const diffWeek = Math.floor(diffDay / 7);
    const diffMonth = Math.floor(diffDay / 30);
    const diffYear = Math.floor(diffDay / 365);

    // Get language: prefer user account language if set, then current UI lang, strictly defaulting to 'en'
    const storedLang = typeof window !== 'undefined' ? localStorage.getItem('slind_language') : null;
    const activeLang = user?.language || currentLang || storedLang || 'en';
    const lang = (activeLang || 'en').toLowerCase().slice(0, 2);

    const timeFormats = {
      ru: {
        justNow: 'Только что',
        secAgo: (n) => `${n} ${ruPlural(n, ['секунду', 'секунды', 'секунд'])} назад`,
        minAgo: (n) => `${n} ${ruPlural(n, ['минуту', 'минуты', 'минут'])} назад`,
        hourAgo: (n) => `${n} ${ruPlural(n, ['час', 'часа', 'часов'])} назад`,
        dayAgo: (n) => `${n} ${ruPlural(n, ['день', 'дня', 'дней'])} назад`,
        weekAgo: (n) => `${n} ${ruPlural(n, ['неделю', 'недели', 'недель'])} назад`,
        monthAgo: (n) => `${n} ${ruPlural(n, ['месяц', 'месяца', 'месяцев'])} назад`,
        yearAgo: (n) => `${n} ${ruPlural(n, ['год', 'года', 'лет'])} назад`,
      },
      en: {
        justNow: 'Just now',
        secAgo: (n) => `${n}s ago`,
        minAgo: (n) => `${n}m ago`,
        hourAgo: (n) => `${n}h ago`,
        dayAgo: (n) => `${n}d ago`,
        weekAgo: (n) => `${n}w ago`,
        monthAgo: (n) => `${n}mo ago`,
        yearAgo: (n) => `${n}y ago`,
      },
      de: {
        justNow: 'Gerade eben',
        secAgo: (n) => `vor ${n} Sek`,
        minAgo: (n) => `vor ${n} Min`,
        hourAgo: (n) => `vor ${n} Std`,
        dayAgo: (n) => `vor ${n} T`,
        weekAgo: (n) => `vor ${n} Wo`,
        monthAgo: (n) => `vor ${n} Mon`,
        yearAgo: (n) => `vor ${n} J`,
      },
      es: {
        justNow: 'Ahora mismo',
        secAgo: (n) => `hace ${n} s`,
        minAgo: (n) => `hace ${n} min`,
        hourAgo: (n) => `hace ${n} h`,
        dayAgo: (n) => `hace ${n} d`,
        weekAgo: (n) => `hace ${n} sem`,
        monthAgo: (n) => `hace ${n} mes`,
        yearAgo: (n) => `hace ${n} a`,
      },
      pt: {
        justNow: 'Agora mesmo',
        secAgo: (n) => `há ${n} s`,
        minAgo: (n) => `há ${n} min`,
        hourAgo: (n) => `há ${n} h`,
        dayAgo: (n) => `há ${n} d`,
        weekAgo: (n) => `há ${n} sem`,
        monthAgo: (n) => `há ${n} mês`,
        yearAgo: (n) => `há ${n} a`,
      },
      fr: {
        justNow: "À l'instant",
        secAgo: (n) => `il y a ${n} s`,
        minAgo: (n) => `il y a ${n} min`,
        hourAgo: (n) => `il y a ${n} h`,
        dayAgo: (n) => `il y a ${n} j`,
        weekAgo: (n) => `il y a ${n} sem`,
        monthAgo: (n) => `il y a ${n} mois`,
        yearAgo: (n) => `il y a ${n} an`,
      },
      it: {
        justNow: 'Adesso',
        secAgo: (n) => `${n} sec fa`,
        minAgo: (n) => `${n} min fa`,
        hourAgo: (n) => `${n} h fa`,
        dayAgo: (n) => `${n} g fa`,
        weekAgo: (n) => `${n} sett fa`,
        monthAgo: (n) => `${n} mes fa`,
        yearAgo: (n) => `${n} a fa`,
      },
      pl: {
        justNow: 'Przed chwilą',
        secAgo: (n) => `${n} sek temu`,
        minAgo: (n) => `${n} min temu`,
        hourAgo: (n) => `${n} godz temu`,
        dayAgo: (n) => `${n} dni temu`,
        weekAgo: (n) => `${n} tyg temu`,
        monthAgo: (n) => `${n} mies temu`,
        yearAgo: (n) => `${n} lat temu`,
      },
      tr: {
        justNow: 'Şimdi',
        secAgo: (n) => `${n} sn önce`,
        minAgo: (n) => `${n} dk önce`,
        hourAgo: (n) => `${n} sa önce`,
        dayAgo: (n) => `${n} g önce`,
        weekAgo: (n) => `${n} hf önce`,
        monthAgo: (n) => `${n} ay önce`,
        yearAgo: (n) => `${n} y önce`,
      },
      zh: {
        justNow: '刚刚',
        secAgo: (n) => `${n}秒前`,
        minAgo: (n) => `${n}分钟前`,
        hourAgo: (n) => `${n}小时前`,
        dayAgo: (n) => `${n}天前`,
        weekAgo: (n) => `${n}周前`,
        monthAgo: (n) => `${n}个月前`,
        yearAgo: (n) => `${n}年前`,
      },
      ja: {
        justNow: 'たった今',
        secAgo: (n) => `${n}秒前`,
        minAgo: (n) => `${n}分前`,
        hourAgo: (n) => `${n}時間前`,
        dayAgo: (n) => `${n}日前`,
        weekAgo: (n) => `${n}週間前`,
        monthAgo: (n) => `${n}ヶ月前`,
        yearAgo: (n) => `${n}年前`,
      },
      ar: {
        justNow: 'الآن',
        secAgo: (n) => `قبل ${n} ث`,
        minAgo: (n) => `قبل ${n} د`,
        hourAgo: (n) => `قبل ${n} س`,
        dayAgo: (n) => `قبل ${n} ي`,
        weekAgo: (n) => `قبل ${n} أ`,
        monthAgo: (n) => `قبل ${n} ش`,
        yearAgo: (n) => `قبل ${n} سنة`,
      },
    };

    const format = timeFormats[lang] || timeFormats['en'];

    if (diffSec < 10) return format.justNow;
    if (diffSec < 60) return format.secAgo(diffSec);
    if (diffMin < 60) return format.minAgo(diffMin);
    if (diffHour < 24) return format.hourAgo(diffHour);
    if (diffDay < 7) return format.dayAgo(diffDay);
    if (diffWeek < 5) return format.weekAgo(diffWeek);
    if (diffMonth < 12) return format.monthAgo(diffMonth);
    return format.yearAgo(diffYear);
  };

  // Close menu on click outside, scroll, or resize
  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (e) => {
      if (!e.target.closest('.creation-menu-wrapper') && !e.target.closest('.creation-menu-dropdown')) {
        setOpenMenu(null);
      }
    };
    const closeMenu = () => setOpenMenu(null);

    document.addEventListener('click', handleClickOutside);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [openMenu]);

  // Handle stop generation — cancels the video, removes the card, restores prompt + attachments
  const handleStopGeneration = async (video) => {
    try {
      // Restore prompt + any saved attachments back into the input
      if (video.prompt) {
        setPrompt(video.prompt);
      }
      if (Array.isArray(video.savedAttachments) && video.savedAttachments.length > 0) {
        setAttachments(video.savedAttachments);
      }
      // Optimistically remove the card from UI
      setGeneratingVideos(prev => prev.filter(v => v.id !== video.id));
      // Call backend to cancel/delete the project
      try {
        await axios.delete(`${API}/videos/${video.id}`);
      } catch (err) {
        console.warn('Cancel API failed (non-fatal):', err);
      }
      toast.success(tr('generationStopped'));
    } catch (e) {
      console.error('Stop failed:', e);
      toast.error(tr('stopFailed'));
    }
  };

  const handleDownload = async (video) => {
    try {
      const videoUrl = video.video_url?.startsWith('http') ? video.video_url : `${BACKEND_URL}${video.video_url}`;
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `video-${video.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setOpenMenu(null);
      toast.success(tr('videoDownloading'));
    } catch (error) {
      console.error('Download error:', error);
      toast.error(tr('downloadError'));
    }
  };

  // Handle video delete
  const handleDelete = async (videoId) => {
    try {
      await axios.delete(`${API}/videos/${videoId}`);
      setUserVideos(prev => prev.filter(v => v.id !== videoId));
      setGeneratingVideos(prev => prev.filter(v => v.id !== videoId));
      setOpenMenu(null);
      toast.success(tr('videoDeleted'));
    } catch (error) {
      console.error('Delete error:', error);
      toast.error(tr('deleteError'));
    }
  };

  // Handle video edit — open the created video's page (edit view)
  const handleEdit = (videoOrId) => {
    setOpenMenu(null);
    const id = typeof videoOrId === 'string' ? videoOrId : videoOrId?.id;
    if (!id) return;
    navigate(`/video/${id}`);
  };

  // Examples carousel state
  const [exampleIndex, setExampleIndex] = useState(0);
  const [isCarouselTransition, setIsCarouselTransition] = useState(true);
  const touchStartX = useRef(0);
  const examplesCarouselRef = useRef(null);

  // Animated title words
  const titleWords = ['more', 'better', 'faster', 'easier'];
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isWordAnimating, setIsWordAnimating] = useState(false);

  // Voice assistant state
  const [showVoiceAssistant, setShowVoiceAssistant] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const recognitionRef = useRef(null);

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'ru-RU'; // Russian language

        recognitionRef.current.onresult = (event) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          setVoiceTranscript(transcript);
        };

        recognitionRef.current.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
          setIsRecording(false);
        };

        recognitionRef.current.onend = () => {
          if (isRecording) {
            // Restart if still recording
            try {
              recognitionRef.current.start();
            } catch (e) {
              console.log('Recognition already started');
            }
          }
        };
      }
    }
  }, [isRecording]);

  // Start voice recording
  const startRecording = async () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser');
      return;
    }
    
    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsRecording(true);
      setVoiceTranscript('');
      recognitionRef.current.start();
    } catch (err) {
      console.error('Microphone access denied:', err);
      alert('Please allow microphone access to use voice commands');
    }
  };

  // Stop voice recording and process
  const stopRecording = async () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    if (voiceTranscript.trim()) {
      setIsProcessing(true);
      
      // Simulate AI processing
      setTimeout(() => {
        setIsAISpeaking(true);
        setIsProcessing(false);
        
        // Simulate video creation
        setTimeout(() => {
          setIsAISpeaking(false);
          // Set the prompt and close voice assistant
          setPrompt(voiceTranscript);
          setShowVoiceAssistant(false);
          setVoiceTranscript('');
          
          // If user is not logged in, redirect to auth
          if (!user) {
            navigate('/auth');
          }
        }, 2000);
      }, 1500);
    }
  };

  // Title word rotation effect
  useEffect(() => {
    const interval = setInterval(() => {
      setIsWordAnimating(true);
      setTimeout(() => {
        setCurrentWordIndex(prev => (prev + 1) % titleWords.length);
        setIsWordAnimating(false);
      }, 400);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const handleCarouselNext = () => {
    setExampleIndex(prev => Math.min(EXAMPLE_VIDEOS.length - 1, prev + 1));
  };

  const handleCarouselPrev = () => {
    setExampleIndex(prev => Math.max(0, prev - 1));
  };

  // Animated placeholder state
  const [placeholderText, setPlaceholderText] = useState("");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);

  // "Unlock more features" popup (anonymous landing only)
  const [unlockPopup, setUnlockPopup] = useState({ open: false, anchor: null });
  const closeUnlockPopup = () => setUnlockPopup({ open: false, anchor: null });
  // Toggle: if the same icon is clicked twice, close instead of re-opening
  const toggleUnlockPopup = (e) => {
    const target = e.currentTarget;
    setUnlockPopup((prev) =>
      prev.open && prev.anchor === target
        ? { open: false, anchor: null }
        : { open: true, anchor: target }
    );
  };

  // Close on Escape / outside click
  useEffect(() => {
    if (!unlockPopup.open) return;
    const onKey = (e) => { if (e.key === 'Escape') closeUnlockPopup(); };
    const onClick = (e) => {
      if (e.target.closest('.unlock-popup') || e.target.closest('[data-unlock-trigger="1"]')) return;
      closeUnlockPopup();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [unlockPopup.open]);

  // Persist userVideos to localStorage on every change so My Creations
  // always shows the existing list on next mount — no empty-state
  // flash, no "your videos will be here" when you actually have videos.
  useEffect(() => {
    try {
      const uid = user?.user_id || user?.id;
      if (!uid) return;
      localStorage.setItem(
        `slind_user_videos_${uid}`,
        JSON.stringify(userVideos)
      );
    } catch (_) {
      /* localStorage unavailable — ignore */
    }
  }, [userVideos, user]);

  // Language state - synchronized with account setting and global events
  const [currentLang, setCurrentLang] = useState(() => {
    return user?.language || (typeof window !== 'undefined' ? localStorage.getItem('slind_language') : null) || 'en';
  });

  useEffect(() => {
    const syncLang = () => {
      const active = user?.language || localStorage.getItem('slind_language') || 'en';
      setCurrentLang(active);
    };
    syncLang();
    window.addEventListener('slind_language_changed', syncLang);
    window.addEventListener('storage', syncLang);
    return () => {
      window.removeEventListener('slind_language_changed', syncLang);
      window.removeEventListener('storage', syncLang);
    };
  }, [user?.language]);

  // Translation helper
  const t = (key) => getTranslation(currentLang, key);

  const handleLanguageChange = (langCode) => {
    setCurrentLang(langCode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('slind_language', langCode);
      window.dispatchEvent(new CustomEvent('slind_language_changed', { detail: langCode }));
    }
  };

  // Speech recognition / Voice input state
  const [isListening, setIsListening] = useState(false);
  const voiceRecognitionRef = useRef(null);

  const toggleListening = () => {
    if (isListening) {
      if (voiceRecognitionRef.current) {
        try { voiceRecognitionRef.current.stop(); } catch (_) {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = currentLang === 'ru' ? 'ru-RU' : 'en-US';

        let baseText = prompt ? prompt.trim() : '';

        recognition.onresult = (event) => {
          let currentTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            currentTranscript += event.results[i][0].transcript;
          }
          currentTranscript = currentTranscript.trim();
          if (currentTranscript) {
            const combined = baseText ? `${baseText} ${currentTranscript}` : currentTranscript;
            setPrompt(combined);
            autoResizeTextarea();
          }
        };

        recognition.onerror = (event) => {
          console.warn('Speech recognition error:', event.error);
          if (event.error === 'not-allowed') {
            toast.error(currentLang === 'ru' ? 'Доступ к микрофону отклонен' : 'Microphone access denied');
            setIsListening(false);
          }
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognition.start();
        voiceRecognitionRef.current = recognition;
        setIsListening(true);
      } catch (err) {
        console.error('Failed to start speech recognition:', err);
        setIsListening(false);
      }
    } else {
      toast.info(currentLang === 'ru' ? 'Говорите... (микрофон включен)' : 'Listening... (Speak now)');
      setIsListening(true);
    }
  };

  useEffect(() => {
    return () => {
      if (voiceRecognitionRef.current) {
        try { voiceRecognitionRef.current.stop(); } catch (_) {}
      }
    };
  }, []);

  // Check auth status and setup scroll listener
  useEffect(() => {
    // Honour the URL hand-off from VideoPage: `?tab=Creations&new=<id>`
    // switches to the Creations tab and immediately starts the
    // progress card for the new (modified) video — no extra clicks.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'Creations') {
        setActiveMainTab('Creations');
      }
      const newId = params.get('new');
      if (newId) {
        enqueueGenerating({
          id: newId,
          title: 'Modified video',
          status: 'pending',
          progress: 0,
          // Mark as modified so the white "modified" pill appears on
          // the progress card right away. The real value is restored
          // once fetchUserVideos returns this project.
          modified_from: 'pending',
        });
        // Strip the params so a reload doesn't keep re-triggering.
        const url = new URL(window.location.href);
        url.searchParams.delete('tab');
        url.searchParams.delete('new');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (_) {
      /* ignore URL parse failures */
    }

    const savedUser = localStorage.getItem("slind_user");
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
        refreshUserFromServer(parsedUser.user_id || parsedUser.id);
        
        // Fetch videos immediately after setting user — no 500ms wait
        // and never wipe the cached list. We persist to localStorage
        // so My Creations always shows existing videos on next mount.
        const fetchInitialVideos = async () => {
          const userId = parsedUser.user_id || parsedUser.id;
          if (!userId) return;
          
          console.log('[INIT] Fetching initial videos for', userId);
          setIsLoadingVideos(true);
          
          try {
            const response = await axios.get(`${API}/videos/user/${userId}`);
            const videos = response.data.projects || [];
            console.log('[INIT] Loaded', videos.length, 'videos');
            setUserVideos(videos);
            try {
              localStorage.setItem(
                `slind_user_videos_${userId}`,
                JSON.stringify(videos)
              );
            } catch (_) {
              /* localStorage unavailable — ignore */
            }
            // Pick up any in-progress videos so the progress card
            // appears on next mount too (covers reload mid-render
            // and the redirect from VideoPage with ?new=<id>).
            videos.forEach(v => {
              if (v.status === 'generating' || v.status === 'processing' || v.status === 'pending') {
                enqueueGenerating(v);
              }
            });
          } catch (error) {
            console.error('[INIT] Failed to fetch:', error);
            // Keep cached userVideos on failure — never blank the list.
          } finally {
            setIsLoadingVideos(false);
          }
        };
        
        fetchInitialVideos();
      } catch (e) {
        localStorage.removeItem("slind_user");
      }
    }
    
    // Scroll listener for header animation (only for non-logged in)
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const threshold = 350;
      setHeaderScrolled(scrollY > threshold);
    };
    
    window.addEventListener('scroll', handleScroll);
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Fetch user videos when switching to Library tab OR Creations tab OR when user logs in
  useEffect(() => {
    if ((activeMainTab === "Library" || activeMainTab === "Creations") && user) {
      fetchUserVideos();
    }
    // eslint-disable-next-line
  }, [activeMainTab, user]);

  // Animated placeholder typing effect
  useEffect(() => {
    const currentPhrase = PLACEHOLDER_PHRASES[phraseIndex % PLACEHOLDER_PHRASES.length];
    let timeout;

    if (isTyping) {
      // Typing animation
      if (placeholderText.length < currentPhrase.length) {
        timeout = setTimeout(() => {
          setPlaceholderText(currentPhrase.slice(0, placeholderText.length + 1));
        }, 50);
      } else {
        // Finished typing, wait then start erasing
        timeout = setTimeout(() => {
          setIsTyping(false);
        }, 2000);
      }
    } else {
      // Erasing animation
      if (placeholderText.length > 0) {
        timeout = setTimeout(() => {
          setPlaceholderText(placeholderText.slice(0, -1));
        }, 30);
      } else {
        // Finished erasing, move to next phrase
        setPhraseIndex((prev) => (prev + 1) % PLACEHOLDER_PHRASES.length);
        setIsTyping(true);
      }
    }

    return () => clearTimeout(timeout);
  }, [placeholderText, phraseIndex, isTyping, currentLang]);

  // Reset placeholder when language changes
  useEffect(() => {
    setPlaceholderText("");
    setPhraseIndex(0);
    setIsTyping(true);
  }, [currentLang]);

  // Intersection Observer for section animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0, rootMargin: '50px 0px 0px 0px' }
    );

    const titles = document.querySelectorAll('.section-title, .section-subtitle');
    titles.forEach((el) => observer.observe(el));

    return () => {
      titles.forEach((el) => observer.unobserve(el));
    };
  }, [user]);

  const fetchUserVideos = async () => {
    if (!user?.user_id && !user?.id) return;
    setIsLoadingVideos(true);
    try {
      const userId = user.user_id || user.id;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      console.log(`[FETCH_VIDEOS] Fetching for user: ${userId}`);
      
      const response = await axios.get(`${API}/videos/user/${userId}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      const fetchedVideos = response.data.projects || [];
      
      console.log(`[FETCH_VIDEOS] Received ${fetchedVideos.length} videos`);
      
      // Replace userVideos entirely with fresh data from server and
      // mirror it to localStorage so My Creations always restores
      // its videos on the next mount — no empty-state flicker.
      setUserVideos(fetchedVideos);
      try {
        localStorage.setItem(
          `slind_user_videos_${userId}`,
          JSON.stringify(fetchedVideos)
        );
      } catch (_) {
        /* localStorage unavailable — ignore */
      }
      
      // Resume polling for any generating videos. We include "pending"
      // here because freshly-created modify projects start in that state
      // before the background task picks them up. `enqueueGenerating`
      // synchronously dedups via pollingIdsRef so this can never spawn
      // a duplicate progress card on the same id.
      fetchedVideos.forEach(video => {
        if (video.status === 'generating' || video.status === 'processing' || video.status === 'pending') {
          enqueueGenerating(video);
        }
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error("Fetch videos timeout");
      } else {
        console.error("Failed to fetch videos:", error);
      }
    } finally {
      setIsLoadingVideos(false);
    }
  };

  // Single entry point to register a video as "currently generating".
  // Uses the synchronous pollingIdsRef tracker so even when this helper
  // is called twice in a row (e.g. once from handleSubmit and once from
  // a subsequent fetchUserVideos) there is at most ONE progress card
  // and ONE polling loop per video id.
  const enqueueGenerating = useCallback((video) => {
    if (!video || !video.id) return;
    if (pollingIdsRef.current.has(video.id)) {
      // Already polling — just refresh the card data, don't add again.
      setGeneratingVideos(prev => prev.map(v =>
        v.id === video.id ? { ...v, ...video, progress: Math.max(v.progress || 0, video.progress || 0) } : v
      ));
      return;
    }
    pollingIdsRef.current.add(video.id);
    setGeneratingVideos(prev => {
      // Defensive dedup in case the ref + state ever drift apart.
      if (prev.some(v => v.id === video.id)) return prev;
      return [{ ...video, progress: video.progress || 0 }, ...prev];
    });
    pollVideoProgress(video.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollVideoProgress = (videoId) => {
    let currentProgress = 5;
    let attempts = 0;
    const maxAttempts = 800; // ~20 min: real renders (stock search, AI photos, ffmpeg) take a few minutes

    const stopPolling = () => {
      pollingIdsRef.current.delete(videoId);
    };
    
    const pollInterval = setInterval(async () => {
      attempts++;
      
      // Increment progress smoothly
      if (currentProgress < 100) {
        const increment = currentProgress < 20 ? 3 : currentProgress < 50 ? 4 : currentProgress < 80 ? 3 : 2;
        currentProgress = Math.min(currentProgress + increment, 100);
      }
      
      try {
        const response = await axios.get(`${API}/video/${videoId}`);
        const videoData = response.data;
        
        setGeneratingVideos(prev => prev.map(v => {
          if (v.id !== videoId) return v;
          
          const newProgress = videoData.status === 'completed'
            ? 100
            : Math.max(Number(videoData.progress) || 0, Math.min(currentProgress, 95));
          
          return {
            ...v,
            ...videoData, // Обновляем ВСЕ данные с сервера (включая created_at)
            progress: Math.max(v.progress || 0, newProgress),
            status: videoData.status
          };
        }));
        
        if (videoData.status === 'completed' || videoData.status === 'failed' || videoData.status === 'error') {
          clearInterval(pollInterval);
          stopPolling();
          setGeneratingVideos(prev => prev.filter(v => v.id !== videoId));
          refreshUserFromServer();
          if (videoData.status === 'completed') {
            // Add to userVideos with deduplication
            setUserVideos(prev => {
              const existingIndex = prev.findIndex(v => v.id === videoData.id);
              if (existingIndex >= 0) {
                // Update existing video
                const updated = [...prev];
                updated[existingIndex] = videoData;
                return updated;
              } else {
                // Add new video
                return [videoData, ...prev];
              }
            });
          }
          return;
        }
        
      } catch (error) {
        setGeneratingVideos(prev => prev.map(v => {
          if (v.id !== videoId) return v;
          return {
            ...v,
            progress: Math.max(v.progress || 0, currentProgress)
          };
        }));
      }
      
      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        stopPolling();
        setGeneratingVideos(prev => prev.filter(v => v.id !== videoId));
      }
    }, 1500); // 1.5 seconds for smoother updates
  };

  const handleSubmit = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }
    
    if (!prompt.trim() && attachments.length === 0) return;
    
    const currentPrompt = prompt.trim();
    const currentAttachments = [...attachments];
    
    console.log(`[SUBMIT] Starting: "${currentPrompt}"`);
    
    // Clear input immediately to allow typing next prompt
    setPrompt('');
    setAttachments([]);
    
    try {
      const requestData = {
        prompt: currentPrompt,
        format_id: selectedFormat?.slug || "auto",
        language: "auto",
        level,
        user_id: user.id || user.user_id
      };
      
      if (currentAttachments.length > 0) {
        // Auto-upload at attach time has already pushed every file to the
        // server. By the time `handleSubmit` is called, every attachment
        // is guaranteed to have a non-null `uploadedUrl` (the send button
        // is disabled until that's true). So there is NO upload happening
        // here — generation kicks off immediately.
        const uploadedUrls = currentAttachments
          .map(a => a.uploadedUrl)
          .filter(Boolean);
        if (uploadedUrls.length !== currentAttachments.length) {
          // Safety net — if somehow we landed here mid-upload, bail out
          // gracefully so we don't fire /video/generate with a missing URL.
          toast.error(tr('uploadError') || "Файл ещё загружается, подождите.");
          // Restore attachments + prompt so the user can retry.
          setPrompt(currentPrompt);
          setAttachments(currentAttachments);
          return;
        }

        const videoAttachment = currentAttachments.find(a => a.type === "video");

        // Route a video attachment to the 3D phone mockup flow ONLY when the
        // user explicitly asks for it (or has no prompt at all). Otherwise the
        // video becomes the source for caption/headline overlay, etc., and the
        // prompt is sent to the regular generation pipeline.
        const promptLower = (currentPrompt || "").toLowerCase();
        const mockupKeywords = /\b(3d|mockup|mock-up|айфон|iphone|phone\s*frame|на\s*телефон[еа]?|3д|макет|на\s*айфон)\b/i;
        const isMockupIntent = videoAttachment && (
          !currentPrompt || mockupKeywords.test(promptLower)
        );

        if (videoAttachment && isMockupIntent) {
          const response = await axios.post(`${API}/device-mockup/create`, {
            video_url: uploadedUrls[0],
            device_type: "phone",
            rotation: 12,
            bg_color: [15, 15, 20],
            animation_style: "camera",
            phone_position: "center",
            aspect_ratio: "9:16",
            user_id: user.user_id || user.id
          });

          const newVideo = {
            id: response.data.id,
            title: currentPrompt,
            prompt: currentPrompt,
            savedAttachments: currentAttachments,
            status: 'generating',
            progress: 0
          };
          enqueueGenerating(newVideo);

          setActiveMainTab('Creations');
          setTimeout(() => {
            const bottomPanel = document.querySelector('.bottom-panel');
            if (bottomPanel) bottomPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 100);

          toast.success(tr('creating3DAnimation'));
          return;
        }

        // Pass uploaded video as the source for the prompt-driven pipeline so
        // captions / text effects / etc. can be rendered ON TOP of it.
        if (videoAttachment) {
          requestData.source_video_url = uploadedUrls[0];
        }
        // Non-video attachments (images) are forwarded as product images.
        const imageUrls = uploadedUrls.filter((_, i) =>
          (currentAttachments[i]?.type || '') !== 'video'
        );
        if (imageUrls.length > 0) {
          requestData.product_images = imageUrls;
        }
      }
      
      const response = await axios.post(`${API}/video/generate`, requestData, {
        headers: {
          'Authorization': `Bearer ${user.token}`
        }
      });
      
      console.log(`[SUBMIT] Response ID: ${response.data.id}`);
      
      // Add generating video to the list (БЕЗ created_at - будет взято с сервера)
      const newVideo = {
        id: response.data.id,
        title: currentPrompt,
        prompt: currentPrompt,
        savedAttachments: currentAttachments,
        status: 'generating',
        progress: 5
      };
      
      refreshUserFromServer();
      
      console.log(`[SUBMIT] Adding to generatingVideos`);
      enqueueGenerating(newVideo);
      
      // Switch to My creations tab
      setActiveMainTab('Creations');
      
      // Scroll to bottom panel
      setTimeout(() => {
        const bottomPanel = document.querySelector('.bottom-panel');
        if (bottomPanel) {
          bottomPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
      
      toast.success(tr('generationStarted'));
      
    } catch (error) {
      console.error("Failed to start generation:", error);
      if (error?.response?.status === 402) {
        toast.error(error.response.data?.message || (currentLang === 'ru' ? 'Недостаточно кредитов' : 'Insufficient credits'));
      } else {
        toast.error(tr('generationError'));
      }
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);

    files.forEach(file => {
      const id = Date.now() + Math.random();
      const isVideo = file.type.startsWith("video/");

      // Use a blob URL for the preview — it costs zero memory (it's a
      // pointer to the underlying file in the browser, NOT a base64-encoded
      // copy of it). A previous version of this code used FileReader +
      // readAsDataURL which OOM-crashed the tab for ~100MB+ videos because
      // the whole file got base64-encoded into a JS string. We revoke the
      // URL when the attachment is removed.
      const previewUrl = URL.createObjectURL(file);

      setAttachments(prev => [...prev, {
        id,
        type: isVideo ? "video" : "image",
        preview: previewUrl,
        previewIsBlob: true,
        file,
        uploading: true,
        progress: 0,
        uploadedUrl: null,
        error: null,
      }]);

      // Kick off the upload right away — the user can keep typing the
      // prompt while the file streams to the server. Send button is
      // disabled until every attachment has `uploading=false` AND a
      // non-null `uploadedUrl`.
      (async () => {
        try {
          const formData = new FormData();
          formData.append("file", file);
          const uploadRes = await axios.post(`${API}/upload`, formData, {
            headers: { "Content-Type": "multipart/form-data" },
            // Long videos (>30s) can take a while on slow links — give
            // them a generous 10-minute window before timing out.
            timeout: 10 * 60 * 1000,
            onUploadProgress: (evt) => {
              if (!evt || !evt.total) return;
              const pct = Math.round((evt.loaded * 100) / evt.total);
              setAttachments(prev => prev.map(a =>
                a.id === id ? { ...a, progress: Math.min(99, pct) } : a
              ));
            },
          });
          const url = uploadRes?.data?.url;
          const rawThumb = uploadRes?.data?.thumbnail_url;
          const thumbnailUrl = rawThumb
            ? (String(rawThumb).startsWith('http') ? rawThumb : `${BACKEND_URL || ''}${rawThumb}`)
            : null;
          setAttachments(prev => prev.map(a =>
            a.id === id
              ? { ...a, uploading: false, progress: 100, uploadedUrl: url, thumbnailUrl }
              : a
          ));
        } catch (err) {
          console.error("Attachment upload failed:", err);
          setAttachments(prev => {
            const dead = prev.find(a => a.id === id);
            if (dead && dead.previewIsBlob) {
              try { URL.revokeObjectURL(dead.preview); } catch (_) { /* noop */ }
            }
            return prev.filter(a => a.id !== id);
          });
          toast.error(tr('uploadError') || "Не удалось загрузить файл. Попробуйте ещё раз.");
        }
      })();
    });

    e.target.value = "";
  };

  const removeAttachment = (id) => {
    setAttachments(prev => {
      const dead = prev.find(a => a.id === id);
      if (dead && dead.previewIsBlob) {
        try { URL.revokeObjectURL(dead.preview); } catch (_) { /* noop */ }
      }
      return prev.filter(a => a.id !== id);
    });
  };

  const handleUpdateUser = (updatedUser) => {
    setUser(updatedUser);
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("slind_user");
    setShowProfile(false);
  };

  const handleGetStarted = () => {
    navigate('/auth');
  };

  const handleAvatarClick = () => {
    if (user) {
      setShowProfile(true);
    } else {
      navigate('/auth');
    }
  };

  const handleClosePopup = () => {
    setIsPopupClosing(true);
    setTimeout(() => {
      setShowFormatsPopup(false);
      setIsPopupClosing(false);
    }, 300);
  };

  const handleSelectFormat = (format) => {
    setPreviewFormat(format);
    setShowFormatPopup(true);
  };

  const handleUseFormat = () => {
    setShowFormatPopup(false);
    if (!user) {
      navigate('/auth');
      return;
    }
    // Commit the previewed format as the applied style (shows chip in input).
    setSelectedFormat(previewFormat);
    // Switch the bottom panel to "My creations" so its indicator and content
    // stay in sync (previously we set an invalid value "Create" which left
    // the Styles tab visually highlighted while showing creations content).
    setActiveMainTab('Creations');
    toast.success(`Style "${previewFormat?.name}" selected`);
  };

  // Swipe handlers for popups
  const handlePopupTouchStart = (e) => {
    popupStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handlePopupTouchMove = (e) => {
    if (!isDragging) return;
    const diff = e.touches[0].clientY - popupStartY.current;
    if (diff > 0) setPopupDragY(diff);
  };

  const handlePopupTouchEnd = (closePopup) => {
    setIsDragging(false);
    if (popupDragY > 100) {
      closePopup();
    }
    setPopupDragY(0);
  };

  // Show profile page
  if (showProfile && user) {
    return (
      <ProfilePage 
        user={user} 
        onBack={() => setShowProfile(false)}
        onLogout={handleLogout}
        onUpdateUser={handleUpdateUser}
        currentLang={currentLang}
        onLanguageChange={handleLanguageChange}
        onUpgrade={() => { setShowProfile(false); navigate('/upgrade'); }}
        onOpenHelp={() => { setShowProfile(false); navigate('/help'); }}
      />
    );
  }

  const completedVideos = userVideos.filter(v => v.status === 'completed');

  // ============ LOGGED IN VIEW ============
  if (user) {
    return (
      <div className="main-page-fixed" data-testid="main-page-logged">
        {/* Background Grid */}
        <div className="perspective-grid">
          <svg viewBox="0 0 400 300" preserveAspectRatio="none" className="grid-svg">
            <line x1="0" y1="0" x2="0" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
            <line x1="80" y1="0" x2="80" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
            <line x1="160" y1="0" x2="160" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
            <line x1="240" y1="0" x2="240" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
            <line x1="320" y1="0" x2="320" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
            <line x1="400" y1="0" x2="400" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
            
            <path d="M0,0 Q200,0 400,0" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none"/>
            <path d="M0,75 Q200,65 400,75" stroke="rgba(255,255,255,0.07)" strokeWidth="1" fill="none"/>
            <path d="M0,150 Q200,130 400,150" stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none"/>
            <path d="M0,225 Q200,195 400,225" stroke="rgba(255,255,255,0.09)" strokeWidth="1" fill="none"/>
            <path d="M0,300 Q200,260 400,300" stroke="rgba(255,255,255,0.1)" strokeWidth="1" fill="none"/>
          </svg>
        </div>
        
        {/* Fixed Header */}
        <header className="main-fixed-header">
          <div className="header-left-logo">
            <LogoSvg className="header-logo-svg" />
          </div>
          
          <div className="header-right-actions">
            <button 
              className="header-upgrade-btn"
              onClick={() => navigate("/upgrade")}
              data-testid="upgrade-btn"
            >
              <UpgradeIcon className="upgrade-btn-icon" />
              Upgrade
            </button>
            
            <button 
              className="header-avatar-btn"
              onClick={handleAvatarClick}
              data-testid="header-avatar-btn"
            >
              {user.picture ? (
                <img src={user.picture} alt={user.name} />
              ) : (
                <PersonIconAvatar className="header-avatar-icon" />
              )}
            </button>
          </div>
        </header>

        {/* Content - always Create view */}
        <div className="create-content-v2">
            {/* Center section - heading and input */}
            <div className="create-center-section">
              {/* Heading */}
              <div className="create-heading-wrapper min-h-[72px] flex flex-col items-center justify-center mb-6">
                {isListening ? (
                  <div className="listening-eye-container flex flex-col items-center justify-center animate-eyes-appear">
                    {/* Two pill eyes morphing & expanding */}
                    <div className="listening-eyes flex items-center justify-center">
                      <div className="listening-eye listening-eye-left" />
                      <div className="listening-eye listening-eye-right" />
                    </div>
                    <h2 className="speak-now-title">Speak now</h2>
                  </div>
                ) : (
                  <div className="create-heading">
                    <h1 className="create-title">
                      {t('readyToCreate')}
                    </h1>
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="create-input-area">
                {(() => {
                  const anyUploading = attachments.some(a => a.uploading);
                  const sendDisabled = isGenerating || anyUploading || (!prompt.trim() && attachments.length === 0);
                  const sendActive = !sendDisabled && (prompt.trim() || attachments.length > 0);
                  return (
                <div className={`input-outer ${isUploading ? "uploading" : ""}`}>
                  {attachments.length > 0 && (
                    <div className="attachments-row">
                      {attachments.map((attachment) => (
                        <div key={attachment.id} className="attachment-item rounded-[16px] overflow-hidden" data-testid="attachment-item">
                          <AttachmentThumb attachment={attachment} />
                          <button 
                            className="attachment-remove"
                            onClick={() => removeAttachment(attachment.id)}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="input-inner relative">
                    {isListening && !prompt && (
                      <div className="listening-placeholder-overlay" onClick={() => textareaRef.current?.focus()}>
                        <span>Listening</span>
                        <span className="listening-wave-dots">
                          <span className="dot dot-1">.</span>
                          <span className="dot dot-2">.</span>
                          <span className="dot dot-3">.</span>
                        </span>
                      </div>
                    )}
                    <textarea
                      ref={textareaRef}
                      value={prompt}
                      onChange={(e) => { setPrompt(e.target.value); autoResizeTextarea(); }}
                      onInput={autoResizeTextarea}
                      placeholder={isListening ? "" : `nind ai, ${placeholderText}`}
                      className="prompt-textarea"
                      rows={1}
                      disabled={isGenerating}
                      data-testid="prompt-input"
                    />
                </div>

                <div className="input-bottom-row">
                  <button 
                    className="input-icon-btn"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="attach-button"
                  >
                    <PlusIconSolid className="w-5 h-5" />
                  </button>

                  <LevelPicker value={level} onChange={setLevel} />

                  {selectedFormat && (
                    <div className="style-chip" data-testid="selected-style-chip">
                      <UseStyleChipIcon className="style-chip-icon" />
                      <span className="style-chip-name" title={selectedFormat.name}>
                        {selectedFormat.name.length > 13
                          ? selectedFormat.name.slice(0, 13) + '…'
                          : selectedFormat.name}
                      </span>
                      <button
                        className="style-chip-close"
                        onClick={() => setSelectedFormat(null)}
                        aria-label="Remove style"
                        data-testid="selected-style-chip-close"
                      >
                        <X className="w-4 h-4" strokeWidth={2.4} />
                      </button>
                    </div>
                  )}

                  <div className="input-bottom-right">
                    <button 
                      className={`input-icon-btn ${isListening ? "mic-active" : ""}`} 
                      onClick={toggleListening} 
                      data-testid="mic-button"
                      title={isListening ? "Stop listening" : "Start speaking"}
                    >
                      <MicIcon className="w-5 h-5" />
                    </button>
                    
                    <button 
                      className={`send-button ${sendActive ? "active" : ""} ${anyUploading ? "waiting-upload" : ""}`}
                      onClick={handleSubmit}
                      disabled={sendDisabled}
                      data-testid="send-button"
                    >
                      <ArrowUp className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
              );
              })()}
            </div>
            </div>

            {/* Bottom Panel */}
            <div className="bottom-panel">
              {/* Header: My creations as text to the left */}
              <div className="bottom-panel-header text-left mb-5 px-1 flex items-center justify-start">
                <h2 className="bottom-panel-title text-xl font-bold text-white tracking-tight text-left m-0">
                  {t('myCreations')}
                </h2>
              </div>

              {/* Content */}
              <div className="bottom-panel-content">
                {/* My Creations */}
                <>
                    {(() => {
                      // Only show fully-completed videos in the grid.
                      // In-progress ones (pending/processing/generating)
                      // are rendered by `generatingVideos` as progress
                      // cards — otherwise the same edited video would
                      // appear twice (once empty, once as progress).
                      const completedUserVideos = userVideos.filter(
                        (v) => v.status === 'completed'
                      );
                      const hasAnyVisible =
                        generatingVideos.length > 0 ||
                        completedUserVideos.length > 0;

                      if (isLoadingVideos && !hasAnyVisible) {
                        return (
                          <div className="library-loading">
                            <div className="spinner"></div>
                          </div>
                        );
                      }
                      if (!hasAnyVisible) {
                        return (
                          <div className="creations-empty-pattern">
                            <div className="creations-pattern-grid">
                              {/* Two columns of squares only */}
                              <div className="pattern-column">
                                <div className="pattern-item ratio-1-1" />
                                <div className="pattern-item ratio-1-1" />
                                <div className="pattern-item ratio-1-1" />
                              </div>
                              <div className="pattern-column">
                                <div className="pattern-item ratio-1-1" />
                                <div className="pattern-item ratio-1-1" />
                                <div className="pattern-item ratio-1-1" />
                              </div>
                            </div>
                            <div className="creations-empty-fade" />
                            <div className="creations-empty-overlay">
                              <p className="creations-empty-text">{t('yourVideosWillBeHere')}</p>
                              <button 
                                className="creations-start-btn"
                                onClick={() => {
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                  setTimeout(() => textareaRef.current?.focus(), 500);
                                }}
                                data-testid="start-create-btn"
                              >
                                <PlusIcon className="start-btn-icon" />
                                {t('start')}
                              </button>
                            </div>
                          </div>
                        );
                      }
                      return (
                      <div className="creations-grid-real">
                        {generatingVideos.map((video) => (
                          <SmoothProgressCard key={video.id} video={video} onStop={handleStopGeneration} />
                        ))}
                        {completedUserVideos.map((video) => (
                          <div 
                            key={video.id} 
                            className="creation-card"
                            data-testid={`library-video-${video.id}`}
                          >
                            <div 
                              className="creation-card-content"
                              onClick={() => navigate(`/video/${video.id}`)}
                            >
                              {video.modified_from && (
                                <span
                                  className="modified-badge"
                                  data-testid={`modified-badge-${video.id}`}
                                >
                                  modified
                                </span>
                              )}
                              {video.poster_url ? (
                                <img 
                                  src={`${BACKEND_URL}${video.poster_url}`} 
                                  alt={video.title || 'Video'}
                                />
                              ) : video.video_url ? (
                                <video 
                                  src={`${BACKEND_URL}${video.video_url}`}
                                  muted
                                  playsInline
                                />
                              ) : (
                                <div className="creation-placeholder" />
                              )}
                            </div>
                            
                            {/* Time ago - bottom left */}
                            <div className="creation-time-ago">
                              {video.status === 'generating' || video.status === 'processing' 
                                ? '' 
                                : getTimeAgo(video.created_at, video.completed_at)}
                            </div>
                            
                            {/* Menu button - bottom right */}
                            <div className="creation-menu-wrapper">
                              <button 
                                className="creation-menu-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (openMenu?.id === video.id) {
                                    setOpenMenu(null);
                                  } else {
                                    const btn = e.currentTarget;
                                    const rect = btn.getBoundingClientRect();
                                    const menuHeight = 132;
                                    const menuWidth = 144;
                                    
                                    // Always anchor menu BELOW the button if there's room,
                                    // otherwise place it ABOVE — never both modes alternating mid-scroll.
                                    const spaceBelow = window.innerHeight - rect.bottom;
                                    const placeBelow = spaceBelow >= menuHeight + 12;
                                    const top = placeBelow
                                      ? rect.bottom + 8
                                      : Math.max(10, rect.top - menuHeight - 8);
                                    let left = rect.left + rect.width / 2;
                                    left = Math.min(
                                      Math.max(left, menuWidth / 2 + 10),
                                      window.innerWidth - menuWidth / 2 - 10
                                    );
                                    
                                    setOpenMenu({ id: video.id, top, left });
                                  }
                                }}
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      );
                    })()}
                  </>
              </div>
            </div>
          </div>

        {/* Global dropdown menu (outside grid overflow) */}
        {openMenu && (
          <div 
            className="creation-menu-dropdown"
            style={{
              top: `${openMenu.top}px`,
              left: `${openMenu.left}px`,
              transform: 'translateX(-50%)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={(e) => { 
              e.stopPropagation(); 
              const video = userVideos.find(v => v.id === openMenu.id);
              if (video) handleDownload(video); 
              setOpenMenu(null);
            }}>
              <Download className="w-4 h-4" />
              <span>Download</span>
            </button>
            <button onClick={(e) => { 
              e.stopPropagation(); 
              handleEdit(openMenu.id);
            }}>
              <Edit2 className="w-4 h-4" />
              <span>Edit</span>
            </button>
            <button onClick={(e) => { 
              e.stopPropagation(); 
              handleDelete(openMenu.id); 
              setOpenMenu(null);
            }}>
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          </div>
        )}

        {/* Style Detail Popup — new tall sheet with swipe-navigation between styles */}
        {showFormatPopup && previewFormat && (
          <StyleDetailPopup
            format={previewFormat}
            formats={FORMATS}
            onClose={() => setShowFormatPopup(false)}
            onUse={(committedFormat) => {
              // The popup may have swiped to a different format than we opened
              // with — commit whichever the user pressed Use Style on.
              setShowFormatPopup(false);
              if (!user) {
                navigate('/auth');
                return;
              }
              setSelectedFormat(committedFormat || previewFormat);
              setActiveMainTab('Creations');
              toast.success(`Style "${(committedFormat || previewFormat)?.name}" selected`);
            }}
          />
        )}

        {/* Formats List Popup (search) */}
        {showFormatsListPopup && (
          <div 
            className="format-popup-overlay"
            onClick={() => setShowFormatsListPopup(false)}
          >
            <div 
              className="formats-list-popup"
              style={{ transform: `translateY(${popupDragY}px)` }}
              onClick={(e) => e.stopPropagation()}
              onTouchStart={handlePopupTouchStart}
              onTouchMove={handlePopupTouchMove}
              onTouchEnd={() => handlePopupTouchEnd(() => setShowFormatsListPopup(false))}
            >
              <div className="popup-drag-handle" />
              
              <h2 className="formats-list-title">Styles</h2>
              
              <div className="formats-list-grid">
                {FORMATS.map((format) => (
                  <button 
                    key={format.id}
                    className="formats-list-item"
                    onClick={() => {
                      handleSelectFormat(format);
                      setShowFormatsListPopup(false);
                    }}
                    data-testid={`formats-list-${format.id}`}
                  >
                    <div 
                      className="formats-list-thumb"
                      style={{ backgroundColor: format.color }}
                    />
                    <span className="formats-list-name">{format.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ NOT LOGGED IN VIEW (ORIGINAL) ============
  return (
    <div className="main-page" data-testid="main-page">
      {/* Background */}
      <div className="liquid-gradient-bg" />
      
      {/* Perspective Grid */}
      <div className="perspective-grid perspective-grid-mobile">
        <svg viewBox="0 0 400 300" preserveAspectRatio="none" className="grid-svg">
          <line x1="0" y1="0" x2="0" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="80" y1="0" x2="80" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="160" y1="0" x2="160" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="240" y1="0" x2="240" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="320" y1="0" x2="320" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="400" y1="0" x2="400" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          
          <path d="M0,0 Q200,0 400,0" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none"/>
          <path d="M0,75 Q200,65 400,75" stroke="rgba(255,255,255,0.07)" strokeWidth="1" fill="none"/>
          <path d="M0,150 Q200,130 400,150" stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none"/>
          <path d="M0,225 Q200,195 400,225" stroke="rgba(255,255,255,0.09)" strokeWidth="1" fill="none"/>
          <path d="M0,300 Q200,260 400,300" stroke="rgba(255,255,255,0.1)" strokeWidth="1" fill="none"/>
        </svg>
      </div>
      
      <div className="perspective-grid perspective-grid-desktop">
        <svg viewBox="0 0 400 300" preserveAspectRatio="none" className="grid-svg">
          <line x1="0" y1="0" x2="0" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="50" y1="0" x2="50" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="100" y1="0" x2="100" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="150" y1="0" x2="150" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="200" y1="0" x2="200" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="250" y1="0" x2="250" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="300" y1="0" x2="300" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="350" y1="0" x2="350" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <line x1="400" y1="0" x2="400" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          
          <path d="M0,0 Q200,0 400,0" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none"/>
          <path d="M0,50 Q200,45 400,50" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none"/>
          <path d="M0,100 Q200,90 400,100" stroke="rgba(255,255,255,0.07)" strokeWidth="1" fill="none"/>
          <path d="M0,150 Q200,135 400,150" stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none"/>
          <path d="M0,200 Q200,180 400,200" stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none"/>
          <path d="M0,250 Q200,225 400,250" stroke="rgba(255,255,255,0.09)" strokeWidth="1" fill="none"/>
          <path d="M0,300 Q200,270 400,300" stroke="rgba(255,255,255,0.1)" strokeWidth="1" fill="none"/>
        </svg>
      </div>
      
      {/* Fixed Header with blur */}
      <header className={`fixed-header ${headerScrolled ? 'scrolled' : ''}`}>
        <div className="header-blur" />
        <div className="header-content">
          <div className={`logo-container ${headerScrolled ? 'hidden' : ''}`}>
            <LogoSvg className="logo-svg" />
          </div>
          
          <span className={`header-overview-text ${headerScrolled ? 'visible' : ''}`}>Overview</span>
          
          <button 
            className={`get-started-btn ${headerScrolled ? 'hidden' : ''}`}
            onClick={handleGetStarted}
            data-testid="get-started-btn"
          >
            {t('getStarted')}
          </button>
        </div>
      </header>

      {/* Main content - scrollable */}
      <div className="main-content">
        {/* Center section - same layout as logged in */}
        <div className="create-center-section-landing">
          {/* Heading */}
          <div className="create-heading">
            <h1 className="create-title">Create & Edit</h1>
            <p className="create-subtitle">{t('makeVideoEditing')}</p>
          </div>

          {/* Input area */}
          <div className="create-input-area">
          <div className={`input-outer ${isUploading ? "uploading" : ""}`}>
            {attachments.length > 0 && (
              <div className="attachments-row">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="attachment-item rounded-[16px] overflow-hidden">
                    <AttachmentThumb attachment={attachment} />
                    <button 
                      className="attachment-remove"
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="input-inner">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); autoResizeTextarea(); }}
                onInput={autoResizeTextarea}
                placeholder={`nind ai, ${placeholderText}`}
                className="prompt-textarea"
                rows={1}
                disabled={isGenerating}
                data-testid="prompt-input"
              />
            </div>

            <div className="input-bottom-row">
              <button 
                className="input-icon-btn"
                onClick={toggleUnlockPopup}
                data-testid="attach-button"
                data-unlock-trigger="1"
              >
                <Plus className="w-5 h-5" />
              </button>

              <div className="input-bottom-right">
                <button 
                  className="input-icon-btn" 
                  onClick={toggleUnlockPopup}
                  data-testid="mic-button"
                  data-unlock-trigger="1"
                >
                  <MicIcon className="w-5 h-5" />
                </button>
                
                <button 
                  className={`send-button ${prompt.trim() || attachments.length > 0 ? "active" : ""}`}
                  onClick={() => navigate('/auth')}
                  data-testid="send-button"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            
            {isUploading && <div className="uploading-border" />}
          </div>

          {/* Unlock more features popup — appears next to + / mic on landing */}
          {unlockPopup.open && (
            <UnlockPopup
              anchor={unlockPopup.anchor}
              onClose={closeUnlockPopup}
              onAction={() => { closeUnlockPopup(); navigate('/auth'); }}
              t={t}
            />
          )}
        </div>
        </div>

        {/* Black section wrapper - everything below is black */}
        <div className="black-section-start">
        {/* You can do section - carousel (no title) */}
        <div className="examples-section-new">
          <div 
            className="examples-carousel-wrapper"
            ref={examplesCarouselRef}
          >
            <div className="examples-carousel-inner">
              {EXAMPLE_VIDEOS.map((video) => (
                <div 
                  key={video.id} 
                  className="example-card"
                >
                  <div className="example-card-content">
                    <div 
                      className="example-card-video"
                      style={{ backgroundColor: video.color }}
                    >
                      {video.video && (
                        <video
                          src={video.video}
                          poster={video.poster}
                          autoPlay
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          aria-hidden="true"
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      )}
                    </div>
                    <div className="example-card-overlay">
                      <h3 className="example-card-title">{video.title}</h3>
                      <p className="example-card-subtitle">{video.subtitle}</p>
                    </div>
                  </div>
                </div>
              ))}
              <div className="examples-and-more-text">
                And many more!
              </div>
            </div>
          </div>
          
          <div className="examples-nav-buttons-left">
            <button 
              className={`examples-nav-btn ${exampleIndex === 0 ? 'disabled' : ''}`}
              onClick={() => {
                if (exampleIndex > 0) {
                  const newIndex = exampleIndex - 1;
                  setExampleIndex(newIndex);
                  if (examplesCarouselRef.current) {
                    const card = examplesCarouselRef.current.querySelectorAll('.example-card')[newIndex];
                    if (card) {
                      const containerWidth = examplesCarouselRef.current.offsetWidth;
                      const cardLeft = card.offsetLeft;
                      const cardWidth = card.offsetWidth;
                      const scrollPos = cardLeft - (containerWidth - cardWidth) / 2;
                      examplesCarouselRef.current.scrollTo({ 
                        left: scrollPos, 
                        behavior: 'smooth' 
                      });
                    }
                  }
                }
              }}
              disabled={exampleIndex === 0}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button 
              className={`examples-nav-btn ${exampleIndex === EXAMPLE_VIDEOS.length - 1 ? 'disabled' : ''}`}
              onClick={() => {
                if (exampleIndex < EXAMPLE_VIDEOS.length - 1) {
                  const newIndex = exampleIndex + 1;
                  setExampleIndex(newIndex);
                  if (examplesCarouselRef.current) {
                    const card = examplesCarouselRef.current.querySelectorAll('.example-card')[newIndex];
                    if (card) {
                      const containerWidth = examplesCarouselRef.current.offsetWidth;
                      const cardLeft = card.offsetLeft;
                      const cardWidth = card.offsetWidth;
                      const scrollPos = cardLeft - (containerWidth - cardWidth) / 2;
                      examplesCarouselRef.current.scrollTo({ 
                        left: scrollPos, 
                        behavior: 'smooth' 
                      });
                    }
                  }
                }
              }}
              disabled={exampleIndex === EXAMPLE_VIDEOS.length - 1}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* How it works section */}
        <div className="how-section">
          <h2 className="section-title">Explore nind ai</h2>
          <div className="how-video-wrapper">
            <div className="how-video-placeholder" />
          </div>
        </div>


        {/* Discover tools section */}
        <div className="discover-tools-section">
          <h2 className="section-title">Discover tools</h2>
          
          <div className="discover-tools-grid">
            {/* AI Speech */}
            <div className="discover-tool-card">
              <div className="discover-tool-header">
                <div className="discover-tool-icon">
                  <svg viewBox="0 0 875 875" fill="currentColor">
                    <path d="M 342.54 740.95 C332.97,739.46 322.83,734.03 315.04,726.24 C311.32,722.53 307.06,717.07 305.56,714.12 C299.73,702.61 300.03,717.98 300.03,438.50 C300.03,187.70 300.08,181.31 301.97,173.82 C306.25,156.81 318.08,143.36 333.57,137.87 C340.97,135.26 353.66,134.37 361.22,135.94 C380.10,139.86 397.36,157.63 400.98,176.89 C402.39,184.36 402.39,693.68 400.98,701.11 C398.73,712.96 390.11,725.68 379.26,733.16 C369.45,739.92 355.26,742.93 342.54,740.95 ZM 519.16 635.84 C498.66,633.46 482.01,619.55 475.72,599.54 L 473.50 592.50 L 473.50 435.50 L 473.50 278.50 L 476.22 271.06 C484.26,249.02 502.82,235.59 525.00,235.76 C547.53,235.94 566.21,249.70 574.18,272.00 L 576.50 278.50 L 576.77 432.74 C577.06,602.84 577.33,594.73 570.83,608.00 C567.24,615.32 559.01,624.51 552.11,628.91 C542.84,634.82 531.28,637.25 519.16,635.84 ZM 161.62 549.89 C145.88,546.19 131.99,533.01 125.81,515.89 L 123.50 509.50 L 123.50 427.50 C123.50,352.10 123.64,344.98 125.27,339.08 C130.52,320.10 146.83,305.08 165.74,301.84 C185.57,298.44 206.57,309.23 216.36,327.87 C223.10,340.69 222.97,338.70 222.99,427.54 C223.00,514.48 223.09,513.00 217.39,524.77 C214.20,531.36 203.73,542.09 197.34,545.33 C186.80,550.66 172.63,552.47 161.62,549.89 ZM 678.10 549.42 C675.14,548.62 670.41,546.74 667.60,545.24 C660.99,541.71 651.23,531.99 647.22,524.93 C640.99,513.96 641.03,514.58 641.01,427.39 C641.01,377.99 641.38,346.25 642.02,342.89 C643.78,333.50 649.14,323.79 656.69,316.28 C664.42,308.59 670.62,304.92 680.00,302.47 C687.61,300.49 698.37,300.88 707.17,303.44 C718.67,306.80 730.48,316.98 736.30,328.57 C742.08,340.06 742.00,338.71 742.00,425.76 C742.00,475.66 741.62,507.75 740.98,511.11 C737.59,529.11 722.96,544.91 705.47,549.47 C698.17,551.37 685.27,551.34 678.10,549.42 Z"/>
                  </svg>
                </div>
                <span className="discover-tool-title">AI Speech</span>
              </div>
              <span className="discover-tool-subtitle">Generating AI-voiceover</span>
            </div>
            
            {/* AI Soundtrack */}
            <div className="discover-tool-card">
              <div className="discover-tool-header">
                <div className="discover-tool-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                </div>
                <span className="discover-tool-title">AI Soundtrack</span>
              </div>
              <span className="discover-tool-subtitle">Generating sound effects and music</span>
            </div>
            
            {/* AI Translation */}
            <div className="discover-tool-card">
              <div className="discover-tool-header">
                <div className="discover-tool-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                  </svg>
                </div>
                <span className="discover-tool-title">AI Translation</span>
              </div>
              <span className="discover-tool-subtitle">Video translation with AI-voiceover or subtitles</span>
            </div>
            
            {/* AI Cut */}
            <div className="discover-tool-card">
              <div className="discover-tool-header">
                <div className="discover-tool-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
                  </svg>
                </div>
                <span className="discover-tool-title">AI Cut</span>
              </div>
              <span className="discover-tool-subtitle">Cutting video with AI</span>
            </div>
            
            {/* AI Script */}
            <div className="discover-tool-card">
              <div className="discover-tool-header">
                <div className="discover-tool-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                  </svg>
                </div>
                <span className="discover-tool-title">AI Script</span>
              </div>
              <span className="discover-tool-subtitle">Generating script for video</span>
            </div>
            
            {/* AI Color grading */}
            <div className="discover-tool-card">
              <div className="discover-tool-header">
                <div className="discover-tool-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
                  </svg>
                </div>
                <span className="discover-tool-title">AI Color grading</span>
              </div>
              <span className="discover-tool-subtitle">Color grading for a professional look</span>
            </div>
          </div>
        </div>
        
        {/* CTA Section */}
        <div className="cta-section">
          <h2 className="cta-title">
            Create <span className="cta-selection-box">
              <span className="sel-line sel-line-top"></span>
              <span className="sel-line sel-line-bottom"></span>
              <span className="sel-line sel-line-left"></span>
              <span className="sel-line sel-line-right"></span>
              <span className="sel-corner sel-corner-tl"></span>
              <span className="sel-corner sel-corner-tr"></span>
              <span className="sel-corner sel-corner-bl"></span>
              <span className="sel-corner sel-corner-br"></span>
              fully edited
            </span> videos
          </h2>
          <p className="cta-subtitle">Turn any prompt into a polished edited video — AI does the rest.</p>
          <button className="cta-get-started-btn" onClick={() => navigate('/auth')} data-testid="cta-get-started-btn">Get started</button>
        </div>
        
        {/* Footer */}
        <footer className="footer-section">
          <div className="footer-card">
            
            <div className="footer-logo">
              <LogoSvg className="footer-logo-svg" />
            </div>
            
            <div className="footer-columns">
              <div className="footer-column">
                <h4 className="footer-column-title">Company</h4>
                <a href="#" className="footer-link">Security</a>
                <a href="#" className="footer-link">Trust Center</a>
                <a href="#" className="footer-link">Press & Media</a>
                <a href="#" className="footer-link">Partnerships</a>
              </div>
              
              <div className="footer-column">
                <h4 className="footer-column-title">Product</h4>
                <a href="#" className="footer-link">Pricing</a>
                <a href="#" className="footer-link">Status</a>
                <a href="#" className="footer-link">Styles</a>
              </div>
              
              <div className="footer-column">
                <h4 className="footer-column-title">Resources</h4>
                <a href="#" className="footer-link">Support</a>
                <a href="#" className="footer-link">Guides & Tutorials</a>
                <a href="#" className="footer-link">Blog</a>
                <a href="#" className="footer-link">FAQs</a>
              </div>
              
              <div className="footer-column">
                <h4 className="footer-column-title">Legal</h4>
                <a href="#" className="footer-link">Privacy policy</a>
                <a href="#" className="footer-link">Do not sell or share my personal information</a>
                <a href="#" className="footer-link">Cookie settings</a>
                <a href="#" className="footer-link">Enterprise terms</a>
                <a href="#" className="footer-link">General terms</a>
                <a href="#" className="footer-link">Platform rules</a>
                <a href="#" className="footer-link">Report abuse</a>
                <a href="#" className="footer-link">Report security concerns</a>
                <a href="#" className="footer-link">DPA</a>
              </div>
              
              <div className="footer-column">
                <h4 className="footer-column-title">Community</h4>
                <a href="#" className="footer-link">Discord</a>
                <a href="#" className="footer-link">TikTok</a>
                <a href="#" className="footer-link">Reddit</a>
                <a href="#" className="footer-link">X (Twitter)</a>
                <a href="#" className="footer-link">YouTube</a>
                <a href="#" className="footer-link">LinkedIn</a>
              </div>
            </div>
          </div>
        </footer>
        </div>
      </div>

      {/* Formats Popup */}
      {showFormatsPopup && (
        <div className={`formats-popup-overlay ${isPopupClosing ? "closing" : ""}`} onClick={handleClosePopup}>
          <div className={`formats-popup ${isPopupClosing ? "closing" : ""}`} onClick={(e) => e.stopPropagation()}>
            <div className="popup-handle" />
            
            {/* Search */}
            <div className="popup-search">
              <Search className="search-icon" />
              <input 
                type="text"
                placeholder="Найти формат контента"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
            
            {/* Tabs */}
            <div className="popup-tabs">
              {FORMAT_TABS.map((tab) => (
                <button
                  key={tab}
                  className={`popup-tab ${activeTab === tab ? "active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            
            {/* Grid */}
            <div className="popup-grid">
              {FORMATS.map((format) => (
                <div key={format.id} className="popup-format-card">
                  <div 
                    className="popup-format-preview"
                    style={{ backgroundColor: format.color }}
                  />
                  <span className="popup-format-name">{format.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Voice Assistant Overlay */}
      {showVoiceAssistant && (
        <div className="voice-assistant-overlay">
          <div className="voice-assistant-content">
            {/* AI Eyes */}
            <div className={`voice-eyes ${isAISpeaking ? 'speaking' : ''} ${isRecording ? 'listening' : ''}`}>
              <div className="voice-eye left"></div>
              <div className="voice-eye right"></div>
            </div>
            
            {/* Status Text */}
            <div className="voice-status">
              {isRecording && !voiceTranscript && <p>Слушаю...</p>}
              {isProcessing && <p>Обрабатываю запрос...</p>}
              {isAISpeaking && <p>Создаю видео по вашему запросу...</p>}
            </div>
            
            {/* Transcript */}
            {voiceTranscript && (
              <div className="voice-transcript">
                <p>"{voiceTranscript}"</p>
              </div>
            )}
          </div>
          
          {/* Bottom controls */}
          <div className="voice-controls">
            {/* Show attachments if any */}
            {attachments.length > 0 && (
              <div className="voice-attachments">
                {attachments.map((file, index) => (
                  <div key={index} className="voice-attachment-item">
                    {file.type?.startsWith('video/') ? (
                      <video src={file.preview} muted />
                    ) : (
                      <img src={file.preview} alt="" />
                    )}
                    <button 
                      className="voice-attachment-remove"
                      onClick={() => setAttachments(prev => prev.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="voice-buttons">
              <button 
                className="voice-control-btn voice-upload-btn"
                onClick={() => {
                  fileInputRef.current?.click();
                }}
              >
                <Plus className="w-6 h-6" />
              </button>
              
              <button 
                className={`voice-record-btn ${isRecording ? 'recording' : ''}`}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={() => {
                  if (isRecording) stopRecording();
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  startRecording();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  stopRecording();
                }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                </svg>
              </button>
              
              <button 
                className="voice-control-btn voice-close-btn"
                onClick={() => {
                  setShowVoiceAssistant(false);
                  setIsRecording(false);
                  setIsAISpeaking(false);
                  setVoiceTranscript('');
                  setIsProcessing(false);
                  if (recognitionRef.current) {
                    recognitionRef.current.stop();
                  }
                }}
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MainPage;
