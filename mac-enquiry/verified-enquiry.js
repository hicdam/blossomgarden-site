/* Loaded only after the Mac service passes end-to-end checks and the form is activated. */
(function () {
  'use strict';
  document.querySelectorAll('form[data-verification-endpoint]').forEach(function (form) {
    var button = form.querySelector('button[type="submit"]');
    var status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.appendChild(status);
    var token = '';
    var widget;
    var busy = false;
    var widgetNode = form.querySelector('[data-turnstile]');
    function ready() {
      if (!window.turnstile) return;
      widget = window.turnstile.render(widgetNode, {
        sitekey: form.dataset.turnstileSitekey,
        action: 'enquiry',
        callback: function (value) { token = value; if (!busy) button.disabled = false; },
        'expired-callback': function () { token = ''; button.disabled = true; },
        'error-callback': function () {
          token = ''; button.disabled = true;
          status.textContent = 'The spam-protection check could not load. Please reload or email hello@blossomgarden.design.';
        }
      });
    }
    // Capture phase prevents any legacy submit handler or native POST from bypassing verification.
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy || !form.reportValidity() || !token) return;
      busy = true;
      button.disabled = true;
      status.textContent = 'Sending your confirmation email request…';
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, 20000);
      try {
        var payload = Object.fromEntries(new FormData(form).entries());
        payload['cf-turnstile-response'] = token;
        var response = await fetch(form.dataset.verificationEndpoint + '/enquiries', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), signal: controller.signal, credentials: 'omit'
        });
        var data;
        try { data = await response.json(); } catch (_) { throw new Error('The enquiry service is temporarily unavailable. Please try again later or email hello@blossomgarden.design.'); }
        if (!response.ok) throw new Error(data.error || 'Please check your details and try again.');
        status.textContent = data.message;
        button.textContent = 'Confirmation requested';
        // Keep entered details visible. To change the email, reload and submit again.
        form.querySelectorAll('input,textarea,select').forEach(function (field) { field.disabled = true; });
      } catch (error) {
        busy = false;
        token = '';
        status.textContent = error.name === 'AbortError'
          ? 'We could not confirm the request completed. Check your inbox before trying again. Your details are still here.'
          : error.message;
        if (window.turnstile && widget !== undefined) window.turnstile.reset(widget);
        button.textContent = 'Send my enquiry';
      } finally {
        clearTimeout(timeout);
      }
    }, true);
    if (window.turnstile) ready();
    else window.addEventListener('blossom-turnstile-ready', ready, { once: true });
  });
})();
