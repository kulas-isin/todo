/* =========================================================
   打勾勾 Pinky — 跟自己打勾勾，說到做到
   零依賴單頁應用，資料存在瀏覽器 localStorage
   ========================================================= */
(function () {
  'use strict';

  const STORE_KEY = 'pinky/v1';
  const PREF_KEY = 'pinky/prefs';
  const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };
  const PRIORITY_LABEL = { high: '高', normal: '中', low: '低' };
  const PRIORITY_ALIAS = {
    '高': 'high', 'high': 'high', 'h': 'high',
    '中': 'normal', 'normal': 'normal', 'n': 'normal',
    '低': 'low', 'low': 'low', 'l': 'low'
  };
  const PALETTES = ['cream', 'pastel', 'lime'];
  const GROUP_ORDER = ['overdue', 'today', 'tomorrow', 'week', 'later', 'someday', 'done'];
  const GROUP_LABEL = {
    overdue: '已逾期', today: '今天', tomorrow: '明天',
    week: '本週稍後', later: '之後', someday: '未排定', done: '已完成'
  };
  const CHEERS = ['約定達成', '說到做到', '又守住一個約定', '漂亮，繼續保持', '這一勾，值得'];
  const HEAT_WEEKS = 17;
  const VIEWS = ['today', 'list', 'trail'];
  const TONES = ['savage', 'coach', 'soft'];
  const TONE_LABEL = { savage: '毒舌', coach: '教練', soft: '溫柔' };
  const PAGES = ['all'].concat(GROUP_ORDER);
  const PAGE_SIZE = 20;

  let state = { todos: [], history: {} };
  let prefs = { view: 'today', page: 'all', category: '', sort: 'manual', theme: null, palette: 'cream', collapsed: ['done'], tone: 'savage', notify: { on: false, morning: '09:00', evening: '21:00' } };
  let pageIndex = 0;
  let query = '';
  let editingId = null;
  let backfillMode = false;
  let undoSnapshot = null;
  let toastTimer = null;
  let cheerIndex = 0;

  const $ = (s) => document.querySelector(s);
  const el = {};
  [
    'dateLine', 'greeting', 'heroSub', 'progPct', 'progHint', 'ringBar', 'ringLabel',
    'tAll', 'tToday', 'tOver', 'tDone', 'cats', 'groups', 'empty', 'tabs', 'pager',
    'nav', 'navDot', 'viewToday', 'viewList', 'viewTrail', 'todayList', 'todayEmpty',
    'streakNum', 'keepRate', 'totalDone', 'heatmap', 'trailRange',
    'quickForm', 'quickInput', 'detailBtn', 'searchInput', 'sortSelect',
    'paletteBtn', 'palettePanel', 'themeBtn', 'moreBtn', 'morePanel',
    'shareBtn', 'shareBtn2', 'exportBtn', 'importBtn', 'importFile', 'clearDoneBtn', 'clearAllBtn',
    'fabBtn', 'confetti', 'toast', 'toastText', 'toastAction', 'installBtn',
    'mascot', 'mascotSay', 'creditScore', 'limitFill', 'limitText', 'backfillBtn',
    'toneBtn', 'toneLabel', 'nagDialog', 'nagText', 'nagMain', 'nagAlt', 'notifyBtn', 'notifyLabel', 'testNagBtn',
    'editDialog', 'editForm', 'dialogTitle', 'fTitle', 'fNote', 'fDue', 'fCategory', 'categoryList',
    'cancelBtn', 'cancelBtn2', 'saveBtn',
    'shareDialog', 'shareCanvas', 'shareClose', 'shareCopy', 'shareSave'
  ].forEach((id) => { el[id] = document.getElementById(id); });

  /* ---------- 儲存 ---------- */

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        state.todos = Array.isArray(data.todos) ? data.todos.map(normalize).filter(Boolean) : [];
        state.history = data.history && typeof data.history === 'object' ? data.history : {};
        state.credit = data.credit && typeof data.credit.score === 'number' ? data.credit : null;
      }
    } catch (err) {
      console.warn('讀取資料失敗，改用空清單。', err);
    }
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) Object.assign(prefs, JSON.parse(raw));
    } catch (err) { /* 用預設值 */ }

    if (!PALETTES.includes(prefs.palette)) prefs.palette = 'cream';
    if (!VIEWS.includes(prefs.view)) prefs.view = 'today';
    if (!PAGES.includes(prefs.page)) prefs.page = 'all';
    if (!Array.isArray(prefs.collapsed)) prefs.collapsed = ['done'];
    if (!TONES.includes(prefs.tone)) prefs.tone = 'savage';
    if (!prefs.notify || typeof prefs.notify !== 'object') prefs.notify = { on: false, morning: '09:00', evening: '21:00' };
    if (!state.credit || typeof state.credit.score !== 'number') {
      state.credit = { score: 70, settledUntil: todayIso(), bankruptAsked: '' };
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 3, todos: state.todos, history: state.history, credit: state.credit }));
    } catch (err) {
      toast('儲存失敗，瀏覽器儲存空間可能已滿。');
      console.error(err);
    }
    writeNagState();
  }

  /* Service Worker 讀不到 localStorage，把罵人所需的狀態放進 Cache Storage */
  function writeNagState() {
    if (!('caches' in window)) return;
    const today = todayIso();
    const overdue = state.todos.filter((t) => !t.done && t.due && t.due < today).length;
    const todayDue = state.todos.filter((t) => !t.done && t.due === today).length;
    const n = overdue + todayDue;
    const pool = (LINES[prefs.tone] || LINES.savage);
    const lines = [];
    for (const ctx of ['notif_morning', 'notif_evening']) {
      for (const raw of (pool[ctx] || [])) lines.push(raw.split('{n}').join(String(n)));
    }
    const payload = { enabled: !!prefs.notify.on, overdue, todayDue, lines };
    caches.open('pinky-state')
      .then((c) => c.put('./nag-state.json', new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })))
      .catch(() => {});
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (err) { /* 忽略 */ }
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
      doneAt: Number(t.doneAt) || null,
      reschedules: Number(t.reschedules) || 0
    };
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 日期 ---------- */

  const toIso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const todayIso = () => toIso(new Date());

  function isIsoDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function fromIso(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function shiftIso(iso, days) {
    const d = fromIso(iso);
    d.setDate(d.getDate() + days);
    return toIso(d);
  }

  function daysFromToday(iso) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((fromIso(iso) - today) / 86400000);
  }

  function dueLabel(iso) {
    const diff = daysFromToday(iso);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '後天';
    if (diff === -1) return '昨天到期';
    if (diff < 0) return `逾期 ${-diff} 天`;
    if (diff <= 7) return `${diff} 天後`;
    return iso.slice(5).replace('-', '/');
  }

  /* ---------- 快速輸入語法 ---------- */

  function parseRelativeDate(token) {
    const t = token.trim();
    const shift = {
      '今天': 0, 'today': 0, '明天': 1, 'tomorrow': 1,
      '後天': 2, '后天': 2, '下週': 7, '下周': 7, '一週後': 7
    };
    const key = Object.prototype.hasOwnProperty.call(shift, t) ? t : t.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(shift, key)) return shiftIso(todayIso(), shift[key]);
    if (isIsoDate(t)) return t;
    const md = t.match(/^(\d{1,2})[-/](\d{1,2})$/);
    if (md) {
      const iso = `${new Date().getFullYear()}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
      return isIsoDate(iso) ? iso : '';
    }
    return '';
  }

  function parseQuick(raw) {
    const out = { title: '', note: '', priority: 'normal', category: '', due: '' };
    out.title = raw
      .replace(/(?:^|\s)!([^\s]+)/g, (m, p) => {
        const mapped = PRIORITY_ALIAS[p.toLowerCase()];
        if (!mapped) return m;
        out.priority = mapped;
        return ' ';
      })
      .replace(/(?:^|\s)#([^\s]+)/g, (m, c) => { out.category = c.slice(0, 30); return ' '; })
      .replace(/(?:^|\s)@([^\s]+)/g, (m, d) => {
        const iso = parseRelativeDate(d);
        if (!iso) return m;
        out.due = iso;
        return ' ';
      })
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 200);
    return out;
  }

  /* ---------- 信用系統 ---------- */

  function creditLimit(score) {
    if (score >= 85) return 18;
    if (score >= 70) return 12;
    if (score >= 55) return 8;
    if (score >= 40) return 5;
    return 3;
  }

  function activeCount() {
    return state.todos.filter((t) => !t.done).length;
  }

  function applyCredit(delta) {
    state.credit.score = Math.max(0, Math.min(100, state.credit.score + delta));
  }

  /* 逾期是負債：每過一天，依逾期件數扣分（單日上限 3 分） */
  function settleCredit() {
    const today = todayIso();
    let cursor = state.credit.settledUntil || today;
    if (cursor >= today) { state.credit.settledUntil = today; return; }
    let days = 0;
    while (cursor < today && days < 30) { cursor = shiftIso(cursor, 1); days++; }
    const overdue = state.todos.filter((t) => !t.done && t.due && t.due < today).length;
    if (overdue > 0 && days > 0) applyCredit(-Math.min(3, overdue) * days);
    state.credit.settledUntil = today;
    save();
  }

  function moodFor(score) {
    if (score >= 85) return 'proud';
    if (score >= 60) return 'normal';
    if (score >= 40) return 'squint';
    return 'angry';
  }

  /* ---------- 勾勾的語氣引擎：每句話都引用本人的帳 ---------- */

  const LINES = {
    savage: {
      greet_clean: [
        '喲，帳面乾淨。難得。',
        '今天還沒欠債。保持，別讓我開口。',
        '零逾期。今天的你我還算看得順眼。',
        '帳上沒事。別高興太早，晚點我再來看。',
        '乾淨的清單。希望不是因為你什麼都沒排。'
      ],
      greet_over: [
        '{n} 筆呆帳掛著。裝死不會讓它消失。',
        '逾期 {n} 件。你的小指記得，你倒是忘了。',
        '帳單在這，{n} 筆逾期。先還債再許願。',
        '那 {n} 件事不會自己完成。我等著，它們也等著。',
        '{n} 筆逾期。要我唸出來給你聽嗎？',
        '你知道嗎，利息每天都在扣。{n} 件，現在去處理。'
      ],
      greet_todaydue: [
        '今天 {n} 件到期。話是你自己說的。',
        '{n} 個約定今天到期。我看著。',
        '今天的份：{n} 件。太陽下山前搞定。',
        '{n} 件今天到期。別讓它們變成明天的呆帳。'
      ],
      add_over: [
        '超貸了。你的信用只撐 {limit} 件，這是第 {count} 件。先扣 3 分。',
        '又借？額度 {limit} 件早就滿了。−3 分，記帳。',
        '第 {count} 件。你的額度是 {limit}。你在寫許願池嗎？−3。',
        '收下了，但這是超貸。做不完的清單叫負債，不叫計畫。−3。'
      ],
      add_debt: [
        '又許願。你上一筆呆帳「{title}」躺 {days} 天了。',
        '先還舊債再開新票，這道理要我教？「{title}」等你 {days} 天了。',
        '新的來了，舊的呢？「{title}」，{days} 天，你自己看。',
        '可以。但「{title}」已經臭了 {days} 天，先聞一下。'
      ],
      resched: [
        '「{title}」改期第 {n} 次。我都幫你數著。',
        '延到 {due}。這句話你上次也說過。',
        '第 {n} 次了。日曆不是許願池。',
        '好，{due}。我把你上次說的日期劃掉了，這是第 {n} 條劃痕。'
      ],
      done_ontime: [
        '說到做到，+{pts}。算你行。',
        '準時。這才叫約定。+{pts}。',
        '勾下去的聲音真好聽。+{pts}。',
        '有欠有還，+{pts}。繼續。',
        '這勾打得漂亮。+{pts}。',
        '看吧，做得到嘛。+{pts}。'
      ],
      done_late: [
        '遲到總比賴帳好。+1，下次準時。',
        '晚了，但清了。+1。別讓我習慣等你。',
        '補交作業。+1。準時的話是 2 分，自己算。'
      ],
      backfill: [
        '有做就記，這才像帳。+1。',
        '沒列在單上也做了？行，記上。+1。',
        '偷偷做事不留紀錄，虧的是你自己的守約率。+1。',
        '這筆入帳。做了就該算數。+1。'
      ],
      abandon: [
        '承認不會做，扣得少。這叫誠實。',
        '放掉了。比拖著爛掉體面。',
        '好，這筆銷帳。誠實面對比較不痛，對吧。'
      ],
      allclear: [
        '今天的帳清了。你今天配得上這個名字。',
        '全勾完。少見，多來幾次。',
        '帳面歸零。今天的你，我沒話講。',
        '清空了。好好休息，明天繼續打勾。'
      ],
      notif_morning: [
        '早。今天 {n} 件等著，先別滑手機。',
        '起床了就來對帳：{n} 件掛著。',
        '早安。你的約定比你先醒，{n} 件。',
        '新的一天，舊的債。{n} 件，開工。',
        '鬧鐘響第二次了吧。{n} 件事在等，去。'
      ],
      notif_evening: [
        '今天還剩 {n} 件沒勾。睡前想清楚怎麼交代。',
        '晚上好。{n} 筆帳還開著，要帶進夢裡嗎？',
        '一天要結束了，{n} 件沒動。明天的你會罵今天的你。',
        '還有 {n} 件。現在做一件，都比明天做兩件划算。',
        '睡前結帳：{n} 件未清。你知道該怎麼做。'
      ]
    },
    coach: {
      greet_clean: ['帳面乾淨，今天照計畫走。', '沒有逾期，狀態不錯。', '零負債開局，保持節奏。'],
      greet_over: ['有 {n} 件逾期，先處理它們再開新的。', '{n} 筆逾期在累積利息，優先清掉。', '先清 {n} 件舊帳，今天會順很多。'],
      greet_todaydue: ['今天 {n} 件到期，逐一擊破。', '{n} 件今日到期，從最難的開始。'],
      add_over: ['超過額度了（{limit} 件）。建議先完成或放棄舊項目。−3 分。', '第 {count} 件超出負荷，清單短一點反而做得完。−3。'],
      add_debt: ['提醒：「{title}」已擱置 {days} 天，先處理它更好。', '新任務收到。「{title}」等了 {days} 天，別忘了它。'],
      resched: ['「{title}」第 {n} 次改期。想一下是不是拆小一點。', '延到 {due}。第 {n} 次了，考慮調整範圍。'],
      done_ontime: ['準時完成，+{pts}。', '如期達成，+{pts}。這就是節奏。'],
      done_late: ['補上了，+1。下次抓前一點的時間。'],
      backfill: ['已補記，+1。有做的事都該被算進來。', '入帳，+1。紀錄完整才看得見真實產出。'],
      abandon: ['放棄也是決策。清單乾淨了。'],
      allclear: ['今日全數達成，漂亮。', '今天結清，明天見。'],
      notif_morning: ['早安，今天 {n} 件。先挑一件最重要的開始。', '開工提醒：{n} 件待處理。'],
      notif_evening: ['今天還有 {n} 件未完成。收個尾或誠實改期。', '睡前檢查：{n} 件未勾。']
    },
    soft: {
      greet_clean: ['今天沒有欠著的事，安心開始吧。', '帳面乾乾淨淨，today is a good day。'],
      greet_over: ['有 {n} 件過期的小約定在等你，慢慢來。', '{n} 件事等久了，挑一件開始就好。'],
      greet_todaydue: ['今天有 {n} 件到期，一件一件來就好。'],
      add_over: ['手上的約定有點多了（額度 {limit} 件），要不要先收個尾？'],
      add_debt: ['「{title}」等你 {days} 天了，別忘了它。'],
      resched: ['「{title}」再延一次沒關係，記得回來。'],
      done_ontime: ['做到了，+{pts}，給自己一點掌聲。', '完成了呢，+{pts}。'],
      done_late: ['雖然晚了，還是做完了，+1。'],
      backfill: ['把做過的事記下來，+1。'],
      abandon: ['放下也是一種整理。'],
      allclear: ['今天的約定都完成了，好好休息。'],
      notif_morning: ['早安，今天有 {n} 件小約定，加油。'],
      notif_evening: ['還有 {n} 件沒完成，做一件也很棒。']
    }
  };

  let lineSeed = 0;
  function say(context, vars) {
    const pool = (LINES[prefs.tone] || LINES.savage)[context] || LINES.savage[context] || [''];
    let line = pool[lineSeed++ % pool.length];
    for (const [k, v] of Object.entries(vars || {})) line = line.split('{' + k + '}').join(String(v));
    return line;
  }

  function renderCredit() {
    const score = state.credit.score;
    const limit = creditLimit(score);
    const active = activeCount();
    el.creditScore.textContent = score;
    el.mascot.dataset.mood = moodFor(score);
    el.limitText.textContent = '進行中 ' + active + '／額度 ' + limit;
    el.limitFill.style.width = Math.min(100, Math.round((active / limit) * 100)) + '%';
    el.limitFill.classList.toggle('is-over', active > limit);

    const today = todayIso();
    const overN = state.todos.filter((t) => !t.done && t.due && t.due < today).length;
    const todayDue = state.todos.filter((t) => !t.done && t.due === today).length;
    const doneToday = state.todos.some((t) => t.done && t.doneAt && toIso(new Date(t.doneAt)) === today);
    if (overN) el.mascotSay.textContent = say('greet_over', { n: overN });
    else if (todayDue) el.mascotSay.textContent = say('greet_todaydue', { n: todayDue });
    else if (doneToday) el.mascotSay.textContent = say('allclear');
    else el.mascotSay.textContent = say('greet_clean');
  }

  function oldestDebt() {
    const today = todayIso();
    const over = state.todos.filter((t) => !t.done && t.due && t.due < today)
      .sort((a, b) => (a.due < b.due ? -1 : 1));
    return over[0] || null;
  }

  /* ---------- 追討對話框 ---------- */

  let nagHandlers = null;
  function openNag(text, mainLabel, altLabel, onMain, onAlt) {
    el.nagText.textContent = text;
    el.nagMain.textContent = mainLabel;
    el.nagAlt.textContent = altLabel;
    nagHandlers = { onMain, onAlt };
    el.nagDialog.showModal();
  }

  /* 分數見底：破產重整——留最急的 3 件，其餘放棄（可復原） */
  function maybeBankrupt() {
    const today = todayIso();
    if (state.credit.score >= 20) return;
    if (state.credit.bankruptAsked === today) return;
    const active = state.todos.filter((t) => !t.done);
    if (active.length <= 3) return;
    state.credit.bankruptAsked = today;
    save();
    const keepN = 3;
    openNag(
      '信用見底（' + state.credit.score + ' 分）。重整方案：留最急的 ' + keepN + ' 件，其餘 ' + (active.length - keepN) + ' 件放棄（可復原），分數重設為 50。簽吧。',
      '接受重整', '再撐一天',
      () => {
        const sorted = active.slice().sort((a, b) => {
          const ad = a.due || '9999-99-99', bd = b.due || '9999-99-99';
          return ad < bd ? -1 : ad > bd ? 1 : 0;
        });
        const keep = new Set(sorted.slice(0, keepN).map((t) => t.id));
        const dropIds = active.filter((t) => !keep.has(t.id)).map((t) => t.id);
        state.credit.score = 50;
        removeTodos(dropIds, '破產重整完成：放棄 ' + dropIds.length + ' 件，留 ' + keepN + ' 件。');
      },
      () => {}
    );
  }

  /* ---------- 足跡紀錄 ---------- */

  function bumpHistory(todo, delta) {
    const day = todayIso();
    const h = state.history[day] || { done: 0, withDue: 0, onTime: 0 };
    h.done = Math.max(0, h.done + delta);
    if (todo.due) {
      h.withDue = Math.max(0, h.withDue + delta);
      if (day <= todo.due) h.onTime = Math.max(0, h.onTime + delta);
    }
    if (h.done === 0 && h.withDue === 0) delete state.history[day];
    else state.history[day] = h;
  }

  function trailStats() {
    let total = 0, withDue = 0, onTime = 0;
    for (const k of Object.keys(state.history)) {
      const h = state.history[k];
      total += h.done || 0;
      withDue += h.withDue || 0;
      onTime += h.onTime || 0;
    }
    let streak = 0;
    let cursor = todayIso();
    if (!(state.history[cursor] && state.history[cursor].done > 0)) cursor = shiftIso(cursor, -1);
    while (state.history[cursor] && state.history[cursor].done > 0) {
      streak++;
      cursor = shiftIso(cursor, -1);
    }
    return { total, withDue, onTime, streak, rate: withDue ? Math.round((onTime / withDue) * 100) : null };
  }

  /* ---------- 資料操作 ---------- */

  function addTodo(fields) {
    const todo = normalize(Object.assign({ createdAt: Date.now() }, fields));
    if (!todo || !todo.title) return null;
    const wasActive = activeCount();
    const limit = creditLimit(state.credit.score);
    state.todos.unshift(todo);
    if (prefs.page === 'done') { prefs.page = 'all'; savePrefs(); }

    if (!todo.done) {
      if (wasActive >= limit) {
        applyCredit(-3);
        toast(say('add_over', { limit, count: wasActive + 1 }));
      } else {
        const debt = oldestDebt();
        if (debt && debt.id !== todo.id) {
          toast(say('add_debt', { title: debt.title.slice(0, 12), days: -daysFromToday(debt.due) }));
        }
      }
    }
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
    bumpHistory(t, t.done ? 1 : -1);
    const today = todayIso();
    const onTime = t.due && today <= t.due;
    const pts = t.due ? (onTime ? 2 : 1) : 1;
    applyCredit(t.done ? pts : -pts);
    save();

    if (t.done) {
      const node = document.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
      if (node) {
        node.classList.add('just-done');
        const r = node.getBoundingClientRect();
        celebrate(r.left + 40, r.top + r.height / 2, allTodayCleared() ? 120 : 34);
      }
      toast(onTime || !t.due ? say('done_ontime', { pts }) : say('done_late'));
      setTimeout(render, 260);
    } else {
      render();
    }
  }

  function allTodayCleared() {
    const today = todayIso();
    const due = state.todos.filter((t) => t.due === today);
    return due.length > 0 && due.every((t) => t.done);
  }

  function removeTodos(ids, message) {
    const set = new Set(ids);
    if (!set.size) return;
    undoSnapshot = { todos: state.todos.slice(), history: JSON.parse(JSON.stringify(state.history)) };
    state.todos = state.todos.filter((t) => !set.has(t.id));
    save();
    render();
    toast(message, '復原', () => {
      if (!undoSnapshot) return;
      state.todos = undoSnapshot.todos;
      state.history = undoSnapshot.history;
      undoSnapshot = null;
      save();
      render();
      toast('已復原。');
    });
  }

  /* ---------- 篩選與分組 ---------- */

  function visibleTodos() {
    const today = todayIso();
    const q = query.trim().toLowerCase();
    let list = state.todos.filter((t) => {
      if (prefs.page !== 'all' && groupOf(t) !== prefs.page) return false;
      if (prefs.category && t.category !== prefs.category) return false;
      if (q && !`${t.title} ${t.note} ${t.category}`.toLowerCase().includes(q)) return false;
      return true;
    });

    if (prefs.sort !== 'manual') {
      list = list.slice().sort((a, b) => {
        if (prefs.sort === 'due') {
          if (!a.due && !b.due) return b.createdAt - a.createdAt;
          if (!a.due) return 1;
          if (!b.due) return -1;
          if (a.due !== b.due) return a.due < b.due ? -1 : 1;
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        }
        if (prefs.sort === 'priority') {
          const d = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
          return d !== 0 ? d : b.createdAt - a.createdAt;
        }
        return b.createdAt - a.createdAt;
      });
    }
    return list;
  }

  function groupOf(t) {
    if (t.done) return 'done';
    if (!t.due) return 'someday';
    const d = daysFromToday(t.due);
    if (d < 0) return 'overdue';
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    if (d <= 7) return 'week';
    return 'later';
  }

  /* ---------- 繪製 ---------- */

  function render() {
    applyView();
    renderCredit();
    renderHero();
    renderProgress();
    renderTiles();
    renderTodayList();
    renderCategories();
    renderTabs();
    renderList();
    renderTrail();
    el.sortSelect.value = prefs.sort;
  }

  function applyView() {
    el.viewToday.hidden = prefs.view !== 'today';
    el.viewList.hidden = prefs.view !== 'list';
    el.viewTrail.hidden = prefs.view !== 'trail';
    el.nav.querySelectorAll('.nav__btn').forEach((b) => {
      const on = b.dataset.view === prefs.view;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    const today = todayIso();
    el.navDot.hidden = state.todos.filter((t) => !t.done && t.due && t.due <= today).length === 0;
  }

  function goto(view, page) {
    prefs.view = view;
    if (page) prefs.page = page;
    pageIndex = 0;
    savePrefs();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* 今天頁只顯示逾期與今天 */
  function renderTodayList() {
    const today = todayIso();
    const items = state.todos.filter((t) => !t.done && t.due && t.due <= today);
    el.todayList.textContent = '';
    if (!items.length) {
      el.todayEmpty.hidden = false;
      el.todayEmpty.textContent = '';
      const mark = document.createElement('strong');
      mark.appendChild(icon(state.todos.length ? '#i-sparkles' : '#i-inbox'));
      el.todayEmpty.appendChild(mark);
      el.todayEmpty.append(state.todos.length ? '今天沒有待辦的約定，輕鬆一下。' : '還沒有任何約定，從上面寫下第一個吧。');
      return;
    }
    el.todayEmpty.hidden = true;
    const buckets = new Map();
    for (const t of items) {
      const g = groupOf(t);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(t);
    }
    const frag = document.createDocumentFragment();
    for (const key of ['overdue', 'today']) {
      const list = buckets.get(key);
      if (list && list.length) frag.appendChild(buildGroup(key, list));
    }
    el.todayList.appendChild(frag);
  }

  /* 清單頁的日期分頁列 */
  function renderTabs() {
    const q = query.trim().toLowerCase();
    const scope = state.todos.filter((t) => {
      if (prefs.category && t.category !== prefs.category) return false;
      if (q && !`${t.title} ${t.note} ${t.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const counts = {};
    for (const t of scope) {
      const g = groupOf(t);
      counts[g] = (counts[g] || 0) + 1;
    }
    if (prefs.page !== 'all' && !counts[prefs.page]) { prefs.page = 'all'; savePrefs(); }

    el.tabs.textContent = '';
    el.tabs.appendChild(tabBtn('all', '全部', scope.length));
    for (const key of GROUP_ORDER) {
      if (counts[key]) el.tabs.appendChild(tabBtn(key, GROUP_LABEL[key], counts[key]));
    }
  }

  function tabBtn(page, label, count) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tab tab--${page}` + (prefs.page === page ? ' is-on' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(prefs.page === page));
    b.append(label);
    const n = document.createElement('span');
    n.className = 'tab__n';
    n.textContent = count;
    b.appendChild(n);
    b.addEventListener('click', () => {
      prefs.page = page;
      pageIndex = 0;
      savePrefs();
      render();
    });
    return b;
  }

  function renderPager(total) {
    const pages = Math.ceil(total / PAGE_SIZE);
    el.pager.textContent = '';
    if (pages <= 1) { el.pager.hidden = true; return; }
    el.pager.hidden = false;

    const step = (delta, label, cls, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.disabled = disabled;
      if (cls === 'prev') b.appendChild(icon('#i-chevron'));
      b.append(label);
      if (cls === 'next') b.appendChild(icon('#i-chevron'));
      b.addEventListener('click', () => {
        pageIndex = Math.min(Math.max(0, pageIndex + delta), pages - 1);
        render();
        el.tabs.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return b;
    };
    const at = document.createElement('span');
    at.className = 'pager__at';
    at.textContent = `${pageIndex + 1} / ${pages}`;
    el.pager.append(step(-1, '上一頁', 'prev', pageIndex === 0), at, step(1, '下一頁', 'next', pageIndex >= pages - 1));
  }

  function renderHero() {
    const now = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    el.dateLine.textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${week}`;

    const h = now.getHours();
    el.greeting.textContent = h < 5 ? '夜深了' : h < 11 ? '早安' : h < 14 ? '午安' : h < 18 ? '午後好' : '晚安';

    const today = todayIso();
    const left = state.todos.filter((t) => !t.done && t.due && t.due <= today).length;
    const active = state.todos.filter((t) => !t.done).length;
    el.heroSub.textContent = '';
    if (!state.todos.length) {
      el.heroSub.textContent = '寫下第一個跟自己的約定吧。';
    } else if (left > 0) {
      el.heroSub.append('今天還有 ', bold(left), ' 個約定等你打勾。');
    } else if (active > 0) {
      el.heroSub.append('今天的約定都完成了，還有 ', bold(active), ' 個排在後面。');
    } else {
      el.heroSub.textContent = '清單全空，難得的輕鬆一天。';
    }
  }

  function bold(text) {
    const b = document.createElement('b');
    b.textContent = String(text);
    return b;
  }

  function renderProgress() {
    const today = todayIso();
    const scope = state.todos.filter((t) => (t.due && t.due <= today) || (t.done && t.doneAt && toIso(new Date(t.doneAt)) === today));
    const done = scope.filter((t) => t.done).length;
    const total = scope.length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    el.progPct.textContent = pct;
    el.ringLabel.textContent = `${done}/${total}`;
    el.ringBar.style.strokeDashoffset = String(314.16 * (1 - (total ? done / total : 0)));
    el.progHint.textContent = !total
      ? '今天還沒有排定的約定'
      : done === total ? '今天的約定全部達成！' : `還差 ${total - done} 個就完成今天`;
  }

  function renderTiles() {
    const today = todayIso();
    let all = 0, todayN = 0, over = 0, done = 0;
    for (const t of state.todos) {
      if (t.done) { done++; continue; }
      all++;
      if (t.due === today) todayN++;
      else if (t.due && t.due < today) over++;
    }
    el.tAll.textContent = all;
    el.tToday.textContent = todayN;
    el.tOver.textContent = over;
    el.tDone.textContent = done;

    document.querySelectorAll('.tile').forEach((btn) => {
      btn.classList.toggle('is-on', prefs.view === 'list' && btn.dataset.page === prefs.page);
    });
  }

  function renderCategories() {
    const cats = [...new Set(state.todos.map((t) => t.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    if (prefs.category && !cats.includes(prefs.category)) prefs.category = '';

    el.cats.textContent = '';
    el.categoryList.textContent = '';
    if (!cats.length) return;

    el.cats.appendChild(catChip('全部分類', ''));
    for (const c of cats) {
      el.cats.appendChild(catChip(c, c));
      const opt = document.createElement('option');
      opt.value = c;
      el.categoryList.appendChild(opt);
    }
  }

  function catChip(label, value) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat' + (prefs.category === value ? ' is-on' : '');
    b.textContent = label;
    b.setAttribute('aria-pressed', String(prefs.category === value));
    b.addEventListener('click', () => {
      prefs.category = prefs.category === value ? '' : value;
      pageIndex = 0;
      savePrefs();
      render();
    });
    return b;
  }

  function renderList() {
    const all = visibleTodos();
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    if (pageIndex > pages - 1) pageIndex = pages - 1;
    const items = all.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);
    renderPager(all.length);
    el.groups.textContent = '';

    if (!items.length) {
      el.empty.hidden = false;
      el.empty.textContent = '';
      const mark = document.createElement('strong');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ico');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', state.todos.length ? '#i-search' : '#i-inbox');
      svg.appendChild(use);
      mark.appendChild(svg);
      el.empty.appendChild(mark);
      el.empty.append(state.todos.length ? '這個條件下沒有項目。' : '還沒有任何約定，從上面寫下第一個吧。');
      return;
    }
    el.empty.hidden = true;

    const buckets = new Map();
    for (const t of items) {
      const g = groupOf(t);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(t);
    }

    const frag = document.createDocumentFragment();
    if (prefs.page !== 'all') {
      // 已由分頁列指明是哪一組，不再重複標題
      const ul = document.createElement('ul');
      ul.className = 'list';
      items.forEach((t, i) => {
        const li = buildTask(t);
        li.style.animationDelay = `${Math.min(i, 8) * 25}ms`;
        ul.appendChild(li);
      });
      frag.appendChild(ul);
    } else {
      for (const key of GROUP_ORDER) {
        const list = buckets.get(key);
        if (!list || !list.length) continue;
        frag.appendChild(buildGroup(key, list));
      }
    }
    el.groups.appendChild(frag);
  }

  function buildGroup(key, items) {
    const collapsed = prefs.collapsed.includes(key);
    const sec = document.createElement('section');
    sec.className = `group group--${key}${collapsed ? ' is-collapsed' : ''}`;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'group__head';
    head.setAttribute('aria-expanded', String(!collapsed));

    const title = document.createElement('span');
    title.className = 'group__title';
    title.textContent = GROUP_LABEL[key];
    const count = document.createElement('span');
    count.className = 'group__count';
    count.textContent = items.length;

    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('class', 'ico');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-chevron');
    chev.appendChild(use);

    head.append(title, count, chev);
    head.addEventListener('click', () => {
      const i = prefs.collapsed.indexOf(key);
      if (i >= 0) prefs.collapsed.splice(i, 1);
      else prefs.collapsed.push(key);
      savePrefs();
      render();
    });

    const ul = document.createElement('ul');
    ul.className = 'list';
    items.forEach((t, i) => {
      const li = buildTask(t);
      li.style.animationDelay = `${Math.min(i, 8) * 25}ms`;
      ul.appendChild(li);
    });

    sec.append(head, ul);
    return sec;
  }

  function buildTask(t) {
    const li = document.createElement('li');
    li.className = `task task--${t.priority}${t.done ? ' is-done' : ''}`;
    li.dataset.id = t.id;
    if (prefs.sort === 'manual') li.draggable = true;

    const zone = document.createElement('div');
    zone.className = 'task__zone';
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'task__check';
    check.setAttribute('aria-pressed', String(t.done));
    check.setAttribute('aria-label', `${t.done ? '取消完成' : '完成'}「${t.title}」`);
    check.appendChild(icon('#i-check'));
    check.addEventListener('click', () => toggleDone(t.id));
    zone.appendChild(check);

    const body = document.createElement('div');
    body.className = 'task__body';
    const title = document.createElement('p');
    title.className = 'task__title';
    title.textContent = t.title;
    body.appendChild(title);

    if (t.note) {
      const note = document.createElement('p');
      note.className = 'task__note';
      note.textContent = t.note;
      body.appendChild(note);
    }

    const meta = document.createElement('div');
    meta.className = 'task__meta';
    const today = todayIso();
    if (t.due) {
      const over = !t.done && t.due < today;
      const isToday = !t.done && t.due === today;
      meta.appendChild(pill(dueLabel(t.due), over ? 'pill--over' : isToday ? 'pill--today' : 'pill--due',
        over ? '#i-alarm' : '#i-clock'));
    }
    if (t.priority !== 'normal') {
      meta.appendChild(pill(PRIORITY_LABEL[t.priority], t.priority === 'high' ? 'pill--high' : 'pill--low', '#i-flag'));
    }
    if (t.category) meta.appendChild(pill(t.category, '', '#i-tag'));
    if (meta.children.length) body.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'task__actions';
    if (prefs.sort === 'manual') {
      const grip = actionBtn('#i-grip', '拖曳排序', null);
      grip.classList.add('task__drag');
      actions.appendChild(grip);
    }
    actions.appendChild(actionBtn('#i-edit', `編輯「${t.title}」`, () => openDialog(t.id)));
    const del = actionBtn('#i-trash', `刪除「${t.title}」`, () => removeTodos([t.id], '已刪除 1 個項目。'));
    del.classList.add('act-del');
    actions.appendChild(del);

    li.append(zone, body, actions);
    return li;
  }

  function icon(href) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', href);
    svg.appendChild(use);
    return svg;
  }

  function pill(text, cls, iconHref) {
    const s = document.createElement('span');
    s.className = 'pill' + (cls ? ' ' + cls : '');
    if (iconHref) s.appendChild(icon(iconHref));
    s.append(text);
    return s;
  }

  function actionBtn(href, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(icon(href));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  /* ---------- 足跡面板 ---------- */

  function renderTrail() {
    const s = trailStats();
    el.streakNum.textContent = s.streak;
    el.keepRate.textContent = s.rate === null ? '—' : s.rate + '%';
    el.totalDone.textContent = s.total;

    const today = todayIso();
    let start = shiftIso(today, -(HEAT_WEEKS * 7 - 1));
    start = shiftIso(start, -fromIso(start).getDay());

    el.heatmap.textContent = '';
    const frag = document.createDocumentFragment();
    let cursor = start;
    while (cursor <= today) {
      const n = (state.history[cursor] && state.history[cursor].done) || 0;
      const cell = document.createElement('i');
      cell.dataset.lv = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 7 ? 3 : 4;
      cell.title = `${cursor}　完成 ${n} 件`;
      if (cursor === today) cell.classList.add('is-today');
      frag.appendChild(cell);
      cursor = shiftIso(cursor, 1);
    }
    el.heatmap.appendChild(frag);
    el.trailRange.textContent = `近 ${HEAT_WEEKS} 週`;
    el.heatmap.scrollLeft = el.heatmap.scrollWidth;
  }

  /* ---------- 慶祝彩帶 ---------- */

  function celebrate(x, y, count) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = el.confetti;
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.width = window.innerWidth * dpr;
    cv.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(document.documentElement);
    const colors = ['--brand', '--accent', '--ok', '--danger'].map((v) => css.getPropertyValue(v).trim() || '#888');

    const parts = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 7;
      parts.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 3,
        w: 5 + Math.random() * 6,
        h: 3 + Math.random() * 5,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - .5) * .3,
        color: colors[i % colors.length],
        life: 1
      });
    }

    cv.classList.add('is-on');
    let raf;
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      let alive = false;
      for (const p of parts) {
        p.vy += .22;
        p.vx *= .995;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= .012;
        if (p.life <= 0) continue;
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(tick);
      else {
        cancelAnimationFrame(raf);
        cv.classList.remove('is-on');
        ctx.clearRect(0, 0, cv.width, cv.height);
      }
    };
    tick();
  }

  /* ---------- 今日成果卡 ---------- */

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawShareCard() {
    const cv = el.shareCanvas;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
    const font = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif';

    const today = todayIso();
    const doneToday = state.todos
      .filter((t) => t.done && t.doneAt && toIso(new Date(t.doneAt)) === today)
      .sort((a, b) => a.doneAt - b.doneAt);
    const s = trailStats();

    // 背景漸層
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, v('--hero-1', '#4f9db8'));
    bg.addColorStop(1, v('--hero-2', '#86c8d6'));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = .12;
    ctx.fillStyle = v('--on-hero', '#fff');
    ctx.beginPath();
    ctx.arc(W - 60, 120, 260, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(90, H - 90, 190, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 卡片
    const pad = 70;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.18)';
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = v('--surface', '#fff');
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 56);
    ctx.fill();
    ctx.restore();

    const x0 = pad + 66;
    const text = v('--text', '#21454e');
    const dim = v('--dim', '#7c99a2');
    const brand = v('--brand', '#4f9db8');

    // 品牌
    ctx.fillStyle = brand;
    roundRect(ctx, x0, pad + 66, 62, 62, 20);
    ctx.fill();
    ctx.strokeStyle = v('--on-brand', '#fff');
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0 + 17, pad + 98);
    ctx.lineTo(x0 + 27, pad + 108);
    ctx.lineTo(x0 + 45, pad + 86);
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = `800 34px ${font}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('打勾勾', x0 + 82, pad + 98);

    const now = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    ctx.fillStyle = dim;
    ctx.font = `600 25px ${font}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${week}`, W - pad - 66, pad + 98);
    ctx.textAlign = 'left';

    // 主數字
    ctx.fillStyle = dim;
    ctx.font = `600 30px ${font}`;
    ctx.fillText('今天達成的約定', x0, pad + 210);

    ctx.fillStyle = text;
    ctx.font = `800 150px ${font}`;
    const numText = String(doneToday.length);
    ctx.fillText(numText, x0, pad + 320);
    const numW = ctx.measureText(numText).width;
    ctx.fillStyle = dim;
    ctx.font = `700 40px ${font}`;
    ctx.fillText('件', x0 + numW + 16, pad + 350);

    // 進度環
    const cx = W - pad - 150, cy = pad + 300, r = 82;
    const scope = state.todos.filter((t) => (t.due && t.due <= today) || (t.done && t.doneAt && toIso(new Date(t.doneAt)) === today));
    const ratio = scope.length ? scope.filter((t) => t.done).length / scope.length : 0;
    ctx.lineWidth = 20;
    ctx.strokeStyle = v('--surface-2', '#eee');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (ratio > 0) {
      ctx.strokeStyle = brand;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.stroke();
    }
    ctx.fillStyle = text;
    ctx.font = `800 38px ${font}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(ratio * 100)}%`, cx, cy + 2);
    ctx.textAlign = 'left';

    // 清單
    let y = pad + 430;
    ctx.strokeStyle = v('--line', 'rgba(0,0,0,.08)');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(W - pad - 66, y);
    ctx.stroke();
    y += 62;

    const shown = doneToday.slice(0, 6);
    if (!shown.length) {
      ctx.fillStyle = dim;
      ctx.font = `500 30px ${font}`;
      ctx.fillText('今天還沒有打勾的項目，明天再約定一次。', x0, y);
    }
    for (const t of shown) {
      ctx.fillStyle = v('--ok', '#4bab86');
      ctx.beginPath();
      ctx.arc(x0 + 17, y - 9, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = v('--surface', '#fff');
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(x0 + 9, y - 9);
      ctx.lineTo(x0 + 15, y - 3);
      ctx.lineTo(x0 + 26, y - 16);
      ctx.stroke();

      ctx.fillStyle = text;
      ctx.font = `600 31px ${font}`;
      let label = t.title;
      const maxW = W - pad * 2 - 200;
      while (ctx.measureText(label).width > maxW && label.length > 2) label = label.slice(0, -1);
      if (label !== t.title) label += '…';
      ctx.fillText(label, x0 + 52, y);
      y += 62;
    }
    if (doneToday.length > shown.length) {
      ctx.fillStyle = dim;
      ctx.font = `500 28px ${font}`;
      ctx.fillText(`還有 ${doneToday.length - shown.length} 件…`, x0 + 52, y);
    }

    // 底部數據
    const by = H - pad - 150;
    ctx.fillStyle = v('--surface-2', '#f5f5f5');
    roundRect(ctx, x0, by - 52, W - pad * 2 - 132, 108, 34);
    ctx.fill();

    const cellW = (W - pad * 2 - 132) / 3;
    const stats = [
      [String(s.streak), '連續達成（天）'],
      [s.rate === null ? '—' : s.rate + '%', '守約率'],
      [String(s.total), '累計完成']
    ];
    ctx.textAlign = 'center';
    stats.forEach((pair, i) => {
      const px = x0 + cellW * i + cellW / 2;
      ctx.fillStyle = text;
      ctx.font = `800 40px ${font}`;
      ctx.fillText(pair[0], px, by - 6);
      ctx.fillStyle = dim;
      ctx.font = `500 22px ${font}`;
      ctx.fillText(pair[1], px, by + 32);
    });

    ctx.fillStyle = dim;
    ctx.font = `600 25px ${font}`;
    ctx.fillText('跟自己打勾勾，說到做到', W / 2, H - pad - 40);
    ctx.textAlign = 'left';
  }

  function openShare() {
    drawShareCard();
    el.shareDialog.showModal();
  }

  function saveShare() {
    el.shareCanvas.toBlob((blob) => {
      if (!blob) { toast('產生圖片失敗。'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pinky-${todayIso()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  async function copyShare() {
    if (!(navigator.clipboard && window.ClipboardItem)) {
      toast('這個瀏覽器不支援複製圖片，請改用下載。');
      return;
    }
    try {
      // Safari 會在 await 之後判定使用者手勢已過期，因此直接把 Promise 交給 ClipboardItem
      const blob = new Promise((res) => el.shareCanvas.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('已複製圖片到剪貼簿。');
    } catch (err) {
      toast('複製失敗，請改用下載。');
    }
  }

  /* ---------- 推播罵人（無後端版）----------
     真推播需要伺服器；這裡做三層：
     1. 頁面開著（含背景分頁）時，早晚各追討一次
     2. Android 裝到主畫面後，periodicSync 背景喚醒（盡力而為）
     3. 每次打開 App 補追一次當天還沒發的  */

  const NOTIFIED_KEY = 'pinky/notified';

  function notifiedToday() {
    try {
      const d = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '{}');
      return d.date === todayIso() ? d.keys || [] : [];
    } catch (err) { return []; }
  }

  function markNotified(key) {
    const keys = notifiedToday();
    keys.push(key);
    try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify({ date: todayIso(), keys })); } catch (err) { /* 忽略 */ }
  }

  function showNag(body) {
    const opts = { body, icon: 'icons/icon-192-any.png', badge: 'icons/icon-192.png', tag: 'pinky-nag' };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification('打勾勾', opts))
        .catch(() => { try { new Notification('打勾勾', opts); } catch (err) { /* 忽略 */ } });
    } else {
      try { new Notification('打勾勾', opts); } catch (err) { /* 忽略 */ }
    }
  }

  function maybeNotify() {
    if (!prefs.notify.on) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const today = todayIso();
    const overdue = state.todos.filter((t) => !t.done && t.due && t.due < today).length;
    const todayDue = state.todos.filter((t) => !t.done && t.due === today).length;
    const n = overdue + todayDue;
    if (!n) return;
    const now = new Date();
    const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const fired = notifiedToday();
    const slots = [['morning', prefs.notify.morning, 'notif_morning'], ['evening', prefs.notify.evening, 'notif_evening']];
    for (const [key, time, ctx] of slots) {
      if (hm >= time && !fired.includes(key)) {
        showNag(say(ctx, { n }));
        markNotified(key);
        break;
      }
    }
  }

  async function toggleNotify() {
    if (!('Notification' in window)) { toast('這個瀏覽器不支援通知。'); return; }
    if (prefs.notify.on) {
      prefs.notify.on = false;
      savePrefs();
      writeNagState();
      renderNotifyLabel();
      toast('提醒已關閉。想被罵再回來開。');
      return;
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast(perm === 'denied' ? '通知被封鎖了。要開請到瀏覽器設定解除。' : '沒拿到通知權限。');
      return;
    }
    prefs.notify.on = true;
    savePrefs();
    writeNagState();
    renderNotifyLabel();
    showNag(prefs.tone === 'savage' ? '勾勾上工了。早上 9 點、晚上 9 點，有帳必追。' : '提醒已開啟：早上 9 點與晚上 9 點。');
    toast('提醒已開啟（早 9 點／晚 9 點，有未完成才會通知）。');

    // Android 裝到主畫面後的背景喚醒（其他平台會靜默失敗，無妨）
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) {
        await reg.periodicSync.register('pinky-nag', { minInterval: 6 * 60 * 60 * 1000 });
      }
    } catch (err) { /* 不支援就算了 */ }
  }

  /* 立刻發一則真通知，驗證整條鏈路有沒有通（不受排程與開關影響） */
  async function testNag() {
    if (!('Notification' in window)) { toast('這個瀏覽器不支援通知。'); return; }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast(perm === 'denied' ? '通知被封鎖了。要開請到瀏覽器設定解除。' : '沒拿到通知權限。');
      return;
    }
    const today = todayIso();
    const overdue = state.todos.filter((t) => !t.done && t.due && t.due < today).length;
    const todayDue = state.todos.filter((t) => !t.done && t.due === today).length;
    const n = overdue + todayDue;
    const body = n > 0
      ? say('notif_evening', { n })
      : (prefs.tone === 'savage' ? '測試收到。目前沒有欠帳，我暫時沒話罵你。' : '測試收到，通知是通的。');
    showNag(body);
    toast('測試通知已發出。沒看到的話，檢查系統層的通知設定。');
  }

  function renderNotifyLabel() {
    el.notifyLabel.textContent = '提醒：' + (prefs.notify.on ? '開' : '關');
  }

  /* ---------- 對話框 ---------- */

  function openDialog(id, backfill) {
    editingId = id || null;
    backfillMode = !!backfill && !id;
    const t = id ? state.todos.find((x) => x.id === id) : null;
    el.dialogTitle.textContent = t ? '編輯約定' : backfillMode ? '補記：我已經做了…' : '新的約定';
    el.fTitle.value = t ? t.title : el.quickInput.value.trim();
    el.fNote.value = t ? t.note : '';
    el.fDue.value = t ? t.due : '';
    el.fCategory.value = t ? t.category : (prefs.category || '');
    const p = t ? t.priority : 'normal';
    el.editForm.querySelectorAll('input[name="priority"]').forEach((r) => { r.checked = r.value === p; });
    el.editDialog.showModal();
    el.fTitle.focus();
    el.fTitle.select();
  }

  function submitDialog(event) {
    const title = el.fTitle.value.trim();
    if (!title) { event.preventDefault(); el.fTitle.focus(); return; }
    const fields = {
      title,
      note: el.fNote.value.trim(),
      due: isIsoDate(el.fDue.value) ? el.fDue.value : '',
      priority: el.editForm.elements.priority.value,
      category: el.fCategory.value.trim()
    };
    if (editingId) {
      const before = state.todos.find((x) => x.id === editingId);
      const rescheduled = before && before.due && fields.due && before.due !== fields.due;
      if (rescheduled) {
        before.reschedules = (before.reschedules || 0) + 1;
        const n = before.reschedules;
        applyCredit(n >= 2 ? -2 : -1);
        const id = editingId;
        updateTodo(id, fields);
        if (n >= 3) {
          openNag(
            '「' + before.title.slice(0, 20) + '」第 ' + n + ' 次改期了。要不要承認你根本不會做？誠實放棄扣 1 分，繼續拖扣 4 分。',
            '誠實放棄（−1）', '繼續拖（−4）',
            () => {
              applyCredit(-1);
              toast(say('abandon'));
              removeTodos([id], '已放棄「' + before.title.slice(0, 12) + '」。');
            },
            () => {
              applyCredit(-4);
              save();
              render();
            }
          );
        } else {
          toast(say('resched', { title: before.title.slice(0, 12), n, due: fields.due }));
        }
      } else {
        updateTodo(editingId, fields);
        toast('已更新。');
      }
    } else if (backfillMode) {
      const t = addTodo(Object.assign({ done: true, doneAt: Date.now() }, fields));
      if (t) {
        bumpHistory(t, 1);
        applyCredit(1);
        save();
        render();
        toast(say('backfill'));
      }
      el.quickInput.value = '';
    } else {
      addTodo(Object.assign({ done: false }, fields));
      el.quickInput.value = '';
      toast('約定成立。');
    }
    editingId = null;
  }

  /* ---------- 匯出／匯入 ---------- */

  function exportJson() {
    const payload = JSON.stringify(
      { version: 3, app: 'pinky', exportedAt: new Date().toISOString(), todos: state.todos, history: state.history, credit: state.credit },
      null, 2
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pinky-backup-${todayIso()}.json`;
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
        undoSnapshot = { todos: state.todos.slice(), history: JSON.parse(JSON.stringify(state.history)) };
        const existing = new Set(state.todos.map((t) => t.id));
        let added = 0;
        for (const t of incoming) {
          if (existing.has(t.id)) continue;
          state.todos.push(t);
          existing.add(t.id);
          added++;
        }
        if (data.history && typeof data.history === 'object') {
          for (const [day, h] of Object.entries(data.history)) {
            if (!isIsoDate(day) || !h) continue;
            const cur = state.history[day] || { done: 0, withDue: 0, onTime: 0 };
            state.history[day] = {
              done: Math.max(cur.done, Number(h.done) || 0),
              withDue: Math.max(cur.withDue, Number(h.withDue) || 0),
              onTime: Math.max(cur.onTime, Number(h.onTime) || 0)
            };
          }
        }
        save();
        render();
        toast(`已匯入 ${added} 個項目（略過 ${incoming.length - added} 個重複）。`, '復原', () => {
          state.todos = undoSnapshot.todos;
          state.history = undoSnapshot.history;
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

  /* ---------- 提示 ---------- */

  function toast(text, actionLabel, onAction) {
    clearTimeout(toastTimer);
    el.toastText.textContent = text;
    el.toast.hidden = false;
    if (actionLabel && onAction) {
      el.toastAction.hidden = false;
      el.toastAction.textContent = actionLabel;
      el.toastAction.onclick = () => { el.toast.hidden = true; onAction(); };
    } else {
      el.toastAction.hidden = true;
      el.toastAction.onclick = null;
    }
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 6000);
  }

  /* ---------- 外觀 ---------- */

  function applyAppearance() {
    const root = document.documentElement;
    root.dataset.palette = prefs.palette;
    const dark = prefs.theme
      ? prefs.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'dark' : 'light';

    el.themeBtn.querySelector('use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim());

    el.palettePanel.querySelectorAll('[data-palette]').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.palette === prefs.palette));
    });
  }

  /* ---------- 拖曳排序 ---------- */

  function setupDragAndDrop() {
    let draggingId = null;

    el.groups.addEventListener('dragstart', (e) => {
      const li = e.target.closest('.task');
      if (!li || prefs.sort !== 'manual') return;
      draggingId = li.dataset.id;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggingId);
    });

    el.groups.addEventListener('dragend', () => {
      draggingId = null;
      el.groups.querySelectorAll('.task').forEach((n) => n.classList.remove('is-dragging', 'is-over'));
    });

    el.groups.addEventListener('dragover', (e) => {
      if (!draggingId) return;
      const li = e.target.closest('.task');
      if (!li || li.dataset.id === draggingId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.groups.querySelectorAll('.is-over').forEach((n) => n.classList.remove('is-over'));
      li.classList.add('is-over');
    });

    el.groups.addEventListener('drop', (e) => {
      const li = e.target.closest('.task');
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

  /* ---------- 事件 ---------- */

  function closePops() {
    [el.morePanel, el.palettePanel].forEach((p) => { p.hidden = true; });
    el.moreBtn.setAttribute('aria-expanded', 'false');
    el.paletteBtn.setAttribute('aria-expanded', 'false');
  }

  function togglePop(btn, panel) {
    const open = panel.hidden;
    closePops();
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  function setupEvents() {
    el.quickForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = el.quickInput.value.trim();
      if (!raw) return;
      const parsed = parseQuick(raw);
      if (!parsed.title) { toast('請輸入約定的內容。'); return; }
      addTodo(Object.assign({ done: false }, parsed));
      el.quickInput.value = '';
      el.quickInput.focus();
    });

    el.detailBtn.addEventListener('click', () => openDialog(null));
    el.fabBtn.addEventListener('click', () => openDialog(null));
    el.backfillBtn.addEventListener('click', () => openDialog(null, true));

    el.notifyBtn.addEventListener('click', toggleNotify);
    el.testNagBtn.addEventListener('click', testNag);

    el.toneBtn.addEventListener('click', () => {
      prefs.tone = TONES[(TONES.indexOf(prefs.tone) + 1) % TONES.length];
      savePrefs();
      el.toneLabel.textContent = '語氣：' + TONE_LABEL[prefs.tone];
      writeNagState();
      renderCredit();
      toast(prefs.tone === 'savage' ? '毒舌模式。自己選的。' : prefs.tone === 'coach' ? '教練模式。' : '溫柔模式。');
    });

    el.nagMain.addEventListener('click', () => {
      el.nagDialog.close();
      if (nagHandlers && nagHandlers.onMain) nagHandlers.onMain();
      nagHandlers = null;
    });
    el.nagAlt.addEventListener('click', () => {
      el.nagDialog.close();
      if (nagHandlers && nagHandlers.onAlt) nagHandlers.onAlt();
      nagHandlers = null;
    });

    document.querySelectorAll('.tile').forEach((btn) => {
      btn.addEventListener('click', () => goto('list', btn.dataset.page));
    });

    el.nav.addEventListener('click', (e) => {
      const b = e.target.closest('.nav__btn');
      if (b) goto(b.dataset.view);
    });

    el.searchInput.addEventListener('input', () => { query = el.searchInput.value; pageIndex = 0; renderTabs(); renderList(); });
    el.sortSelect.addEventListener('change', () => { prefs.sort = el.sortSelect.value; pageIndex = 0; savePrefs(); render(); });

    el.editForm.addEventListener('submit', submitDialog);
    [el.cancelBtn, el.cancelBtn2].forEach((b) => b.addEventListener('click', () => {
      editingId = null;
      el.editDialog.close();
    }));
    el.editDialog.addEventListener('close', () => { editingId = null; backfillMode = false; });

    el.editForm.querySelectorAll('.quickdates button').forEach((b) => {
      b.addEventListener('click', () => {
        el.fDue.value = b.dataset.shift === 'clear' ? '' : shiftIso(todayIso(), Number(b.dataset.shift));
      });
    });

    el.themeBtn.addEventListener('click', () => {
      prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      savePrefs();
      applyAppearance();
    });

    el.paletteBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePop(el.paletteBtn, el.palettePanel); });
    el.moreBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePop(el.moreBtn, el.morePanel); });
    el.palettePanel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-palette]');
      if (!b) return;
      prefs.palette = b.dataset.palette;
      savePrefs();
      applyAppearance();
    });
    document.addEventListener('click', closePops);

    [el.shareBtn, el.shareBtn2].forEach((b) => b.addEventListener('click', openShare));
    el.shareClose.addEventListener('click', () => el.shareDialog.close());
    el.shareSave.addEventListener('click', saveShare);
    el.shareCopy.addEventListener('click', copyShare);

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
      if (!confirm('確定要刪除全部待辦事項嗎？（足跡紀錄會保留，建議先匯出備份）')) return;
      removeTodos(state.todos.map((t) => t.id), '已刪除全部項目。');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePops();
      const tag = document.activeElement ? document.activeElement.tagName : '';
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || el.editDialog.open || el.shareDialog.open;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'n') { e.preventDefault(); el.quickInput.focus(); }
      else if (e.key === '/') { e.preventDefault(); el.searchInput.focus(); }
      else if (k === 't') { el.themeBtn.click(); }
      else if (k === 'p') { prefs.palette = PALETTES[(PALETTES.indexOf(prefs.palette) + 1) % PALETTES.length]; savePrefs(); applyAppearance(); }
      else if (k === 's') { openShare(); }
      else if (k === '1') { goto('today'); }
      else if (k === '2') { goto('list'); }
      else if (k === '3') { goto('trail'); }
    });

    let lastDay = todayIso();
    setInterval(() => {
      const now = todayIso();
      if (now !== lastDay) { lastDay = now; settleCredit(); render(); maybeBankrupt(); }
      maybeNotify();
    }, 60000);

    window.addEventListener('storage', (e) => {
      if (e.key !== STORE_KEY) return;
      load();
      render();
    });
  }

  /* ---------- PWA：安裝與離線 ---------- */

  function setupPwa() {
    // 桌機／Android：攔截安裝提示，改由選單觸發
    let deferredPrompt = null;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      el.installBtn.hidden = false;
    });

    // iOS Safari 沒有 beforeinstallprompt，改成顯示操作說明
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIos && !standalone) el.installBtn.hidden = false;

    el.installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        el.installBtn.hidden = true;
        if (outcome === 'accepted') toast('已加入主畫面，之後離線也能用。');
        return;
      }
      toast(isIos ? '點下方的分享鈕，選「加入主畫面」。' : '這個瀏覽器需要從網址列的安裝圖示加入。');
    });

    window.addEventListener('appinstalled', () => {
      el.installBtn.hidden = true;
      toast('安裝完成，打勾勾已經在你的主畫面上了。');
    });

    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker 註冊失敗：', err));
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      // 已經有舊版在跑才需要提示；首次安裝不打擾
      if (document.visibilityState === 'visible' && navigator.serviceWorker.controller) {
        toast('已更新到新版本，重新整理即可套用。');
      }
    });
  }

  /* ---------- 啟動 ---------- */

  load();
  settleCredit();
  applyAppearance();
  setupEvents();
  setupDragAndDrop();
  setupPwa();
  el.toneLabel.textContent = '語氣：' + TONE_LABEL[prefs.tone];
  renderNotifyLabel();
  render();
  maybeBankrupt();
  setTimeout(maybeNotify, 1500);

  // 主畫面捷徑：?action=new / ?action=share
  const action = new URLSearchParams(location.search).get('action');
  if (action === 'new') openDialog(null);
  else if (action === 'list') goto('list');
  else if (action === 'share') openShare();
  if (action) history.replaceState(null, '', location.pathname);
})();
