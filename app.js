'use strict';

// ===== CONSTANTS =====
const STORAGE = { RECORDS: 'ot_records_v1' };

const TYPE = {
  OVERTIME:   'overtime',
  SHUKUCHOKU: 'shukuchoku',
  NITCHOKU:   'nitchoku',
};

const WORK_START_MIN = 8 * 60 + 30;
const WORK_END_MIN   = 17 * 60 + 15;

const REASONS  = ['病棟業務', '救急対応', 'その他'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// Default work periods per mode
const defaultShukuPeriods    = () => [{ start: '17:30', end: '22:00', walkIn: 0, ambu: 0 }];
const defaultNitchokuPeriods = () => [{ start: '08:30', end: '17:15', walkIn: 0, ambu: 0 }];

// ===== STATE =====
const S = {
  tab:             'record',
  recordMode:      TYPE.OVERTIME,
  listMonth:       new Date(),
  shukuPeriods:    defaultShukuPeriods(),
  nitchokuPeriods: defaultNitchokuPeriods(),
};

// ===== STORAGE =====
const load = (key, def) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; } };
const store = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };
const getRecords = () => load(STORAGE.RECORDS, []);

function upsertRecord(rec) {
  const recs = getRecords();
  const idx  = recs.findIndex(r => r.id === rec.id);
  idx >= 0 ? (recs[idx] = rec) : recs.unshift(rec);
  store(STORAGE.RECORDS, recs);
}
function removeRecord(id) { store(STORAGE.RECORDS, getRecords().filter(r => r.id !== id)); }

// ===== TIME UTILS =====
const uid        = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const pad        = n => String(n).padStart(2, '0');
const toDateStr  = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const toTimeStr  = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function formatDateJP(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth()+1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
}

