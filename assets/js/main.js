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

  /* ---------- Journey + service context ---------- */
  var JOURNEY_KEY = "blossom-journey";
  var SERVICE_KEY = "blossom-service-interest";

  function getStored(key) {
    try { return sessionStorage.getItem(key) || ""; } catch (e) { return ""; }
  }

  function setStored(key, value) {
    if (!value) return;
    try { sessionStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  function currentJourney() {
    if (window.location.pathname.indexOf("architects-builders") !== -1) return "trade_partner";
    return getStored(JOURNEY_KEY) || "direct_customer";
  }

  function currentService() {
    var fromQuery = "";
    try { fromQuery = new URLSearchParams(window.location.search).get("service") || ""; } catch (e) { /* ignore */ }
    return fromQuery || getStored(SERVICE_KEY) || "";
  }

  /* ---------- Event tracking (only fires when analytics is loaded) ---------- */
  function track(eventName, params) {
    if (typeof window.gtag === "function") {
      var payload = Object.assign({
        page_path: window.location.pathname,
        journey_type: currentJourney()
      }, params || {});
      var service = currentService();
      if (service && !payload.service) payload.service = service;
      window.gtag("event", eventName, payload);
    }
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a");
    if (!a) return;

    var href = a.getAttribute("href") || "";
    var eventName = a.dataset && a.dataset.event ? a.dataset.event : "";
    var linkText = (a.textContent || "").trim();

    if (eventName === "route_partners" || href.indexOf("architects-builders.html") !== -1) {
      setStored(JOURNEY_KEY, "trade_partner");
      track("buyer_route_click", { route: "trade_partner", link_text: linkText });
    } else if (eventName === "route_garden_projects" || eventName === "route_maintenance") {
      setStored(JOURNEY_KEY, "direct_customer");
      track("buyer_route_click", {
        route: eventName === "route_maintenance" ? "maintenance" : "garden_projects",
        link_text: linkText
      });
    }

    try {
      var linkUrl = new URL(a.href, window.location.href);
      var service = linkUrl.searchParams.get("service");
      if (service) {
        setStored(SERVICE_KEY, service);
        track("service_interest", { service: service, link_text: linkText });
      }
    } catch (err) { /* ignore malformed URLs */ }

    if (a.href && a.href.indexOf("tel:") === 0) {
      track("phone_call_click", { link_url: a.href });
    }
    if (a.href && a.href.indexOf("mailto:") === 0) {
      track("email_click");
    }
    if (eventName) {
      track(eventName, { link_text: linkText });
      if (eventName === "book_review_click") {
        track("enquiry_cta_click", { link_text: linkText });
      }
    }
  });

  /* Record meaningful page/service intent once per page load. */
  (function trackPageIntent() {
    var path = window.location.pathname;
    var servicePages = {
      "/garden-maintenance.html": "maintenance",
      "/garden-design.html": "garden_design",
      "/garden-management.html": "garden_management",
      "/garden-projects.html": "garden_projects",
      "/garden-review.html": "garden_review",
      "/your-garden-manager.html": "ongoing_garden_support"
    };
    if (path.indexOf("architects-builders.html") !== -1) {
      setStored(JOURNEY_KEY, "trade_partner");
      track("partner_page_view");
    }
    if (servicePages[path]) {
      setStored(SERVICE_KEY, servicePages[path]);
      track("service_view", { service: servicePages[path] });
    }
  })();

  /* ---------- Campaign attribution: persist UTM + landing data ---------- */
  var ATTR_KEY = "blossom-attribution";
  var PENDING_LEAD_KEY = "blossom-pending-enquiry";
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

  /* Carry the selected service into the enquiry form. */
  var serviceField = document.querySelector('select[name="help_with"]');
  var serviceNames = { "garden-buildings": "Garden building", "decking": "Decking", "gates": "Gates", "fencing": "Fencing", "maintenance": "Garden maintenance" };
  var chosenService = new URLSearchParams(window.location.search).get("service");
  if (serviceField && serviceNames[chosenService]) serviceField.value = serviceNames[chosenService];

  /* ---------- Enquiry forms ---------- */
  document.querySelectorAll("form[data-enquiry]").forEach(function (form) {
    var formStarted = false;
    function markFormStarted(e) {
      if (formStarted) return;
      var target = e.target;
      if (!target || target.type === "hidden" || target.name === "_honey") return;
      formStarted = true;
      track("enquiry_form_start", {
        form_id: form.id || "enquiry",
        service: currentService() || (form.querySelector('[name="help_with"]') || {}).value || ""
      });
    }
    form.addEventListener("focusin", markFormStarted);
    form.addEventListener("input", markFormStarted);

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
      /* This is an attempt, not a lead. The provider may still reject it. */
      if (e.defaultPrevented || !form.checkValidity()) return;
      var selectedService = (form.querySelector('[name="help_with"]') || {}).value || currentService() || "";
      if (selectedService) setStored(SERVICE_KEY, selectedService);
      track("enquiry_form_attempt", {
        form_id: form.id || "enquiry",
        service: selectedService
      });
      try {
        sessionStorage.setItem(PENDING_LEAD_KEY, JSON.stringify({
          created: Date.now(),
          form_id: form.id || "enquiry",
          service: selectedService,
          journey_type: currentJourney()
        }));
      } catch (err) { /* private mode */ }
      /* Demo mode: until a real form endpoint is configured, redirect to the
         confirmation page so the journey can be tested end to end. */
      if (form.action.indexOf("REPLACE_WITH_FORM_ENDPOINT") !== -1) {
        e.preventDefault();
        window.location.href = form.dataset.thanks || "thanks.html";
      }
    });
  });

  /* FormSubmit redirects here only after it accepts the form. Count once,
     and ignore direct visits or stale attempts. Email ownership is separate. */
  if (window.location.pathname.replace(/\/$/, "").endsWith("/thanks.html")) {
    try {
      var pendingLead = sessionStorage.getItem(PENDING_LEAD_KEY);
      sessionStorage.removeItem(PENDING_LEAD_KEY);
      if (pendingLead) {
        var lead = JSON.parse(pendingLead);
        if (Date.now() - lead.created < 30 * 60 * 1000) {
          track("generate_lead", {
            form_id: lead.form_id,
            service: lead.service || "",
            journey_type: lead.journey_type || currentJourney()
          });
        }
      }
    } catch (err) { /* private mode */ }
  }
})();
