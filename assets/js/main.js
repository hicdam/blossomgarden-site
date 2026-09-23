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

  /* ---------- Shared responsive navigation ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var menu = document.querySelector('.mobile-menu');
  var navBar = document.querySelector('.nav-bar');
  var desktopNav = window.matchMedia('(min-width: 1200px)');
  if (toggle && menu) {
    function sizeMenu() {
      if (menu.hidden) return;
      var bottom = navBar.getBoundingClientRect().bottom;
      menu.style.maxHeight = Math.max(0, window.innerHeight - bottom) + 'px';
    }
    function closeMenu(returnFocus) {
      menu.hidden = true;
      menu.classList.remove('open');
      menu.style.maxHeight = '';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Menu';
      document.body.classList.remove('nav-open');
      if (returnFocus) toggle.focus();
    }
    toggle.addEventListener('click', function () {
      if (!menu.hidden) { closeMenu(false); return; }
      menu.hidden = false;
      menu.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.textContent = 'Close';
      document.body.classList.add('nav-open');
      sizeMenu();
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeMenu(false);
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !e.target.closest('.site-header')) closeMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (menu.hidden) return;
      if (e.key === 'Escape') { closeMenu(true); return; }
      if (e.key === 'Tab') {
        var nodes = Array.from(document.querySelector('.site-header').querySelectorAll('a, button, summary')).filter(function (el) { return el.getClientRects().length; });
        var first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    window.addEventListener('resize', function () { if (desktopNav.matches) closeMenu(false); else sizeMenu(); });
    window.addEventListener('pageshow', function () { closeMenu(false); });
  }
  // One content source: fuller on desktop, expandable after the mobile shortcuts.
  var homeMore = document.querySelector('.home-more');
  var fullHome = window.matchMedia('(min-width: 760px)');
  if (homeMore) {
    function syncHome() { homeMore.open = fullHome.matches; }
    syncHome();
    fullHome.addEventListener('change', syncHome);
    document.querySelectorAll('a[href="#homeowners"]').forEach(function (a) {
      a.addEventListener('click', function () { homeMore.open = true; });
    });
    if (window.location.hash === '#homeowners') homeMore.open = true;
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
