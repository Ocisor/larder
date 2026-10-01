'use strict';

/* =========================================================
   Data
   Each item: { id, name, category, level, count, buy, onList, inBasket }
   level: rough amount left — 3 Full, 2 Half, 1 Low, 0 Out
   count: exact number you have, or null for items tracked by level
   buy:   how many to get when it's on the list, or null for "any"
          (kept after shopping, so it's remembered for next time)
   ========================================================= */

const STORE_KEY = 'larder.v1';
const PREFS_KEY = 'larder.prefs';
const LEVELS = ['Out', 'Low', 'Half', 'Full'];   // index = level number
const CATEGORIES = ['Fresh', 'Fridge', 'Freezer', 'Cupboard', 'Other'];
const MAX = 999;

let items = loadItems();
let prefs = loadPrefs();
let view = 'list';
let query = '';

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Turns anything (saved data or a backup file) into a valid item list,
// dropping broken entries and duplicate names. Throws if it isn't a list at all.
function clean(list) {
  if (!Array.isArray(list)) throw new Error('Not an item list');
  const seen = new Set();
  return list.flatMap(x => {
    if (!x || typeof x.name !== 'string' || !x.name.trim()) return [];
    const name = x.name.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    const onList = x.onList === true;
    const count = wholeNumber(x.count);
    let buy = wholeNumber(x.buy);
    if (buy === 0) buy = null;
    if (count !== null && onList && buy === null) buy = 1;
    return [{
      id: typeof x.id === 'string' && x.id ? x.id : newId(),
      name,
      category: CATEGORIES.includes(x.category) ? x.category : 'Other',
      level: [0, 1, 2, 3].includes(x.level) ? x.level : 3,
      count,
      buy,
      onList,
      inBasket: onList && x.inBasket === true,
    }];
  });
}

// A whole number between 0 and MAX, or null if it isn't one
function wholeNumber(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, MAX) : null;
}

function loadItems() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
    return raw ? clean(JSON.parse(raw).items) : [];
  } catch {
    // Keep a copy of unreadable data instead of silently overwriting it
    try { if (raw) localStorage.setItem(STORE_KEY + '.unreadable', raw); } catch {}
    return [];
  }
}

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ version: 2, items }));
  } catch {
    showToast('Couldn’t save. Your phone’s storage may be full.');
  }
}

// Every edit goes through here: snapshot, change, save, redraw,
// and optionally show a toast whose Undo puts the snapshot back.
function change(mutate, message) {
  const before = structuredClone(items);
  mutate();
  save();
  render();
  if (message) showToast(message, () => { items = before; save(); render(); });
}

const find = id => items.find(i => i.id === id);
const counted = i => i.count !== null;
const byName = (a, b) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function grouped(list) {
  return CATEGORIES
    .map(cat => [cat, list.filter(i => i.category === cat).sort(byName)])
    .filter(([, rows]) => rows.length);
}

/* =========================================================
   Rendering
   ========================================================= */

const $ = sel => document.querySelector(sel);

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICON = {
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  basket: filled => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9.5h17l-1.7 9a2 2 0 0 1-2 1.6H7.2a2 2 0 0 1-2-1.6z"${filled ? ' fill="currentColor"' : ''}/><path d="M8 9.5l4-5.5 4 5.5"/></svg>`,
};

// Three dots: how many are filled = how much is left
function dots(level) {
  const marks = [1, 2, 3].map(n => `<i class="${level >= n ? 'on' : ''}"></i>`).join('');
  return `<span class="dots" data-level="${level}" aria-hidden="true">${marks}</span>`;
}

function render() {
  renderList();
  renderStock();
  updateDock();
}

