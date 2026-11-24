// app.js — FieldLog UI: hash-router + view renderers. Vanilla JS, no build step,
// so the whole app is just static files you can host anywhere (see README.md).
//
// The primary record is a **Job** (see js/db.js): a persistent job-site entry
// (site name, service order/unit number, overall job scope, job history)
// that a worker creates once and keeps adding to over the life of that job.
// Inside a Job live three independent, repeatable kinds of entries: Time
// Sheet Report (TSR) entries (one per day worked — hourly schedule +
// approval signature), Daily Status Report (DSR) entries (one per day
// worked — team/first aid/further history/work completed/technical
// comments/current status), and Field Service Report (FSR) entries (one per
// piece of equipment tested — report type + WEG-EM technical checklist).

// Release number shown next to the app name in the top bar. Bump together with
// CACHE_VERSION in sw.js.
const APP_VERSION = '69';        // internal build number (also in sw.js CACHE_VERSION)
const APP_VERSION_LABEL = 'Beta_6';  // what the person sees in the top bar

const App = {
  worker: null,
  photoUrls: new Map(), // photo.id -> object URL, so we can revoke them on teardown

  async start() {
    await DB.init();
    window.addEventListener('hashchange', () => this.route());

    // Ask the browser not to evict this app's data when the phone is low on
    // space (best effort — some browsers grant it silently, some never do).
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    const workerId = DB.getCurrentWorkerId();
    if (workerId) this.worker = await DB.getWorker(workerId);
    // Profile still on the device but the "current worker" pointer is gone or
    // stale? Re-select it rather than showing first-time setup again.
    if (!this.worker) this.worker = await DB.recoverWorker();

    this.route();

    if ('serviceWorker' in navigator) {
      // After an app update the new version takes over by itself; the page
      // that's open keeps running the old code until it's reopened. All data
      // (jobs, photos, profile) is untouched by an update.
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) this.showUpdateBanner();
        hadController = true;
      });
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('SW registration failed', e));
    }
  },

  // After an update the page that is open still runs the old code until it is
  // reloaded, so offer a one-tap reload (all data on the device is untouched).
  showUpdateBanner() {
    if (document.getElementById('update-banner')) return;
    const el = document.createElement('div');
    el.id = 'update-banner';
    el.className = 'update-banner';
    el.innerHTML = '<span>A new version of the app is ready.</span><button class="btn btn-sm btn-primary">Reload now</button>';
    el.querySelector('button').addEventListener('click', () => location.reload());
    document.body.appendChild(el);
  },

  route() {
    const hash = location.hash || '#/jobs';
    if (!this.worker && hash !== '#/enroll') { location.hash = '#/enroll'; return; }

    const jobMatch = hash.match(/^#\/job\/([^/]+)$/);

    if (hash === '#/enroll') return this.renderEnroll();
    if (hash === '#/jobs') return this.renderJobsList('jobs');
    if (jobMatch) return this.renderJobDetail(jobMatch[1]);
    if (hash === '#/history') return this.renderJobsList('history');
    if (hash === '#/settings') return this.renderSettings();
    return this.renderJobsList('jobs');
  },

  // ---------- Shell helpers ----------
  setShell({ title, sub, showBack }) {
    const titleEl = document.getElementById('topbar-title');
    titleEl.textContent = title;
    // Version tag next to the app name (keep APP_VERSION in step with
    // CACHE_VERSION in sw.js — both are bumped on every release).
    const ver = document.createElement('span');
    ver.className = 'app-version';
    ver.textContent = APP_VERSION_LABEL;
    ver.title = `Build ${APP_VERSION}`;
    titleEl.appendChild(ver);
    document.getElementById('topbar-sub').textContent = sub || '';
    document.getElementById('back-btn').classList.toggle('hidden', !showBack);
  },

  setNav(active) {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === active));
    document.getElementById('bottomnav').classList.toggle('hidden', active === null);
  },

  toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  },

  // ---------- One-time enrollment ----------
  // This app is designed as one account per device: the field service worker
  // enrolls once when they first open it, and from then on the device just
  // opens straight to their own job list — no picking a profile each time.
  async renderEnroll() {
    this.setShell({ title: 'EM-WEG Field Service', sub: 'Set up this device' });
    this.setNav(null);

    const main = document.getElementById('main');
    main.innerHTML = `
      <div class="login-hero">
        <img src="icons/icon-192.png" alt="WEG Field Service" />
        <h1>Welcome</h1>
        <p>Let's set up this device with your name — you'll only need to do this once.</p>
      </div>
      <div class="card">
        <label class="field-label">Your name</label>
        <input type="text" id="enroll-name" placeholder="e.g. Dhanush Venku" />
        <label class="field-label">Role (optional)</label>
        <select id="enroll-role">${roleOptionsHtml('')}</select>
        <label class="field-label">Area / Location (optional)</label>
        <input type="text" id="enroll-area" placeholder="e.g. North Region / Zone 4" />
        <button class="btn btn-primary btn-block" id="enroll-btn">Get started</button>
        <button class="btn btn-block mt8" id="enroll-transfer-btn">📲 Get my data from another device (enter a code)</button>
        <button class="btn btn-block mt8" id="enroll-restore-btn">📂 Restore from a backup file instead</button>
      </div>
    `;
    document.getElementById('enroll-restore-btn').addEventListener('click', () => this.pickAndRestoreBackup());
    document.getElementById('enroll-transfer-btn').addEventListener('click', () => Transfer.open('enter'));

    document.getElementById('enroll-btn').addEventListener('click', async () => {
      const name = document.getElementById('enroll-name').value.trim();
      const role = document.getElementById('enroll-role').value.trim();
      const area = document.getElementById('enroll-area').value.trim();
      if (!name) { this.toast('Enter your name first'); return; }
      const w = await DB.addWorker(name, role, area);
      DB.setCurrentWorkerId(w.id);
      this.worker = w;
      location.hash = '#/jobs';
    });
  },

  // ---------- Jobs list (also used for History) ----------
  async renderJobsList(mode) {
    const isHistory = mode === 'history';
    this.setShell({ title: 'EM-WEG Field Service', sub: `${isHistory ? 'History' : 'Jobs'} · ${this.worker.name}` });
    this.setNav(isHistory ? 'history' : 'jobs');
    const jobs = await DB.getJobsForWorker(this.worker.id);

    const summarize = (job) => {
      const parts = [];
      parts.push(`TSR dates: ${job.tsrEntries.reduce((n, t) => n + (t.dayEntries || []).length, 0)}`);
      parts.push(`DSR: ${job.dsrEntries.length}`);
      parts.push(`FSR: ${job.fsrEntries.length}`);
      return parts.join(' · ');
    };

    const main = document.getElementById('main');
    const listHtml = jobs.length === 0
      ? `<div class="empty-state">${isHistory ? 'No jobs logged yet.' : 'No jobs yet — tap "+ New Job" to start one.'}</div>`
      : `<div class="card" style="padding:0;">${jobs.map((job) => `
          <div class="history-item" data-job-id="${job.id}">
            <div>
              <div class="history-date">${escapeHtml(job.siteName || 'Untitled job site')}</div>
              <div class="history-meta">${escapeHtml(job.serviceOrder ? `SO/Unit: ${job.serviceOrder} · ` : '')}${summarize(job)}</div>
            </div>
            <span class="badge synced">${formatDateShort(job.updatedAt)}</span>
          </div>
        `).join('')}</div>`;

    main.innerHTML = isHistory
      ? listHtml
      : `<div class="new-job-btn-row"><button class="btn btn-primary" id="new-job-btn">+ New Job</button></div><div class="mt12"></div>${listHtml}`;

    main.querySelectorAll('.history-item').forEach((el) => {
      el.addEventListener('click', () => { location.hash = `#/job/${el.dataset.jobId}`; });
    });

    const newJobBtn = document.getElementById('new-job-btn');
    if (newJobBtn) newJobBtn.addEventListener('click', () => this.openNewJobModal());
  },

  openNewJobModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>New job</h3>
        <label class="field-label">Customer / Client Name</label>
        <input type="text" id="newjob-site" placeholder="e.g. Acme Manufacturing" />
        <label class="field-label mt8">Job Site / Location</label>
        <input type="text" id="newjob-location" placeholder="e.g. Riverside Plant" />
        <label class="field-label mt8">Service Order / Unit Number</label>
        <input type="text" id="newjob-order" placeholder="e.g. SO-48213" />
        <label class="field-label">Overall Job Scope</label>
        <textarea class="log-input" id="newjob-scope" placeholder="Describe the overall scope of this job…"></textarea>
        <label class="field-label mt8">Job History</label>
        <textarea class="log-input" id="newjob-history" placeholder="Relevant history / background…"></textarea>
        <div class="row mt8">
          <button class="btn" id="newjob-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="newjob-create-btn" style="flex:1;">Create job</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#newjob-cancel-btn').addEventListener('click', close);
    backdrop.querySelector('#newjob-create-btn').addEventListener('click', async () => {
      const siteName = backdrop.querySelector('#newjob-site').value.trim();
      const siteLocation = backdrop.querySelector('#newjob-location').value.trim();
      const serviceOrder = backdrop.querySelector('#newjob-order').value.trim();
      const overallJobScope = backdrop.querySelector('#newjob-scope').value.trim();
      const jobHistory = backdrop.querySelector('#newjob-history').value.trim();
      if (!siteName) { this.toast('Enter the customer / client name first'); return; }
      const job = await DB.createJob(this.worker.id, { siteName, siteLocation, serviceOrder, overallJobScope, jobHistory });
      close();
      location.hash = `#/job/${job.id}`;
    });
  },

  // ---------- Job detail: header + TSR / DSR / FSR sections ----------
  async renderJobDetail(jobId) {
    const job = await DB.getJob(jobId);
    if (!job) { location.hash = '#/jobs'; return; }
    const photos = await DB.getPhotosForJob(job.id);

    this.setShell({
      title: job.siteName || 'Untitled job site',
      sub: job.serviceOrder ? `SO/Unit: ${job.serviceOrder}` : this.worker.name,
      showBack: true
    });
    this.setNav(null);

    const main = document.getElementById('main');
    main.innerHTML = `
      <details class="job-details" id="job-details">
        <summary>📝 Job details <span class="text-dim">— ${escapeHtml([job.siteName, job.serviceOrder].filter(Boolean).join(' · ') || 'tap to edit')}</span></summary>
        <div class="card" id="job-header-card"></div>
      </details>

      <div class="job-tabs" id="job-tabs" role="tablist">
        <button class="job-tab" role="tab" data-tab="tsr">⏱️ TSR <span class="job-tab-count">${job.tsrEntries.length}</span></button>
        <button class="job-tab" role="tab" data-tab="dsr">📋 DSR <span class="job-tab-count">${job.dsrEntries.length}</span></button>
        <button class="job-tab" role="tab" data-tab="fsr">🔧 FSR <span class="job-tab-count">${job.fsrEntries.length}</span></button>
      </div>


      <div class="job-panel" id="job-panel-tsr" role="tabpanel">
        <div class="section-label">⏱️ Time Sheet Report (TSR)</div>
        <div id="tsr-list"></div>
        <button class="btn btn-block" id="add-tsr-btn">+ Add another time sheet (new visit / new approver)</button>
      </div>

      <div class="job-panel" id="job-panel-dsr" role="tabpanel">
        <div class="section-label">📋 Daily Status Report (DSR)</div>
        <div class="hint-text">A DSR is created automatically for every date logged on the Time Sheet Report.</div>
        <div id="dsr-list"></div>
      </div>

      <div class="job-panel" id="job-panel-fsr" role="tabpanel">
        <div class="section-label">🔧 Field Service Report (FSR)</div>
        <div id="fsr-list"></div>
        <button class="btn btn-block" id="add-fsr-btn">+ Add FSR entry</button>
      </div>

      <div class="card generate-report-card mt12">
        <button class="btn btn-primary" id="generate-report-btn">📊 Generate Report</button>
      </div>
    `;

    // Three tabs instead of one long page. The chosen tab is remembered per job
    // (also across re-renders such as "add time sheet").
    this._jobTabs = this._jobTabs || {};
    const tabsEl = document.getElementById('job-tabs');
    const showTab = (name) => {
      this._jobTabs[job.id] = name;
      tabsEl.querySelectorAll('.job-tab').forEach((b) => {
        const on = b.dataset.tab === name;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      ['tsr', 'dsr', 'fsr'].forEach((t) => document.getElementById(`job-panel-${t}`).classList.toggle('hidden', t !== name));
    };
    tabsEl.querySelectorAll('.job-tab').forEach((b) => b.addEventListener('click', () => {
      showTab(b.dataset.tab);
      const top = tabsEl.getBoundingClientRect().top + window.scrollY - (document.querySelector('.topbar')?.offsetHeight || 0) - 4;
      if (window.scrollY > top) window.scrollTo({ top, behavior: 'auto' });
    }));
    const topbarH = (document.querySelector('.topbar') || {}).offsetHeight || 64;
    tabsEl.style.top = `${topbarH - 1}px`;
    showTab(this._jobTabs[job.id] || 'tsr');

    document.getElementById('job-header-card').appendChild(this.renderJobHeaderCard(job));

    const tsrList = document.getElementById('tsr-list');
    job.tsrEntries.forEach((entry, idx) => tsrList.appendChild(this.collapsibleEntry(this.renderTsrEntryCard(job, entry, idx), entry.id, '⏱️', () => this.tsrSummary(entry, idx, job.tsrEntries.length))));

    // A job visited again later (maybe signed off by a different supervisor)
    // gets its own time sheet with its own dates and its own approval.
    document.getElementById('add-tsr-btn').addEventListener('click', async () => {
      const newTsr = DB.newTsrEntry(false);
      job.tsrEntries.push(newTsr);
      (this._openEntries = this._openEntries || new Set()).add(newTsr.id);
      await DB.saveJob(job);
      this.renderJobDetail(job.id);
      this.toast('New time sheet added — pick its dates');
    });

    const dsrList = document.getElementById('dsr-list');
    job.dsrEntries.forEach((entry) => dsrList.appendChild(this.collapsibleEntry(this.renderDsrEntryCard(job, entry, photos), entry.id, '📋', () => this.dsrSummary(job, entry))));
    // Lets the TSR card (rendered above) rebuild just the DSR cards when a
    // date flips between "all travel" and "has labor" — no full-page re-render,
    // so the field being edited keeps its place.
    this._refreshDsrList = async () => {
      const freshPhotos = await DB.getPhotosForJob(job.id);
      dsrList.innerHTML = '';
      job.dsrEntries.forEach((entry) => dsrList.appendChild(this.collapsibleEntry(this.renderDsrEntryCard(job, entry, freshPhotos), entry.id, '📋', () => this.dsrSummary(job, entry))));
      const cnt = tabsEl.querySelector('[data-tab="dsr"] .job-tab-count');
      if (cnt) cnt.textContent = job.dsrEntries.length;
    };

    const fsrList = document.getElementById('fsr-list');
    job.fsrEntries.forEach((entry, idx) => fsrList.appendChild(this.collapsibleEntry(this.renderFsrEntryCard(job, entry, idx, photos), entry.id, '🔧', () => this.fsrSummary(entry, idx))));

    document.getElementById('add-fsr-btn').addEventListener('click', async () => {
      const newFsr = DB.newFsrEntry();
      job.fsrEntries.push(newFsr);
      (this._openEntries = this._openEntries || new Set()).add(newFsr.id);
      await DB.saveJob(job);
      this.renderJobDetail(job.id);
    });

    document.getElementById('generate-report-btn').addEventListener('click', () => {
      this.openReportScopeModal((scope) => {
        const counts = { tsr: job.tsrEntries.reduce((n, t) => n + (t.dayEntries || []).length, 0), dsr: job.dsrEntries.length, fsr: job.fsrEntries.length + job.dsrEntries.length };  // an FSR is built from the DSRs, so it needs no FSR entry of its own
        if (counts[scope] === 0) {
          this.toast(`Add at least one ${scope.toUpperCase()} entry first`);
          return;
        }
        // DSR has a second choice: one report covering every logged date, or
        // a single date picked out on its own.
        if (scope === 'dsr') {
          this.openDsrScopeModal(job, (dsrOptions) => this.runReportGeneration(job, scope, dsrOptions));
          return;
        }
        // With more than one time sheet (separate visits), pick which one —
        // each has its own dates and its own approval.
        if (scope === 'tsr' && job.tsrEntries.length > 1) {
          this.openTsrScopeModal(job, (tsrOptions) => this.runReportGeneration(job, scope, tsrOptions));
          return;
        }
        this.runReportGeneration(job, scope, {});
      });
    });
  },

  // Shared tail of report generation — picks a format, builds the file, and
  // shows the "Report ready" modal. `options` carries scope-specific extras
  // (currently just { dsrDate } for a single-date DSR report).
  runReportGeneration(job, scope, options) {
    this.openFormatChoiceModal(async (format) => {
      try {
        const { blob, filename } = await Report.generate(job, this.worker, format, scope, options);
        this.openReportModal(blob, filename, job, scope);
      } catch (err) {
        console.error('Report generation failed', err);
        this.toast('Could not generate report — see console for details');
      }
    });
  },

  // Lets the worker pick which time sheet (visit) to generate a Time Sheet
  // Report for, or every time sheet in one report. onChoose(options) gets
  // { tsrId } for one time sheet, or {} for all of them.
  openTsrScopeModal(job, onChoose) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const buttonsHtml = job.tsrEntries.map((entry, idx) => {
      const dates = (entry.dayEntries || []).map((d) => d.date).sort();
      const range = !dates.length ? 'no dates yet'
        : dates.length === 1 ? formatDateLong(dates[0])
        : `${formatDateLong(dates[0])} – ${formatDateLong(dates[dates.length - 1])}`;
      return `<button class="btn btn-block mt8" data-tsr-id-btn="${entry.id}">Time Sheet ${idx + 1} · ${escapeHtml(range)}${entry.approval ? ' ✓' : ''}</button>`;
    }).join('');
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>Time Sheet Report (TSR)</h3>
        <p class="text-dim">Pick which time sheet to generate.</p>
        ${buttonsHtml}
        <button class="btn btn-block mt8" id="tsr-scope-all-btn">All time sheets (one report)</button>
        <button class="btn btn-ghost btn-block mt8" id="tsr-scope-cancel-btn">Cancel</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#tsr-scope-cancel-btn').addEventListener('click', close);
    backdrop.querySelector('#tsr-scope-all-btn').addEventListener('click', () => { close(); onChoose({}); });
    backdrop.querySelectorAll('[data-tsr-id-btn]').forEach((btn) => {
      btn.addEventListener('click', () => { close(); onChoose({ tsrId: btn.dataset.tsrIdBtn }); });
    });
  },

  // Lets the worker pick which single date's DSR entry to generate a report
  // for — there's no "all dates together" option, a DSR report always
  // covers exactly one date. onChoose(options) is called with { dsrDate }.
  openDsrScopeModal(job, onChoose) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const sortedEntries = (job.dsrEntries || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const dateButtonsHtml = sortedEntries.length
      ? sortedEntries.map((entry) => `<button class="btn btn-block mt8" data-dsr-date-btn="${entry.date}">${formatDateLong(entry.date)}</button>`).join('')
      : '<p class="text-dim">No dates logged yet.</p>';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>Daily Report (DSR)</h3>
        <p class="text-dim">Pick a date to generate its report.</p>
        ${dateButtonsHtml}
        <button class="btn btn-ghost btn-block mt8" id="dsr-scope-cancel-btn">Cancel</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#dsr-scope-cancel-btn').addEventListener('click', close);
    backdrop.querySelectorAll('[data-dsr-date-btn]').forEach((btn) => {
      btn.addEventListener('click', () => { close(); onChoose({ dsrDate: btn.dataset.dsrDateBtn }); });
    });
  },

  // ---------- Job header card: site name, service order, scope, history ----------
  renderJobHeaderCard(job) {
    const card = document.createElement('div');
    card.innerHTML = `
      <div class="field-label-row">
        <label class="field-label">Customer / Client Name</label>
        <button class="job-remove-btn" data-delete-job title="Delete job">🗑</button>
      </div>
      <input type="text" class="job-site-input" data-job-field="siteName" placeholder="e.g. Acme Manufacturing" value="${escapeHtml(job.siteName)}" />

      <label class="field-label mt8">Job Site / Location</label>
      <input type="text" data-job-field="siteLocation" placeholder="e.g. Riverside Plant" value="${escapeHtml(job.siteLocation || '')}" />

      <label class="field-label mt8">Service Order / Unit Number</label>
      <input type="text" data-job-field="serviceOrder" placeholder="e.g. SO-48213" value="${escapeHtml(job.serviceOrder || '')}" />
      <label class="field-label mt8">Overall Job Scope</label>
      <textarea class="log-input" data-job-field="overallJobScope" placeholder="Describe the overall scope of this job…">${escapeHtml(job.overallJobScope || '')}</textarea>
      <label class="field-label mt8">Job History</label>
      <textarea class="log-input" data-job-field="jobHistory" placeholder="Relevant history / background…">${escapeHtml(job.jobHistory || '')}</textarea>
    `;
    // Use the actual element rather than a wrapper div, so it picks up .card
    // styling from the placeholder container in renderJobDetail.
    const wrapper = document.createDocumentFragment();
    while (card.firstChild) wrapper.appendChild(card.firstChild);
    const holder = document.createElement('div');
    holder.appendChild(wrapper);

    holder.querySelectorAll('[data-job-field]').forEach((el) => {
      el.addEventListener('change', async () => {
        job[el.dataset.jobField] = el.value;
        await DB.saveJob(job);
      });
    });
    holder.querySelector('[data-delete-job]').addEventListener('click', async () => {
      if (!confirm(`Delete "${job.siteName || 'this job'}" and everything logged under it (TSR, DSR, FSR entries, and photos)? This can't be undone.`)) return;
      await DB.deleteJob(job.id);
      location.hash = '#/jobs';
    });

    return holder;
  },

  // ---------- Time Sheet Report (TSR) — one per job, one block per date ----------
  // Wraps an entry card in a click-to-open bar so each Time Sheet / DSR / FSR
  // entry starts minimized. `summaryFn()` returns the one-line title; it is
  // re-run when the card changes so the bar stays current. Which entries are
  // open is remembered (for this visit to the app) so re-renders don't fold
  // them away.
  collapsibleEntry(card, id, icon, summaryFn) {
    this._openEntries = this._openEntries || new Set();
    const det = document.createElement('details');
    det.className = 'entry-collapse';
    if (this._openEntries.has(id)) det.open = true;
    const sum = document.createElement('summary');
    const paint = () => {
      const { title, meta } = summaryFn();
      sum.innerHTML = `<span class="entry-icon">${icon}</span><span class="entry-title">${escapeHtml(title)}</span>${meta ? `<span class="entry-meta">${escapeHtml(meta)}</span>` : ''}<span class="entry-chevron">▾</span>`;
    };
    paint();
    det.appendChild(sum);
    det.appendChild(card);
    det.addEventListener('toggle', () => { if (det.open) this._openEntries.add(id); else this._openEntries.delete(id); });
    const repaint = () => setTimeout(paint, 60);
    card.addEventListener('change', repaint);
    card.addEventListener('click', repaint);
    card.addEventListener('input', repaint);
    return det;
  },

  tsrSummary(tsrEntry, idx, total) {
    const dates = (tsrEntry.dayEntries || []).map((d) => d.date).filter(Boolean).sort();
    const span = dates.length === 0 ? 'no dates yet' : dates.length === 1 ? formatDateShort(dates[0]) : `${formatDateShort(dates[0])} – ${formatDateShort(dates[dates.length - 1])}`;
    return {
      title: total > 1 ? `Time Sheet ${idx + 1}` : 'Time Sheet',
      meta: `${span} · ${dates.length} day${dates.length === 1 ? '' : 's'}${tsrEntry.approval ? ' · ✓ Approved' : ''}`
    };
  },
  dsrSummary(job, dsrEntry) {
    const date = dsrEntry.date ? formatDateLong(dsrEntry.date) : 'No date';
    const travel = dsrEntry.date && jobDateIsTravelOnly(job, dsrEntry.date);
    return { title: date, meta: travel ? '🚗 Travel day' : ((dsrEntry.workCompleted || '').trim() ? 'Has entries' : 'Empty') };
  },
  fsrSummary(fsrEntry, idx) {
    const enabled = Object.values(fsrEntry.testSections || {}).filter((x) => x && x.enabled).length;
    const bits = [fsrEntry.reportType === 'generator' ? 'Generator' : fsrEntry.reportType === 'motor' ? 'Motor' : '', fsrEntry.testDate ? formatDateShort(fsrEntry.testDate) : '', enabled ? `${enabled} test section${enabled === 1 ? '' : 's'}` : ''].filter(Boolean);
    return { title: (fsrEntry.modelNumber || '').trim() || `Equipment ${idx + 1}`, meta: bits.join(' · ') };
  },

  renderTsrEntryCard(job, tsrEntry, idx = 0) {
    const locked = !!tsrEntry.approval;
    const card = document.createElement('div');
    card.className = 'card job-card' + (locked ? ' locked' : '');

    const dayTimeRangeHtml = (day) => `
      <div class="time-range-row">
        <select data-day-time-part="startHour" ${locked ? 'disabled' : ''}>${hourSelectOptions(day.startHour)}</select>
        <select data-day-time-part="startMinute" ${locked ? 'disabled' : ''}>${minuteSelectOptions(day.startMinute)}</select>
        <select data-day-time-part="startPeriod" ${locked ? 'disabled' : ''}>${periodSelectOptions(day.startPeriod)}</select>
        <span class="time-sep">to</span>
        <select data-day-time-part="endHour" ${locked ? 'disabled' : ''}>${hourSelectOptions(day.endHour)}</select>
        <select data-day-time-part="endMinute" ${locked ? 'disabled' : ''}>${minuteSelectOptions(day.endMinute)}</select>
        <select data-day-time-part="endPeriod" ${locked ? 'disabled' : ''}>${periodSelectOptions(day.endPeriod)}</select>
      </div>
    `;

    // Labor and Travel always sum to the day's total logged hours (from its
    // time range above) — only laborHours is stored, Travel is always the
    // remainder, so editing either number here keeps both in sync (see the
    // change handlers below).
    const laborTravelHtml = (day) => {
      const total = tsrDayTotalHours(day);
      const laborVal = day.laborHours == null ? '' : formatHoursShort(Math.min(day.laborHours, total));
      const travelVal = day.laborHours == null ? '' : formatHoursShort(Math.max(0, total - day.laborHours));
      return `
        <div class="tsr-total-hours" data-day-total-hours>Total logged: ${formatHoursShort(total)} hrs</div>
        <div class="labor-travel-row">
          <div class="labor-travel-field">
            <label class="field-label-sm">Labor (hrs)</label>
            <input type="number" min="0" max="${total}" step="0.25" inputmode="decimal" data-day-labor-hours value="${laborVal}" placeholder="0" ${locked ? 'disabled' : ''} />
          </div>
          <div class="labor-travel-field">
            <label class="field-label-sm">Travel (hrs)</label>
            <input type="number" min="0" max="${total}" step="0.25" inputmode="decimal" data-day-travel-hours value="${travelVal}" placeholder="0" ${locked ? 'disabled' : ''} />
          </div>
        </div>
      `;
    };

    const approvalHtml = tsrEntry.approval ? `
      <div class="approval-approved">
        <img src="${tsrEntry.approval.signatureDataUrl}" alt="Signature" />
        <div class="approval-approved-text">
          ✓ Approved
          <span class="who">${escapeHtml(tsrEntry.approval.signedBy)}${tsrEntry.approval.signedRole ? ' — ' + escapeHtml(tsrEntry.approval.signedRole) : ''} · ${formatTime(tsrEntry.approval.signedAt)}</span>
        </div>
      </div>
      <div class="locked-note">
        <span>Editing is locked while approved.</span>
        <button class="btn btn-sm" data-clear-approval>Clear approval</button>
      </div>
    ` : `
      <button class="btn btn-primary btn-block" data-open-signature>✍️ Get approval signature</button>
    `;

    const sortedDayEntries = (tsrEntry.dayEntries || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const dayBlocksHtml = sortedDayEntries.length
      ? sortedDayEntries.map((day) => `
          <div class="tsr-day-block" data-day-date="${day.date}">
            <div class="tsr-day-head">
              <span class="tsr-day-date">${formatDateLong(day.date)}</span>
              ${locked ? '' : `<button type="button" class="date-chip-remove" data-remove-date="${day.date}" title="Remove date">×</button>`}
            </div>
            <label class="field-label mt8">Time</label>
            ${dayTimeRangeHtml(day)}
            <label class="field-label mt8">Labor / Travel split</label>
            ${laborTravelHtml(day)}
          </div>
        `).join('')
      : '<p class="text-dim">No dates selected yet.</p>';

    card.innerHTML = `
      <div class="job-head">
        <div class="fsr-entry-title">${job.tsrEntries.length > 1 ? `Time Sheet ${idx + 1}` : 'Time Sheet'}</div>
        ${job.tsrEntries.length > 1 ? '<button class="btn btn-sm btn-ghost" data-delete-tsr title="Delete this time sheet">🗑️ Delete</button>' : ''}
      </div>
      <label class="field-label">Dates covered by this time sheet</label>
      <div class="tsr-day-list" data-days-list>${dayBlocksHtml}</div>
      ${locked ? '' : `
        <div class="add-date-row">
          <input type="date" class="job-date-input" data-add-date-input />
          <button class="btn btn-sm" data-add-date-btn>+ Add date</button>
        </div>
      `}

      <div class="approval-box">${approvalHtml}</div>
    `;

    const addDateBtn = card.querySelector('[data-add-date-btn]');
    if (addDateBtn) addDateBtn.addEventListener('click', async () => {
      const input = card.querySelector('[data-add-date-input]');
      const val = input.value;
      if (!val) { this.toast('Pick a date first'); return; }
      tsrEntry.dayEntries = tsrEntry.dayEntries || [];
      // Each date has exactly one Daily Status Report, so a date can only be
      // logged on one time sheet.
      const owner = job.tsrEntries.findIndex((t) => (t.dayEntries || []).some((d) => d.date === val));
      if (owner !== -1) {
        this.toast(job.tsrEntries[owner] === tsrEntry ? 'That date is already added' : `That date is already on Time Sheet ${owner + 1}`);
        return;
      }
      tsrEntry.dayEntries.push(DB.newTsrDayEntry(val));
      // A DSR entry is created automatically for every date logged here —
      // there's no separate "+ Add DSR entry" step anymore.
      DB.ensureDsrEntryForDate(job, val, this.worker.name);
      await DB.saveJob(job);
      this.renderJobDetail(job.id);
    });

    const deleteTsrBtn = card.querySelector('[data-delete-tsr]');
    if (deleteTsrBtn) deleteTsrBtn.addEventListener('click', async () => {
      if (!confirm('Delete this whole time sheet? All of its dates, their Daily Status Report entries (and photos), and its approval will be removed. This can\'t be undone.')) return;
      const allPhotos = await DB.getPhotosForJob(job.id);
      for (const day of tsrEntry.dayEntries || []) {
        const removedDsr = DB.removeDsrEntryForDate(job, day.date);
        if (removedDsr) for (const p of allPhotos.filter((ph) => ph.ownerId === removedDsr.id)) await DB.deletePhoto(p.id);
      }
      job.tsrEntries = job.tsrEntries.filter((t) => t.id !== tsrEntry.id);
      await DB.saveJob(job);
      this.renderJobDetail(job.id);
    });

    card.querySelectorAll('[data-remove-date]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const date = btn.dataset.removeDate;
        if (!confirm('Remove this date? Its Daily Status Report entry (and any photos on it) will be deleted too. This can\'t be undone.')) return;
        tsrEntry.dayEntries = (tsrEntry.dayEntries || []).filter((d) => d.date !== date);
        // A DSR entry never outlives the TSR date it was created for.
        const removedDsr = DB.removeDsrEntryForDate(job, date);
        if (removedDsr) {
          const allPhotos = await DB.getPhotosForJob(job.id);
          const toDelete = allPhotos.filter((p) => p.ownerId === removedDsr.id);
          for (const p of toDelete) await DB.deletePhoto(p.id);
        }
        await DB.saveJob(job);
        this.renderJobDetail(job.id);
      });
    });

    card.querySelectorAll('.tsr-day-block').forEach((block) => {
      const date = block.dataset.dayDate;
      const day = (tsrEntry.dayEntries || []).find((d) => d.date === date);
      if (!day) return;

      // Keeps the "Total logged" readout and the Labor/Travel inputs in sync
      // with the day's current time range (total may change after an edit),
      // reclamping any stored laborHours so it never exceeds the new total.
      const totalEl = block.querySelector('[data-day-total-hours]');
      const laborInput = block.querySelector('[data-day-labor-hours]');
      const travelInput = block.querySelector('[data-day-travel-hours]');

      function refreshLaborTravel() {
        const total = tsrDayTotalHours(day);
        if (day.laborHours != null) day.laborHours = Math.max(0, Math.min(day.laborHours, total));
        if (totalEl) totalEl.textContent = `Total logged: ${formatHoursShort(total)} hrs`;
        if (laborInput) laborInput.max = String(total);
        if (travelInput) travelInput.max = String(total);
        if (laborInput) laborInput.value = day.laborHours == null ? '' : formatHoursShort(day.laborHours);
        if (travelInput) travelInput.value = day.laborHours == null ? '' : formatHoursShort(Math.max(0, total - day.laborHours));
        return total;
      }

      // Saves, then rebuilds the DSR cards if this date just flipped between
      // "all travel" and "has labor" (its DSR card collapses / expands).
      const saveAndSyncDsr = async (wasTravelOnly) => {
        tsrEntry.updatedAt = Date.now();
        await DB.saveJob(job);
        if (tsrDayIsTravelOnly(day) !== wasTravelOnly && this._refreshDsrList) await this._refreshDsrList();
      };

      block.querySelectorAll('[data-day-time-part]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const wasTravelOnly = tsrDayIsTravelOnly(day);
          const part = sel.dataset.dayTimePart;
          day[part] = part.includes('Period') ? sel.value : Number(sel.value);
          refreshLaborTravel();
          await saveAndSyncDsr(wasTravelOnly);
        });
      });

      if (laborInput) laborInput.addEventListener('change', async () => {
        const wasTravelOnly = tsrDayIsTravelOnly(day);
        const total = tsrDayTotalHours(day);
        let labor = parseFloat(laborInput.value);
        if (isNaN(labor)) labor = 0;
        day.laborHours = Math.max(0, Math.min(total, labor));
        refreshLaborTravel();
        await saveAndSyncDsr(wasTravelOnly);
      });

      if (travelInput) travelInput.addEventListener('change', async () => {
        const wasTravelOnly = tsrDayIsTravelOnly(day);
        const total = tsrDayTotalHours(day);
        let travel = parseFloat(travelInput.value);
        if (isNaN(travel)) travel = 0;
        travel = Math.max(0, Math.min(total, travel));
        day.laborHours = Math.max(0, total - travel);
        refreshLaborTravel();
        await saveAndSyncDsr(wasTravelOnly);
      });
    });

    const openSigBtn = card.querySelector('[data-open-signature]');
    if (openSigBtn) openSigBtn.addEventListener('click', () => this.openTsrSignatureModal(job, tsrEntry));

    const clearApprovalBtn = card.querySelector('[data-clear-approval]');
    if (clearApprovalBtn) {
      clearApprovalBtn.addEventListener('click', async () => {
        if (!confirm('Clear this approval so the time sheet can be edited again?')) return;
        tsrEntry.approval = null;
        await DB.saveJob(job);
        this.renderJobDetail(job.id);
      });
    }

    return card;
  },

  // ---------- Daily Status Report (DSR) — one per day worked ----------
  renderDsrEntryCard(job, dsrEntry, photos) {
    const card = document.createElement('div');
    card.className = 'card';

    const fieldPhotos = (fieldKey) => photos.filter((p) => p.ownerId === dsrEntry.id && p.type === fieldKey);

    // A date that's 100% travel on the Time Sheet (Labor set to 0 hrs) gets a
    // short "Travel day" DSR instead of the full form — nothing to fill in
    // beyond optional team/notes. Switches back to the full form on its own
    // if the Time Sheet's Labor/Travel split is changed later.
    if (jobDateIsTravelOnly(job, dsrEntry.date)) {
      card.classList.add('dsr-travel-card');
      card.innerHTML = `
        <div class="field-label-row">
          <label class="field-label">Date</label>
        </div>
        <div class="dsr-travel-date">${formatDateLong(dsrEntry.date)}</div>
        <div class="dsr-travel-banner">🚗 Travel day — this date is all travel hours on the Time Sheet, so no full daily report is needed. It will appear as "Travel" in the DSR report.</div>

        <label class="field-label mt8">Team head /members: (optional)</label>
        <textarea class="log-input" data-daily-field="teamMembers" placeholder="e.g. Mike (lead), Dhanush">${escapeHtml(dsrEntry.teamMembers || '')}</textarea>

        <label class="field-label mt8">Travel notes (optional)</label>
        <textarea class="log-input" data-daily-field="travelNotes" placeholder="e.g. Drove from Houston to site, arrived 6 PM…">${escapeHtml(dsrEntry.travelNotes || '')}</textarea>
      `;
      card.querySelectorAll('[data-daily-field]').forEach((ta) => {
        ta.addEventListener('change', async () => {
          dsrEntry[ta.dataset.dailyField] = ta.value;
          await DB.saveJob(job);
        });
      });
      return card;
    }

    card.innerHTML = `
      <div class="field-label-row">
        <label class="field-label">Date</label>
        <button class="job-remove-btn" data-remove-dsr title="Remove DSR entry">🗑</button>
      </div>
      <input type="date" class="job-date-input" data-dsr-date value="${dsrEntry.date}" />

      <label class="field-label mt8">Team head /members:</label>
      <textarea class="log-input" data-daily-field="teamMembers" placeholder="e.g. Mike (lead), Dhanush">${escapeHtml(dsrEntry.teamMembers || '')}</textarea>

      <label class="field-label mt8">First Aid / Near Misses / Recordable Injuries to Date:</label>
      <div class="yn-toggle">
        <button type="button" class="yn-btn ${dsrEntry.firstAidIncident === 'no' ? 'selected' : ''}" data-firstaid-btn="no">No</button>
        <button type="button" class="yn-btn ${dsrEntry.firstAidIncident === 'yes' ? 'selected' : ''}" data-firstaid-btn="yes">Yes</button>
      </div>
      <textarea class="log-input mt8" data-daily-field="firstAidExplanation" data-firstaid-explain placeholder="Describe what happened…" style="${dsrEntry.firstAidIncident === 'yes' ? '' : 'display:none;'}">${escapeHtml(dsrEntry.firstAidExplanation || '')}</textarea>

      <label class="field-label mt8">Further Job History</label>
      <textarea class="log-input" data-daily-field="furtherJobHistory" placeholder="Anything further to add to the job history…">${escapeHtml(dsrEntry.furtherJobHistory || '')}</textarea>

      <label class="field-label mt8">Work Completed</label>
      <textarea class="log-input" data-daily-field="workCompleted" placeholder="What was completed today…">${escapeHtml(dsrEntry.workCompleted || '')}</textarea>
      ${this.renderDsrFieldPhotoSlot('workCompleted', fieldPhotos('workCompleted'))}

      <label class="field-label mt8">Technical Comments / Concerns / Findings</label>
      <textarea class="log-input" data-daily-field="technicalComments" placeholder="Anything technical worth flagging…">${escapeHtml(dsrEntry.technicalComments || '')}</textarea>
      ${this.renderDsrFieldPhotoSlot('technicalComments', fieldPhotos('technicalComments'))}

      <label class="field-label mt8">Current Status / Next Steps</label>
      <textarea class="log-input" data-daily-field="currentStatus" placeholder="Where things stand and what's next…">${escapeHtml(dsrEntry.currentStatus || '')}</textarea>
      ${this.renderDsrFieldPhotoSlot('currentStatus', fieldPhotos('currentStatus'))}
    `;

    card.querySelector('[data-dsr-date]').addEventListener('change', async (e) => {
      dsrEntry.date = e.target.value;
      await DB.saveJob(job);
    });

    card.querySelectorAll('[data-daily-field]').forEach((ta) => {
      ta.addEventListener('change', async () => {
        dsrEntry[ta.dataset.dailyField] = ta.value;
        await DB.saveJob(job);
      });
    });

    card.querySelectorAll('[data-firstaid-btn]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        dsrEntry.firstAidIncident = btn.dataset.firstaidBtn;
        await DB.saveJob(job);
        card.querySelectorAll('[data-firstaid-btn]').forEach((b) => b.classList.toggle('selected', b === btn));
        const explainTa = card.querySelector('[data-firstaid-explain]');
        if (explainTa) explainTa.style.display = dsrEntry.firstAidIncident === 'yes' ? '' : 'none';
      });
    });

    card.querySelector('[data-remove-dsr]').addEventListener('click', async () => {
      if (!confirm('Remove this DSR entry and its photos? This can\'t be undone.')) return;
      const allPhotos = await DB.getPhotosForJob(job.id);
      const toDelete = allPhotos.filter((p) => p.ownerId === dsrEntry.id);
      for (const p of toDelete) await DB.deletePhoto(p.id);
      job.dsrEntries = job.dsrEntries.filter((e) => e.id !== dsrEntry.id);
      await DB.saveJob(job);
      this.renderJobDetail(job.id);
    });

    card.querySelectorAll('[data-dsr-photo-capture]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const fieldKey = btn.dataset.dsrPhotoCapture;
        const blobs = await Camera.pickPhotos();
        if (!blobs.length) return;
        for (const blob of blobs) await DB.addPhoto(job.id, dsrEntry.id, fieldKey, blob);
        this.toast(blobs.length === 1 ? 'Photo added' : `${blobs.length} photos added`);
        this.renderJobDetail(job.id);
      });
    });
    card.querySelectorAll('[data-delete-dsr-photo]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await DB.deletePhoto(btn.dataset.deleteDsrPhoto);
        this.renderJobDetail(job.id);
      });
    });

    return card;
  },

  // ---------- Field Service Report (FSR) — repeatable, one per unit/equipment ----------
  renderFsrEntryCard(job, fsrEntry, idx, photos) {
    fsrEntry.testSections = fsrEntry.testSections || {};
    const card = document.createElement('div');
    card.className = 'card job-card';

    const reportTypeOptions = [
      ['', 'Select report type…'],
      ['generator', 'Generator Report'],
      ['motor', 'Motor Report']
    ].map(([val, label]) => `<option value="${val}" ${(fsrEntry.reportType || '') === val ? 'selected' : ''}>${label}</option>`).join('');

    const sectionPhotoHtml = (sectionKey) => {
      const ownerId = DB.testSectionPhotoOwnerId(fsrEntry.id, sectionKey);
      const sectionPhotos = photos.filter((p) => p.ownerId === ownerId && p.type === 'section');
      return this.renderSectionPhotoSlot(sectionKey, sectionPhotos, false);
    };

    const testSectionsHtml = fsrEntry.reportType ? `
      <div class="section-label">Test Sections</div>
      <p class="text-dim tf-intro">Check off the sections that apply to this ${fsrEntry.reportType === 'generator' ? 'generator' : 'motor'}. Each section has its own photo capture/upload option — add as many photos as you need.</p>
      <div data-test-checklist>${TestSections.renderChecklist(fsrEntry, sectionPhotoHtml)}</div>
    ` : '';

    card.innerHTML = `
      <div class="field-label-row">
        <label class="field-label">Model Number</label>
        <button class="job-remove-btn" data-remove-fsr title="Remove FSR entry">🗑</button>
      </div>
      <input type="text" data-fsr-field="modelNumber" placeholder="e.g. M-4501" value="${escapeHtml(fsrEntry.modelNumber || '')}" />

      <label class="field-label mt8">Test Date</label>
      <input type="date" class="job-date-input" data-fsr-test-date value="${escapeHtml(fsrEntry.testDate || '')}" />

      <label class="field-label mt8">Report Type</label>
      <select data-report-type>${reportTypeOptions}</select>
      ${testSectionsHtml}
    `;

    const modelInput = card.querySelector('[data-fsr-field="modelNumber"]');
    modelInput.addEventListener('change', async () => {
      fsrEntry.modelNumber = modelInput.value.trim();
      await DB.saveJob(job);
    });

    card.querySelector('[data-fsr-test-date]').addEventListener('change', async (e) => {
      fsrEntry.testDate = e.target.value;
      await DB.saveJob(job);
    });

    const reportTypeSelect = card.querySelector('[data-report-type]');
    reportTypeSelect.addEventListener('change', async () => {
      fsrEntry.reportType = reportTypeSelect.value || null;
      await DB.saveJob(job);
      this.renderJobDetail(job.id);
    });

    const checklistEl = card.querySelector('[data-test-checklist]');
    if (checklistEl) {
      checklistEl.querySelectorAll('[data-test-toggle]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          const key = cb.dataset.testToggle;
          const existing = fsrEntry.testSections[key] || { enabled: false, values: {} };
          fsrEntry.testSections[key] = { enabled: cb.checked, values: existing.values || {} };
          await DB.saveJob(job);
          this.renderJobDetail(job.id);
        });
      });

      const testFieldDebounce = {};   // one pending save per section, so editing one doesn't cancel another's
      checklistEl.addEventListener('input', (e) => {
        const bodyEl = e.target.closest('[data-test-body]');
        if (!bodyEl) return;
        const debounceKey = bodyEl.dataset.testBody;
        clearTimeout(testFieldDebounce[debounceKey]);
        // Auto-calculated rows (P.I.) update immediately as readings are typed.
        const liveSection = REPORT_SECTIONS.find((s) => s.key === bodyEl.dataset.testBody);
        if (liveSection) TestSections.refreshCalculated(liveSection, bodyEl);
        testFieldDebounce[debounceKey] = setTimeout(async () => {
          const sectionKey = bodyEl.dataset.testBody;
          const section = REPORT_SECTIONS.find((s) => s.key === sectionKey);
          if (!section) return;
          const values = TestSections.collectSectionValues(section, bodyEl);
          const existing = fsrEntry.testSections[sectionKey] || { enabled: true, values: {} };
          fsrEntry.testSections[sectionKey] = { enabled: existing.enabled, values };
          await DB.saveJob(job);
        }, 400);
      });
      checklistEl.addEventListener('change', async (e) => {
        const bodyEl = e.target.closest('[data-test-body]');
        if (!bodyEl || !e.target.matches('select')) return;
        const sectionKey = bodyEl.dataset.testBody;
        const section = REPORT_SECTIONS.find((s) => s.key === sectionKey);
        if (!section) return;
        TestSections.refreshCalculated(section, bodyEl);   // e.g. a unit change affects P.I.
        const values = TestSections.collectSectionValues(section, bodyEl);
        const existing = fsrEntry.testSections[sectionKey] || { enabled: true, values: {} };
        fsrEntry.testSections[sectionKey] = { enabled: existing.enabled, values };
        await DB.saveJob(job);
      });

      checklistEl.querySelectorAll('[data-section-capture]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const sectionKey = btn.dataset.sectionCapture;
          const blobs = await Camera.pickPhotos();
          if (!blobs.length) return;
          const ownerId = DB.testSectionPhotoOwnerId(fsrEntry.id, sectionKey);
          for (const blob of blobs) await DB.addPhoto(job.id, ownerId, 'section', blob);
          this.toast(blobs.length === 1 ? 'Section photo added' : `${blobs.length} section photos added`);
          this.renderJobDetail(job.id);
        });
      });
      checklistEl.querySelectorAll('[data-delete-section-photo]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await DB.deletePhoto(btn.dataset.deleteSectionPhoto);
          this.renderJobDetail(job.id);
        });
      });
    }

    card.querySelector('[data-remove-fsr]').addEventListener('click', async () => {
      if (!confirm('Remove this FSR entry and its photos? This can\'t be undone.')) return;
      const allPhotos = await DB.getPhotosForJob(job.id);
      const toDelete = allPhotos.filter((p) => p.ownerId === fsrEntry.id || p.ownerId.startsWith(fsrEntry.id + '::'));
      for (const p of toDelete) await DB.deletePhoto(p.id);
      job.fsrEntries = job.fsrEntries.filter((e) => e.id !== fsrEntry.id);
      await DB.saveJob(job);
      this.renderJobDetail(job.id);
    });

    return card;
  },

  // Compact photo slot shown under a DSR narrative field (Work Completed /
  // Technical Comments / Current Status) — any number of optional photos per
  // field; the Upload button stays available after photos are added so more
  // can keep being attached.
  renderDsrFieldPhotoSlot(fieldKey, photos) {
    const gallery = photos.length
      ? `<div class="photo-thumbs">${photos.map((photo) => `<div class="photo-thumb small"><img src="${this.objectUrlFor(photo)}" alt="photo"/><button data-delete-dsr-photo="${photo.id}">×</button></div>`).join('')}</div>`
      : '';
    return `
      <div class="multi-photo-slot section-photo-slot">
        ${gallery}
        <div class="photo-actions">
          <button class="btn btn-sm" data-dsr-photo-capture="${fieldKey}">🖼️ Upload</button>
        </div>
      </div>
    `;
  },

  // Compact photo slot shown inside an expanded technical inspection section
  // — lets the worker attach any number of optional photos per section (a
  // nameplate, a bearing, a reading on a meter, etc.) alongside the fields.
  renderSectionPhotoSlot(sectionKey, photos, locked) {
    const gallery = photos.length
      ? `<div class="photo-thumbs">${photos.map((photo) => `<div class="photo-thumb small"><img src="${this.objectUrlFor(photo)}" alt="section photo"/>${locked ? '' : `<button data-delete-section-photo="${photo.id}">×</button>`}</div>`).join('')}</div>`
      : '';
    const actions = locked ? '' : `
      <div class="photo-actions">
        <button class="btn btn-sm" data-section-capture="${sectionKey}">🖼️ Upload</button>
      </div>`;
    return `
      <div class="multi-photo-slot section-photo-slot">
        <div class="field-label" style="margin-bottom:6px;">Section photos (optional)</div>
        ${gallery}
        ${actions}
      </div>
    `;
  },

  // ---------- TSR approval signature ----------
  openTsrSignatureModal(job, tsrEntry) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop sig-backdrop';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>Approval signature</h3>
        <p class="text-dim sig-subtitle">${escapeHtml(job.siteName || 'This job')} · ${escapeHtml(formatTsrDatesLabel((tsrEntry.dayEntries || []).map((d) => d.date)))}</p>
        <div class="sig-fields">
          <div>
            <label class="field-label">Client name</label>
            <input type="text" id="sig-name" placeholder="e.g. Jordan Lee" />
          </div>
          <div>
            <label class="field-label">Role / Position</label>
            <input type="text" id="sig-role" placeholder="e.g. Site Manager" />
          </div>
        </div>
        <label class="field-label sig-label">Signature <span class="sig-rotate-tip">· turn your phone sideways for a bigger signing area</span></label>
        <div class="sig-canvas-wrap"><canvas id="sig-canvas"></canvas></div>
        <p class="sig-hint">Sign with your finger or mouse above</p>
        <div class="row sig-actions">
          <button class="btn" id="sig-clear-btn">Clear</button>
          <button class="btn" id="sig-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="sig-save-btn" style="flex:1;">Approve &amp; Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const canvas = backdrop.querySelector('#sig-canvas');
    const wrap = backdrop.querySelector('.sig-canvas-wrap');
    const ctx = canvas.getContext('2d');
    let drawing = false, hasDrawn = false, lastX = 0, lastY = 0;

    const resetCtx = () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2.5 * Math.min(window.devicePixelRatio || 1, 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };

    // The signing area is bigger in landscape (see .sig-backdrop in
    // css/style.css), so the drawing buffer is sized to match whatever space
    // it currently has — and re-sized (keeping anything already signed,
    // scaled to fit) whenever the phone is rotated.
    const fitCanvas = () => {
      const rect = wrap.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
      if (canvas.width === w && canvas.height === h) return;
      const old = document.createElement('canvas');
      old.width = canvas.width; old.height = canvas.height;
      if (old.width && old.height) old.getContext('2d').drawImage(canvas, 0, 0);
      canvas.width = w; canvas.height = h;
      resetCtx();
      if (hasDrawn && old.width && old.height) {
        const k = Math.min(w / old.width, h / old.height);
        const dw = old.width * k, dh = old.height * k;
        ctx.drawImage(old, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
    };
    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    const posFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    };

    canvas.addEventListener('pointerdown', (e) => {
      drawing = true; hasDrawn = true;
      const p = posFromEvent(e); lastX = p.x; lastY = p.y;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = posFromEvent(e);
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke();
      lastX = p.x; lastY = p.y;
    });
    const stopDrawing = () => { drawing = false; };
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointerleave', stopDrawing);

    const close = () => { window.removeEventListener('resize', fitCanvas); backdrop.remove(); };

    backdrop.querySelector('#sig-clear-btn').addEventListener('click', () => {
      resetCtx();
      hasDrawn = false;
    });
    backdrop.querySelector('#sig-cancel-btn').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    backdrop.querySelector('#sig-save-btn').addEventListener('click', async () => {
      const name = backdrop.querySelector('#sig-name').value.trim();
      const role = backdrop.querySelector('#sig-role').value.trim();
      if (!name) { this.toast('Enter the client\'s name'); return; }
      if (!hasDrawn) { this.toast('Please sign before saving'); return; }

      // Always saved as the same 600x260 image regardless of how big the
      // signing area was (portrait vs landscape), so reports lay it out
      // identically either way.
      const out = document.createElement('canvas');
      out.width = 600; out.height = 260;
      const octx = out.getContext('2d');
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, 600, 260);
      const k = Math.min(600 / canvas.width, 260 / canvas.height);
      octx.drawImage(canvas, (600 - canvas.width * k) / 2, (260 - canvas.height * k) / 2, canvas.width * k, canvas.height * k);

      tsrEntry.approval = {
        signedBy: name,
        signedRole: role,
        signatureDataUrl: out.toDataURL('image/png'),
        signedAt: Date.now()
      };
      await DB.saveJob(job);
      close();
      this.toast(`Approved by ${name}`);
      this.renderJobDetail(job.id);
    });
  },

  // ---------- Report generation: scope, then format, then save/share ----------
  // First asks which content to include (TSR / DSR / FSR), then hands the
  // chosen scope to onChoose. There's no "Combined (all)" option — each
  // report is scoped to exactly one of TSR, DSR, or FSR.
  openReportScopeModal(onChoose) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>Generate report</h3>
        <p class="text-dim">What do you want to generate?</p>
        <button class="btn btn-primary btn-block mt8" id="scope-tsr-btn">⏱️ Time Sheet (TSR)</button>
        <button class="btn btn-block mt8" id="scope-dsr-btn">📋 Daily Report (DSR)</button>
        <button class="btn btn-block mt8" id="scope-fsr-btn">🔧 Field Report (FSR)</button>
        <button class="btn btn-ghost btn-block mt8" id="scope-cancel-btn">Cancel</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#scope-cancel-btn').addEventListener('click', close);
    backdrop.querySelector('#scope-tsr-btn').addEventListener('click', () => { close(); onChoose('tsr'); });
    backdrop.querySelector('#scope-dsr-btn').addEventListener('click', () => { close(); onChoose('dsr'); });
    backdrop.querySelector('#scope-fsr-btn').addEventListener('click', () => { close(); onChoose('fsr'); });
  },

  // Lets the worker pick Word (.docx) or PDF before the report is built.
  // onChoose(format) is called with 'docx' or 'pdf'; the button shows a
  // "Generating…" state and stays open until report generation resolves.
  openFormatChoiceModal(onChoose) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>Choose a format</h3>
        <p class="text-dim">Choose a format for this report.</p>
        <button class="btn btn-primary btn-block mt8" id="format-docx-btn">📄 Word (.docx)</button>
        <button class="btn btn-block mt8" id="format-pdf-btn">📕 PDF</button>
        <button class="btn btn-ghost btn-block mt8" id="format-cancel-btn">Cancel</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#format-cancel-btn').addEventListener('click', close);

    const pick = async (format, btn) => {
      backdrop.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      btn.textContent = 'Generating…';
      try {
        await onChoose(format);
      } finally {
        close();
      }
    };
    backdrop.querySelector('#format-docx-btn').addEventListener('click', (e) => pick('docx', e.currentTarget));
    backdrop.querySelector('#format-pdf-btn').addEventListener('click', (e) => pick('pdf', e.currentTarget));
  },

  openReportModal(blob, filename, job, scope) {
    const canShareFiles = Report.canShareFile(new File([blob], filename, { type: blob.type }));
    const scopeLabel = scopeLabelFor(scope);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>Report ready</h3>
        <p class="text-dim">${escapeHtml(filename)}</p>
        <button class="btn btn-primary btn-block mt8" id="report-save-btn">💾 Save to device</button>
        <button class="btn btn-block mt8" id="report-email-btn">✉️ Share via email</button>
        <p class="sig-hint mt8">${canShareFiles ? 'Opens your share sheet — pick Mail, Gmail, or any app.' : 'Your browser can\'t attach files to share directly — saving the file first, then opening your mail app.'}</p>
        <button class="btn btn-ghost btn-block" id="report-close-btn">Close</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#report-close-btn').addEventListener('click', close);

    backdrop.querySelector('#report-save-btn').addEventListener('click', () => {
      Report.saveLocally(blob, filename);
      this.toast('Report saved to your device');
      close();
    });

    backdrop.querySelector('#report-email-btn').addEventListener('click', async () => {
      const subject = `${scopeLabel} — ${job.siteName || 'Job'}`;
      const body = `Attached is the ${scopeLabel.toLowerCase()} for ${job.siteName || 'this job'} (${this.worker.name}).`;
      const res = await Report.shareViaEmail(blob, filename, { subject, body, to: '' });
      if (res.cancelled) return; // user backed out of the share sheet, leave modal open
      this.toast(res.method === 'share' ? 'Shared' : 'Report saved — attach it to the email that just opened');
      close();
    });
  },

  objectUrlFor(photo) {
    if (!this.photoUrls.has(photo.id)) {
      this.photoUrls.set(photo.id, URL.createObjectURL(photo.blob));
    }
    return this.photoUrls.get(photo.id);
  },

  // ---------- Settings ----------
  async renderSettings() {
    this.setShell({ title: 'EM-WEG Field Service', sub: `Settings · ${this.worker.name}` });
    this.setNav('settings');
    const settings = DB.getSettings();

    const currentTz = settings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    let tzList = (typeof Intl.supportedValuesOf === 'function') ? Intl.supportedValuesOf('timeZone') : COMMON_TIMEZONES;
    // Some engines resolve the device's default zone to "UTC" but omit it from
    // supportedValuesOf('timeZone') entirely — without this, a device set to
    // UTC would silently show the alphabetically-first zone as "selected"
    // instead, which is wrong and confusing. Make sure UTC is always an option.
    if (!tzList.includes('UTC')) tzList = ['UTC', ...tzList];
    const tzOptions = tzList.map((tz) =>
      `<option value="${tz}" ${tz === currentTz ? 'selected' : ''}>${tz.replace(/_/g, ' ')}</option>`
    ).join('');

    const backupFreq = settings.backupFrequency || 'daily';
    const freqOptions = [
      ['daily', 'Daily'],
      ['weekly', 'Weekly'],
      ['off', 'Manual only']
    ].map(([val, label]) => `<option value="${val}" ${val === backupFreq ? 'selected' : ''}>${label}</option>`).join('');

    const main = document.getElementById('main');
    main.innerHTML = `
      <div class="card">
        <h3>📲 Transfer to another device</h3>
        <p class="text-dim">Move your jobs and photos to your laptop or another phone — no account needed. On one device tap <b>Show code</b>: it shows an 8-digit number and a QR code. On the other device tap <b>Enter code</b> and scan the QR (or type the number). One step and they're paired. Both devices need internet for the first few seconds; your data goes straight between them, encrypted.</p>
        <button class="btn btn-primary btn-block mt8" id="xfer-send-btn">Show code on this device</button>
        <button class="btn btn-block mt8" id="xfer-receive-btn">Enter code from the other device</button>
      </div>
      <div class="card">
        <h3>Time zone</h3>
        <label class="field-label">Your time zone</label>
        <select id="time-zone">${tzOptions}</select>
        <button class="btn btn-primary btn-block mt8" id="save-timezone-btn">Save time zone</button>
        <p class="text-dim mt8">There's no fixed shift window — hours can be logged any time of day, since some jobs run well past a typical 8-hour day. This just labels report timestamps correctly if you work across regions.</p>
      </div>

      <div class="card">
        <h3>Backup</h3>
        <label class="field-label">Reminder frequency</label>
        <select id="backup-frequency">${freqOptions}</select>
        <button class="btn btn-primary btn-block mt8" id="backup-now-btn">💾 Backup data now</button>
        <button class="btn btn-block mt8" id="restore-backup-btn">📂 Restore from backup file</button>
        <p class="text-dim mt8" id="backup-status">${backupStatusText(settings)}</p>
        <p class="text-dim">A backup includes every job and every photo. Restoring adds the backup's data back onto this device (it never deletes what's already here) — use it to move to a new phone or recover after data was cleared.</p>
      </div>

      <div class="card">
        <h3>Your profile</h3>
        <label class="field-label">Name</label>
        <input type="text" id="profile-name" value="${escapeHtml(this.worker.name)}" />
        <label class="field-label">Role</label>
        <select id="profile-role">${roleOptionsHtml(this.worker.role || '')}</select>
        <label class="field-label">Area / Location</label>
        <input type="text" id="profile-area" value="${escapeHtml(this.worker.area || '')}" placeholder="e.g. North Region / Zone 4" />
        <button class="btn btn-primary btn-block" id="save-profile-btn">Save profile</button>
      </div>

      <div class="card">
        <h3>Erase data</h3>
        <p class="text-dim">Permanently erases everything stored on this device — your profile, every job (TSR, DSR, and FSR entries), and all photos. This can't be undone, so back up first if you need to keep a copy.</p>
        <button class="btn btn-danger btn-block mt8" id="erase-data-btn">🗑️ Erase all data</button>
      </div>
    `;

    document.getElementById('xfer-send-btn').addEventListener('click', () => Transfer.open('show'));
    document.getElementById('xfer-receive-btn').addEventListener('click', () => Transfer.open('enter'));

    document.getElementById('save-timezone-btn').addEventListener('click', () => {
      settings.timeZone = document.getElementById('time-zone').value;
      DB.saveSettings(settings);
      this.toast('Time zone saved');
    });

    document.getElementById('backup-frequency').addEventListener('change', (e) => {
      settings.backupFrequency = e.target.value;
      DB.saveSettings(settings);
      document.getElementById('backup-status').innerHTML = backupStatusText(settings);
    });

    document.getElementById('backup-now-btn').addEventListener('click', () => this.exportAllData());
    document.getElementById('restore-backup-btn').addEventListener('click', () => this.pickAndRestoreBackup());

    document.getElementById('save-profile-btn').addEventListener('click', async () => {
      const name = document.getElementById('profile-name').value.trim();
      const role = document.getElementById('profile-role').value.trim();
      const area = document.getElementById('profile-area').value.trim();
      if (!name) { this.toast('Name can\'t be empty'); return; }
      this.worker.name = name;
      this.worker.role = role;
      this.worker.area = area;
      await DB.updateWorker(this.worker);
      this.setShell({ title: 'EM-WEG Field Service', sub: `Settings · ${this.worker.name}` });
      this.toast('Profile saved');
    });

    document.getElementById('erase-data-btn').addEventListener('click', async () => {
      if (!confirm('Erase ALL data on this device? This permanently deletes your profile, every job, and every photo. This cannot be undone.')) return;
      await DB.eraseAllData();
      location.href = location.pathname; // full reload into a clean, unenrolled state
    });
  },

  // Saves a complete local backup (every worker profile, job, and photo) as a
  // single file on this device. This is a plain local backup, not a sync to
  // any server — there is no server. Records when it ran so Settings can show
  // "last backup" / overdue status. Restore with pickAndRestoreBackup().
  async exportAllData() {
    const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    this.toast('Preparing backup…');
    const workers = await DB.getWorkers();
    const parts = [`{"format":"weg-fieldservice-backup","version":2,"backedUpAt":${JSON.stringify(new Date().toISOString())},"workers":[`];
    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      const jobs = await DB.getJobsForWorker(w.id);
      const photos = [];
      for (const job of jobs) {
        for (const p of await DB.getPhotosForJob(job.id)) {
          photos.push({ id: p.id, jobId: p.jobId, ownerId: p.ownerId, type: p.type, takenAt: p.takenAt, dataUrl: await blobToDataUrl(p.blob) });
        }
      }
      parts.push((i ? ',' : '') + JSON.stringify({ worker: w, jobs, photos }));
    }
    parts.push(']}');
    const blob = new Blob(parts, { type: 'application/json' });
    const fileName = `WEG_FieldService_Backup_${DB.todayStr()}.json`;
    const download = () => {
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url; el.download = fileName;
      document.body.appendChild(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    // On a phone, offer the share sheet (AirDrop, Mail, Teams, Files, …) so the backup can go to
    // a laptop in one step. It needs a fresh tap, so it is a button on a small sheet.
    let file = null;
    try { file = new File([blob], fileName, { type: 'application/json' }); } catch { /* old browser */ }
    const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
    if (canShare) {
      const mb = (blob.size / 1048576).toFixed(1);
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `<div class="modal-sheet"><h3>Backup ready</h3>
        <p class="text-dim">${escapeHtml(fileName)} · ${mb} MB — every job and every photo on this device.</p>
        <button class="btn btn-primary btn-block" id="bk-share">📤 Send / share (AirDrop, Mail, Teams, Files…)</button>
        <button class="btn btn-block mt8" id="bk-save">💾 Save to this device</button>
        <button class="btn btn-ghost btn-block mt8" id="bk-close">Close</button></div>`;
      document.body.appendChild(backdrop);
      backdrop.querySelector('#bk-share').addEventListener('click', async () => {
        try { await navigator.share({ files: [file], title: 'EM-WEG Field Service backup' }); backdrop.remove(); }
        catch (e) { if (!e || e.name !== 'AbortError') { download(); backdrop.remove(); } }
      });
      backdrop.querySelector('#bk-save').addEventListener('click', () => { download(); backdrop.remove(); });
      backdrop.querySelector('#bk-close').addEventListener('click', () => backdrop.remove());
    } else download();
    const shared = canShare;

    const settings = DB.getSettings();
    settings.lastBackupAt = Date.now();
    DB.saveSettings(settings);
    const statusEl = document.getElementById('backup-status');
    if (statusEl) statusEl.innerHTML = backupStatusText(settings);

    this.toast(shared ? 'Backup ready' : 'Backup saved to your device');
  },

  // Lets the worker pick a backup file and restores it onto this device
  // (merge by id — see DB.importBackup), then opens the app on that profile.
  pickAndRestoreBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.position = 'fixed'; input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || !Array.isArray(data.workers) || !data.workers.length) throw new Error('not a backup');
        const counts = await DB.importBackup(data);
        if (!counts.workers) throw new Error('empty');
        // Open on the restored profile if none is currently selected.
        if (!DB.getCurrentWorkerId() || !(await DB.getWorker(DB.getCurrentWorkerId()))) {
          DB.setCurrentWorkerId(data.workers.find((e) => e && e.worker && e.worker.id).worker.id);
        }
        alert(`Backup restored: ${counts.jobs} job(s) and ${counts.photos} photo(s).`);
        location.href = location.pathname + '#/jobs';
        location.reload();
      } catch (err) {
        console.error('Restore failed', err);
        this.toast('That file isn\'t a valid backup');
      }
    }, { once: true });
    input.click();
  }
};

