(function () {
  'use strict';
  var items = window.BlossomMaterials || [];
  var key = 'blossom-material-preferences-v1';
  var valid = Object.create(null);
  items.forEach(function (item) { valid[item.id] = item; });
  function clean(value) {
    var out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    items.forEach(function (item) {
      if (value[item.id] === 'like' || value[item.id] === 'dislike') out[item.id] = value[item.id];
    });
    return out;
  }
  var state = {};
  var storageWorks = true;
  try { state = clean(JSON.parse(localStorage.getItem(key) || '{}')); } catch (e) { storageWorks = false; }
  var params = new URLSearchParams(window.location.search);
  if (params.has('materials')) {
    var transferred = {};
    params.get('materials').slice(0,2000).split(',').forEach(function (pair) {
      var bits = pair.split(':');
      if (Object.prototype.hasOwnProperty.call(valid,bits[0]) && (bits[1] === 'like' || bits[1] === 'dislike')) transferred[bits[0]] = bits[1];
    });
    state = clean(transferred);
  }
  function persist() {
    try {
      if (Object.keys(state).length) localStorage.setItem(key, JSON.stringify(state));
      else localStorage.removeItem(key);
      storageWorks = true;
    } catch (e) { storageWorks = false; }
  }
  function serialise() {
    return items.filter(function (i) { return state[i.id]; }).map(function (i) { return i.id + ':' + state[i.id]; }).join(',');
  }
  function summary() {
    return ['like','dislike'].map(function (choice) {
      var selected = items.filter(function (i) { return state[i.id] === choice; });
      return selected.length ? (choice === 'like' ? 'I like:' : 'Not for me:') + '\n' + selected.map(function (i) { return '- ' + i.title; }).join('\n') : '';
    }).filter(Boolean).join('\n\n');
  }
  var contact = document.getElementById('material-enquiry');
  if (contact) {
    var field = document.getElementById('material-preferences');
    var include = document.getElementById('include-materials');
    contact.hidden = !Object.keys(state).length;
    field.value = summary();
    field.disabled = !include.checked;
    include.addEventListener('change',function () { field.disabled = !include.checked; });
    contact.querySelector('a').href = 'materials.html?materials=' + encodeURIComponent(serialise()) + '#choices';
    // A persisted page restored by Back should still honour the checkbox.
    window.addEventListener('pageshow',function () { field.disabled = !include.checked; });
    return;
  }
  var library = document.querySelector('.materials-page');
  if (!library) return;
  if (params.has('materials')) persist();
  document.querySelector('.material-tools').hidden = false;
  document.querySelectorAll('.material-actions').forEach(function (el) { el.hidden = false; });
  var status = document.getElementById('material-status');
  function render() {
    var count = Object.keys(state).length;
    document.getElementById('choices-link').textContent = 'Your choices (' + count + ')';
    document.getElementById('choice-empty').hidden = count > 0;
    document.getElementById('choices-clear').hidden = count === 0;
    var enquiry = document.getElementById('choices-enquiry');
    enquiry.textContent = count ? 'Use these choices in an enquiry' : 'Discuss your ideas';
    enquiry.href = 'contact.html' + (count ? '?materials=' + encodeURIComponent(serialise()) : '') + '#enquiry-form';
    document.getElementById('storage-note').textContent = storageWorks ? 'Your preferences stay in this browser. They are only sent to Blossom if you choose to include them in an enquiry. No account needed.' : 'This browser could not save your choices between visits. Use the enquiry link to carry your current choices with you.';
    document.querySelectorAll('[data-material]').forEach(function (card) {
      var choice = state[card.dataset.material] || '';
      card.dataset.selected = choice;
      card.querySelectorAll('[data-choice]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.choice === choice)); });
    });
    var lists = document.getElementById('choice-lists');
    lists.replaceChildren();
    ['like','dislike'].forEach(function (choice) {
      var chosen = items.filter(function (i) { return state[i.id] === choice; });
      if (!chosen.length) return;
      var heading = document.createElement('h3');
      heading.textContent = choice === 'like' ? 'You like' : 'Not for you';
      var ul = document.createElement('ul'); ul.className = 'material-choice-list';
      chosen.forEach(function (i) {
        var li = document.createElement('li'); var name = document.createElement('span'); name.textContent = i.title;
        var button = document.createElement('button'); button.type = 'button'; button.textContent = 'Remove'; button.dataset.remove = i.id; button.setAttribute('aria-label','Remove ' + i.title);
        li.append(name,button); ul.append(li);
      });
      lists.append(heading,ul);
    });
  }
  library.addEventListener('click',function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-choice')) {
      var id = button.closest('[data-material]').dataset.material;
      if (state[id] === button.dataset.choice) delete state[id]; else state[id] = button.dataset.choice;
      persist(); render(); status.textContent = valid[id].title + (state[id] ? (state[id] === 'like' ? ' added to your likes.' : ' marked as not for you.') : ' removed from your choices.');
    } else if (button.hasAttribute('data-remove')) {
      delete state[button.dataset.remove]; persist(); render();
      document.getElementById('choices-enquiry').focus(); status.textContent = 'Choice removed.';
    } else if (button.id === 'choices-clear') {
      state = {}; persist(); render(); document.getElementById('choices-enquiry').focus(); status.textContent = 'All choices cleared.';
    } else if (button.hasAttribute('data-filter')) {
      applyFilter(button.dataset.filter);
      history.replaceState(null,'',window.location.pathname + (button.dataset.filter === 'all' ? '' : '#' + button.dataset.filter));
    }
  });
  function applyFilter(group) {
    if (['all','buildings','decking','landscaping'].indexOf(group) < 0) group = 'all';
    document.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed',String(b.dataset.filter === group)); });
    document.querySelectorAll('[data-material-group]').forEach(function (s) { s.hidden = group !== 'all' && s.dataset.materialGroup !== group; });
  }
  applyFilter(window.location.hash.slice(1));
  window.addEventListener('hashchange',function () {
    if (window.location.hash !== '#choices') applyFilter(window.location.hash.slice(1));
  });
  render();
}());