function renderList() {
  const toGet = items.filter(i => i.onList && !i.inBasket);
  const basket = items.filter(i => i.onList && i.inBasket).sort(byName);

  let count = '';
  if (toGet.length && basket.length) count = `${toGet.length} to get, ${basket.length} in basket`;
  else if (toGet.length) count = `${toGet.length} to get`;
  else if (basket.length) count = `All ${basket.length} in basket`;
  $('#list-count').textContent = count;

  if (!toGet.length && !basket.length) {
    $('#list-body').innerHTML = `
      <div class="empty">
        <p>Nothing to buy.</p>
        <p class="sub">Tap the basket next to an item in your inventory to put it here.</p>
        <button class="link" data-action="tab" data-view="stock">Open inventory</button>
      </div>`;
    return;
  }

  let html = '';
  for (const [cat, rows] of grouped(toGet)) {
    html += `<h2 class="group">${cat}</h2><ul class="rows">${rows.map(listRow).join('')}</ul>`;
  }
  if (basket.length) {
    html += `<h2 class="group">In basket</h2><ul class="rows">${basket.map(listRow).join('')}</ul>`;
  }
  $('#list-body').innerHTML = html;
}

function listRow(i) {
  const isCounted = counted(i);
  const spoken = [isCounted ? '' : LEVELS[i.level], i.buy ? `buy ${i.buy}` : ''].filter(Boolean).join(', ');
  const remove = i.inBasket ? '' : `
    <button class="icon-btn" data-action="unlist" data-id="${i.id}" aria-label="Take ${esc(i.name)} off the list">${ICON.x}</button>`;
  return `
    <li class="row${i.inBasket ? ' got' : ''}">
      <button class="tick" data-action="tick" data-id="${i.id}" aria-pressed="${i.inBasket}">
        <span class="box" aria-hidden="true">${i.inBasket ? ICON.check : ''}</span>
        <span class="name">${esc(i.name)}${isCounted ? `<span class="have">Have ${i.count}</span>` : ''}${spoken ? `<span class="sr">, ${spoken}</span>` : ''}</span>
        ${i.buy ? `<span class="qty" aria-hidden="true">×${i.buy}</span>` : ''}
        ${isCounted ? '' : dots(i.level)}
      </button>${remove}
    </li>`;
}

function renderStock() {
  $('#stock-count').textContent = items.length ? plural(items.length, 'item') : '';

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
  const exists = q && items.some(i => i.name.toLowerCase() === q);

  let html = '';
  if (q && !exists) {
    html += `<button class="add-row" data-action="add-from-search">${ICON.plus}<span>Add “${esc(query.trim())}”</span></button>`;
  }
  if (!items.length && !q) {
    html += `
      <div class="empty">
        <p>No items yet.</p>
        <p class="sub">Type a name in the box above to add your first one.</p>
      </div>`;
  }
  for (const [cat, rows] of grouped(shown)) {
    html += `<h2 class="group">${cat}</h2><ul class="rows">${rows.map(stockRow).join('')}</ul>`;
  }
  if (items.length && items.length < 8 && !q) {
    html += `<p class="hint">Tap the dots or number as you use something up. Tap the basket to put it on your shopping list. Tap a name to edit it, or to switch it to an exact count.</p>`;
  }
  $('#stock-body').innerHTML = html;
}

function stockRow(i) {
  return `
    <li class="row">
      <button class="name-btn" data-action="edit" data-id="${i.id}"><span class="name">${esc(i.name)}</span></button>
      ${counted(i)
        ? `<button class="level-btn" data-action="use-one" data-id="${i.id}"
                   aria-label="${esc(i.name)}: ${i.count} left. Tap to use one."><span class="num${i.count === 0 ? ' zero' : ''}" aria-hidden="true">${i.count}</span></button>`
        : `<button class="level-btn" data-action="step" data-id="${i.id}"
                   aria-label="${esc(i.name)}: ${LEVELS[i.level]}. Tap to lower.">${dots(i.level)}</button>`}
      <button class="icon-btn list-btn" data-action="toggle-list" data-id="${i.id}"
              aria-pressed="${i.onList}" aria-label="${esc(i.name)} on shopping list">${ICON.basket(i.onList)}</button>
    </li>`;
}

