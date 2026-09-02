/* Blossom Garden Design & Project Management
   Navigation, consent, analytics events, forms, scroll reveal. */

(function () {
  "use strict";

  /* ------------------------------------------------------------------
     Configuration:
     - GA_MEASUREMENT_ID: GA4 measurement ID (set to "" to disable analytics).
     - Form endpoints are set per-form via the action attribute (FormSubmit).
  ------------------------------------------------------------------ */
  var GA_MEASUREMENT_ID = "G-MS76VT312E"; /* GA4 property "Blossom Garden", web stream blossomgarden.design */

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Mobile navigation ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.querySelector(".mobile-menu");
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reducedMotion && revealEls.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Overlay nav (homepage): transparent over hero, solid on scroll ---------- */
  var header = document.querySelector(".site-header");
  if (header && document.body.dataset.nav === "overlay") {
    var navScroll = function () { header.classList.toggle("scrolled", window.scrollY > 40); };
    window.addEventListener("scroll", navScroll, { passive: true });
    navScroll();
  }

  /* ---------- Cookie consent (UK PECR: no analytics before consent) ---------- */
  var CONSENT_KEY = "blossom-consent";
  var banner = document.querySelector(".cookie-banner");

  function loadAnalytics() {
    if (!GA_MEASUREMENT_ID) return;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_MEASUREMENT_ID, { anonymize_ip: true });
  }

  function consentState() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) { /* private mode */ }
    if (banner) banner.classList.remove("visible");
    if (value === "granted") loadAnalytics();
  }

  if (consentState() === "granted") {
    loadAnalytics();
  } else if (consentState() === null && banner) {
    banner.classList.add("visible");
  }

  var acceptBtn = document.querySelector("[data-consent-accept]");
  var declineBtn = document.querySelector("[data-consent-decline]");
  if (acceptBtn) acceptBtn.addEventListener("click", function () { setConsent("granted"); });
  if (declineBtn) declineBtn.addEventListener("click", function () { setConsent("denied"); });
  document.querySelectorAll("[data-consent-change]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      try { localStorage.removeItem(CONSENT_KEY); } catch (err) { /* ignore */ }
      if (banner) { banner.classList.add("visible"); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }
    });
  });

  /* ---------- Event tracking (only fires when analytics is loaded) ---------- */
  function track(eventName, params) {
    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, params || {});
    }
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a");
    if (!a) return;
    if (a.href && a.href.indexOf("tel:") === 0) {
      track("phone_call_click", { link_url: a.href });
    }
    if (a.dataset && a.dataset.event) {
      track(a.dataset.event, { link_text: (a.textContent || "").trim() });
    }
  });

  /* ---------- Campaign attribution: persist UTM + landing data ---------- */
  var ATTR_KEY = "blossom-attribution";
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get("utm_source") || params.get("utm_campaign")) {
      sessionStorage.setItem(ATTR_KEY, JSON.stringify({
        utm_source: params.get("utm_source") || "",
        utm_medium: params.get("utm_medium") || "",
        utm_campaign: params.get("utm_campaign") || "",
        utm_content: params.get("utm_content") || "",
        landing_page: window.location.pathname,
        referrer: document.referrer || ""
      }));
    }
  } catch (e) { /* sessionStorage unavailable */ }

  /* ---------- Enquiry forms ---------- */
  document.querySelectorAll("form[data-enquiry]").forEach(function (form) {
    /* Copy stored attribution into hidden fields if present */
    try {
      var stored = sessionStorage.getItem(ATTR_KEY);
      if (stored) {
        var attr = JSON.parse(stored);
        Object.keys(attr).forEach(function (k) {
          var field = form.querySelector('input[name="' + k + '"]');
          if (field) field.value = attr[k];
        });
      }
    } catch (e) { /* ignore */ }

    form.addEventListener("submit", function (e) {
      track("generate_lead", {
        form_id: form.id || "enquiry",
        project_type: (form.querySelector('[name="project_type"]') || {}).value || "",
        budget: (form.querySelector('[name="budget"]') || {}).value || ""
      });
      /* Demo mode: until a real form endpoint is configured, redirect to the
         confirmation page so the journey can be tested end to end. */
      if (form.action.indexOf("REPLACE_WITH_FORM_ENDPOINT") !== -1) {
        e.preventDefault();
        window.location.href = form.dataset.thanks || "thanks.html";
      }
    });
  });
})();
