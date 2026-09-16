// db.js — IndexedDB data layer for WEG Field Service.
// Stores: workers, dailyLogs (one per worker per date), photos (blobs, referenced by id).
// Everything here is local-first: it works fully offline. report.js reads
// from this store to build an Excel report on demand — there is no server.

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
  // A daily log is one page per worker per date, made up of one or more
  // "jobs" (job-site visits). Each job carries: a site name, a single
  // pre-work photo, a single post-work photo, an hourly work log, and an
  // optional vendor approval signature.
  dailyLogId(workerId, date) { return `${workerId}_${date}`; },

  newJob(siteName) {
    return {
      id: this.uid(),
      siteName: (siteName || '').trim(),
      serviceOrder: '',       // Service Order / Unit Number
      reportType: null,       // 'generator' | 'synchronous_motor' | null
      testSections: {},       // { [sectionKey]: { enabled, values: {...} } } — see js/reportSections.js
      entries: [],            // [{ hour, description, updatedAt }]
      prePhotoId: null,
      postPhotoId: null,
      approval: null,         // { signedBy, signedRole, signatureDataUrl, signedAt }
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  },

  // No fixed shift window — some workers run well past a typical 8-hour day,
  // so every hour of the day (0-23) is always available to log against.
  async getOrCreateDailyLog(workerId, date) {
    const db = await this.init();
    const id = this.dailyLogId(workerId, date);
    let log = await reqToPromise(tx(db, 'dailyLogs', 'readonly').get(id));
    if (log) return log;

    log = {
      id, workerId, date, hourRangeStart: 0, hourRangeEnd: 24, jobs: [],
      status: 'draft', reportGeneratedAt: null, updatedAt: Date.now(), createdAt: Date.now(),
      dailyReport: {           // Daily Status Report narrative fields (DSR template)
        workCompleted: '',
        workToBeCompleted: '',
        technicalComments: '',
        recommendations: ''
      }
    };
    await reqToPromise(tx(db, 'dailyLogs', 'readwrite').add(log));
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
    return reqToPromise(tx(db, 'dailyLogs', 'readonly').get(id));
  },

  async getLogsForWorker(workerId) {
    const db = await this.init();
    const all = await reqToPromise(tx(db, 'dailyLogs', 'readonly').index('byWorker').getAll(workerId));
    return all.sort((a, b) => (a.date < b.date ? 1 : -1));
  },

  async markReportGenerated(id) {
    const db = await this.init();
    const store = tx(db, 'dailyLogs', 'readwrite');
    const log = await reqToPromise(store.get(id));
    if (log) { log.reportGeneratedAt = Date.now(); await reqToPromise(store.put(log)); }
  },

  // ---------- Photos ----------
  // Each job has exactly one pre-work and one post-work photo. Capturing a
  // new one for a slot that's already filled replaces (deletes) the old one.
  async addPhoto(dailyLogId, jobId, type, blob) {
    const db = await this.init();
    const photo = {
      id: this.uid(), dailyLogId, jobId, type, blob,
      takenAt: Date.now()
    };
    await reqToPromise(tx(db, 'photos', 'readwrite').add(photo));
    return photo;
  },

  async replaceJobPhoto(dailyLogId, jobId, type, blob) {
    const existing = await this.getPhotosForLog(dailyLogId);
    const toRemove = existing.filter((p) => p.jobId === jobId && p.type === type);
    for (const p of toRemove) await this.deletePhoto(p.id);
    return this.addPhoto(dailyLogId, jobId, type, blob);
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