function updateDock() {
  const basketCount = items.filter(i => i.onList && i.inBasket).length;
  const toGetCount = items.filter(i => i.onList && !i.inBasket).length;

  const done = $('#done-shopping');
  done.hidden = view !== 'list' || basketCount === 0;
  done.textContent = `Mark ${basketCount} bought`;

  $('#tab-badge').textContent = toGetCount || '';

  // Tell the CSS how tall the dock is, so the page and toast sit above it
  document.documentElement.style.setProperty('--dock-h', $('#dock').offsetHeight + 'px');
}

function show(name) {
  view = name;
  $('#view-list').hidden = name !== 'list';
  $('#view-stock').hidden = name !== 'stock';
  document.querySelectorAll('.tab').forEach(tab => {
    if (tab.dataset.view === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  updateDock();
}

// Little pulse on an item's dots so you can see what just changed
function bump(id) {
  const el = document.querySelector(`.level-btn[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.classList.add('bump');
  el.scrollIntoView({ block: 'nearest' });
}

/* =========================================================
   Sheets (add / edit item, backup)
   ========================================================= */

const sheet = $('#sheet');
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); }); // tap outside closes

function stepper(name, value, label) {
  return `
    <div class="stepper">
      <button type="button" class="ghost" data-action="stepper" data-delta="-1" aria-label="${label}: one fewer">${ICON.minus}</button>
      <input class="input" name="${name}" type="number" inputmode="numeric" min="0" max="${MAX}"
             value="${value ?? ''}" aria-label="${label}">
      <button type="button" class="ghost" data-action="stepper" data-delta="1" aria-label="${label}: one more">${ICON.plus}</button>
    </div>`;
}

function openItemSheet(item, presetName = '') {
  const isNew = !item;
  const d = item || {
    name: presetName,
    category: prefs.lastCategory || 'Cupboard',
    level: 3,
    count: null,
    buy: null,
    onList: false,
  };
  const isCounted = d.count !== null;
  // Only pop the keyboard up when you're about to type a name
  const focusName = isNew && !presetName;

  sheet.innerHTML = `
    <form class="sheet-body" novalidate>
      <h2 tabindex="-1" ${focusName ? '' : 'autofocus'}>${isNew ? 'New item' : 'Edit item'}</h2>

      <label class="field">
        <span>Name</span>
        <input class="input" name="name" maxlength="60" value="${esc(d.name)}"
               autocomplete="off" autocapitalize="sentences" enterkeyhint="done" ${focusName ? 'autofocus' : ''}>
      </label>

      <fieldset>
        <legend>Where it lives</legend>
        <div class="chips">
          ${CATEGORIES.map(c => `
            <label class="chip"><input type="radio" name="category" value="${c}" ${c === d.category ? 'checked' : ''}><span>${c}</span></label>`).join('')}
        </div>
      </fieldset>

      <fieldset>
        <legend>How much is left</legend>
        <div class="segments two">
          <label class="seg"><input type="radio" name="mode" value="level" ${isCounted ? '' : 'checked'}><span>Rough level</span></label>
          <label class="seg"><input type="radio" name="mode" value="count" ${isCounted ? 'checked' : ''}><span>Exact count</span></label>
        </div>
        <div class="segments" data-panel="level">
          ${[3, 2, 1, 0].map(l => `
            <label class="seg"><input type="radio" name="level" value="${l}" ${l === d.level ? 'checked' : ''}><span>${dots(l)}${LEVELS[l]}</span></label>`).join('')}
        </div>
        <div data-panel="count">${stepper('count', d.count ?? 0, 'How many you have')}</div>
      </fieldset>

      <label class="switch">
        <input type="checkbox" name="onList" ${d.onList ? 'checked' : ''}>
        <span class="track" aria-hidden="true"></span>
        <span>On shopping list</span>
      </label>

      <div class="field buy" data-panel="buy">
        <span>How many to buy</span>
        ${stepper('buy', d.buy, 'How many to buy')}
      </div>

      <p class="form-error" role="alert"></p>

      <div class="actions">
        ${isNew ? '' : `<button type="button" class="danger" data-action="delete" data-id="${item.id}">Delete</button>`}
        <button type="button" class="ghost" data-action="close-sheet">Cancel</button>
        <button type="submit" class="primary">${isNew ? 'Add item' : 'Save changes'}</button>
      </div>
    </form>`;

  const form = sheet.querySelector('form');
  const panel = name => form.querySelector(`[data-panel="${name}"]`);

  // Show the level picker or the count stepper, and the buy stepper only when it's on the list.
  // Counted items always need a buy amount (so "Mark bought" knows what to add); level items can leave it blank.
  const sync = () => {
    const mode = form.elements.mode.value;
    const onList = form.elements.onList.checked;
    panel('level').hidden = mode !== 'level';
    panel('count').hidden = mode !== 'count';
    panel('buy').hidden = !onList;
    form.elements.buy.placeholder = mode === 'count' ? '' : 'Any amount';
    if (mode === 'count' && onList && !form.elements.buy.value) form.elements.buy.value = 1;
  };
  form.addEventListener('change', sync);
  sync();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(form);
    const name = String(f.get('name')).trim().replace(/\s+/g, ' ');
    const error = form.querySelector('.form-error');
    const clash = items.find(i => i !== item && i.name.toLowerCase() === name.toLowerCase());

    if (!name) { error.textContent = 'Give the item a name.'; return; }
    if (clash) { error.textContent = `You already have “${clash.name}”. Edit that one instead.`; return; }

    const onList = f.get('onList') === 'on';
    const count = f.get('mode') === 'count' ? (wholeNumber(f.get('count')) ?? 0) : null;
    let buy = wholeNumber(f.get('buy'));
    if (buy === 0) buy = null;
    if (count !== null && onList && buy === null) buy = 1;

    const fields = {
      name,
      category: f.get('category'),
      level: Number(f.get('level')),
      count,
      buy,
      onList,
    };
    prefs.lastCategory = fields.category;
    savePrefs();
    sheet.close();

    if (isNew) {
      const created = { id: newId(), ...fields, inBasket: false };
      query = '';
      $('#search').value = '';
      change(() => { items.push(created); });
      bump(created.id);
    } else {
      change(() => {
        Object.assign(item, fields);
        if (!item.onList) item.inBasket = false;
      });
    }
  });

  sheet.showModal();
}

function openSettings() {
  const n = items.length;
  sheet.innerHTML = `
    <div class="sheet-body">
      <h2 tabindex="-1" autofocus>Backup</h2>
      <p class="sub">Your ${plural(n, 'item')} ${n === 1 ? 'is' : 'are'} stored only on this phone. Save a backup now and then, so you can restore them if Chrome’s data gets cleared or you switch phones.</p>
      <div class="actions stack">
        <button type="button" class="primary" data-action="export">Save backup</button>
        <button type="button" class="ghost" data-action="import">Restore from backup</button>
        <button type="button" class="ghost" data-action="close-sheet">Close</button>
      </div>
      <input type="file" id="import-file" accept=".json,application/json" hidden>
    </div>`;
  sheet.querySelector('#import-file').addEventListener('change', importBackup);
  sheet.showModal();
}

function exportBackup() {
  const data = { app: 'larder', version: 2, saved: new Date().toISOString(), items };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `larder-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  sheet.close();
  showToast('Backup saved to Downloads');
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  let incoming;
  try {
    incoming = clean(JSON.parse(await file.text()).items);
  } catch {
    sheet.close();
    showToast('That file isn’t a Larder backup.');
    return;
  }
  if (items.length && !confirm(`Replace your ${plural(items.length, 'item')} with the ${plural(incoming.length, 'item')} in this backup?`)) return;
  sheet.close();
  change(() => { items = incoming; }, `Restored ${plural(incoming.length, 'item')}`);
}

/* =========================================================
   Toast with optional Undo
   ========================================================= */

const toastEl = $('#toast');
let toastTimer;

function showToast(message, undo) {
  const text = document.createElement('span');
  text.textContent = message;
  toastEl.replaceChildren(text);
  if (undo) {
    const btn = document.createElement('button');
    btn.textContent = 'Undo';
    btn.addEventListener('click', () => { undo(); hideToast(); });
    toastEl.append(btn);
  }
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 6000 : 3000);
}
function hideToast() { toastEl.classList.remove('show'); }

/* =========================================================
   Events — one listener handles every button via data-action
   ========================================================= */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const item = el.dataset.id ? find(el.dataset.id) : null;
  if (el.dataset.id && !item) return;

  switch (el.dataset.action) {
    case 'tab':
      show(el.dataset.view);
      break;

    case 'tick':            // shopping list: in the basket / not
      change(() => { item.inBasket = !item.inBasket; });
      break;

    case 'unlist':          // shopping list: take off without buying
      change(() => { item.onList = false; item.inBasket = false; }, `Took ${item.name} off the list`);
      break;

    case 'done': {          // shopping list: everything in the basket is now Full
      const bought = items.filter(i => i.onList && i.inBasket);
      change(() => {
        for (const i of bought) {
          if (counted(i)) i.count = Math.min(MAX, i.count + (i.buy || 1));  // add what you bought
          else i.level = 3;                                                // back to Full
          i.onList = false;
          i.inBasket = false;
        }
      }, `Marked ${bought.length} bought`);
      break;
    }

    case 'step':            // inventory: Full → Half → Low → Out → Full
      change(() => { item.level = item.level === 0 ? 3 : item.level - 1; });
      bump(item.id);
      break;

    case 'use-one':         // inventory: counted item, one fewer (stops at 0)
      if (item.count > 0) {
        change(() => { item.count -= 1; });
        bump(item.id);
      }
      break;

    case 'toggle-list':     // inventory: on / off the shopping list
      change(() => {
        item.onList = !item.onList;
        if (!item.onList) item.inBasket = false;
        else if (counted(item) && !item.buy) item.buy = 1;
      });
      break;

    case 'stepper': {       // item sheet: − / + buttons beside a number box
      const input = el.parentElement.querySelector('input');
      const isBuy = input.name === 'buy';
      const countMode = el.form.elements.mode.value === 'count';
      const next = (wholeNumber(input.value) ?? 0) + Number(el.dataset.delta);
      if (isBuy && next < 1) input.value = countMode ? 1 : '';   // blank buy = "any amount"
      else input.value = Math.max(0, Math.min(MAX, next));
      break;
    }

    case 'edit':
      openItemSheet(item);
      break;

    case 'add-from-search':
      openItemSheet(null, query.trim());
      break;

    case 'delete':
      sheet.close();
      change(() => { items = items.filter(i => i.id !== item.id); }, `Deleted ${item.name}`);
      break;

    case 'settings':
      openSettings();
      break;

    case 'export':
      exportBackup();
      break;

    case 'import':
      sheet.querySelector('#import-file').click();
      break;

    case 'close-sheet':
      sheet.close();
      break;
  }
});

const search = $('#search');
search.addEventListener('input', () => { query = search.value; renderStock(); });
search.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const q = query.trim();
  if (q && !items.some(i => i.name.toLowerCase() === q.toLowerCase())) openItemSheet(null, q);
});

/* =========================================================
   Start up
   ========================================================= */

$('[data-action="settings"]').innerHTML = ICON.more;
render();
show('list');                 // always open on the shopping list

// Ask Chrome not to clear this app's storage when the phone runs low on space
navigator.storage?.persist?.();

// The service worker is what makes the app open with no signal
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error('Service worker failed', err));
  });
}
