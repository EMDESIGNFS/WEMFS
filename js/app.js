// app.js — FieldLog UI: hash-router + view renderers. Vanilla JS, no build step,
// so the whole app is just static files you can host anywhere (see README.md).
//
// Each day is split into two independent things (see js/db.js for the data
// shapes): one Daily Status Report (DSR) — a custom-time hourly schedule,
// pre/post photos, and four narrative fields — and zero or more Field
// Service Report (FSR) entries, one per unit/equipment worked on that day.

const App = {
  worker: null,
  photoUrls: new Map(), // photo.id -> object URL, so we can revoke them on teardown

  async start() {
    await DB.init();
    window.addEventListener('hashchange', () => this.route());

    const workerId = DB.getCurrentWorkerId();
    if (workerId) this.worker = await DB.getWorker(workerId);

    this.route();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
    }
  },

  route() {
    const hash = location.hash || '#/today';
    if (!this.worker && hash !== '#/enroll') { location.hash = '#/enroll'; return; }

    const dayMatch = hash.match(/^#\/day\/(\d{4}-\d{2}-\d{2})$/);

    if (hash === '#/enroll') return this.renderEnroll();
    if (hash === '#/today') return this.renderDay(DB.todayStr());
    if (dayMatch) return this.renderDay(dayMatch[1]);
    if (hash === '#/history') return this.renderHistory();
    if (hash === '#/settings') return this.renderSettings();
    return this.renderDay(DB.todayStr());
  },

  // ---------- Shell helpers ----------
  setShell({ title, sub, showBack }) {
    document.getElementById('topbar-title').textContent = title;
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
  // opens straight to their own log — no picking a profile each time.
  async renderEnroll() {
    this.setShell({ title: 'WEG Field Service', sub: 'Set up this device' });
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
        <input type="text" id="enroll-role" placeholder="e.g. Control Engineer" />
        <label class="field-label">Area / Location (optional)</label>
        <input type="text" id="enroll-area" placeholder="e.g. North Region / Zone 4" />
        <button class="btn btn-primary btn-block" id="enroll-btn">Get started</button>
      </div>
    `;

    document.getElementById('enroll-btn').addEventListener('click', async () => {
      const name = document.getElementById('enroll-name').value.trim();
      const role = document.getElementById('enroll-role').value.trim();
      const area = document.getElementById('enroll-area').value.trim();
      if (!name) { this.toast('Enter your name first'); return; }
      const w = await DB.addWorker(name, role, area);
      DB.setCurrentWorkerId(w.id);
      this.worker = w;
      location.hash = '#/today';
    });
  },

  // ---------- Today / Day view ----------
  async renderDay(date) {
    const log = await DB.getOrCreateDailyLog(this.worker.id, date);
    const photos = await DB.getPhotosForLog(log.id);

    const isToday = date === DB.todayStr();
    this.setShell({
      title: isToday ? "Today's Log" : formatDateLong(date),
      sub: `${this.worker.name} · ${formatDateLong(date)}`,
      showBack: !isToday
    });
    this.setNav(isToday ? 'today' : null);

    const reportLabel = log.reportGeneratedAt
      ? `Report generated ${formatTime(log.reportGeneratedAt)}`
      : 'No report generated yet';

    const main = document.getElementById('main');
    main.innerHTML = `
      <div id="dsr-card"></div>

      <div class="section-label" style="margin-top:20px;">🔧 Field Service Report (FSR)</div>
      <p class="text-dim tf-intro">One entry per unit/equipment worked on today — add as many as you need.</p>
      <div id="fsr-list"></div>
      <button class="btn btn-block" id="add-fsr-btn">+ Add FSR entry</button>

      <div class="card generate-report-card mt12">
        <div class="text-dim">${reportLabel}</div>
        <button class="btn btn-primary" id="generate-report-btn">📊 Generate Report</button>
      </div>
    `;

    document.getElementById('dsr-card').appendChild(this.renderDsrCard(log, photos));

    document.getElementById('add-fsr-btn').addEventListener('click', async () => {
      log.fsrEntries = log.fsrEntries || [];
      log.fsrEntries.push(DB.newFsrEntry(''));
      await DB.saveDailyLog(log);
      this.renderDay(date);
    });

    const fsrList = document.getElementById('fsr-list');
    if (!log.fsrEntries || log.fsrEntries.length === 0) {
      fsrList.innerHTML = `<div class="empty-state">No FSR entries yet — tap "+ Add FSR entry" for each unit/equipment you service today.</div>`;
    } else {
      log.fsrEntries.forEach((entry) => {
        fsrList.appendChild(this.renderFsrEntryCard(log, entry, photos));
      });
    }

    document.getElementById('generate-report-btn').addEventListener('click', () => {
      this.openReportScopeModal((scope) => {
        const fsrCount = (log.fsrEntries || []).length;
        if (scope !== 'dsr' && fsrCount === 0) {
          this.toast('Add at least one FSR entry first');
          return;
        }
        this.openFormatChoiceModal(async (format) => {
          try {
            const { blob, filename } = await Report.generate(log, this.worker, format, scope);
            await DB.markReportGenerated(log.id);
            this.openReportModal(blob, filename, log, scope);
            this.renderDay(date);
          } catch (err) {
            console.error('Report generation failed', err);
            this.toast('Could not generate report — see console for details');
          }
        });
      });
    });
  },

  // ---------- Daily Status Report (DSR) — one per day ----------
  renderDsrCard(log, photos) {
    log.dsr = log.dsr || DB.newDsr();
    const dsr = log.dsr;
    dsr.entries = dsr.entries || [];

    const card = document.createElement('div');
    card.className = 'card';

    const entriesHtml = dsr.entries.map((entry, idx) => `
      <div class="hour-entry time-entry" data-idx="${idx}">
        <div class="time-range-row">
          <select data-time-part="startHour">${hourSelectOptions(entry.startHour)}</select>
          <select data-time-part="startMinute">${minuteSelectOptions(entry.startMinute)}</select>
          <select data-time-part="startPeriod">${periodSelectOptions(entry.startPeriod)}</select>
          <span class="time-sep">to</span>
          <select data-time-part="endHour">${hourSelectOptions(entry.endHour)}</select>
          <select data-time-part="endMinute">${minuteSelectOptions(entry.endMinute)}</select>
          <select data-time-part="endPeriod">${periodSelectOptions(entry.endPeriod)}</select>
        </div>
        <textarea class="log-input" data-entry-desc placeholder="What was done in this time range?">${escapeHtml(entry.description || '')}</textarea>
        <button class="remove-entry-btn" data-remove-entry title="Remove">×</button>
      </div>
    `).join('');

    const prePhoto = photos.find((p) => p.jobId === 'dsr' && p.type === 'pre');
    const postPhoto = photos.find((p) => p.jobId === 'dsr' && p.type === 'post');

    card.innerHTML = `
      <div class="section-label" style="margin-top:0;">📋 Daily Status Report (DSR)</div>

      <div class="section-label">Hourly Schedule</div>
      <p class="text-dim tf-intro">Pick a custom start and end time for each block of work.</p>
      <div data-entries-list>${entriesHtml || '<p class="text-dim">No time entries yet.</p>'}</div>
      <button class="btn btn-sm mt8" data-add-entry>+ Add time entry</button>

      <div class="section-label">Pre-work photo</div>
      ${this.renderSinglePhotoSlot('pre', prePhoto, false)}

      <div class="section-label">Post-work photo</div>
      ${this.renderSinglePhotoSlot('post', postPhoto, false)}

      <div class="section-label">📝 Daily Report</div>
      <p class="text-dim tf-intro">These go into the generated DSR alongside the hourly schedule above.</p>

      <label class="field-label">Work Completed</label>
      <textarea class="log-input" data-daily-field="workCompleted" placeholder="What was completed today…">${escapeHtml(dsr.workCompleted || '')}</textarea>

      <label class="field-label mt8">Work To Be Completed (Next 24 Hours)</label>
      <textarea class="log-input" data-daily-field="workToBeCompleted" placeholder="What's planned next…">${escapeHtml(dsr.workToBeCompleted || '')}</textarea>

      <label class="field-label mt8">Technical Comments / Concerns / Findings</label>
      <textarea class="log-input" data-daily-field="technicalComments" placeholder="Anything technical worth flagging…">${escapeHtml(dsr.technicalComments || '')}</textarea>

      <label class="field-label mt8">Recommendations</label>
      <textarea class="log-input" data-daily-field="recommendations" placeholder="Recommendations going forward…">${escapeHtml(dsr.recommendations || '')}</textarea>
    `;

    // Narrative fields
    card.querySelectorAll('[data-daily-field]').forEach((ta) => {
      ta.addEventListener('change', async () => {
        dsr[ta.dataset.dailyField] = ta.value;
        await DB.saveDailyLog(log);
      });
    });

    // Add time entry
    card.querySelector('[data-add-entry]').addEventListener('click', async () => {
      const last = dsr.entries[dsr.entries.length - 1];
      dsr.entries.push({ ...newTimeEntryDefaults(last), description: '', updatedAt: Date.now() });
      await DB.saveDailyLog(log);
      this.renderDay(log.date);
    });

    // Time part selects
    card.querySelectorAll('[data-time-part]').forEach((sel) => {
      sel.addEventListener('change', async (e) => {
        const idx = Number(e.target.closest('[data-idx]').dataset.idx);
        const part = sel.dataset.timePart;
        const entry = dsr.entries[idx];
        entry[part] = part.includes('Period') ? sel.value : Number(sel.value);
        entry.updatedAt = Date.now();
        await DB.saveDailyLog(log);
      });
    });

    // Entry descriptions (debounced)
    card.querySelectorAll('[data-entry-desc]').forEach((ta) => {
      let debounce;
      ta.addEventListener('input', (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          const idx = Number(e.target.closest('[data-idx]').dataset.idx);
          dsr.entries[idx].description = ta.value;
          dsr.entries[idx].updatedAt = Date.now();
          await DB.saveDailyLog(log);
        }, 500);
      });
    });

    card.querySelectorAll('[data-remove-entry]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const idx = Number(e.target.closest('[data-idx]').dataset.idx);
        dsr.entries.splice(idx, 1);
        await DB.saveDailyLog(log);
        this.renderDay(log.date);
      });
    });

    // Pre/post photos
    card.querySelectorAll('[data-capture]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.capture;
        const source = btn.dataset.source;
        const blob = await Camera.capture(source);
        if (!blob) return;
        const photo = await DB.replacePhoto(log.id, 'dsr', type, blob);
        if (type === 'pre') dsr.prePhotoId = photo.id; else dsr.postPhotoId = photo.id;
        await DB.saveDailyLog(log);
        this.toast(`${type === 'pre' ? 'Pre-work' : 'Post-work'} photo saved`);
        this.renderDay(log.date);
      });
    });
    card.querySelectorAll('[data-delete-photo]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await DB.deletePhoto(btn.dataset.deletePhoto);
        const type = btn.dataset.type;
        if (type === 'pre') dsr.prePhotoId = null; else dsr.postPhotoId = null;
        await DB.saveDailyLog(log);
        this.renderDay(log.date);
      });
    });

    return card;
  },

  // ---------- Field Service Report (FSR) — repeatable, one per unit/equipment ----------
  renderFsrEntryCard(log, fsrEntry, photos) {
    const locked = !!fsrEntry.approval;
    fsrEntry.testSections = fsrEntry.testSections || {};
    const card = document.createElement('div');
    card.className = 'card job-card' + (locked ? ' locked' : '');

    const approvalHtml = fsrEntry.approval ? `
      <div class="approval-approved">
        <img src="${fsrEntry.approval.signatureDataUrl}" alt="Signature" />
        <div class="approval-approved-text">
          ✓ Approved
          <span class="who">${escapeHtml(fsrEntry.approval.signedBy)}${fsrEntry.approval.signedRole ? ' — ' + escapeHtml(fsrEntry.approval.signedRole) : ''} · ${formatTime(fsrEntry.approval.signedAt)} on ${formatDateLong(log.date)}</span>
        </div>
      </div>
      <div class="locked-note">
        <span>Editing is locked while approved.</span>
        <button class="btn btn-sm" data-clear-approval>Clear approval</button>
      </div>
    ` : `
      <button class="btn btn-primary btn-block" data-open-signature>✍️ Get approval signature</button>
    `;

    const reportTypeOptions = [
      ['', 'Select report type…'],
      ['generator', 'Generator Report'],
      ['motor', 'Motor Report']
    ].map(([val, label]) => `<option value="${val}" ${(fsrEntry.reportType || '') === val ? 'selected' : ''}>${label}</option>`).join('');

    const sectionPhotoHtml = (sectionKey) => {
      const ownerId = DB.testSectionPhotoOwnerId(fsrEntry.id, sectionKey);
      const photo = photos.find((p) => p.jobId === ownerId && p.type === 'section');
      return this.renderSectionPhotoSlot(sectionKey, photo, locked);
    };

    const testSectionsHtml = fsrEntry.reportType ? `
      <div class="section-label">Test Sections</div>
      <p class="text-dim tf-intro">Check off the sections that apply to this ${fsrEntry.reportType === 'generator' ? 'generator' : 'motor'}. Each section has its own photo capture/upload option.</p>
      <div data-test-checklist>${TestSections.renderChecklist(fsrEntry, sectionPhotoHtml)}</div>
    ` : '';

    card.innerHTML = `
      <div class="job-head">
        <input type="text" class="job-site-input" data-site-name placeholder="Job site name (e.g. Riverside Plant)" value="${escapeHtml(fsrEntry.siteName)}" ${locked ? 'disabled' : ''} />
        ${locked ? '' : '<button class="job-remove-btn" data-remove-job title="Remove FSR entry">🗑</button>'}
      </div>

      <label class="field-label">Service Order / Unit Number</label>
      <input type="text" class="job-service-order-input" data-service-order placeholder="e.g. SO-48213 / Unit 2" value="${escapeHtml(fsrEntry.serviceOrder || '')}" ${locked ? 'disabled' : ''} />

      <label class="field-label mt8">Report Type</label>
      <select data-report-type ${locked ? 'disabled' : ''}>${reportTypeOptions}</select>
      ${testSectionsHtml}

      <div class="approval-box">${approvalHtml}</div>
    `;

    // Site name
    const siteInput = card.querySelector('[data-site-name]');
    siteInput.addEventListener('change', async () => {
      fsrEntry.siteName = siteInput.value;
      await DB.saveDailyLog(log);
    });

    // Service Order / Unit Number
    const serviceOrderInput = card.querySelector('[data-service-order]');
    serviceOrderInput.addEventListener('change', async () => {
      fsrEntry.serviceOrder = serviceOrderInput.value;
      await DB.saveDailyLog(log);
    });

    // Report type — switching it changes which test sections are offered,
    // so the checklist needs a re-render. Existing answers for sections are
    // kept in fsrEntry.testSections even if they're hidden after switching type.
    const reportTypeSelect = card.querySelector('[data-report-type]');
    reportTypeSelect.addEventListener('change', async () => {
      fsrEntry.reportType = reportTypeSelect.value || null;
      await DB.saveDailyLog(log);
      this.renderDay(log.date);
    });

    // Test section checklist — same delegated-listener pattern as before.
    const checklistEl = card.querySelector('[data-test-checklist]');
    if (checklistEl) {
      checklistEl.querySelectorAll('[data-test-toggle]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          const key = cb.dataset.testToggle;
          const existing = fsrEntry.testSections[key] || { enabled: false, values: {} };
          fsrEntry.testSections[key] = { enabled: cb.checked, values: existing.values || {} };
          await DB.saveDailyLog(log);
          this.renderDay(log.date);
        });
      });

      let testFieldDebounce;
      checklistEl.addEventListener('input', (e) => {
        const bodyEl = e.target.closest('[data-test-body]');
        if (!bodyEl) return;
        clearTimeout(testFieldDebounce);
        testFieldDebounce = setTimeout(async () => {
          const sectionKey = bodyEl.dataset.testBody;
          const section = REPORT_SECTIONS.find((s) => s.key === sectionKey);
          if (!section) return;
          const values = TestSections.collectSectionValues(section, bodyEl);
          const existing = fsrEntry.testSections[sectionKey] || { enabled: true, values: {} };
          fsrEntry.testSections[sectionKey] = { enabled: existing.enabled, values };
          await DB.saveDailyLog(log);
        }, 400);
      });
      // <select> unit dropdowns fire 'change', not 'input' — same handling.
      checklistEl.addEventListener('change', async (e) => {
        const bodyEl = e.target.closest('[data-test-body]');
        if (!bodyEl || !e.target.matches('select')) return;
        const sectionKey = bodyEl.dataset.testBody;
        const section = REPORT_SECTIONS.find((s) => s.key === sectionKey);
        if (!section) return;
        const values = TestSections.collectSectionValues(section, bodyEl);
        const existing = fsrEntry.testSections[sectionKey] || { enabled: true, values: {} };
        fsrEntry.testSections[sectionKey] = { enabled: existing.enabled, values };
        await DB.saveDailyLog(log);
      });

      // Per-section photo capture/upload
      checklistEl.querySelectorAll('[data-section-capture]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const sectionKey = btn.dataset.sectionCapture;
          const source = btn.dataset.source;
          const blob = await Camera.capture(source);
          if (!blob) return;
          const ownerId = DB.testSectionPhotoOwnerId(fsrEntry.id, sectionKey);
          await DB.replacePhoto(log.id, ownerId, 'section', blob);
          this.toast('Section photo saved');
          this.renderDay(log.date);
        });
      });
      checklistEl.querySelectorAll('[data-delete-section-photo]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await DB.deletePhoto(btn.dataset.deleteSectionPhoto);
          this.renderDay(log.date);
        });
      });
    }

    // Remove FSR entry
    const removeJobBtn = card.querySelector('[data-remove-job]');
    if (removeJobBtn) {
      removeJobBtn.addEventListener('click', async () => {
        if (!confirm(`Remove "${fsrEntry.siteName || 'this FSR entry'}" and its photos? This can't be undone.`)) return;
        const allPhotos = await DB.getPhotosForLog(log.id);
        const toDelete = allPhotos.filter((p) => p.jobId === fsrEntry.id || p.jobId.startsWith(fsrEntry.id + '::'));
        for (const p of toDelete) await DB.deletePhoto(p.id);
        log.fsrEntries = log.fsrEntries.filter((e) => e.id !== fsrEntry.id);
        await DB.saveDailyLog(log);
        this.renderDay(log.date);
      });
    }

    // Approval
    const openSigBtn = card.querySelector('[data-open-signature]');
    if (openSigBtn) openSigBtn.addEventListener('click', () => this.openSignatureModal(log, fsrEntry));

    const clearApprovalBtn = card.querySelector('[data-clear-approval]');
    if (clearApprovalBtn) {
      clearApprovalBtn.addEventListener('click', async () => {
        if (!confirm('Clear this approval so the entry can be edited again?')) return;
        fsrEntry.approval = null;
        await DB.saveDailyLog(log);
        this.renderDay(log.date);
      });
    }

    return card;
  },

  renderSinglePhotoSlot(type, photo, locked) {
    const label = type === 'pre' ? 'pre-work' : 'post-work';
    const thumb = photo
      ? `<div class="photo-thumb"><img src="${this.objectUrlFor(photo)}" alt="${label} photo"/>${locked ? '' : `<button data-delete-photo="${photo.id}" data-type="${type}">×</button>`}</div>`
      : `<div class="photo-empty">📷</div>`;
    const actions = locked ? '' : `
      <div class="photo-actions">
        <button class="btn btn-sm" data-capture="${type}" data-source="camera">📷 Camera</button>
        <button class="btn btn-sm" data-capture="${type}" data-source="gallery">🖼️ Gallery</button>
      </div>`;
    return `
      <div class="single-photo-slot">
        ${thumb}
        ${actions}
      </div>
    `;
  },

  // Compact photo slot shown inside an expanded technical inspection section
  // — lets the worker attach one optional photo per section (a nameplate,
  // a bearing, a reading on a meter, etc.) alongside the fields.
  renderSectionPhotoSlot(sectionKey, photo, locked) {
    const thumb = photo
      ? `<div class="photo-thumb small"><img src="${this.objectUrlFor(photo)}" alt="section photo"/>${locked ? '' : `<button data-delete-section-photo="${photo.id}">×</button>`}</div>`
      : `<div class="photo-empty small">📷</div>`;
    const actions = locked ? '' : `
      <div class="photo-actions">
        <button class="btn btn-sm" data-section-capture="${sectionKey}" data-source="camera">📷 Camera</button>
        <button class="btn btn-sm" data-section-capture="${sectionKey}" data-source="gallery">🖼️ Upload</button>
      </div>`;
    return `
      <div class="single-photo-slot section-photo-slot">
        <div class="field-label" style="margin-bottom:6px;">Section photo (optional)</div>
        ${thumb}
        ${actions}
      </div>
    `;
  },

  // ---------- Vendor approval signature ----------
  openSignatureModal(log, fsrEntry) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>Approval signature</h3>
        <p class="text-dim">${escapeHtml(fsrEntry.siteName || 'This FSR entry')} · ${formatDateLong(log.date)}</p>
        <label class="field-label">Client name</label>
        <input type="text" id="sig-name" placeholder="e.g. Jordan Lee" />
        <label class="field-label">Role / Position</label>
        <input type="text" id="sig-role" placeholder="e.g. Site Manager" />
        <label class="field-label">Signature</label>
        <div class="sig-canvas-wrap"><canvas id="sig-canvas" width="600" height="260"></canvas></div>
        <p class="sig-hint">Sign with your finger or mouse above</p>
        <div class="row">
          <button class="btn" id="sig-clear-btn">Clear</button>
          <button class="btn" id="sig-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="sig-save-btn" style="flex:1;">Approve &amp; Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const canvas = backdrop.querySelector('#sig-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let drawing = false, hasDrawn = false, lastX = 0, lastY = 0;

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

    const close = () => backdrop.remove();

    backdrop.querySelector('#sig-clear-btn').addEventListener('click', () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      hasDrawn = false;
    });
    backdrop.querySelector('#sig-cancel-btn').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    backdrop.querySelector('#sig-save-btn').addEventListener('click', async () => {
      const name = backdrop.querySelector('#sig-name').value.trim();
      const role = backdrop.querySelector('#sig-role').value.trim();
      if (!name) { this.toast('Enter the client\'s name'); return; }
      if (!hasDrawn) { this.toast('Please sign before saving'); return; }

      fsrEntry.approval = {
        signedBy: name,
        signedRole: role,
        signatureDataUrl: canvas.toDataURL('image/png'),
        signedAt: Date.now()
      };
      await DB.saveDailyLog(log);
      close();
      this.toast(`Approved by ${name}`);
      this.renderDay(log.date);
    });
  },

  // ---------- Report generation: scope, then format, then save/share ----------
  // First asks which content to include (DSR only / FSR only / combined),
  // then hands the chosen scope to onChoose.
  openReportScopeModal(onChoose) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>Generate report</h3>
        <p class="text-dim">What do you want to generate?</p>
        <button class="btn btn-primary btn-block mt8" id="scope-dsr-btn">📋 Daily Report (DSR)</button>
        <button class="btn btn-block mt8" id="scope-fsr-btn">🔧 Field Report (FSR)</button>
        <button class="btn btn-block mt8" id="scope-combined-btn">📎 Combined Report</button>
        <button class="btn btn-ghost btn-block mt8" id="scope-cancel-btn">Cancel</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#scope-cancel-btn').addEventListener('click', close);
    backdrop.querySelector('#scope-dsr-btn').addEventListener('click', () => { close(); onChoose('dsr'); });
    backdrop.querySelector('#scope-fsr-btn').addEventListener('click', () => { close(); onChoose('fsr'); });
    backdrop.querySelector('#scope-combined-btn').addEventListener('click', () => { close(); onChoose('combined'); });
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

  openReportModal(blob, filename, log, scope) {
    const settings = DB.getSettings();
    const canShareFiles = Report.canShareFile(new File([blob], filename, { type: blob.type }));
    const scopeLabel = scope === 'dsr' ? 'Daily Status Report' : scope === 'fsr' ? 'Field Service Report' : 'Daily Status & Field Service Report';

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
      const subject = `${scopeLabel} — ${formatDateLong(log.date)}`;
      const body = `Attached is the ${scopeLabel.toLowerCase()} for ${this.worker.name} on ${formatDateLong(log.date)}.`;
      const res = await Report.shareViaEmail(blob, filename, { subject, body, to: settings.reportEmail || '' });
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

  // ---------- History ----------
  async renderHistory() {
    this.setShell({ title: 'History', sub: this.worker.name });
    this.setNav('history');
    const logs = await DB.getLogsForWorker(this.worker.id);

    const main = document.getElementById('main');
    if (logs.length === 0) {
      main.innerHTML = `<div class="empty-state">No daily logs yet. Start today's log from the Today tab.</div>`;
      return;
    }
    const summarize = (log) => {
      const fsrEntries = log.fsrEntries || [];
      const dsrHours = (log.dsr && log.dsr.entries) ? log.dsr.entries.length : 0;
      const approved = fsrEntries.filter((e) => e.approval).length;
      const parts = [];
      parts.push(`DSR: ${dsrHours} time ${dsrHours === 1 ? 'entry' : 'entries'}`);
      if (fsrEntries.length === 0) {
        parts.push('No FSR entries');
      } else {
        const names = fsrEntries.map((e) => e.siteName || 'Untitled site').join(', ');
        parts.push(`FSR: ${fsrEntries.length} ${fsrEntries.length === 1 ? 'entry' : 'entries'} · ${approved} approved — ${names}`);
      }
      return parts.join(' · ');
    };
    main.innerHTML = `<div class="card" style="padding:0;">${logs.map((log) => `
      <div class="history-item" data-date="${log.date}">
        <div>
          <div class="history-date">${formatDateLong(log.date)}</div>
          <div class="history-meta">${escapeHtml(summarize(log))}</div>
        </div>
        <span class="badge ${log.reportGeneratedAt ? 'synced' : 'pending'}">${log.reportGeneratedAt ? 'Report generated' : 'No report yet'}</span>
      </div>
    `).join('')}</div>`;

    main.querySelectorAll('.history-item').forEach((el) => {
      el.addEventListener('click', () => { location.hash = `#/day/${el.dataset.date}`; });
    });
  },

  // ---------- Settings ----------
  async renderSettings() {
    this.setShell({ title: 'Settings', sub: this.worker.name });
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
        <h3>Time zone</h3>
        <label class="field-label">Your time zone</label>
        <select id="time-zone">${tzOptions}</select>
        <button class="btn btn-primary btn-block mt8" id="save-timezone-btn">Save time zone</button>
        <p class="text-dim mt8">There's no fixed shift window — hours can be logged any time of day, since some jobs run well past a typical 8-hour day. This just labels report timestamps correctly if you work across regions.</p>
      </div>

      <div class="card">
        <h3>Reports</h3>
        <label class="field-label">Default email recipient (optional)</label>
        <input type="text" id="report-email" placeholder="office@example.com" value="${escapeHtml(settings.reportEmail || '')}" />
        <button class="btn btn-primary btn-block" id="save-report-email-btn">Save</button>
        <p class="text-dim mt8">Pre-fills the "to" field when sharing a report by email. Reports are generated per day from the Today/History views — tap "Generate Report" there.</p>
      </div>

      <div class="card">
        <h3>Backup</h3>
        <label class="field-label">Reminder frequency</label>
        <select id="backup-frequency">${freqOptions}</select>
        <button class="btn btn-primary btn-block mt8" id="backup-now-btn">💾 Backup data now</button>
        <p class="text-dim mt8" id="backup-status">${backupStatusText(settings)}</p>
      </div>

      <div class="card">
        <h3>Your profile</h3>
        <label class="field-label">Name</label>
        <input type="text" id="profile-name" value="${escapeHtml(this.worker.name)}" />
        <label class="field-label">Role</label>
        <input type="text" id="profile-role" value="${escapeHtml(this.worker.role || '')}" placeholder="e.g. Control Engineer" />
        <label class="field-label">Area / Location</label>
        <input type="text" id="profile-area" value="${escapeHtml(this.worker.area || '')}" placeholder="e.g. North Region / Zone 4" />
        <button class="btn btn-primary btn-block" id="save-profile-btn">Save profile</button>
      </div>

      <div class="card">
        <h3>Erase data</h3>
        <p class="text-dim">Permanently erases everything stored on this device — your profile, every logged day, all FSR entries, and all photos. This can't be undone, so back up first if you need to keep a copy.</p>
        <button class="btn btn-danger btn-block mt8" id="erase-data-btn">🗑️ Erase all data</button>
      </div>
    `;

    document.getElementById('save-timezone-btn').addEventListener('click', () => {
      settings.timeZone = document.getElementById('time-zone').value;
      DB.saveSettings(settings);
      this.toast('Time zone saved');
    });

    document.getElementById('save-report-email-btn').addEventListener('click', () => {
      settings.reportEmail = document.getElementById('report-email').value.trim();
      DB.saveSettings(settings);
      this.toast('Saved');
    });

    document.getElementById('backup-frequency').addEventListener('change', (e) => {
      settings.backupFrequency = e.target.value;
      DB.saveSettings(settings);
      document.getElementById('backup-status').innerHTML = backupStatusText(settings);
    });

    document.getElementById('backup-now-btn').addEventListener('click', () => this.exportAllData());

    document.getElementById('save-profile-btn').addEventListener('click', async () => {
      const name = document.getElementById('profile-name').value.trim();
      const role = document.getElementById('profile-role').value.trim();
      const area = document.getElementById('profile-area').value.trim();
      if (!name) { this.toast('Name can\'t be empty'); return; }
      this.worker.name = name;
      this.worker.role = role;
      this.worker.area = area;
      await DB.updateWorker(this.worker);
      this.setShell({ title: 'Settings', sub: this.worker.name });
      this.toast('Profile saved');
    });

    document.getElementById('erase-data-btn').addEventListener('click', async () => {
      if (!confirm('Erase ALL data on this device? This permanently deletes your profile, every logged day, and every photo. This cannot be undone.')) return;
      await DB.eraseAllData();
      location.href = location.pathname; // full reload into a clean, unenrolled state
    });
  },

  // Saves a complete local backup (every worker profile, daily log, and photo
  // reference) as a single file on this device. This is a plain local backup,
  // not a sync to any server — there is no server. Records when it ran so
  // Settings can show "last backup" / overdue status.
  async exportAllData() {
    const workers = await DB.getWorkers();
    const data = { backedUpAt: new Date().toISOString(), workers: [] };
    for (const w of workers) {
      const logs = await DB.getLogsForWorker(w.id);
      data.workers.push({ worker: w, logs });
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `WEG_FieldService_Backup_${DB.todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);

    const settings = DB.getSettings();
    settings.lastBackupAt = Date.now();
    DB.saveSettings(settings);
    const statusEl = document.getElementById('backup-status');
    if (statusEl) statusEl.innerHTML = backupStatusText(settings);

    this.toast('Backup saved to your device');
  }
};

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
function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clampInt(val, min, max, fallback) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ---------- Custom time-range helpers (DSR hourly schedule) ----------
// The DSR's hourly schedule uses a custom start/end time (hour 1-12, minute
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
// 12-hour + AM/PM -> minutes since midnight (00:00), for sorting.
function timeTo24Hour(h12, period) {
  let hh = h12 % 12;
  if (period === 'PM') hh += 12;
  return hh;
}
function timeFrom24Hour(hh) {
  hh = ((hh % 24) + 24) % 24;
  const period = hh < 12 ? 'AM' : 'PM';
  let h12 = hh % 12; if (h12 === 0) h12 = 12;
  return { h12, period };
}
function timeEntryStartMinutes(entry) {
  return timeTo24Hour(entry.startHour, entry.startPeriod) * 60 + (entry.startMinute || 0);
}
function formatClockTime(h12, minute, period) {
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}
function formatTimeRangeEntry(entry) {
  return `${formatClockTime(entry.startHour, entry.startMinute, entry.startPeriod)} - ${formatClockTime(entry.endHour, entry.endMinute, entry.endPeriod)}`;
}
// Defaults for a freshly-added time entry: starts where the previous one left
// off (so entries chain naturally through the day), or 8:00-9:00 AM if it's
// the first one.
function newTimeEntryDefaults(lastEntry) {
  if (!lastEntry) return { startHour: 8, startMinute: 0, startPeriod: 'AM', endHour: 9, endMinute: 0, endPeriod: 'AM' };
  const endHH = timeTo24Hour(lastEntry.endHour, lastEntry.endPeriod);
  const start = timeFrom24Hour(endHH);
  const end = timeFrom24Hour(endHH + 1);
  return {
    startHour: start.h12, startMinute: lastEntry.endMinute || 0, startPeriod: start.period,
    endHour: end.h12, endMinute: lastEntry.endMinute || 0, endPeriod: end.period
  };
}

document.addEventListener('DOMContentLoaded', () => App.start());