// The fixed list of job titles a worker can pick as their role — enrollment
// and the profile editor both use this (see roleOptionsHtml below); it's not
// free text so every worker's title reads consistently across the app and in
// generated reports.
const WORKER_ROLES = [
  'Field Service Engineer',
  'Generator or Generator Specialist / Winder',
  'Generator or Generator Technician',
  'Lead Consultant / TFA',
  'Project Engineer / PM',
  'Scheduler / Project Coordinator',
  'Site Superintendent',
  'Turbine Bucket / Blade Specialist',
  'Turbine Stress Relieve / Heat Tech',
  'Millwright Foreman',
  'Millwright',
  'Millwright TRT',
  'Turbine Blader',
  'Turbine Heat Stress Technician',
  'Machinist (Shop or Field)',
  'Blast Cleaning Rate'
];

// Builds the <option> list for a role <select>: a blank "Select role…"
// choice plus the fixed WORKER_ROLES list, with `selected` marked. If a
// worker's stored role doesn't match anything in the current list (e.g. free
// text saved before this became a fixed list), it's added as an extra
// option so their existing value is never silently dropped.
function roleOptionsHtml(selected) {
  const opts = [`<option value="">Select role…</option>`];
  let matched = false;
  WORKER_ROLES.forEach((r) => {
    if (r === selected) matched = true;
    opts.push(`<option value="${escapeHtml(r)}" ${r === selected ? 'selected' : ''}>${escapeHtml(r)}</option>`);
  });
  if (selected && !matched) {
    opts.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`);
  }
  return opts.join('');
}

// A fallback list used only when the browser doesn't support
// Intl.supportedValuesOf('timeZone') (e.g. some older WebViews). Covers the
// most common regions field service teams operate in.
const COMMON_TIMEZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
  'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo',
  'UTC', 'Europe/London', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo',
  'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland'
];

// Builds the "Last backup: ..." status line shown under the Backup card,
// including an overdue warning based on the chosen reminder frequency.
function backupStatusText(settings) {
  if (!settings.lastBackupAt) {
    return 'Never backed up yet — tap "Backup data now" to save a copy to this device.';
  }
  const last = new Date(settings.lastBackupAt);
  const ageMs = Date.now() - settings.lastBackupAt;
  const ageHours = ageMs / (1000 * 60 * 60);
  const freq = settings.backupFrequency || 'daily';

  let overdue = false;
  if (freq === 'daily' && ageHours > 24) overdue = true;
  if (freq === 'weekly' && ageHours > 24 * 7) overdue = true;

  const when = `${last.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${last.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const base = `Last backup: ${when}`;
  return overdue ? `${base} · ⚠️ Backup due` : base;
}

// ---------- Formatting helpers ----------
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateShort(ts) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
// A TSR entry can cover several dates (e.g. a whole work week logged as one
// time sheet) — this is the shared label used wherever those dates need to
// read as a single line (the signature modal, etc.).
function formatTsrDatesLabel(dates) {
  const sorted = (dates || []).slice().sort();
  if (sorted.length === 0) return 'No dates selected';
  return sorted.map((d) => formatDateLong(d)).join(', ');
}
function scopeLabelFor(scope) {
  if (scope === 'tsr') return 'Time Sheet Report';
  if (scope === 'dsr') return 'Daily Status Report';
  if (scope === 'fsr') return 'Field Service Report';
  return 'Combined Report';
}
function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clampInt(val, min, max, fallback) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ---------- Custom time-range helpers (TSR hourly schedule) ----------
// The TSR's hourly schedule uses a custom start/end time (hour 1-12, minute
// in 15-minute steps, AM/PM) instead of fixed whole-hour blocks, so a worker
// can log e.g. "8:30 AM to 9:15 AM" exactly as it happened.
const TIME_MINUTE_STEPS = [0, 15, 30, 45];

function hourSelectOptions(selected) {
  let opts = '';
  for (let h = 1; h <= 12; h++) opts += `<option value="${h}" ${h === selected ? 'selected' : ''}>${h}</option>`;
  return opts;
}
function minuteSelectOptions(selected) {
  return TIME_MINUTE_STEPS.map((m) => `<option value="${m}" ${m === selected ? 'selected' : ''}>${String(m).padStart(2, '0')}</option>`).join('');
}
function periodSelectOptions(selected) {
  return ['AM', 'PM'].map((p) => `<option value="${p}" ${p === selected ? 'selected' : ''}>${p}</option>`).join('');
}
function formatClockTime(h12, minute, period) {
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}
function formatTimeRangeEntry(entry) {
  return `${formatClockTime(entry.startHour, entry.startMinute, entry.startPeriod)} - ${formatClockTime(entry.endHour, entry.endMinute, entry.endPeriod)}`;
}

// Formats an hours value for the Labor/Travel split inputs and the "Total
// logged" readout: no unnecessary trailing zeros (8, 4.5, 0.25, ...), and a
// bare '0' rather than an empty string so the field never looks blank once
// it holds a real value.
function formatHoursShort(n) {
  if (n == null || isNaN(n)) return '';
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : String(rounded).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

document.addEventListener('DOMContentLoaded', () => App.start());
