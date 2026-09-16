// app.js — FieldLog UI: hash-router + view renderers. Vanilla JS, no build step,
// so the whole app is just static files you can host anywhere (see README.md).

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
        <input type="text" id="enroll-name" placeholder="e.g. Dhanush Venkataswamy" />
        <label class="field-label">Role (optional)</label>
        <input type="text" id="enroll-role" placeholder="e.g. Control Eng." />
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

    // one pre-work photo + one post-work photo per job, looked up by jobId+type
    const photoByJobType = {};
    photos.forEach((p) => { photoByJobType[`${p.jobId}_${p.type}`] = p; });

    const reportLabel = log.reportGeneratedAt
      ? `Report generated ${formatTime(log.reportGeneratedAt)}`
      : 'No report generated yet';

    log.dailyReport = log.dailyReport || { workCompleted: '', workToBeCompleted: '', technicalComments: '', recommendations: '' };
    const dr = log.dailyReport;

    const main = document.getElementById('main');
    main.innerHTML = `
      <div id="job-list"></div>
      <button class="btn btn-block" id="add-job-btn">+ Add job site</button>

      <div class="card mt12">
        <div class="section-label" style="margin-top:0;">📝 Daily Report</div>
        <p class="text-dim tf-intro">These go into the generated report alongside the hourly log below — the hourly structure itself doesn't change.</p>

        <label class="field-label">Work Completed</label>
        <textarea class="log-input" data-daily-field="workCompleted" placeholder="What was completed today…">${escapeHtml(dr.workCompleted || '')}</textarea>

        <label class="field-label mt8">Work To Be Completed (Next 24 Hours)</label>
        <textarea class="log-input" data-daily-field="workToBeCompleted" placeholder="What's planned next…">${escapeHtml(dr.workToBeCompleted || '')}</textarea>

        <label class="field-label mt8">Technical Comments / Concerns / Findings</label>
        <textarea class="log-input" data-daily-field="technicalComments" placeholder="Anything technical worth flagging…">${escapeHtml(dr.technicalComments || '')}</textarea>

        <label class="field-label mt8">Recommendations</label>
        <textarea class="log-input" data-daily-field="recommendations" placeholder="Recommendations going forward…">${escapeHtml(dr.recommendations || '')}</textarea>
      </div>

      <div class="card row between mt12">
        <div class="text-dim">${reportLabel}</div>
        <button class="btn btn-primary" id="generate-report-btn">📊 Generate Report</button>
      </div>
    `;

    main.querySelectorAll('[data-daily-field]').forEach((ta) => {
      ta.addEventListener('change', async () => {
        log.dailyReport[ta.dataset.dailyField] = ta.value;
        await DB.saveDailyLog(log);
      });
    });

    document.getElementById('generate-report-btn').addEventListener('click', async () => {
      if (!log.jobs || log.jobs.length === 0) { this.toast('Add a job site before generating a report'); return; }
      this.openFormatChoiceModal(async (format) => {
        try {
          const { blob, filename } = await Report.generate(log, this.worker, format);
          await DB.markReportGenerated(log.id);
          this.openReportModal(blob, filename, log);
          this.renderDay(date);
        } catch (err) {
          console.error('Report generation failed', err);
          this.toast('Could not generate report — see console for details');
        }
      });
    });
    document.getElementById('add-job-btn').addEventListener('click', async () => {
      log.jobs = log.jobs || [];
      log.jobs.push(DB.newJob(''));
      await DB.saveDailyLog(log);
      this.renderDay(date);
    });

    const jobList = document.getElementById('job-list');
    if (!log.jobs || log.jobs.length === 0) {
      jobList.innerHTML = `<div class="empty-state">No job sites yet — tap "+ Add job site" to start logging today's work.</div>`;
    } else {
      log.jobs.forEach((job) => {
        jobList.appendChild(this.renderJobCard(log, job, photoByJobType));
      });
    }
  },

  renderJobCard(log, job, photoByJobType) {
    const locked = !!job.approval;
    job.testSections = job.testSections || {}; // jobs created before this feature existed
    const card = document.createElement('div');
    card.className = 'card job-card' + (locked ? ' locked' : '');

    // Every hour of the day is selectable — no fixed shift window, since some
    // workers run well past a typical 8-hour day.
    const hourRangeStart = log.hourRangeStart ?? 0;
    const hourRangeEnd = log.hourRangeEnd ?? 24;
    const hourOptions = (selected) => {
      let opts = '';
      for (let h = hourRangeStart; h < hourRangeEnd; h++) {
        opts += `<option value="${h}" ${h === selected ? 'selected' : ''}>${formatHourRange(h)}</option>`;
      }
      return opts;
    };

    const entriesHtml = job.entries.map((entry, idx) => `
      <div class="hour-entry" data-idx="${idx}">
        <select data-entry-hour ${locked ? 'disabled' : ''}>${hourOptions(entry.hour)}</select>
        <textarea class="log-input" data-entry-desc placeholder="What was done this hour?" ${locked ? 'disabled' : ''}>${escapeHtml(entry.description)}</textarea>
        ${locked ? '' : '<button class="remove-entry-btn" data-remove-entry title="Remove">×</button>'}
      </div>
    `).join('');

    const prePhoto = photoByJobType[`${job.id}_pre`];
    const postPhoto = photoByJobType[`${job.id}_post`];

    const approvalHtml = job.approval ? `
      <div class="approval-approved">
        <img src="${job.approval.signatureDataUrl}" alt="Signature" />
        <div class="approval-approved-text">
          ✓ Approved
          <span class="who">${escapeHtml(job.approval.signedBy)}${job.approval.signedRole ? ' — ' + escapeHtml(job.approval.signedRole) : ''} · ${formatTime(job.approval.signedAt)} on ${formatDateLong(log.date)}</span>
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
      ['generator', 'Generator'],
      ['synchronous_motor', 'Synchronous Motor']
    ].map(([val, label]) => `<option value="${val}" ${(job.reportType || '') === val ? 'selected' : ''}>${label}</option>`).join('');

    const testSectionsHtml = job.reportType ? `
      <div class="section-label">Test Sections</div>
      <p class="text-dim tf-intro">Check off the sections that apply to this ${job.reportType === 'generator' ? 'generator' : 'synchronous motor'}. Based on the WEG-EM field service report templates.</p>
      <div data-test-checklist>${TestSections.renderChecklist(job)}</div>
    ` : '';

    card.innerHTML = `
      <div class="job-head">
        <input type="text" class="job-site-input" data-site-name placeholder="Job site name (e.g. Riverside Plant)" value="${escapeHtml(job.siteName)}" ${locked ? 'disabled' : ''} />
        ${locked ? '' : '<button class="job-remove-btn" data-remove-job title="Remove job site">🗑</button>'}
      </div>

      <label class="field-label">Service Order / Unit Number</label>
      <input type="text" class="job-service-order-input" data-service-order placeholder="e.g. SO-48213 / Unit 2" value="${escapeHtml(job.serviceOrder || '')}" ${locked ? 'disabled' : ''} />

      <label class="field-label mt8">Report Type</label>
      <select data-report-type ${locked ? 'disabled' : ''}>${reportTypeOptions}</select>
      ${testSectionsHtml}

      <div class="section-label">Pre-work photo</div>
      ${this.renderSinglePhotoSlot('pre', prePhoto, locked)}

      <div class="section-label">Hourly work log</div>
      <div data-entries-list>${entriesHtml || '<p class="text-dim">No hours logged yet.</p>'}</div>
      ${locked ? '' : '<button class="btn btn-sm mt8" data-add-entry>+ Add hour entry</button>'}

      <div class="section-label">Post-work photo</div>
      ${this.renderSinglePhotoSlot('post', postPhoto, locked)}

      <div class="approval-box">${approvalHtml}</div>
    `;

    // Site name
    const siteInput = card.querySelector('[data-site-name]');
    siteInput.addEventListener('change', async () => {
      job.siteName = siteInput.value;
      await DB.saveDailyLog(log);
    });

    // Service Order / Unit Number
    const serviceOrderInput = card.querySelector('[data-service-order]');
    serviceOrderInput.addEventListener('change', async () => {
      job.serviceOrder = serviceOrderInput.value;
      await DB.saveDailyLog(log);
    });

    // Report type — switching it changes which test sections are offered,
    // so the checklist needs a re-render. Existing answers for sections are
    // kept in job.testSections even if they're hidden after switching type.
    const reportTypeSelect = card.querySelector('[data-report-type]');
    reportTypeSelect.addEventListener('change', async () => {
      job.reportType = reportTypeSelect.value || null;
      await DB.saveDailyLog(log);
      this.renderDay(log.date);
    });

    // Test section checklist: toggling a checkbox shows/hides that
    // section's field form. A debounced, delegated listener on the whole
    // checklist container handles every field inside every expanded
    // section without needing hundreds of individual listeners, and
    // without re-rendering the card on every keystroke (which would lose
    // focus/cursor position given how many inputs a section can have).
    const checklistEl = card.querySelector('[data-test-checklist]');
    if (checklistEl) {
      checklistEl.querySelectorAll('[data-test-toggle]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          const key = cb.dataset.testToggle;
          const existing = job.testSections[key] || { enabled: false, values: {} };
          job.testSections[key] = { enabled: cb.checked, values: existing.values || {} };
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
          const existing = job.testSections[sectionKey] || { enabled: true, values: {} };
          job.testSections[sectionKey] = { enabled: existing.enabled, values };
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
        const existing = job.testSections[sectionKey] || { enabled: true, values: {} };
        job.testSections[sectionKey] = { enabled: existing.enabled, values };
        await DB.saveDailyLog(log);
      });
    }

    // Remove job
    const removeJobBtn = card.querySelector('[data-remove-job]');
    if (removeJobBtn) {
      removeJobBtn.addEventListener('click', async () => {
        if (!confirm(`Remove "${job.siteName || 'this job site'}" and its photos? This can't be undone.`)) return;
        const photos = await DB.getPhotosForLog(log.id);
        for (const p of photos.filter((p) => p.jobId === job.id)) await DB.deletePhoto(p.id);
        log.jobs = log.jobs.filter((j) => j.id !== job.id);
        await DB.saveDailyLog(log);
        this.renderDay(log.date);
      });
    }

    // Hourly entries
    const addEntryBtn = card.querySelector('[data-add-entry]');
    if (addEntryBtn) {
      addEntryBtn.addEventListener('click', async () => {
        const lastHour = job.entries.length ? job.entries[job.entries.length - 1].hour + 1 : hourRangeStart;
        job.entries.push({ hour: Math.min(lastHour, hourRangeEnd - 1), description: '', updatedAt: Date.now() });
        await DB.saveDailyLog(log);
        this.renderDay(log.date);
      });
    }

    card.querySelectorAll('[data-entry-hour]').forEach((sel) => {
      sel.addEventListener('change', async (e) => {
        const idx = Number(e.target.closest('[data-idx]').dataset.idx);
        job.entries[idx].hour = Number(sel.value);
        job.entries[idx].updatedAt = Date.now();
        await DB.saveDailyLog(log);
      });
    });

    card.querySelectorAll('[data-entry-desc]').forEach((ta) => {
      let debounce;
      ta.addEventListener('input', (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          const idx = Number(e.target.closest('[data-idx]').dataset.idx);
          job.entries[idx].description = ta.value;
          job.entries[idx].updatedAt = Date.now();
          await DB.saveDailyLog(log);
        }, 500);
      });
    });

    card.querySelectorAll('[data-remove-entry]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const idx = Number(e.target.closest('[data-idx]').dataset.idx);
        job.entries.splice(idx, 1);
        await DB.saveDailyLog(log);
        this.renderDay(log.date);
      });
    });

    // Photos
    card.querySelectorAll('[data-capture]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.capture;
        const source = btn.dataset.source; // 'camera' or 'gallery'
        const blob = await Camera.capture(source);
        if (!blob) return;
        const photo = await DB.replaceJobPhoto(log.id, job.id, type, blob);
        if (type === 'pre') job.prePhotoId = photo.id; else job.postPhotoId = photo.id;
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
        if (type === 'pre') job.prePhotoId = null; else job.postPhotoId = null;
        await DB.saveDailyLog(log);
        this.renderDay(log.date);
      });
    });

    // Approval
    const openSigBtn = card.querySelector('[data-open-signature]');
    if (openSigBtn) openSigBtn.addEventListener('click', () => this.openSignatureModal(log, job));

    const clearApprovalBtn = card.querySelector('[data-clear-approval]');
    if (clearApprovalBtn) {
      clearApprovalBtn.addEventListener('click', async () => {
        if (!confirm('Clear this approval so the job can be edited again?')) return;
        job.approval = null;
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

  // ---------- Vendor approval signature ----------
  openSignatureModal(log, job) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>Approval signature</h3>
        <p class="text-dim">${escapeHtml(job.siteName || 'This job site')} · ${formatDateLong(log.date)}</p>
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

      job.approval = {
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

  // ---------- Excel report: save locally or share by email ----------
  // Lets the worker pick Word (.docx) or PDF before the report is built.
  // onChoose(format) is called with 'docx' or 'pdf'; the button shows a
  // "Generating…" state and stays open until report generation resolves.
  openFormatChoiceModal(onChoose) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <h3>Generate report</h3>
        <p class="text-dim">Choose a format for today's daily status report.</p>
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
      const original = btn.textContent;
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

  openReportModal(blob, filename, log) {
    const settings = DB.getSettings();
    const canShareFiles = Report.canShareFile(new File([blob], filename, { type: blob.type }));

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
      const subject = `Daily Status Report — ${formatDateLong(log.date)}`;
      const body = `Attached is the daily status report for ${this.worker.name} on ${formatDateLong(log.date)}.`;
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
      const jobs = log.jobs || [];
      const approved = jobs.filter((j) => j.approval).length;
      if (jobs.length === 0) return 'No job sites logged';
      const names = jobs.map((j) => j.siteName || 'Untitled site').join(', ');
      return `${jobs.length} job site${jobs.length === 1 ? '' : 's'} · ${approved} approved — ${names}`;
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
        <input type="text" id="profile-role" value="${escapeHtml(this.worker.role || '')}" placeholder="e.g. HVAC Technician" />
        <label class="field-label">Area / Location</label>
        <input type="text" id="profile-area" value="${escapeHtml(this.worker.area || '')}" placeholder="e.g. North Region / Zone 4" />
        <button class="btn btn-primary btn-block" id="save-profile-btn">Save profile</button>
      </div>

      <div class="card">
        <h3>Erase data</h3>
        <p class="text-dim">Permanently erases everything stored on this device — your profile, every logged day, all job sites, and all photos. This can't be undone, so back up first if you need to keep a copy.</p>
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
function formatHour(h) {
  h = ((h % 24) + 24) % 24;
  const period = h < 12 ? 'AM' : 'PM';
  let hour12 = h % 12; if (hour12 === 0) hour12 = 12;
  return `${hour12}:00 ${period}`;
}
// Renders an hour as its full clock-hour block, e.g. "9 - 10 AM" or,
// when the block crosses noon/midnight, "11 AM - 12 PM".
function formatHourRange(h) {
  const start = ((h % 24) + 24) % 24;
  const end = (start + 1) % 24;
  const partsFor = (hh) => {
    const period = hh < 12 ? 'AM' : 'PM';
    let hour12 = hh % 12; if (hour12 === 0) hour12 = 12;
    return { hour12, period };
  };
  const a = partsFor(start), b = partsFor(end);
  return a.period === b.period ? `${a.hour12} - ${b.hour12} ${a.period}` : `${a.hour12} ${a.period} - ${b.hour12} ${b.period}`;
}
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

document.addEventListener('DOMContentLoaded', () => App.start());
