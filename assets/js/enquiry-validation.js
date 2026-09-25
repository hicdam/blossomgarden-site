(function () {
  'use strict';
  function enquiryError(name, raw) {
    var value = raw.trim();
    var limits = { name: 100, email: 254, contact: 254, location: 120, message: 4000 };
    if (!value) return 'Please complete this field.';
    if (limits[name] && value.length > limits[name]) return 'Please shorten this to ' + limits[name] + ' characters or fewer.';
    if (name === 'name' && !/\p{L}/u.test(value)) return 'Please enter your name.';
    if (name === 'location' && !/[\p{L}\p{N}]/u.test(value)) return 'Please enter your town, village or postcode.';
    if (name === 'email' || (name === 'contact' && value.includes('@'))) {
      if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value)) return 'Please enter a complete email address, such as name@example.com.';
    }
    if (name === 'contact' && !value.includes('@')) {
      var digits = value.replace(/\D/g, '');
      if (!/^\+?[\d\s().-]+$/.test(value) || digits.length < 7 || digits.length > 15) return 'Please enter an email address or a phone number including the area code.';
    }
    if (name === 'message') {
      var compact = value.replace(/\s/g, '');
      if (value.length < 8 || !/\p{L}/u.test(value) || /^(.{1,3})\1{2,}$/iu.test(compact)) return 'Please briefly describe the work you need, for example “Need hedge cut”.';
    }
    return '';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = enquiryError;
  if (typeof document === 'undefined') return;
  document.querySelectorAll('form[data-enquiry]').forEach(function (form) {
    var fields = Array.from(form.querySelectorAll('input[required]:not([type="checkbox"]), textarea[required]'));
    function validate(field) { field.setCustomValidity(enquiryError(field.name, field.value)); }
    fields.forEach(function (field) {
      field.addEventListener('input', function () { validate(field); });
      field.addEventListener('blur', function () { field.value = field.value.trim(); validate(field); });
    });
    form.addEventListener('submit', function (event) {
      fields.forEach(function (field) { field.value = field.value.trim(); validate(field); });
      if (!form.checkValidity()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        form.reportValidity();
      }
    }, true);
  });
})();
