// Swipe-down-to-dismiss for every bottom sheet in the app (touch + mouse).
// The sheet follows the finger 1:1; on release it closes when pulled far enough or flicked down,
// otherwise it springs back. Closing reuses each popup's own "tap outside" handler (overlay click),
// so every popup keeps its own close logic.

const SHEET_SEL = "[data-sheet], .confirm-popup, .language-popup, .appearance-popup, .formats-list-popup, .formats-popup, .invite-popup, .style-popup";
// popups that already drive their own touch gestures (horizontal paging etc.) only get mouse dragging here
const OWN_TOUCH_SEL = ".style-popup";
const TEXT_SEL = "input, textarea, select, [contenteditable='true']";
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const START_SLOP = 6;

let st = null;
let suppressClickUntil = 0;

const scrollableBetween = (el, sheet) => {
  for (let n = el; n && n !== sheet.parentElement; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === "auto" || oy === "scroll") return n;
    }
    if (n === sheet) break;
  }
  return null;
};

const overlayOf = (sheet) => {
  let n = sheet.parentElement;
  while (n && n !== document.body) {
    const pos = getComputedStyle(n).position;
    if (pos === "fixed") return n;
    n = n.parentElement;
  }
  return sheet.parentElement;
};

function begin(target, x, y, isTouch) {
  const sheet = target.closest?.(SHEET_SEL);
  if (!sheet || sheet.dataset.sheetDismissed) return;
  if (isTouch && sheet.matches(OWN_TOUCH_SEL)) return;
  if (!isTouch && target.closest(TEXT_SEL)) return; // keep mouse text selection in fields
  st = { sheet, x0: x, y0: y, dragging: false, offset: 0, samples: [{ t: performance.now(), y }], scroller: scrollableBetween(target, sheet), isTouch };
}

function move(x, y, ev) {
  if (!st) return;
  const dx = x - st.x0;
  const dy = y - st.y0;
  if (!st.dragging) {
    const canPull = dy > 0 && Math.abs(dy) >= Math.abs(dx) && !(st.scroller && st.scroller.scrollTop > 0);
    if (canPull && ev.cancelable) ev.preventDefault(); // keep the browser from starting a scroll / pull-to-refresh
    if (Math.abs(dy) < START_SLOP && Math.abs(dx) < START_SLOP) return;
    // horizontal gesture, upward pull, or inner content scrolled down: let the page / list scroll
    if (Math.abs(dx) > Math.abs(dy) || dy < 0 || (st.scroller && st.scroller.scrollTop > 0)) { st = null; return; }
    st.dragging = true;
    st.y0 = y; // start from 0 so the sheet does not jump by the slop
    const s = st.sheet.style;
    s.setProperty("animation", "none", "important");
    s.transition = "none";
    s.willChange = "transform";
  }
  if (ev.cancelable) ev.preventDefault();
  const raw = y - st.y0;
  const off = raw >= 0 ? raw : raw * 0.18; // a little rubber band upwards
  st.offset = off;
  st.sheet.style.transform = `translate3d(0, ${off}px, 0)`;
  const now = performance.now();
  st.samples.push({ t: now, y });
  while (st.samples.length > 2 && now - st.samples[0].t > 90) st.samples.shift();
}

function end() {
  if (!st) return;
  const { sheet, dragging, offset, samples } = st;
  st = null;
  if (!dragging) return;
  suppressClickUntil = performance.now() + 350;
  const a = samples[0];
  const b = samples[samples.length - 1];
  const v = b && a && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px per ms, + = down
  const h = sheet.getBoundingClientRect().height || 400;
  const dismiss = offset > Math.min(160, h * 0.3) || (v > 0.45 && offset > 12);
  if (dismiss) {
    sheet.dataset.sheetDismissed = "1";
    const remaining = Math.max(0, h - offset);
    const dur = Math.round(Math.max(160, Math.min(380, v > 0.1 ? remaining / (v * 1.2) : 340)));
    sheet.style.transition = `transform ${dur}ms ${EASE}`;
    sheet.style.transform = "translate3d(0, 100%, 0)";
    setTimeout(() => {
      const ov = overlayOf(sheet);
      if (ov && ov !== sheet) ov.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }, dur);
  } else {
    sheet.style.transition = `transform 0.45s ${EASE}`;
    sheet.style.transform = "translate3d(0, 0, 0)";
  }
}

export function installSheetGestures() {
  if (typeof window === "undefined" || window.__nindSheetGestures) return;
  window.__nindSheetGestures = true;
  document.addEventListener("touchstart", (e) => { if (e.touches.length === 1) begin(e.target, e.touches[0].clientX, e.touches[0].clientY, true); else st = null; }, { passive: true, capture: true });
  document.addEventListener("touchmove", (e) => { if (st && e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY, e); }, { passive: false, capture: true });
  document.addEventListener("touchend", end, { capture: true });
  document.addEventListener("touchcancel", end, { capture: true });
  document.addEventListener("mousedown", (e) => { if (e.button === 0) begin(e.target, e.clientX, e.clientY, false); }, { capture: true });
  window.addEventListener("mousemove", (e) => { if (st && !st.isTouch) move(e.clientX, e.clientY, e); }, { capture: true });
  window.addEventListener("mouseup", () => { if (st && !st.isTouch) end(); }, { capture: true });
  // a drag must not also "tap" the button the finger started on (or the overlay under the mouse)
  document.addEventListener("click", (e) => {
    if (performance.now() < suppressClickUntil && e.isTrusted) { e.stopPropagation(); e.preventDefault(); suppressClickUntil = 0; }
  }, { capture: true });
}
