// db.js — IndexedDB data layer for WEG Field Service.
// Stores: workers, jobs, photos (blobs, referenced by id). Everything here is
// local-first: it works fully offline. report.js reads from this store to
// build a Word/PDF report on demand — there is no server.
//
// A **Job** is the primary, persistent record — you create one per job site
// (site name, service order/unit number, overall job scope, job history) and
// keep adding to it over the life of that job. Inside a Job live three
// independent, repeatable kinds of entries:
//   - dsrEntries: one Daily Status Report per day worked — Team head/members
//     (pre-filled with the worker's own name), First Aid/Near Misses/
//     Recordable Injuries (Yes/No + explanation), Further Job History, and
//     Work Completed / Technical Comments / Current Status (each with any
//     number of optional photos). No time tracking here — that's the TSR's
//     job.
//   - tsrEntries: always exactly one Time Sheet Report per job, covering
//     every date worked on it. Each date has its own custom-time hourly
//     schedule and its own Labor/Travel hour split (see newTsrDayEntry),
//     while a single approval signature covers every date on the entry.
//     Adding a date automatically creates a matching DSR entry for it (see
//     ensureDsrEntryForDate), and removing a date automatically deletes that
//     DSR entry (and its photos — see removeDsrEntryForDate) — DSR entries
//     are never added or removed by hand anymore.
//   - fsrEntries: one Field Service Report per piece of equipment tested —
//     report type (Generator/Motor) + the WEG-EM technical inspection
//     checklist, each section with any number of its own optional photos. No
//     site name, service order, or approval signature here — those live on
//     the Job (site/order) or nowhere (FSR approval was dropped; TSR carries
//     the signature).

// Total hours worked/traveled on one TSR day entry, from its 12-hour
// start/end clock fields (see newTsrDayEntry below). Shared by the app UI
// (the live Labor/Travel split — see renderTsrEntryCard in js/app.js) and
// report generation (Straight/Overtime/Premium categorization in
// js/report.js), so every part of the app agrees on one date's total.
// Assumes a shift doesn't cross midnight.
function tsrDayTotalHours(day) {
  const to24 = (h12, period) => (period === 'PM' ? (h12 % 12) + 12 : h12 % 12);
  const startMin = to24(day.startHour, day.startPeriod) * 60 + day.startMinute;
  const endMin = to24(day.endHour, day.endPeriod) * 60 + day.endMinute;
  return Math.max(0, endMin - startMin) / 60;
}
window.tsrDayTotalHours = tsrDayTotalHours;

