import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const BRAND_LOGO = "/assets/nind-logo-white-sm.png";
export const SUPPORT_EMAIL = "support@nind.pro";

// Inline markup: [text](href), **bold**, and bare support e-mail addresses.
export function Inline({ text }) {
  const parts = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|([A-Za-z0-9._%+-]+@nind\.pro)/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      const href = m[2];
      if (href.startsWith("/")) parts.push(<Link key={k++} to={href} className="info-link">{m[1]}</Link>);
      else parts.push(<a key={k++} href={href} className="info-link" target={href.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer">{m[1]}</a>);
    } else if (m[3]) {
      parts.push(<strong key={k++}>{m[3]}</strong>);
    } else if (m[4]) {
      parts.push(<a key={k++} href={`mailto:${m[4]}`} className="info-link">{m[4]}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Block({ item }) {
  if (typeof item === "string") return <p className="info-p"><Inline text={item} /></p>;
  if (item.ul) return <ul className="info-ul">{item.ul.map((li, i) => <li key={i}><Inline text={li} /></li>)}</ul>;
  if (item.ol) return <ol className="info-ol">{item.ol.map((li, i) => <li key={i}><Inline text={li} /></li>)}</ol>;
  if (item.h3) return <h3 className="info-h3">{item.h3}</h3>;
  if (item.note) return <div className="info-note"><Inline text={item.note} /></div>;
  if (item.table) {
    return (
      <div className="info-table-wrap">
        <table className="info-table">
          <thead><tr>{item.table.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{item.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}><Inline text={c} /></td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  return null;
}

function StatusWidget() {
  const [state, setState] = useState({ loading: true, ok: false, ms: 0, at: null });
  const check = async () => {
    setState((s) => ({ ...s, loading: true }));
    const t0 = performance.now();
    try {
      const r = await fetch("/api", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setState({ loading: false, ok: r.ok && j.status === "ok", ms: Math.round(performance.now() - t0), at: new Date() });
    } catch (_) {
      setState({ loading: false, ok: false, ms: 0, at: new Date() });
    }
  };
  useEffect(() => { check(); }, []);
  const rows = [
    ["Website", true],
    ["API & accounts", state.ok],
    ["Video creation & editing", state.ok],
  ];
  return (
    <div className="info-status">
      <div className={`info-status-banner ${state.loading ? "" : state.ok ? "ok" : "down"}`}>
        <span className="info-status-dot" />
        {state.loading ? "Checking systems…" : state.ok ? "All systems operational" : "We're having trouble reaching the service"}
      </div>
      {rows.map(([name, ok]) => (
        <div className="info-status-row" key={name}>
          <span>{name}</span>
          <span className={state.loading ? "" : ok ? "ok" : "down"}>{state.loading ? "…" : ok ? "Operational" : "Unavailable"}</span>
        </div>
      ))}
      <div className="info-status-meta">
        {state.at && <>Last checked {state.at.toLocaleTimeString()}{state.ok ? ` · response ${state.ms} ms` : ""} · </>}
        <button type="button" className="info-link info-btn-link" onClick={check}>Check again</button>
      </div>
    </div>
  );
}

function CookieSettingsWidget() {
  const cats = [
    ["Strictly necessary", "Keeps you signed in, remembers your language and saves your support conversations on this device. Required for the service to work.", "Always on"],
    ["Analytics", "nind ai does not use analytics or measurement cookies.", "Not used"],
    ["Advertising", "nind ai does not use advertising, retargeting or cross-site tracking cookies.", "Not used"],
  ];
  return (
    <div className="info-cookies">
      {cats.map(([t, d, s]) => (
        <div className="info-cookie-row" key={t}>
          <div>
            <div className="info-cookie-title">{t}</div>
            <div className="info-cookie-desc">{d}</div>
          </div>
          <span className={`info-pill ${s === "Always on" ? "on" : ""}`}>{s}</span>
        </div>
      ))}
    </div>
  );
}

export default function InfoLayout({ page }) {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = `${page.title} · nind ai`;
    window.scrollTo(0, 0);
    return () => { document.title = "nind ai"; };
  }, [page.title]);

  return (
    <div className="info-page">
      <header className="info-header">
        <Link to="/" className="info-logo" aria-label="nind ai home">
          <img src={BRAND_LOGO} alt="nind ai" draggable={false} />
        </Link>
        <button type="button" className="info-back" onClick={() => navigate("/")}>← Back to home</button>
      </header>

      <main className="info-main">
        {page.eyebrow && <div className="info-eyebrow">{page.eyebrow}</div>}
        <h1 className="info-h1">{page.title}</h1>
        {page.updated && <div className="info-updated">Effective date: {page.updated}</div>}
        {page.intro && page.intro.map((p, i) => <Block key={i} item={p} />)}

        {page.widget === "status" && <StatusWidget />}
        {page.widget === "cookies" && <CookieSettingsWidget />}

        {page.sections?.length > 3 && page.toc !== false && (
          <nav className="info-toc">
            <div className="info-toc-title">Contents</div>
            <ol>
              {page.sections.map((s, i) => <li key={i}><a href={`#s${i + 1}`}>{s.h}</a></li>)}
            </ol>
          </nav>
        )}

        {page.sections?.map((s, i) => (
          <section key={i} id={`s${i + 1}`} className="info-section">
            <h2 className="info-h2">{s.h}</h2>
            {s.body.map((b, j) => <Block key={j} item={b} />)}
          </section>
        ))}

        {page.related && (
          <div className="info-related">
            {page.related.map(([label, href]) => <Link key={href} to={href} className="info-chip">{label}</Link>)}
          </div>
        )}
      </main>

      <footer className="info-footer">
        <div className="info-footer-links">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/cookies">Cookies</Link>
          <Link to="/refunds">Refunds</Link>
          <Link to="/rules">Platform rules</Link>
          <Link to="/contact">Contact</Link>
        </div>
        <div className="info-copy">© 2026 nind ai · Oslo, Norway · <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></div>
      </footer>
    </div>
  );
}