function formatDuration(min) {
  if (!min || min <= 0) return '0分';
  const h = Math.floor(min / 60), m = min % 60;
  return h === 0 ? `${m}分` : m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

function timeStrToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function calcOvertimeMin(s, e) {
  const sm = timeStrToMin(s), em = timeStrToMin(e);
  let ot = 0;
  if (em > WORK_END_MIN)   ot += em - Math.max(sm, WORK_END_MIN);
  if (sm < WORK_START_MIN) ot += Math.min(em, WORK_START_MIN) - sm;
  return Math.floor(ot / 5) * 5;
}

function calcActualMin(s, e) {
  let sm = timeStrToMin(s), em = timeStrToMin(e);
  if (em < sm) em += 24 * 60;
  return em - sm;
}

function isNextDayOff(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDay() === 5 || d.getDay() === 6;
}

// Returns the fixed OT period for shuku/nitchoku
function getOtInfo(type, nextDayWork) {
  if (type === TYPE.SHUKUCHOKU) {
    return nextDayWork
      ? { label: '22:00〜翌5:00（7時間）',    otMin: 7 * 60 }
      : { label: '17:30〜翌8:30（15時間）',   otMin: 15 * 60 };
  }
  return   { label: '8:30〜17:15（8時間45分）', otMin: 8 * 60 + 45 };
}

// ===== RENDER CORE =====
function render() {
  document.getElementById('app').innerHTML = `
    <div class="layout">
      <div id="screen" class="screen"></div>
      <nav class="tab-bar">
        ${tabBtn('record',  clockIcon(), '記録')}
        ${tabBtn('history', listIcon(),  '履歴')}
      </nav>
    </div>
    <div id="modal-overlay" class="modal-overlay hidden"></div>
  `;
  renderScreen();
  document.querySelector('.tab-bar').addEventListener('click', e => {
    const b = e.target.closest('.tab-btn');
    if (b) navigate(b.dataset.tab);
  });
}

function tabBtn(id, icon, label) {
  return `<button class="tab-btn${S.tab===id?' active':''}" data-tab="${id}">${icon}<span>${label}</span></button>`;
}

function navigate(tab) {
  S.tab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderScreen();
}

// KEY BUG FIX: replace the screen element entirely each time to clear
// accumulated event listeners (caused the +128 stepper bug)
function renderScreen() {
  const old = document.getElementById('screen');
  const scr = document.createElement('div');
  scr.id = 'screen'; scr.className = 'screen';
  old.replaceWith(scr);

  switch (S.tab) {
    case 'record':  scr.innerHTML = renderRecord();  bindRecord();  break;
    case 'history': scr.innerHTML = renderHistory(); bindHistory(); break;
  }
}

// ===== RECORD TAB =====
function renderRecord() {
  const today = toDateStr();
  return `
    <div class="header"><h1 class="header-title">時間外記録</h1></div>
    <div class="content">
      <div class="date-badge">${formatDateJP(today)}</div>
      <div class="segment-control">
        ${segBtn(TYPE.OVERTIME,   '通常残業')}
        ${segBtn(TYPE.SHUKUCHOKU, '宿直')}
        ${segBtn(TYPE.NITCHOKU,   '日直')}
      </div>
      ${S.recordMode === TYPE.OVERTIME   ? renderOvertimePanel()      : ''}
      ${S.recordMode === TYPE.SHUKUCHOKU ? renderShukuchokuForm(today) : ''}
      ${S.recordMode === TYPE.NITCHOKU   ? renderNitchokuForm(today)   : ''}
      ${S.recordMode === TYPE.OVERTIME   ? renderTodayRecords(today)   : ''}
    </div>
  `;
}

function segBtn(mode, label) {
  return `<button class="segment-btn${S.recordMode===mode?' active':''}" data-mode="${mode}">${label}</button>`;
}

function renderOvertimePanel() {
  return `
    <div class="overtime-panel">
      <button class="btn btn-danger btn-large" id="btn-evening">残業終了</button>
      <p class="hint-text">定時（17:15）からの残業を記録</p>
      <div class="divider"></div>
      <button class="btn btn-holiday" id="btn-holiday">任意の時間で記録</button>
      <p class="hint-text">開始〜終了の全時間が時間外として計算されます</p>
      <div class="divider"></div>
      <button class="btn btn-morning" id="btn-morning">早出残業を記録</button>
      <p class="hint-text">定時前（〜8:30）の残業を記録</p>
    </div>
  `;
}

function renderShukuchokuForm(today) {
  const nextOff = isNextDayOff(today);
  const isWork  = !nextOff;
  const ot      = getOtInfo(TYPE.SHUKUCHOKU, isWork);
  return `
    <div class="card">
      <div class="form-group">
        <label class="form-label">宿直日</label>
        <input type="date" class="form-input" id="sk-date" value="${today}">
      </div>
      <div class="form-group">
        <label class="form-label">翌日の勤務</label>
        <div class="toggle-group">
          <button class="toggle-btn${isWork?' active':''}"  data-nday="work">勤務あり（日〜木）</button>
          <button class="toggle-btn${!isWork?' active':''}" data-nday="off">休み（金・土・祝前日）</button>
        </div>
      </div>
      <div class="ot-info-strip" id="sk-ot-info">時間外：${ot.label}</div>
      <div class="form-group">
        <label class="form-label">実働時間の記録</label>
        <div id="sk-periods">${renderPeriodsHTML(S.shukuPeriods, 'sk')}</div>
        <button class="btn-add-period" data-addperiod="sk">＋ 実働時間を追加</button>
      </div>
      <div class="form-group">
        <label class="form-label">備考</label>
        <input type="text" class="form-input" id="sk-note" placeholder="任意">
      </div>
      <button class="btn btn-primary btn-full" id="btn-save-sk">保存</button>
    </div>
  `;
}

function renderNitchokuForm(today) {
  const ot = getOtInfo(TYPE.NITCHOKU, true);
  return `
    <div class="card">
      <div class="form-group">
        <label class="form-label">日直日</label>
        <input type="date" class="form-input" id="nt-date" value="${today}">
      </div>
      <div class="ot-info-strip">時間外：${ot.label}</div>
      <div class="form-group">
        <label class="form-label">実働時間の記録</label>
        <div id="nt-periods">${renderPeriodsHTML(S.nitchokuPeriods, 'nt')}</div>
        <button class="btn-add-period" data-addperiod="nt">＋ 実働時間を追加</button>
      </div>
      <div class="form-group">
        <label class="form-label">備考</label>
        <input type="text" class="form-input" id="nt-note" placeholder="任意">
      </div>
      <button class="btn btn-primary btn-full" id="btn-save-nt">保存</button>
    </div>
  `;
}

function renderPeriodsHTML(periods, prefix) {
  return periods.map((p, i) => `
    <div class="period-card">
      <div class="period-header">
        <div class="period-times">
          <input type="time" class="form-input time-compact" value="${p.start}" data-ps="${prefix}-${i}">
          <span class="period-sep">〜</span>
          <input type="time" class="form-input time-compact" value="${p.end}" data-pe="${prefix}-${i}">
        </div>
        ${periods.length > 1
          ? `<button class="btn-icon btn-rm-period" data-rmprefix="${prefix}" data-rmidx="${i}">✕</button>`
          : ''}
      </div>
      <div class="period-counts">
        <div class="count-item">
          <span class="count-label">Walk-in</span>
          <div class="stepper stepper-sm">
            <button class="stepper-btn" data-stepper="${prefix}-wi-${i}" data-action="dec">−</button>
            <span class="stepper-value" id="${prefix}-wi-${i}-v">${p.walkIn}</span>
            <button class="stepper-btn" data-stepper="${prefix}-wi-${i}" data-action="inc">+</button>
          </div>
        </div>
        <div class="count-item">
          <span class="count-label">救急車</span>
          <div class="stepper stepper-sm">
            <button class="stepper-btn" data-stepper="${prefix}-am-${i}" data-action="dec">−</button>
            <span class="stepper-value" id="${prefix}-am-${i}-v">${p.ambu}</span>
            <button class="stepper-btn" data-stepper="${prefix}-am-${i}" data-action="inc">+</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function renderTodayRecords(today) {
  const recs = getRecords().filter(r => r.date === today);
  if (!recs.length) return '';
  return `
    <div class="section-title" style="margin-top:8px">今日の記録</div>
    <div class="records-list">${recs.map(recordItemHTML).join('')}</div>
  `;
}

function recordItemHTML(r) {
  if (r.type === TYPE.OVERTIME) {
    const label  = r.overtimeKind === 'morning' ? '早出' : r.overtimeKind === 'holiday' ? '時間外' : '残業';
    const badge  = `<span class="badge badge-overtime">${label}</span>`;
    const emBadge = r.emergency ? `<span class="badge badge-emergency">🚨 緊急呼出</span>` : '';
    const reason = r.reason === 'その他' && r.reasonDetail ? r.reasonDetail : (r.reason || '');
    return `
      <div class="record-item">
        <div class="record-main">
          <div class="record-header">${badge}${emBadge}</div>
          <div class="record-detail">${r.startTime}〜${r.endTime}（${formatDuration(r.durationMinutes)}）</div>
          ${reason ? `<div class="record-reason">${reason}</div>` : ''}
        </div>
        <button class="btn-icon btn-delete-rec" data-id="${r.id}">✕</button>
      </div>`;
  }
  if (r.type === TYPE.SHUKUCHOKU) {
    const badge = `<span class="badge badge-shukuchoku">宿直</span>`;
    const sub   = `<span class="badge-sub">${r.nextDayWork ? '翌日勤務あり' : '翌日休み'}</span>`;
    const periods = (r.workPeriods || []).map(p =>
      `${p.start}〜${p.end}　Walk-in:${p.walkIn}　救急車:${p.ambu}`
    ).join('\n');
    return `
      <div class="record-item">
        <div class="record-main">
          <div class="record-header">${badge}${sub}</div>
          <div class="record-detail" style="white-space:pre-line">${r.otLabel || ''}</div>
          ${periods ? `<div class="record-reason" style="white-space:pre-line">${periods}</div>` : ''}
          ${r.note ? `<div class="record-reason">${r.note}</div>` : ''}
        </div>
        <button class="btn-icon btn-delete-rec" data-id="${r.id}">✕</button>
      </div>`;
  }
  // nitchoku
  const badge = `<span class="badge badge-nitchoku">日直</span>`;
  const periods = (r.workPeriods || []).map(p =>
    `${p.start}〜${p.end}　Walk-in:${p.walkIn}　救急車:${p.ambu}`
  ).join('\n');
  return `
    <div class="record-item">
      <div class="record-main">
        <div class="record-header">${badge}</div>
        <div class="record-detail">${r.otLabel || ''}</div>
        ${periods ? `<div class="record-reason" style="white-space:pre-line">${periods}</div>` : ''}
        ${r.note ? `<div class="record-reason">${r.note}</div>` : ''}
      </div>
      <button class="btn-icon btn-delete-rec" data-id="${r.id}">✕</button>
    </div>`;
}

// ===== RECORD EVENT BINDING =====
// Called once per renderScreen() — no listener accumulation since screen element is replaced
function bindRecord() {
  const scr = document.getElementById('screen');

  scr.addEventListener('click', e => {
    // Segment switch
    const seg = e.target.closest('.segment-btn');
    if (seg && seg.dataset.mode !== S.recordMode) {
      if (seg.dataset.mode === TYPE.SHUKUCHOKU) S.shukuPeriods    = defaultShukuPeriods();
      if (seg.dataset.mode === TYPE.NITCHOKU)   S.nitchokuPeriods = defaultNitchokuPeriods();
      S.recordMode = seg.dataset.mode;
      renderScreen();
      return;
    }

    // Overtime buttons
    if (e.target.closest('#btn-evening')) { showOvertimeModal('evening'); return; }
    if (e.target.closest('#btn-holiday')) { showOvertimeModal('holiday'); return; }
    if (e.target.closest('#btn-morning')) { showOvertimeModal('morning'); return; }

    // Next-day toggle (宿直)
    const nday = e.target.closest('[data-nday]');
    if (nday) {
      scr.querySelectorAll('[data-nday]').forEach(b => b.classList.remove('active'));
      nday.classList.add('active');
      const ot = getOtInfo(TYPE.SHUKUCHOKU, nday.dataset.nday === 'work');
      const strip = document.getElementById('sk-ot-info');
      if (strip) strip.textContent = `時間外：${ot.label}`;
      return;
    }

    // Add work period
    const addPeriod = e.target.closest('[data-addperiod]');
    if (addPeriod) {
      const px = addPeriod.dataset.addperiod;
      const periods = px === 'sk' ? S.shukuPeriods : S.nitchokuPeriods;
      syncPeriodState(px, periods);
      periods.push({ start: '00:00', end: '08:30', walkIn: 0, ambu: 0 });
      document.getElementById(`${px}-periods`).innerHTML = renderPeriodsHTML(periods, px);
      return;
    }

    // Remove work period
    const rmPeriod = e.target.closest('.btn-rm-period');
    if (rmPeriod) {
      const px  = rmPeriod.dataset.rmprefix;
      const idx = parseInt(rmPeriod.dataset.rmidx, 10);
      const periods = px === 'sk' ? S.shukuPeriods : S.nitchokuPeriods;
      syncPeriodState(px, periods);
      periods.splice(idx, 1);
      document.getElementById(`${px}-periods`).innerHTML = renderPeriodsHTML(periods, px);
      return;
    }

    // Stepper +/−
    const sbtn = e.target.closest('.stepper-btn');
    if (sbtn) {
      const id  = sbtn.dataset.stepper;
      const vel = document.getElementById(`${id}-v`);
      if (!vel) return;
      let n = parseInt(vel.textContent, 10);
      sbtn.dataset.action === 'inc' ? n++ : (n > 0 && n--);
      vel.textContent = n;
      return;
    }

    // Save buttons
    if (e.target.closest('#btn-save-sk')) { saveShukuchoku(); return; }
    if (e.target.closest('#btn-save-nt')) { saveNitchoku();   return; }

    // Delete record
    const del = e.target.closest('.btn-delete-rec');
    if (del && confirm('この記録を削除しますか？')) {
      removeRecord(del.dataset.id);
      renderScreen();
    }
  });
}

// Read current DOM values into the periods array (before add/remove)
function syncPeriodState(prefix, periods) {
  periods.forEach((p, i) => {
    const se = document.querySelector(`[data-ps="${prefix}-${i}"]`);
    const ee = document.querySelector(`[data-pe="${prefix}-${i}"]`);
    const we = document.getElementById(`${prefix}-wi-${i}-v`);
    const ae = document.getElementById(`${prefix}-am-${i}-v`);
    if (se) p.start  = se.value;
    if (ee) p.end    = ee.value;
    if (we) p.walkIn = parseInt(we.textContent, 10) || 0;
    if (ae) p.ambu   = parseInt(ae.textContent, 10) || 0;
  });
}

function saveShukuchoku() {
  syncPeriodState('sk', S.shukuPeriods);
  const date       = document.getElementById('sk-date')?.value || toDateStr();
  const note       = document.getElementById('sk-note')?.value.trim() || '';
  const ndBtn      = document.querySelector('[data-nday].active');
  const nextDayWork = ndBtn ? ndBtn.dataset.nday === 'work' : true;
  const ot         = getOtInfo(TYPE.SHUKUCHOKU, nextDayWork);

  upsertRecord({
    id: uid(), date, type: TYPE.SHUKUCHOKU,
    nextDayWork, otMin: ot.otMin, otLabel: ot.label,
    workPeriods: JSON.parse(JSON.stringify(S.shukuPeriods)),
    note, createdAt: Date.now(),
  });
  S.shukuPeriods = defaultShukuPeriods();
  showToast('宿直を記録しました');
  renderScreen();
}

function saveNitchoku() {
  syncPeriodState('nt', S.nitchokuPeriods);
  const date  = document.getElementById('nt-date')?.value || toDateStr();
  const note  = document.getElementById('nt-note')?.value.trim() || '';
  const ot    = getOtInfo(TYPE.NITCHOKU, true);

  upsertRecord({
    id: uid(), date, type: TYPE.NITCHOKU,
    otMin: ot.otMin, otLabel: ot.label,
    workPeriods: JSON.parse(JSON.stringify(S.nitchokuPeriods)),
    note, createdAt: Date.now(),
  });
  S.nitchokuPeriods = defaultNitchokuPeriods();
  showToast('日直を記録しました');
  renderScreen();
}

// ===== OVERTIME MODAL =====
function showOvertimeModal(kind) {
  const defaultStart = kind === 'evening' ? '17:15' : kind === 'holiday' ? '08:30' : toTimeStr();
  const defaultEnd   = kind === 'evening' ? toTimeStr() : kind === 'holiday' ? '17:15' : '08:30';
  const calcMin = (s, e) => kind === 'holiday'
    ? Math.floor(calcActualMin(s, e) / 5) * 5
    : calcOvertimeMin(s, e);
  const today        = toDateStr();

  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-handle"></div>
      <div class="modal-title">${kind === 'evening' ? '残業終了' : kind === 'holiday' ? '任意の時間で記録' : '早出残業'}</div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">日付</label>
          <input type="date" class="form-input" id="m-date" value="${today}">
        </div>
        <div class="modal-time-row">
          <div class="form-group">
            <label class="form-label">開始</label>
            <input type="time" class="form-input" id="m-start" value="${defaultStart}">
          </div>
          <div class="form-sep-mid">〜</div>
          <div class="form-group">
            <label class="form-label">終了</label>
            <input type="time" class="form-input" id="m-end" value="${defaultEnd}">
          </div>
        </div>
        <div class="calculated-duration">
          <div class="calculated-duration-label">時間外</div>
          <div class="calculated-duration-value" id="dur-val">${formatDuration(calcMin(defaultStart, defaultEnd))}</div>
        </div>
        <div class="form-group">
          <label class="form-label">残業理由</label>
          <div class="reason-grid">
            ${REASONS.map(r => `<button class="reason-pill" data-reason="${r}">${r}</button>`).join('')}
          </div>
          <div id="reason-detail-wrap" class="reason-detail-wrap">
            <input type="text" class="form-input" id="reason-detail" placeholder="理由を入力">
          </div>
        </div>
        <div style="text-align:right;margin-top:4px">
          <button class="em-btn" id="m-emergency" data-active="0">緊急呼出なし</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="m-save">保存</button>
        <button class="btn-text" id="m-cancel">キャンセル</button>
      </div>
    </div>
  `;
  overlay.classList.remove('hidden');

  let selectedReason = '';

  const recalc = () => {
    const s = document.getElementById('m-start')?.value;
    const e = document.getElementById('m-end')?.value;
    if (s && e) document.getElementById('dur-val').textContent = formatDuration(calcMin(s, e));
  };
  document.getElementById('m-start').addEventListener('change', recalc);
  document.getElementById('m-end').addEventListener('change', recalc);

  // 緊急呼出トグル
  document.getElementById('m-emergency').addEventListener('click', () => {
    const btn = document.getElementById('m-emergency');
    const active = btn.dataset.active === '1';
    btn.dataset.active = active ? '0' : '1';
    btn.textContent    = active ? '緊急呼出なし' : '🚨 緊急呼出あり';
    btn.classList.toggle('active', !active);
  });

  overlay.addEventListener('click', e => {
    const pill = e.target.closest('.reason-pill');
    if (pill) {
      overlay.querySelectorAll('.reason-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      selectedReason = pill.dataset.reason;
      document.getElementById('reason-detail-wrap').classList.toggle('visible', selectedReason === 'その他');
      return;
    }
    if (e.target === overlay) closeModal();
  });

  document.getElementById('m-save').addEventListener('click', () => {
    const startStr  = document.getElementById('m-start').value;
    const endStr    = document.getElementById('m-end').value;
    const emergency = document.getElementById('m-emergency').dataset.active === '1';
    const recDate   = document.getElementById('m-date').value || today;
    upsertRecord({
      id: uid(), date: recDate, type: TYPE.OVERTIME, overtimeKind: kind,
      startTime: startStr, endTime: endStr,
      durationMinutes: calcMin(startStr, endStr),
      reason: selectedReason,
      reasonDetail: document.getElementById('reason-detail')?.value.trim() || '',
      emergency,
      createdAt: Date.now(),
    });
    closeModal();
    showToast('残業を記録しました');
    renderScreen();
  });

  document.getElementById('m-cancel').addEventListener('click', closeModal);
}

function closeModal() {
  const o = document.getElementById('modal-overlay');
  if (o) { o.classList.add('hidden'); o.innerHTML = ''; }
}

// ===== HISTORY TAB =====
function checkForUpdate() {
  if (confirm('キャッシュをクリアして最新版を読み込みます。よろしいですか？')) {
    (async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
      location.reload(true);
    })();
  }
}

function renderHistory() {
  const y = S.listMonth.getFullYear();
  const m = S.listMonth.getMonth();

  const monthRecs = getRecords().filter(r => {
    const d = new Date(r.date + 'T00:00:00');
    return d.getFullYear() === y && d.getMonth() === m;
  });

  const otMin = monthRecs.reduce((s, r) => {
    if (r.type === TYPE.OVERTIME) return s + (r.durationMinutes || 0);
    return s + (r.otMin || 0); // 宿直・日直の固定時間外時間を加算
  }, 0);
  const skCnt = monthRecs.filter(r => r.type === TYPE.SHUKUCHOKU).length;
  const ntCnt = monthRecs.filter(r => r.type === TYPE.NITCHOKU).length;

  const byDate = {};
  monthRecs.forEach(r => { (byDate[r.date] = byDate[r.date] || []).push(r); });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  return `
    <div class="header"><h1 class="header-title">履歴</h1></div>
    <div class="content">
      <div class="month-nav">
        <button class="month-nav-btn" id="btn-prev">‹</button>
        <span class="month-title">${y}年${m+1}月</span>
        <button class="month-nav-btn" id="btn-next">›</button>
      </div>
      <div class="summary-card">
        <div class="summary-stat">
          <div class="summary-stat-value">${formatDuration(otMin)}</div>
          <div class="summary-stat-label">時間外合計</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${skCnt}</div>
          <div class="summary-stat-label">宿直</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${ntCnt}</div>
          <div class="summary-stat-label">日直</div>
        </div>
      </div>
      ${dates.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">この月の記録はありません</div>
        </div>
      ` : dates.map(date => `
        <div class="day-section">
          <div class="day-section-title">${formatDateJP(date)}</div>
          <div class="records-list">${byDate[date].map(recordItemHTML).join('')}</div>
        </div>
      `).join('')}
      <div class="export-area">
        <button class="btn btn-primary btn-sm" disabled style="opacity:.4;cursor:default;width:100%">
          Excel出力（準備中）
        </button>
        <div class="export-note">申請書テンプレート共有後に対応予定</div>
        <button class="btn-update-check" id="btn-update">アップデートを確認</button>
      </div>
    </div>
  `;
}

function bindHistory() {
  const scr = document.getElementById('screen');
  document.getElementById('btn-prev')?.addEventListener('click', () => {
    S.listMonth = new Date(S.listMonth.getFullYear(), S.listMonth.getMonth() - 1, 1);
    renderScreen();
  });
  document.getElementById('btn-next')?.addEventListener('click', () => {
    S.listMonth = new Date(S.listMonth.getFullYear(), S.listMonth.getMonth() + 1, 1);
    renderScreen();
  });
  scr.addEventListener('click', e => {
    if (e.target.closest('#btn-update')) { checkForUpdate(); return; }
    const del = e.target.closest('.btn-delete-rec');
    if (del && confirm('この記録を削除しますか？')) { removeRecord(del.dataset.id); renderScreen(); }
  });
}

// ===== TOAST =====
function showToast(msg) {
  document.getElementById('toast')?.remove();
  const t = document.createElement('div');
  t.id = 'toast'; t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))',
    left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.75)', color: '#fff',
    padding: '10px 20px', borderRadius: '20px',
    fontSize: '14px', fontWeight: '500',
    zIndex: '999', whiteSpace: 'nowrap',
    animation: 'fadeInOut 2.2s ease forwards',
  });
  if (!document.getElementById('toast-style')) {
    const s = document.createElement('style'); s.id = 'toast-style';
    s.textContent = `@keyframes fadeInOut{0%{opacity:0;transform:translateX(-50%) translateY(8px)}15%{opacity:1;transform:translateX(-50%) translateY(0)}75%{opacity:1}100%{opacity:0}}`;
    document.head.appendChild(s);
  }
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2300);
}

// ===== ICONS =====
function clockIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
}
function listIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
});