const DB_NAME = 'fieldlog-db';
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('workers')) {
        db.createObjectStore('workers', { keyPath: 'id' });
      }
      // Replaces the older 'dailyLogs' store (one record per worker per date)
      // with 'jobs' — a persistent record per job site that a worker keeps
      // adding daily DSR/TSR entries and per-unit FSR entries into over time.
      if (db.objectStoreNames.contains('dailyLogs')) {
        db.deleteObjectStore('dailyLogs');
      }
      if (!db.objectStoreNames.contains('jobs')) {
        const store = db.createObjectStore('jobs', { keyPath: 'id' });
        store.createIndex('byWorker', 'workerId');
      }
      if (db.objectStoreNames.contains('photos')) {
        db.deleteObjectStore('photos');
      }
      // Photos are keyed by the top-level Job they belong to (for bulk
      // fetch when building a report) and scoped within that by `ownerId` —
      // a DSR entry's id, an FSR entry's id, or a composite section id.
      const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
      photoStore.createIndex('byJob', 'jobId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  _db: null,
  async init() {
    if (!this._db) this._db = await openDb();
    return this._db;
  },

  uid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  },
  todayStr(d = new Date()) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // ---------- Workers ----------
  async addWorker(name, role, area) {
    const db = await this.init();
    const worker = {
      id: this.uid(),
      name: name.trim(),
      role: (role || '').trim(),
      area: (area || '').trim(),
      createdAt: Date.now()
    };
    await reqToPromise(tx(db, 'workers', 'readwrite').add(worker));
    return worker;
  },
  async getWorkers() {
    const db = await this.init();
    return reqToPromise(tx(db, 'workers', 'readonly').getAll());
  },
  async getWorker(id) {
    const db = await this.init();
    return reqToPromise(tx(db, 'workers', 'readonly').get(id));
  },
  async updateWorker(worker) {
    const db = await this.init();
    await reqToPromise(tx(db, 'workers', 'readwrite').put(worker));
    return worker;
  },

  // ---------- Jobs ----------
  // A fresh Job record — created once per customer/client and kept open for
  // as long as the worker keeps logging DSR/TSR days and FSR equipment
  // entries against it. `siteName` holds the customer/client's name (shown
  // in the app as "Customer / Client Name" — the field key is unchanged from
  // before that relabel, so existing saved jobs keep working); `siteLocation`
  // is the separate physical job site/location, entered right before the
  // Service Order.
  newJob(workerId, { siteName = '', siteLocation = '', serviceOrder = '', overallJobScope = '', jobHistory = '' } = {}) {
    return {
      id: this.uid(),
      workerId,
      siteName: siteName.trim(),
      siteLocation: siteLocation.trim(),
      serviceOrder: serviceOrder.trim(),
      overallJobScope: overallJobScope.trim(),
      jobHistory: jobHistory.trim(),
      dsrEntries: [],
      tsrEntries: [],
      fsrEntries: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  },

  // One Daily Status Report — one per day worked on this job. `teamMembers`
  // is pre-filled with the worker's own name; they can add more lines below
  // it for whoever else is on site that day.
  newDsrEntry(defaultTeamMember) {
    return {
      id: this.uid(),
      date: this.todayStr(),
      teamMembers: (defaultTeamMember || '').trim(),
      firstAidIncident: null,   // 'yes' | 'no' | null (unanswered)
      firstAidExplanation: '',
      furtherJobHistory: '',    // supplementary, day-specific history (distinct from the Job's own overall history)
      workCompleted: '',
      technicalComments: '',
      currentStatus: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  },

  // One Time Sheet Report — covers one or more dates worked on this job (a
  // single work week can be logged as one TSR entry). Each date gets its own
  // custom-time start/end range and its own Labor/Travel work-type pick
  // (see newTsrDayEntry), while a single approval signature covers every
  // date on the entry.
  newTsrEntry() {
    return {
      id: this.uid(),
      dayEntries: [this.newTsrDayEntry(this.todayStr())],
      approval: null,  // { signedBy, signedRole, signatureDataUrl, signedAt }
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  },

  // One date's worth of time-sheet detail within a TSR entry — its own
  // custom-time start/end range plus how that date's total hours (see
  // tsrDayTotalHours above) split between Labor and Travel. Only Labor is
  // stored; Travel is always the remainder (total - laborHours), so the two
  // can never disagree — the app UI lets the worker edit either field and
  // keeps both in sync live (see renderTsrEntryCard in js/app.js).
  newTsrDayEntry(date) {
    return {
      date,                                             // 'YYYY-MM-DD'
      startHour: 8, startMinute: 0, startPeriod: 'AM',   // 1-12, 0/15/30/45, 'AM'|'PM'
      endHour: 9, endMinute: 0, endPeriod: 'AM',
      laborHours: null  // hours of that day's total spent on Labor; null until set
    };
  },

  // One Field Service Report entry — one piece of equipment/unit tested on
  // this job. No site name / service order (those live on the Job) and no
  // approval signature (that now lives on the TSR). `modelNumber` is what
  // identifies this entry in the app and in generated reports (falling back
  // to "Equipment N" — see fsrEntryLabel() in js/report.js — until one is
  // entered).
  newFsrEntry() {
    return {
      id: this.uid(),
      modelNumber: '',
      reportType: null,       // 'generator' | 'motor' | null
      testSections: {},       // { [sectionKey]: { enabled, values: {...} } } — see js/reportSections.js
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  },

  // Every job gets exactly one TSR entry and one DSR entry (for today) right
  // away — there's no more "+ Add TSR entry" / "+ Add DSR entry"; DSR entries
  // are created automatically to match whatever dates end up on the TSR.
  async createJob(workerId, fields) {
    const db = await this.init();
    const job = this.newJob(workerId, fields);
    const worker = await this.getWorker(workerId);
    const tsrEntry = this.newTsrEntry();
    job.tsrEntries = [tsrEntry];
    tsrEntry.dayEntries.forEach((day) => this.ensureDsrEntryForDate(job, day.date, worker && worker.name));
    await reqToPromise(tx(db, 'jobs', 'readwrite').add(job));
    return job;
  },

  // Makes sure `job` has a DSR entry for `date`, creating one (pre-filled
  // with `defaultTeamMember`) if it doesn't already exist. Called whenever a
  // date is added to the job's TSR entry (and when a job is first created) —
  // DSR entries are never created manually. Returns true if a new entry was
  // created, so callers can tell whether anything changed.
  ensureDsrEntryForDate(job, date, defaultTeamMember) {
    job.dsrEntries = job.dsrEntries || [];
    if (job.dsrEntries.some((entry) => entry.date === date)) return false;
    const entry = this.newDsrEntry(defaultTeamMember);
    entry.date = date;
    job.dsrEntries.push(entry);
    job.dsrEntries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return true;
  },

  // The reverse of ensureDsrEntryForDate: removes `job`'s DSR entry for
  // `date`, if it has one, and returns the removed entry (so the caller can
  // clean up its photos) or null if there wasn't one. Called whenever a date
  // is removed from the job's TSR entry — a DSR entry never outlives the TSR
  // date it was created for.
  removeDsrEntryForDate(job, date) {
    job.dsrEntries = job.dsrEntries || [];
    const idx = job.dsrEntries.findIndex((entry) => entry.date === date);
    if (idx === -1) return null;
    return job.dsrEntries.splice(idx, 1)[0];
  },

  async getJobsForWorker(workerId) {
    const db = await this.init();
    const all = await reqToPromise(tx(db, 'jobs', 'readonly').index('byWorker').getAll(workerId));
    for (const job of all) {
      if (this._normalizeJob(job)) await this.saveJob(job);
    }
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async getJob(id) {
    const db = await this.init();
    const job = await reqToPromise(tx(db, 'jobs', 'readonly').get(id));
    if (!job) return job;
    if (this._normalizeJob(job)) await this.saveJob(job);
    return job;
  },

  // Fills in any arrays/fields missing on a job created before a feature
  // existed, so nothing renders as undefined, and brings older jobs in line
  // with the current one-TSR-per-job / auto-DSR-per-date rules. Mutates
  // `job` in place and returns true if anything on it needed to change, so
  // callers know whether the fixed-up job needs to be persisted.
  _normalizeJob(job) {
    let mutated = false;
    job.dsrEntries = job.dsrEntries || [];
    job.tsrEntries = job.tsrEntries || [];
    job.fsrEntries = job.fsrEntries || [];

    job.tsrEntries.forEach((entry) => {
      if (!entry.dayEntries) {
        // TSR entries used to carry a `dates` array plus one flat time range
        // + work type shared by every date; split that into one dayEntry per
        // date so each date can now have its own time range and work type.
        if (entry.dates) {
          entry.dayEntries = entry.dates.map((d) => ({
            date: d,
            startHour: entry.startHour || 8,
            startMinute: entry.startMinute || 0,
            startPeriod: entry.startPeriod || 'AM',
            endHour: entry.endHour || 9,
            endMinute: entry.endMinute || 0,
            endPeriod: entry.endPeriod || 'AM',
            workType: entry.workType === undefined ? null : entry.workType
          }));
        } else {
          // Oldest shape: a single `date` string plus a repeatable `entries`
          // list of time ranges (no work type at all) — take the first
          // logged range as that one date's dayEntry.
          const first = (entry.entries && entry.entries[0]) || {};
          entry.dayEntries = [{
            date: entry.date || this.todayStr(),
            startHour: first.startHour || 8,
            startMinute: first.startMinute || 0,
            startPeriod: first.startPeriod || 'AM',
            endHour: first.endHour || 9,
            endMinute: first.endMinute || 0,
            endPeriod: first.endPeriod || 'AM',
            workType: null
          }];
        }
        mutated = true;
      }
      if (entry.dates !== undefined) { delete entry.dates; mutated = true; }
      if (entry.date !== undefined) { delete entry.date; mutated = true; }
      if (entry.entries !== undefined) { delete entry.entries; mutated = true; }
      if (entry.startHour !== undefined) { delete entry.startHour; delete entry.startMinute; delete entry.startPeriod; delete entry.endHour; delete entry.endMinute; delete entry.endPeriod; mutated = true; }
      if (entry.workType !== undefined) { delete entry.workType; mutated = true; }

      // Each day used to carry a single Labor-or-Travel `workType` pick;
      // that's now a numeric Labor/Travel hour split (`laborHours`, with
      // Travel always the remainder of that day's total — see
      // newTsrDayEntry above). Convert whatever a day already had into an
      // equivalent split rather than losing it: all-Labor, all-Travel, or
      // (no prior pick) unset, left for the worker to fill in.
      (entry.dayEntries || []).forEach((day) => {
        if (day.laborHours === undefined) {
          const total = tsrDayTotalHours(day);
          if (day.workType === 'labor') day.laborHours = total;
          else if (day.workType === 'travel') day.laborHours = 0;
          else day.laborHours = null;
          mutated = true;
        }
        if (day.workType !== undefined) { delete day.workType; mutated = true; }
      });
    });

    // Only one TSR entry is allowed per job now. A job created before this
    // change may have more than one — keep the first, merge every other
    // entry's dayEntries into it by date (so no logged date, time, or work
    // type is lost — first entry wins on a date collision), and drop the rest.
    if (job.tsrEntries.length > 1) {
      const [keep, ...rest] = job.tsrEntries;
      keep.dayEntries = keep.dayEntries || [];
      rest.forEach((extra) => {
        (extra.dayEntries || []).forEach((day) => {
          if (!keep.dayEntries.some((d) => d.date === day.date)) keep.dayEntries.push(day);
        });
      });
      keep.dayEntries.sort((a, b) => a.date.localeCompare(b.date));
      job.tsrEntries = [keep];
      mutated = true;
    }
    // Every job always has exactly one TSR entry — seed one if this job
    // somehow has none.
    if (job.tsrEntries.length === 0) {
      job.tsrEntries.push(this.newTsrEntry());
      mutated = true;
    }

    // A DSR entry is auto-created for every date logged on the TSR; backfill
    // any that are missing (e.g. dates added before this feature existed).
    job.tsrEntries[0].dayEntries.forEach((day) => {
      if (this.ensureDsrEntryForDate(job, day.date, null)) mutated = true;
    });

    // FSR entries used to have no name of their own (shown as "Equipment N"
    // by position); fill in a blank modelNumber for older entries so the
    // field always exists.
    job.fsrEntries.forEach((entry) => {
      if (entry.modelNumber === undefined) { entry.modelNumber = ''; mutated = true; }
    });

    return mutated;
  },

  async saveJob(job) {
    const db = await this.init();
    job.updatedAt = Date.now();
    await reqToPromise(tx(db, 'jobs', 'readwrite').put(job));
    return job;
  },

  async deleteJob(id) {
    const db = await this.init();
    const photos = await this.getPhotosForJob(id);
    for (const p of photos) await this.deletePhoto(p.id);
    await reqToPromise(tx(db, 'jobs', 'readwrite').delete(id));
  },

  // ---------- Photos ----------
  // A photo belongs to a Job (`jobId`, for bulk fetch when building that
  // job's report) and is scoped within it by `ownerId`: a DSR entry's id
  // (with `type` 'workCompleted' / 'technicalComments' / 'currentStatus'),
  // or a compound id for a specific FSR test section's photo (see
  // testSectionPhotoOwnerId below, `type` 'section'). Any `ownerId`+`type`
  // combination can hold any number of photos — every camera/upload slot in
  // the app lets the worker attach multiple images, not just one, so callers
  // always add a new photo rather than replacing an existing one.
  async addPhoto(jobId, ownerId, type, blob) {
    const db = await this.init();
    const photo = {
      id: this.uid(), jobId, ownerId, type, blob,
      takenAt: Date.now()
    };
    await reqToPromise(tx(db, 'photos', 'readwrite').add(photo));
    return photo;
  },

  // Composite owner id for a technical inspection section's photos, so they
  // don't collide with another FSR entry's or section's photos.
  testSectionPhotoOwnerId(fsrEntryId, sectionKey) {
    return `${fsrEntryId}::${sectionKey}`;
  },

  async getPhotosForJob(jobId) {
    const db = await this.init();
    return reqToPromise(tx(db, 'photos', 'readonly').index('byJob').getAll(jobId));
  },

  async getPhoto(id) {
    const db = await this.init();
    return reqToPromise(tx(db, 'photos', 'readonly').get(id));
  },

  async deletePhoto(id) {
    const db = await this.init();
    await reqToPromise(tx(db, 'photos', 'readwrite').delete(id));
  },

  // ---------- Settings (small key/value, stored in localStorage — not worth its own store) ----------
  getSettings() {
    try {
      return JSON.parse(localStorage.getItem('fieldlog-settings')) || {};
    } catch { return {}; }
  },
  saveSettings(settings) {
    localStorage.setItem('fieldlog-settings', JSON.stringify(settings));
  },
  getCurrentWorkerId() { return localStorage.getItem('fieldlog-current-worker'); },
  setCurrentWorkerId(id) { localStorage.setItem('fieldlog-current-worker', id); },
  clearCurrentWorker() { localStorage.removeItem('fieldlog-current-worker'); },

  // Permanently wipes every worker, job, and photo on this device, plus
  // all saved settings. Used by Settings → Erase data. Irreversible.
  async eraseAllData() {
    const db = await this.init();
    await Promise.all([
      reqToPromise(tx(db, 'workers', 'readwrite').clear()),
      reqToPromise(tx(db, 'jobs', 'readwrite').clear()),
      reqToPromise(tx(db, 'photos', 'readwrite').clear())
    ]);
    localStorage.removeItem('fieldlog-settings');
    localStorage.removeItem('fieldlog-current-worker');
  }
};

window.DB = DB;
