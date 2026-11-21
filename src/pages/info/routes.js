import * as L from "./legalContent";
import * as I from "./infoContent";

// path -> page content. Every footer link points to one of these (or /upgrade).
export const INFO_PAGES = {
  "/terms": L.terms,
  "/privacy": L.privacy,
  "/cookies": L.cookies,
  "/refunds": L.refunds,
  "/rules": L.rules,
  "/privacy-choices": L.privacyChoices,
  "/enterprise-terms": L.enterpriseTerms,
  "/dpa": L.dpa,
  "/report-abuse": I.reportAbuse,
  "/security-report": I.securityReport,
  "/about": I.about,
  "/contact": I.contact,
  "/security": I.security,
  "/trust": I.trust,
  "/press": I.press,
  "/partnerships": I.partnerships,
  "/status": I.status,
  "/styles": I.styles,
  "/support": I.support,
  "/guides": I.guides,
  "/blog": I.blog,
  "/faq": I.faq,
  "/community": I.community,
};
