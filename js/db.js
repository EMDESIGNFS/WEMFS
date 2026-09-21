// db.js — IndexedDB data layer for WEG Field Service.
// Stores: workers, dailyLogs (one per worker per date), photos (blobs, referenced by id).
// Everything here is local-first: it works fully offline. report.js reads
// from this store to build a Word/PDF report on demand — there is no server.
//
// Each daily log has two independent parts:
//   - dsr:        one Daily Status Report per day — a custom-time hourly
//                 schedule, one pre-work + one post-work photo, and the four
//                 narrative fields (Work Completed / Work To Be Completed /
//                 Technical Comments / Recommendations). Not tied to a site.
//   - fsrEntries: zero or more Field Service Report entries — one per piece
//                 of equipment/unit worked on that day. Each carries a site
//                 name, service order/unit number, a report type (Generator
//                 Report / Motor Report), the WEG-EM technical inspection
//                 checklist (with an optional photo per section), and an
//                 approval signature.

const DB_NAME = 'fieldlog-db';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('workers')) {
        db.createObjectStore('workers', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('dailyLogs')) {
        const store = db.createObjectStore('dailyLogs', { keyPath: 'id' });
        store.createIndex('byWorker', 'workerId');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const store = db.createObjectStore('photos', { keyPath: 'id' });
        store.createIndex('byDailyLog', 'dailyLogId');
      }
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

  // ---------- Daily logs ----------
  dailyLogId(workerId, date) { return `${workerId}_${date}`; },

  // Default Daily Status Report shape — one per day, not tied to any site.
  newDsr() {
    return {
      entries: [],   // [{ id, startHour(1-12), startMinute(0/15/30/45), startPeriod('AM'|'PM'), endHour, endMinute, endPeriod, description, updatedAt }]
      prePhotoId: null,
      postPhotoId: null,
      workCompleted: '',
      workToBeCompleted: '',
      technicalComments: '',
      recommendations: ''
    };
  },

  // A single Field Service Report entry — one piece of equipment/unit.
  newFsrEntry(siteName) {
    return {
      id: this.uid(),
      siteName: (siteName || '').trim(),
      serviceOrder: '',       // Service Order / Unit Number
      reportType: null,       // 'generator' | 'motor' | null
      testSections: {},       // { [sectionKey]: { enabled, values: {...}, photoId } } — see js/reportSections.js
      approval: null,         // { signedBy, signedRole, signatureDataUrl, signedAt }
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  },

  async getOrCreateDailyLog(workerId, date) {
    const db = await this.init();
    const id = this.dailyLogId(workerId, date);
    let log = await reqToPromise(tx(db, 'dailyLogs', 'readonly').get(id));
    if (log) return this._migrateLog(log);

    log = {
      id, workerId, date,
      dsr: this.newDsr(),
      fsrEntries: [],
      status: 'draft', reportGeneratedAt: null, updatedAt: Date.now(), createdAt: Date.now()
    };
    await reqToPromise(tx(db, 'dailyLogs', 'readwrite').add(log));
    return log;
  },

  // Fills in any fields missing on a log created before a feature existed —
  // keeps older locally-stored days from breaking the current UI.
  _migrateLog(log) {
    log.dsr = log.dsr || this.newDsr();
    log.dsr.entries = log.dsr.entries || [];
    if (!log.fsrEntries) log.fsrEntries = log.jobs || [];
    return log;
  },

  async saveDailyLog(log) {
    const db = await this.init();
    log.updatedAt = Date.now();
    await reqToPromise(tx(db, 'dailyLogs', 'readwrite').put(log));
    return log;
  },

  async getDailyLog(id) {
    const db = await this.init();
    const log = await reqToPromise(tx(db, 'dailyLogs', 'readonly').get(id));
    return log ? this._migrateLog(log) : log;
  },

  async getLogsForWorker(workerId) {
    const db = await this.init();
    const all = await reqToPromise(tx(db, 'dailyLogs', 'readonly').index('byWorker').getAll(workerId));
    return all.map((l) => this._migrateLog(l)).sort((a, b) => (a.date < b.date ? 1 : -1));
  },

  async markReportGenerated(id) {
    const db = await this.init();
    const store = tx(db, 'dailyLogs', 'readwrite');
    const log = await reqToPromise(store.get(id));
    if (log) { log.reportGeneratedAt = Date.now(); await reqToPromise(store.put(log)); }
  },

  // ---------- Photos ----------
  // A photo's `ownerId` scopes it to whatever it belongs to: 'dsr' for the
  // day's pre/post-work photos, an FSR entry's id for that entry's own
  // photos, or a compound id for a specific test section's photo (see
  // testSectionPhotoOwnerId below). `type` distinguishes photos within the
  // same owner ('pre' / 'post' / 'section').
  async addPhoto(dailyLogId, ownerId, type, blob) {
    const db = await this.init();
    const photo = {
      id: this.uid(), dailyLogId, jobId: ownerId, type, blob,
      takenAt: Date.now()
    };
    await reqToPromise(tx(db, 'photos', 'readwrite').add(photo));
    return photo;
  },

  async replacePhoto(dailyLogId, ownerId, type, blob) {
    const existing = await this.getPhotosForLog(dailyLogId);
    const toRemove = existing.filter((p) => p.jobId === ownerId && p.type === type);
    for (const p of toRemove) await this.deletePhoto(p.id);
    return this.addPhoto(dailyLogId, ownerId, type, blob);
  },

  // Composite owner id for a single technical inspection section's photo,
  // so it doesn't collide with another FSR entry's or section's photo.
  testSectionPhotoOwnerId(fsrEntryId, sectionKey) {
    return `${fsrEntryId}::${sectionKey}`;
  },

  async getPhotosForLog(dailyLogId) {
    const db = await this.init();
    return reqToPromise(tx(db, 'photos', 'readonly').index('byDailyLog').getAll(dailyLogId));
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

  // Permanently wipes every worker, daily log, and photo on this device, plus
  // all saved settings. Used by Settings → Erase data. Irreversible.
  async eraseAllData() {
    const db = await this.init();
    await Promise.all([
      reqToPromise(tx(db, 'workers', 'readwrite').clear()),
      reqToPromise(tx(db, 'dailyLogs', 'readwrite').clear()),
      reqToPromise(tx(db, 'photos', 'readwrite').clear())
    ]);
    localStorage.removeItem('fieldlog-settings');
    localStorage.removeItem('fieldlog-current-worker');
  }
};

window.DB = DB;
