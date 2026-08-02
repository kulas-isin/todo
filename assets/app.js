/* 我的待辦清單 — 零依賴、資料存在瀏覽器 localStorage 的單頁應用 */
(function () {
  'use strict';

  const STORE_KEY = 'my-todo-app/v1';
  const PREF_KEY = 'my-todo-app/prefs';
  const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };
  const PRIORITY_LABEL = { high: '高', normal: '中', low: '低' };
  const PRIORITY_ALIAS = {
    '高': 'high', 'high': 'high', 'h': 'high',
    '中': 'normal', 'normal': 'normal', 'n': 'normal',
    '低': 'low', 'low': 'low', 'l': 'low'
  };

  /** @type {{todos: Array}} */
  let state = { todos: [] };
  let prefs = { filter: 'all', category: '', sort: 'manual', theme: null };
  let query = '';
  let editingId = null;
  let undoSnapshot = null;
  let toastTimer = null;

  const $ = (sel) => document.querySelector(sel);
  const el = {
    list: $('#list'),
    empty: $('#empty'),
    quickForm: $('#quickForm'),
    quickInput: $('#quickInput'),
    detailBtn: $('#detailBtn'),
    searchInput: $('#searchInput'),
    categorySelect: $('#categorySelect'),
    categoryList: $('#categoryList'),
    sortSelect: $('#sortSelect'),
    filters: $('.filters'),
    dialog: $('#editDialog'),
    form: $('#editForm'),
    dialogTitle: $('#dialogTitle'),
    fTitle: $('#fTitle'),
    fNote: $('#fNote'),
    fDue: $('#fDue'),
    fPriority: $('#fPriority'),
    fCategory: $('#fCategory'),
    cancelBtn: $('#cancelBtn'),
    themeBtn: $('#themeBtn'),
    themeIcon: $('#themeIcon'),
    moreBtn: $('#moreBtn'),
    morePanel: $('#morePanel'),
    exportBtn: $('#exportBtn'),
    importBtn: $('#importBtn'),
    importFile: $('#importFile'),
    clearDoneBtn: $('#clearDoneBtn'),
    clearAllBtn: $('#clearAllBtn'),
    toast: $('#toast'),
    toastText: $('#toastText'),
    toastAction: $('#toastAction'),
    statActive: $('#statActive'),
    statToday: $('#statToday'),
    statOverdue: $('#statOverdue'),
    statDone: $('#statDone')
  };

  /* ---------- 儲存 ---------- */

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.todos)) state.todos = data.todos.map(normalize).filter(Boolean);
      }
    } catch (err) {
      console.warn('讀取資料失敗，改用空清單。', err);
    }
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) Object.assign(prefs, JSON.parse(raw));
    } catch (err) {
      console.warn('讀取偏好設定失敗。', err);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, todos: state.todos }));
    } catch (err) {
      toast('儲存失敗，瀏覽器儲存空間可能已滿。');
      console.error(err);
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch (err) { /* 偏好設定存不了不影響使用 */ }
  }

  function normalize(t) {
    if (!t || typeof t.title !== 'string') return null;
    return {
      id: typeof t.id === 'string' && t.id ? t.id : uid(),
      title: t.title.slice(0, 200),
      note: typeof t.note === 'string' ? t.note.slice(0, 2000) : '',
      done: !!t.done,
      priority: PRIORITY_ORDER[t.priority] !== undefined ? t.priority : 'normal',
      category: typeof t.category === 'string' ? t.category.slice(0, 30) : '',
      due: isIsoDate(t.due) ? t.due : '',
      createdAt: Number(t.createdAt) || Date.now(),
      doneAt: Number(t.doneAt) || null
    };
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 日期工具 ---------- */

  function todayIso() {
    const d = new Date();
    return toIso(d);
  }

  function toIso(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function isIsoDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function daysFromToday(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
  }

  function dueLabel(iso) {
    const diff = daysFromToday(iso);
    if (diff === 0) return '今天到期';
    if (diff === 1) return '明天到期';
    if (diff === 2) return '後天到期';
    if (diff < 0) return `逾期 ${-diff} 天`;
    if (diff <= 7) return `${diff} 天後（${iso.slice(5)}）`;
    return iso;
  }

  /* ---------- 快速輸入語法解析 ---------- */

  function parseRelativeDate(token) {
    const t = token.trim();
    const shift = { '今天': 0, 'today': 0, '明天': 1, 'tomorrow': 1, '後天': 2, '后天': 2, '下週': 7, '下周': 7 };
    if (Object.prototype.hasOwnProperty.call(shift, t.toLowerCase()) || Object.prototype.hasOwnProperty.call(shift, t)) {
      const d = new Date();
      d.setDate(d.getDate() + (shift[t] !== undefined ? shift[t] : shift[t.toLowerCase()]));
      return toIso(d);
    }
    if (isIsoDate(t)) return t;
    const md = t.match(/^(\d{1,2})[-/](\d{1,2})$/);
    if (md) {
      const now = new Date();
      const iso = `${now.getFullYear()}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
      return isIsoDate(iso) ? iso : '';
    }
    return '';
  }

  function parseQuick(raw) {
    const out = { title: '', note: '', priority: 'normal', category: '', due: '' };
    const title = raw
      .replace(/(?:^|\s)!([^\s]+)/g, (m, p) => {
        const mapped = PRIORITY_ALIAS[p.toLowerCase()];
        if (!mapped) return m;
        out.priority = mapped;
        return ' ';
      })
      .replace(/(?:^|\s)#([^\s]+)/g, (m, c) => {
        out.category = c.slice(0, 30);
        return ' ';
      })
      .replace(/(?:^|\s)@([^\s]+)/g, (m, d) => {
        const iso = parseRelativeDate(d);
        if (!iso) return m;
        out.due = iso;
        return ' ';
      })
      .replace(/\s{2,}/g, ' ')
      .trim();
    out.title = title.slice(0, 200);
    return out;
  }

  /* ---------- 資料操作 ---------- */

  function addTodo(fields) {
    const todo = normalize(Object.assign({ createdAt: Date.now() }, fields));
    if (!todo || !todo.title) return null;
    state.todos.unshift(todo);
    save();
    render();
    return todo;
  }

  function updateTodo(id, fields) {
    const t = state.todos.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, fields);
    save();
    render();
  }

  function toggleDone(id) {
    const t = state.todos.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    save();
    render();
  }

  function removeTodos(ids, message) {
    const set = new Set(ids);
    if (!set.size) return;
    undoSnapshot = state.todos.slice();
    state.todos = state.todos.filter((t) => !set.has(t.id));
    save();
    render();
    toast(message, '復原', () => {
      if (!undoSnapshot) return;
      state.todos = undoSnapshot;
      undoSnapshot = null;
      save();
      render();
      toast('已復原。');
    });
  }

  /* ---------- 篩選與排序 ---------- */

  function visibleTodos() {
    const today = todayIso();
    const q = query.trim().toLowerCase();
    let list = state.todos.filter((t) => {
      switch (prefs.filter) {
        case 'active': if (t.done) return false; break;
        case 'done': if (!t.done) return false; break;
        case 'today': if (t.done || t.due !== today) return false; break;
        case 'overdue': if (t.done || !t.due || t.due >= today) return false; break;
      }
      if (prefs.category && t.category !== prefs.category) return false;
      if (q) {
        const hay = `${t.title} ${t.note} ${t.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (prefs.sort !== 'manual') {
      list = list.slice().sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (prefs.sort === 'due') {
          if (!a.due && !b.due) return b.createdAt - a.createdAt;
          if (!a.due) return 1;
          if (!b.due) return -1;
          if (a.due !== b.due) return a.due < b.due ? -1 : 1;
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        }
        if (prefs.sort === 'priority') {
          const d = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
          if (d !== 0) return d;
          return b.createdAt - a.createdAt;
        }
        return b.createdAt - a.createdAt; // created
      });
    }
    return list;
  }

  /* ---------- 畫面繪製 ---------- */

  function render() {
    renderStats();
    renderCategories();
    renderList();
    document.querySelectorAll('.chip[data-filter]').forEach((btn) => {
      const on = btn.dataset.filter === prefs.filter;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    el.sortSelect.value = prefs.sort;
  }

  function renderStats() {
    const today = todayIso();
    let active = 0, dueToday = 0, overdue = 0, done = 0;
    for (const t of state.todos) {
      if (t.done) { done++; continue; }
      active++;
      if (t.due === today) dueToday++;
      else if (t.due && t.due < today) overdue++;
    }
    el.statActive.textContent = active;
    el.statToday.textContent = dueToday;
    el.statOverdue.textContent = overdue;
    el.statDone.textContent = done;
  }

  function renderCategories() {
    const cats = [...new Set(state.todos.map((t) => t.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    if (prefs.category && !cats.includes(prefs.category)) prefs.category = '';

    el.categorySelect.textContent = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = '所有分類';
    el.categorySelect.appendChild(all);
    for (const c of cats) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      el.categorySelect.appendChild(opt);
    }
    el.categorySelect.value = prefs.category;

    el.categoryList.textContent = '';
    for (const c of cats) {
      const opt = document.createElement('option');
      opt.value = c;
      el.categoryList.appendChild(opt);
    }
  }

  function renderList() {
    const items = visibleTodos();
    el.list.textContent = '';

    if (!items.length) {
      el.empty.hidden = false;
      el.empty.textContent = state.todos.length
        ? '這個條件下沒有項目。'
        : '還沒有任何待辦事項，從上面新增第一筆吧！';
      return;
    }
    el.empty.hidden = true;

    const today = todayIso();
    const frag = document.createDocumentFragment();
    for (const t of items) frag.appendChild(buildItem(t, today));
    el.list.appendChild(frag);
  }

  function buildItem(t, today) {
    const li = document.createElement('li');
    li.className = `item pri-${t.priority}${t.done ? ' is-done' : ''}`;
    li.dataset.id = t.id;
    if (prefs.sort === 'manual') li.draggable = true;

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'item__handle';
    handle.textContent = '⠿';
    handle.setAttribute('aria-label', '拖曳排序');
    handle.tabIndex = -1;
    handle.hidden = prefs.sort !== 'manual';
    li.appendChild(handle);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'item__check';
    check.checked = t.done;
    check.setAttribute('aria-label', `標記「${t.title}」為${t.done ? '未完成' : '已完成'}`);
    check.addEventListener('change', () => toggleDone(t.id));
    li.appendChild(check);

    const body = document.createElement('div');
    body.className = 'item__body';

    const title = document.createElement('p');
    title.className = 'item__title';
    title.textContent = t.title;
    body.appendChild(title);

    if (t.note) {
      const note = document.createElement('p');
      note.className = 'item__note';
      note.textContent = t.note;
      body.appendChild(note);
    }

    const meta = document.createElement('div');
    meta.className = 'item__meta';
    if (t.due) {
      const overdue = !t.done && t.due < today;
      const isToday = !t.done && t.due === today;
      meta.appendChild(tag(
        `📅 ${dueLabel(t.due)}`,
        overdue ? 'tag--overdue' : isToday ? 'tag--due-today' : ''
      ));
    }
    if (t.priority !== 'normal') {
      meta.appendChild(tag(`${t.priority === 'high' ? '🔺' : '🔻'} ${PRIORITY_LABEL[t.priority]}優先`,
        t.priority === 'high' ? 'tag--pri-high' : ''));
    }
    if (t.category) meta.appendChild(tag(`# ${t.category}`));
    if (meta.children.length) body.appendChild(meta);

    li.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'item__actions';
    actions.appendChild(iconButton('✏️', `編輯「${t.title}」`, () => openDialog(t.id)));
    actions.appendChild(iconButton('🗑️', `刪除「${t.title}」`, () => removeTodos([t.id], '已刪除 1 個項目。')));
    li.appendChild(actions);

    return li;
  }

  function tag(text, extra) {
    const s = document.createElement('span');
    s.className = 'tag' + (extra ? ' ' + extra : '');
    s.textContent = text;
    return s;
  }

  function iconButton(glyph, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = glyph;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  /* ---------- 對話框（新增／編輯） ---------- */

  function openDialog(id) {
    editingId = id || null;
    const t = id ? state.todos.find((x) => x.id === id) : null;
    el.dialogTitle.textContent = t ? '編輯待辦事項' : '新增待辦事項';
    el.fTitle.value = t ? t.title : el.quickInput.value.trim();
    el.fNote.value = t ? t.note : '';
    el.fDue.value = t ? t.due : '';
    el.fPriority.value = t ? t.priority : 'normal';
    el.fCategory.value = t ? t.category : (prefs.category || '');
    el.dialog.showModal();
    el.fTitle.focus();
    el.fTitle.select();
  }

  function submitDialog(event) {
    const title = el.fTitle.value.trim();
    if (!title) {
      event.preventDefault();
      el.fTitle.focus();
      return;
    }
    const fields = {
      title,
      note: el.fNote.value.trim(),
      due: isIsoDate(el.fDue.value) ? el.fDue.value : '',
      priority: el.fPriority.value,
      category: el.fCategory.value.trim()
    };
    if (editingId) {
      updateTodo(editingId, fields);
      toast('已更新。');
    } else {
      addTodo(Object.assign({ done: false }, fields));
      el.quickInput.value = '';
      toast('已新增。');
    }
    editingId = null;
  }

  /* ---------- 匯出／匯入 ---------- */

  function exportJson() {
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), todos: state.todos }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `todo-backup-${todayIso()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const incoming = (Array.isArray(data) ? data : data.todos || []).map(normalize).filter(Boolean);
        if (!incoming.length) { toast('檔案裡沒有可匯入的項目。'); return; }
        undoSnapshot = state.todos.slice();
        const existing = new Set(state.todos.map((t) => t.id));
        let added = 0;
        for (const t of incoming) {
          if (existing.has(t.id)) continue;
          state.todos.push(t);
          existing.add(t.id);
          added++;
        }
        save();
        render();
        toast(`已匯入 ${added} 個項目（略過 ${incoming.length - added} 個重複）。`, '復原', () => {
          state.todos = undoSnapshot;
          undoSnapshot = null;
          save();
          render();
        });
      } catch (err) {
        toast('匯入失敗：檔案格式不正確。');
        console.error(err);
      }
    };
    reader.onerror = () => toast('讀取檔案失敗。');
    reader.readAsText(file);
  }

  /* ---------- 提示訊息 ---------- */

  function toast(text, actionLabel, onAction) {
    clearTimeout(toastTimer);
    el.toastText.textContent = text;
    el.toast.hidden = false;
    if (actionLabel && onAction) {
      el.toastAction.hidden = false;
      el.toastAction.textContent = actionLabel;
      el.toastAction.onclick = () => {
        el.toast.hidden = true;
        onAction();
      };
    } else {
      el.toastAction.hidden = true;
      el.toastAction.onclick = null;
    }
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 6000);
  }

  /* ---------- 主題 ---------- */

  function applyTheme() {
    const dark = prefs.theme
      ? prefs.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    el.themeIcon.textContent = dark ? '☀️' : '🌙';
  }

  /* ---------- 拖曳排序 ---------- */

  function setupDragAndDrop() {
    let draggingId = null;

    el.list.addEventListener('dragstart', (e) => {
      const li = e.target.closest('.item');
      if (!li || prefs.sort !== 'manual') return;
      draggingId = li.dataset.id;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggingId);
    });

    el.list.addEventListener('dragend', () => {
      draggingId = null;
      el.list.querySelectorAll('.item').forEach((n) => n.classList.remove('is-dragging', 'is-dragover'));
    });

    el.list.addEventListener('dragover', (e) => {
      if (!draggingId) return;
      const li = e.target.closest('.item');
      if (!li || li.dataset.id === draggingId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.list.querySelectorAll('.is-dragover').forEach((n) => n.classList.remove('is-dragover'));
      li.classList.add('is-dragover');
    });

    el.list.addEventListener('drop', (e) => {
      const li = e.target.closest('.item');
      if (!draggingId || !li) return;
      e.preventDefault();
      const targetId = li.dataset.id;
      if (targetId === draggingId) return;
      const from = state.todos.findIndex((t) => t.id === draggingId);
      const to = state.todos.findIndex((t) => t.id === targetId);
      if (from < 0 || to < 0) return;
      const [moved] = state.todos.splice(from, 1);
      state.todos.splice(to, 0, moved);
      draggingId = null;
      save();
      render();
    });
  }

  /* ---------- 事件綁定 ---------- */

  function setupEvents() {
    el.quickForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = el.quickInput.value.trim();
      if (!raw) return;
      const parsed = parseQuick(raw);
      if (!parsed.title) { toast('請輸入待辦事項的內容。'); return; }
      addTodo(Object.assign({ done: false }, parsed));
      el.quickInput.value = '';
      el.quickInput.focus();
    });

    el.detailBtn.addEventListener('click', () => openDialog(null));

    el.filters.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip[data-filter]');
      if (!btn) return;
      prefs.filter = btn.dataset.filter;
      savePrefs();
      render();
    });

    el.searchInput.addEventListener('input', () => {
      query = el.searchInput.value;
      renderList();
    });

    el.categorySelect.addEventListener('change', () => {
      prefs.category = el.categorySelect.value;
      savePrefs();
      render();
    });

    el.sortSelect.addEventListener('change', () => {
      prefs.sort = el.sortSelect.value;
      savePrefs();
      render();
    });

    el.form.addEventListener('submit', submitDialog);
    el.cancelBtn.addEventListener('click', () => { editingId = null; el.dialog.close(); });
    el.dialog.addEventListener('close', () => { editingId = null; });

    el.themeBtn.addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      prefs.theme = dark ? 'light' : 'dark';
      savePrefs();
      applyTheme();
    });

    el.moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = el.morePanel.hidden;
      el.morePanel.hidden = !open;
      el.moreBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => {
      if (!el.morePanel.hidden) {
        el.morePanel.hidden = true;
        el.moreBtn.setAttribute('aria-expanded', 'false');
      }
    });

    el.exportBtn.addEventListener('click', exportJson);
    el.importBtn.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', () => {
      const file = el.importFile.files && el.importFile.files[0];
      if (file) importJson(file);
      el.importFile.value = '';
    });

    el.clearDoneBtn.addEventListener('click', () => {
      const ids = state.todos.filter((t) => t.done).map((t) => t.id);
      if (!ids.length) { toast('沒有已完成的項目。'); return; }
      removeTodos(ids, `已清除 ${ids.length} 個已完成項目。`);
    });

    el.clearAllBtn.addEventListener('click', () => {
      if (!state.todos.length) { toast('目前沒有資料。'); return; }
      if (!confirm('確定要刪除全部待辦事項嗎？建議先匯出備份。')) return;
      removeTodos(state.todos.map((t) => t.id), '已刪除全部項目。');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.morePanel.hidden) {
        el.morePanel.hidden = true;
        el.moreBtn.setAttribute('aria-expanded', 'false');
      }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || el.dialog.open;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); el.quickInput.focus(); }
      else if (e.key === '/') { e.preventDefault(); el.searchInput.focus(); }
      else if (e.key === 't' || e.key === 'T') { el.themeBtn.click(); }
    });

    // 換日時更新「今天／逾期」的顯示
    let lastDay = todayIso();
    setInterval(() => {
      const now = todayIso();
      if (now !== lastDay) { lastDay = now; render(); }
    }, 60000);

    // 多分頁同步
    window.addEventListener('storage', (e) => {
      if (e.key !== STORE_KEY) return;
      load();
      render();
    });
  }

  /* ---------- 啟動 ---------- */

  load();
  applyTheme();
  el.searchInput.value = '';
  setupEvents();
  setupDragAndDrop();
  render();
})();
