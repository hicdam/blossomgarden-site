(function () {
  'use strict';
  var key = 'blossom-garden-ideas-v1';
  var oldKey = 'blossom-material-preferences-v1';
  var limit = 4000;
  var saved = '';
  var unavailable = false;
  var data = window.BlossomMaterials || [];
  function legacyNotes(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    var lines = [];
    data.forEach(function (item) {
      if (value[item.id] === 'like') lines.push('Interested in: ' + item.title);
      if (value[item.id] === 'dislike') lines.push('Prefer to avoid: ' + item.title);
    });
    return lines.length ? 'Earlier ideas to discuss and refine:\n' + lines.join('\n') : '';
  }
  try {
    var raw = localStorage.getItem(key);
    if (raw !== null) saved = raw.slice(0,limit);
    else {
      var old = {};
      try { old = JSON.parse(localStorage.getItem(oldKey) || '{}'); } catch (e) { /* damaged old preferences */ }
      saved = legacyNotes(old);
    }
  } catch (e) { unavailable = true; }
  var note = document.getElementById('garden-ideas');
  if (note) {
    note.value = saved;
    var controls = document.querySelector('.ideas-controls');
    var status = document.getElementById('ideas-status');
    controls.hidden = false;
    function save() {
      saved = note.value.trim().slice(0,limit);
      try {
        localStorage.setItem(key,saved);
        localStorage.removeItem(oldKey);
        unavailable = false;
        status.textContent = saved ? 'Your ideas are saved in this browser. You can return and change them at any time.' : 'Your saved ideas have been cleared.';
        return true;
      } catch (e) {
        unavailable = true;
        status.textContent = 'This browser cannot save your notes. Please copy them into the enquiry form when you contact us.';
        return false;
      }
    }
    document.getElementById('ideas-save').addEventListener('click',save);
    document.getElementById('ideas-discuss').addEventListener('click',function () {
      if (save()) window.location.href = 'contact.html#enquiry-form';
    });
    document.getElementById('ideas-clear').addEventListener('click',function () {
      note.value = ''; saved = '';
      try { localStorage.removeItem(key); localStorage.removeItem(oldKey); status.textContent = 'Your saved ideas have been cleared.'; }
      catch (e) { status.textContent = 'The notes on this page are cleared, but this browser could not update its saved data.'; }
      note.focus();
    });
    if (unavailable) status.textContent = 'This browser cannot access saved notes. You can still write ideas here and copy them into your enquiry.';
    if (window.location.hash === '#choices') window.location.replace('#your-ideas');
  }
  var contact = document.getElementById('material-enquiry');
  if (contact) {
    var field = document.getElementById('material-preferences');
    var include = document.getElementById('include-materials');
    contact.hidden = !saved;
    field.value = saved;
    function update() { field.disabled = !include.checked; }
    update(); include.addEventListener('change',update); window.addEventListener('pageshow',update);
  }
}());
