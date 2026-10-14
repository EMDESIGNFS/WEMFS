// report.js — builds a downloadable/shareable report for a Job, as either a
// Word (.docx) document or a PDF. The header (logo + the two company
// letterheads) and the "Page X of Y" footer match the official WEG-EM "Daily
// Status Report" Word template (see icons/dsr-header-logo.jpg, extracted
// directly from that template). These letterhead elements are never altered
// by report content — only the space between the header and footer is used
// to lay out the actual TSR/DSR/FSR data. A single-scope report (TSR only,
// DSR only, or FSR only) doesn't repeat its own name as a section heading —
// the title under the header already says it — that heading only shows up
// on a combined report, where it's needed to tell the sections apart.
//
// A Job (see js/db.js) is a persistent record for one job site, holding
// three independent, repeatable kinds of entries added to it over time:
//   - tsrEntries: always exactly one Time Sheet Report, covering one or more
//     dates — each date with its own hourly schedule and Labor/Travel pick,
//     plus a single approval signature covering every date on it.
//   - dsrEntries: Daily Status Reports — one per day worked, each with team/
//     first aid/history narrative fields and optional photos.
//   - fsrEntries: Field Service Reports — one per piece of equipment tested,
//     each with the WEG-EM technical inspection checklist and per-section
//     photos.
// The worker picks which of the three to include when generating a report —
// TSR only, DSR only, FSR only, or combined (all three) — and which file
// format. Everything is generated in the browser — via a bundled copy of the
// `docx` library (js/vendor/docx.min.js) and jsPDF + jsPDF-AutoTable
// (js/vendor/jspdf.min.js, js/vendor/jspdf.autotable.min.js) — so report
// generation works fully offline with no server involved.

// ---------- Technical inspection sections (see js/reportSections.js) ----------
// Turns one stored leaf value (a plain string, or a {value,unit} unit
// reading) into display text. Returns '—' for a field the worker left
// blank — used only to detect blanks so they can be left out of the report
// entirely (see buildTestSectionsData below); the report itself only shows
// fields that were actually filled in.
function formatLeafValue(row, leafVal) {
  if (row.t === 'unit' || row.t === 'unit2') {
    const v = leafVal || {};
    if (v.value === undefined || v.value === null || String(v.value).trim() === '') return '—';
    return `${v.value} ${v.unit || ''}`.trim();
  }
  const s = leafVal == null ? '' : String(leafVal).trim();
  return s === '' ? '—' : s;
}

// Flattens every enabled technical inspection section on an FSR entry into
// { title, photo, rows: [[label, value], ...] } — but only the fields that
// actually have a value. Blank fields (and blank grid cells) are left out
// entirely rather than padded with "—", so the report shows exactly what was
// measured. A section with nothing entered and no photo is dropped
// altogether, so a section a worker checked but never filled in doesn't show
// up as an empty block.
function buildTestSectionsData(fsrEntry, allPhotos) {
  const enabledKeys = Object.keys(fsrEntry.testSections || {}).filter((k) => fsrEntry.testSections[k] && fsrEntry.testSections[k].enabled);
  if (enabledKeys.length === 0) return [];
  const sections = enabledKeys.map((k) => REPORT_SECTIONS.find((s) => s.key === k)).filter(Boolean);

  return sections.map((section) => {
    const values = ((fsrEntry.testSections[section.key] || {}).values) || {};
    const rows = [];
    for (const fRow of section.rows) {
      if (fRow.t === 'grid') {
        const grid = values[fRow.k] || [];
        const unitSuffix = fRow.u2 ? ` ${fRow.u2}` : '';
        fRow.rows.forEach((rLabel, ri) => {
          fRow.cols.forEach((cLabel, ci) => {
            const cellVal = grid[ri] && grid[ri][ci];
            if (cellVal === undefined || cellVal === '' || cellVal === null) return; // unentered — skip
            rows.push([`${fRow.l} — ${rLabel} — ${cLabel}`, `${cellVal}${unitSuffix}`]);
          });
        });
      } else if (fRow.t === 'dual') {
        const v = values[fRow.k] || {};
        fRow.fields.forEach((f) => {
          const val = formatLeafValue({ t: 'unit' }, v[f.k]);
          if (val === '—') return;
          rows.push([`${fRow.l} — ${f.l}`, val]);
        });
      } else if (fRow.p) {
        const v = values[fRow.k] || {};
        const foundVal = formatLeafValue(fRow, v.found);
        const leftVal = formatLeafValue(fRow, v.left);
        if (foundVal === '—' && leftVal === '—') continue;
        const parts = [];
        if (foundVal !== '—') parts.push(`As Found: ${foundVal}`);
        if (leftVal !== '—') parts.push(`As Left: ${leftVal}`);
        rows.push([fRow.l, parts.join('    |    ')]);
      } else {
        const val = formatLeafValue(fRow, values[fRow.k]);
        if (val === '—') continue;
        rows.push([fRow.l, val]);
      }
    }
    const ownerId = DB.testSectionPhotoOwnerId(fsrEntry.id, section.key);
    const photos = allPhotos.filter((p) => p.ownerId === ownerId && p.type === 'section');
    return { title: section.title, rows, photos };
  }).filter((s) => s.rows.length > 0 || s.photos.length > 0); // nothing entered and no photos — leave it out entirely
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// jsPDF's addImage() rasterizes at the *source* pixel dimensions regardless
// of the display width/height it's placed at — embedding a full-resolution
// photo or logo untouched bloats the PDF to tens of megabytes. Downscaling
// through a canvas first (to roughly the pixel size it'll actually be shown
// at) keeps PDFs a normal, shareable size. Word (.docx) doesn't have this
// problem — it embeds the original file bytes as-is — so this is PDF-only.
function resizeDataUrl(dataUrl, maxDim, mime = 'image/jpeg', quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (Math.max(width, height) > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL(mime, quality));
    };
    img.onerror = () => reject(new Error('Image failed to load for resizing'));
    img.src = dataUrl;
  });
}

// Natural pixel size of an image blob (as the browser displays it, i.e. with
// any camera EXIF rotation already applied), so photos can be placed in
// reports at their true aspect ratio instead of being forced into a fixed box.
function getImageSize(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image failed to load')); };
    img.src = url;
  });
}

// Largest size that fits inside maxW x maxH while keeping the original
// width:height ratio (never stretched or squashed).
function fitInside(width, height, maxW, maxH) {
  const scale = Math.min(maxW / width, maxH / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// One TextRun per line of `text` (joined with line breaks), so multi-line
// fields keep their line breaks in Word — a literal "\n" inside a single
// TextRun is collapsed to a space by Word.
function multilineRuns(text, opts = {}) {
  return String(text == null ? '' : text).split('\n').map((line, i) => new window.docx.TextRun({ ...opts, text: line, ...(i ? { break: 1 } : {}) }));
}

// Safety topics printed on every Field Service Report (fixed list from the
// official report format).
const FSR_TOPICS = [
  'Potential for electrical shock and sudden release of stored energy.',
  'Lifting and rigging.',
  'Housekeeping.',
  'Communication with other trades.',
  'Brake and awareness of your surrounding and heat awareness and hydrating.',
  'Use of ladder or have a scaffold in accesses point.',
  'Verbal communication with other trades on this project.',
  'FME all opening and tool going in generator.',
  'Awareness of the weather.',
  'Pinch point and sharp edges'
];

// Combines every DSR entry on the job into the overview part of the Field
// Service Report: service date range, de-duplicated team, first-aid status,
// and — per DSR date, oldest first — Work Completed, Technical Comments and
// Current Status / Next Steps (with the photos attached to each).
function buildFsrSummary(job, photos, fsrModels = []) {
  const entries = (job.dsrEntries || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const dates = entries.map((e) => e.date).filter(Boolean);
  const serviceDateText = !dates.length ? '—'
    : dates[0] === dates[dates.length - 1] ? formatDateLong(dates[0])
    : `${formatDateLong(dates[0])} to ${formatDateLong(dates[dates.length - 1])}`;

  const team = [];
  const seen = new Set();
  for (const e of entries) {
    for (const name of String(e.teamMembers || '').split(/[\n,]/).map((n) => n.trim()).filter(Boolean)) {
      const key = name.toLowerCase();
      if (!seen.has(key)) { seen.add(key); team.push(name); }
    }
  }

  const incidents = entries.filter((e) => e.firstAidIncident === 'yes');
  const firstAidText = incidents.length
    ? incidents.map((e) => `${formatDateLong(e.date)}: ${(e.firstAidExplanation || '').trim() || '(no explanation entered)'}`).join('; ')
    : entries.some((e) => e.firstAidIncident === 'no') ? 'None to date.' : '—';

  const days = entries.map((e) => ({
    date: e.date,
    travelOnly: jobDateIsTravelOnly(job, e.date),
    workCompleted: (e.workCompleted || '').trim(),
    technicalComments: (e.technicalComments || '').trim(),
    currentStatus: (e.currentStatus || '').trim(),
    workCompletedPhotos: photos.filter((p) => p.ownerId === e.id && p.type === 'workCompleted'),
    technicalCommentsPhotos: photos.filter((p) => p.ownerId === e.id && p.type === 'technicalComments'),
    currentStatusPhotos: photos.filter((p) => p.ownerId === e.id && p.type === 'currentStatus')
  }));

  // The three combined sections, in report order. Travel-only dates have no
  // narrative, so they only appear under Work Completed (as a Travel line).
  const sections = [
    { label: 'WORK COMPLETED:', key: 'workCompleted', photosKey: 'workCompletedPhotos', showTravel: true },
    { label: 'TECHNICAL COMMENTS / CONCERNS / FINDINGS:', key: 'technicalComments', photosKey: 'technicalCommentsPhotos' },
    { label: 'CURRENT STATUS / NEXT STEPS:', key: 'currentStatus', photosKey: 'currentStatusPhotos' }
  ].map((sec) => ({
    label: sec.label,
    items: days
      .filter((d) => (sec.showTravel && d.travelOnly) || (!d.travelOnly && (d[sec.key] || d[sec.photosKey].length)))
      .map((d) => ({
        date: d.date,
        text: d.travelOnly ? 'Travel only — no on-site work performed.' : d[sec.key],
        photos: d.travelOnly ? [] : d[sec.photosKey]
      }))
  }));

  // Generator / motor test data goes under Work Completed, on the date the
  // test was done. A test date with no DSR of its own gets its own date block;
  // a test with no date is filed under the last DSR date.
  const work = sections[0];
  const lastDate = dates.length ? dates[dates.length - 1] : (job.tsrEntries && job.tsrEntries[0] && (job.tsrEntries[0].dayEntries || []).map((d) => d.date).sort().pop()) || DB.todayStr();
  work.items.forEach((it) => { it.tests = []; });
  for (const fm of fsrModels) {
    const d = fm.entry.testDate || lastDate;
    let item = work.items.find((it) => it.date === d);
    if (!item) {
      item = { date: d, text: '', photos: [], tests: [] };
      work.items.push(item);
    }
    item.tests.push(fm);
  }
  work.items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return { serviceDateText, team, firstAidText, overallJobScope: (job.overallJobScope || '').trim(), sections };
}

function fsrReportTypeLabel(reportType) {
  return reportType === 'generator' ? 'Generator Report' : reportType === 'motor' ? 'Motor Report' : null;
}

// What an FSR entry is headed by in a report: the model number the worker
// entered, or "Equipment N" (by position) if none was entered yet.
function fsrEntryLabel(entry, idx) {
  const model = (entry.modelNumber || '').trim();
  return model || `Equipment ${idx + 1}`;
}

function scopeTitle(scope) {
  if (scope === 'tsr') return 'TIME SHEET REPORT';
  if (scope === 'dsr') return 'DAILY STATUS REPORT';
  if (scope === 'fsr') return 'FIELD SERVICE REPORT';
  return 'TIME SHEET, DAILY STATUS & FIELD SERVICE REPORT';
}

function firstAidDisplayText(dsrEntry) {
  if (dsrEntry.firstAidIncident === 'yes') return `Yes — ${(dsrEntry.firstAidExplanation || '').trim() || '(no explanation entered)'}`;
  if (dsrEntry.firstAidIncident === 'no') return 'No';
  return '—';
}

// ---------- TSR hour categorization (Straight / Overtime / Premium) ----------
// Matches the official WEG-EM Time Sheet Report policy:
//   - Straight Time: first 8 hours of work and travel, Monday - Friday.
//   - Overtime (1.5x): hours beyond 8 Monday - Friday, and the first 8 hours
//     worked on Saturday.
//   - Premium (2x): hours beyond 8 on Saturday, all hours on Sunday, and all
//     hours on a federally recognized holiday.
// Work vs. travel isn't distinguished for these thresholds — the policy
// treats them the same.

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
// The nth occurrence of `weekday` (0=Sun..6=Sat) in `month` (0-11) of `year`.
function nthWeekdayOfMonth(year, month, weekday, n) {
  const d = new Date(year, month, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) {
      count += 1;
      if (count === n) return d;
    }
    d.setDate(d.getDate() + 1);
  }
}
function lastWeekdayOfMonth(year, month, weekday) {
  const d = new Date(year, month + 1, 0); // last calendar day of the month
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return d;
}
// Anonymous Gregorian algorithm for the date of Easter Sunday.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Builds { 'YYYY-MM-DD': 'Holiday Name' } for one calendar year, from the
// company's federally-recognized holiday list.
function holidaysForYear(year) {
  const map = {};
  const set = (d, name) => { map[ymd(d)] = name; };

  set(new Date(year, 11, 31), "New Year's Eve");
  set(new Date(year, 0, 1), "New Year's Day");
  set(nthWeekdayOfMonth(year, 0, 1, 3), 'Martin Luther King Day'); // 3rd Monday of January
  set(addDays(easterSunday(year), -2), 'Good Friday');
  set(lastWeekdayOfMonth(year, 4, 1), 'Memorial Day'); // last Monday of May

  // Independence Day + floating holiday: when July 4th falls on a weekend,
  // the floating holiday is observed on the adjacent weekday.
  const july4 = new Date(year, 6, 4);
  set(july4, 'Independence Day');
  if (july4.getDay() === 6) set(addDays(july4, -1), 'Independence Day (floating holiday)');
  if (july4.getDay() === 0) set(addDays(july4, 1), 'Independence Day (floating holiday)');

  set(nthWeekdayOfMonth(year, 8, 1, 1), 'Labor Day'); // 1st Monday of September
  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4); // 4th Thursday of November
  set(thanksgiving, 'Thanksgiving Day');
  set(addDays(thanksgiving, 1), 'Day after Thanksgiving');
  set(new Date(year, 11, 24), 'Christmas Eve');
  set(new Date(year, 11, 25), 'Christmas Day');

  return map;
}

const _holidayCacheByYear = {};
function holidayNameFor(dateStr) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  if (!_holidayCacheByYear[year]) _holidayCacheByYear[year] = holidaysForYear(year);
  return _holidayCacheByYear[year][dateStr] || null;
}

// Total hours worked on one TSR day entry, as a decimal (e.g. 8.5) — an
// alias for the shared tsrDayTotalHours() in js/db.js (loaded before this
// file), so the app's live Labor/Travel split and the report's
// Straight/Overtime/Premium categorization always agree on one date's total.
function dayEntryHours(day) {
  return tsrDayTotalHours(day);
}

// Splits one day's total worked hours into { straight, overtime, premium },
// per the policy above, plus the holiday name if `dateStr` is one and a
// `dayType` — 'Holiday' | 'Sunday' | 'Saturday' | 'Weekday' — that the TSR
// table shows per row so it's clear at a glance which rule produced that
// row's split. A holiday date is always classified 'Holiday' even if it also
// happens to fall on a Saturday/Sunday, matching the hours themselves.
function categorizeDayHours(dateStr, totalHours) {
  const holiday = holidayNameFor(dateStr);
  if (holiday) return { straight: 0, overtime: 0, premium: totalHours, holiday, dayType: 'Holiday' };
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0 = Sunday, 6 = Saturday
  if (dow === 0) return { straight: 0, overtime: 0, premium: totalHours, holiday: null, dayType: 'Sunday' };
  if (dow === 6) {
    const overtime = Math.min(totalHours, 8);
    const premium = Math.max(0, totalHours - 8);
    return { straight: 0, overtime, premium, holiday: null, dayType: 'Saturday' };
  }
  const straight = Math.min(totalHours, 8);
  const overtime = Math.max(0, totalHours - 8);
  return { straight, overtime, premium: 0, holiday: null, dayType: 'Weekday' };
}

// Formats an hour value for the TSR table: '—' for zero/none, otherwise the
// number with no unnecessary trailing zeros (8, 1.5, 2.25, ...).
function formatHoursCell(n) {
  if (!n || Math.abs(n) < 0.005) return '—';
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : String(rounded).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

// 'YYYY-MM-DD' -> 'MM-DD-YYYY', matching the official TSR template's date
// column format.
function formatDateMDY(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${m}-${d}-${y}`;
}

// Formats a TSR day entry's 12-hour clock fields as e.g. '7:00 AM'.
function formatClockTime(hour12, minute, period) {
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

// Builds the plain data all three renderers (Word/PDF, and each scope's
// section builder) work from, so the output formats can never drift out of
// sync with each other. `scope` is 'tsr' | 'dsr' | 'fsr' | 'combined' — it
// controls which of the Job's three independent entry lists get built at
// all. Every job entry is sorted oldest-first by its own `date`, so a
// report covering many days reads top to bottom in the order they happened.
// `options.dsrDate` (only meaningful when scope === 'dsr') narrows the DSR
// section down to that one date's entry, for the "generate an individual
// date" choice — omitted (or scope !== 'dsr'), every DSR entry is included
// as before.
async function buildReportModel(job, worker, scope, options = {}) {
  const tz = DB.getSettings().timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const photos = await DB.getPhotosForJob(job.id);
  const includeTsr = scope === 'tsr' || scope === 'combined';
  const includeDsr = scope === 'dsr' || scope === 'combined';
  const includeFsr = scope === 'fsr' || scope === 'combined';

  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '');

  // Each TSR entry now covers one or more dates, each with its own time
  // range and Labor/Travel hour split (see js/db.js newTsrDayEntry), while
  // the entry itself carries a single approval signature covering every one
  // of those dates.
  const tsrModels = includeTsr
    ? (job.tsrEntries || []).map((entry) => ({
        entry,
        days: (entry.dayEntries || []).slice().sort(byDate).map((day) => {
          const totalHours = dayEntryHours(day);
          const laborHours = day.laborHours == null ? null : Math.min(day.laborHours, totalHours);
          const travelHours = laborHours == null ? null : Math.max(0, totalHours - laborHours);
          return {
            day,
            laborHours,
            travelHours,
            totalHours,
            hours: categorizeDayHours(day.date, totalHours)
          };
        })
      }))
    : [];

  const dsrModels = includeDsr
    ? (job.dsrEntries || [])
        .filter((entry) => !options.dsrDate || entry.date === options.dsrDate)
        .slice().sort(byDate).map((entry) => ({
        entry,
        // A date that's 100% travel on the Time Sheet gets a short "Travel"
        // entry instead of the full DSR narrative (see tsrDayIsTravelOnly).
        travelOnly: jobDateIsTravelOnly(job, entry.date),
        firstAidText: firstAidDisplayText(entry),
        workCompletedPhotos: photos.filter((p) => p.ownerId === entry.id && p.type === 'workCompleted'),
        technicalCommentsPhotos: photos.filter((p) => p.ownerId === entry.id && p.type === 'technicalComments'),
        currentStatusPhotos: photos.filter((p) => p.ownerId === entry.id && p.type === 'currentStatus')
      }))
    : [];

  const fsrModels = includeFsr
    ? (job.fsrEntries || []).map((entry, idx) => ({
        entry,
        idx,
        reportTypeLabel: fsrReportTypeLabel(entry.reportType),
        sections: buildTestSectionsData(entry, photos)
      }))
    : [];

  // The date printed under the report title. A DSR report is for exactly one
  // date, so it shows that date (not the day the file happens to be generated);
  // TSR/FSR reports keep showing the generation date.
  const fsrSummary = scope === 'fsr' ? buildFsrSummary(job, photos, fsrModels) : null;

  // The Field Service Report is dated with the last date on the Time Sheet
  // (not the day it is generated).
  let reportDate = DB.todayStr();
  if (scope === 'dsr' && dsrModels.length) reportDate = dsrModels[0].entry.date;
  else if (scope === 'fsr') {
    const tsrDates = ((job.tsrEntries || [])[0] ? job.tsrEntries[0].dayEntries || [] : []).map((d) => d.date).filter(Boolean).sort();
    const dsrDates = (job.dsrEntries || []).map((e) => e.date).filter(Boolean).sort();
    reportDate = tsrDates.length ? tsrDates[tsrDates.length - 1] : dsrDates.length ? dsrDates[dsrDates.length - 1] : reportDate;
  }

  return { worker, job, tz, scope, reportDate, tsr: tsrModels, dsr: dsrModels, fsr: fsrModels, fsrSummary };
}

async function fetchImageDataUrl(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blobToDataURL(blob);
  } catch {
    return null;
  }
}

// Header logo, extracted from the official WEG-EM "Daily Status Report" Word
// template: the combined WEG + Electric Machinery logo shown at the top of
// every report. Native pixel size (used to keep the aspect ratio correct
// wherever it gets placed at a different display size). The actual image
// bytes are embedded as a base64 data URI in js/reportAssets.js
// (REPORT_LOGO_DATA_URL) rather than fetched from icons/*.jpg — a plain
// fetch() of a local file silently fails (leaving it blank in the generated
// report) when the app is opened as a file:// page instead of served over
// http(s), so the report builders below use that constant directly instead
// of fetchImageDataUrl for this image.
const HEADER_LOGO_NATIVE = { width: 416, height: 148 };

// The two company letterheads shown side by side under the logo, exactly as
// in the official blank DSR template.
const WEG_ADDRESS_LINES = ['WEG Electric Corp.', '6655 Sugarloaf Parkway Duluth, GA. 30097', 'Phone: 1-800-275-4934', 'www.weg.net'];
const EM_ADDRESS_LINES = ['Electric Machinery Company LLC', '800 Central Avenue NE Minneapolis, MN 55413', 'Phone: +1 (612) 378-8000', 'www.electricmachinery.com'];

// ============================================================================
// Word (.docx) builder
// ============================================================================
async function buildDocx(model) {
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun, ShadingType,
    Footer, PageNumber
  } = window.docx;

  const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

  const cell = (text, { bold = false, width, shade, italic = false, color } = {}) => new TableCell({
    borders: CELL_BORDERS,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: 'auto' } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: text == null || text === '' ? '—' : String(text), bold, italics: italic, color })] })]
  });

  const twoColTable = (rows, labelWidth = 30) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([label, value]) => new TableRow({ children: [cell(label, { bold: true, width: labelWidth }), cell(value, { width: 100 - labelWidth })] }))
  });

  const sectionHeading = (text) => new Paragraph({ children: [new TextRun({ text, bold: true, size: 24 })], spacing: { before: 240, after: 120 } });
  const subHeading = (text) => new Paragraph({ children: [new TextRun({ text, bold: true, size: 22, color: '00579D' })], spacing: { before: 200, after: 80 } });

  // Places the photo at its original aspect ratio, as large as fits inside
  // maxW x maxH (px). The original image bytes are embedded untouched.
  async function imageRunFromBlob(blob, maxW, maxH) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const type = (blob.type || '').includes('png') ? 'png' : 'jpg';
    let transformation = { width: maxW, height: maxH };
    try {
      const size = await getImageSize(blob);
      transformation = fitInside(size.width, size.height, maxW, maxH);
    } catch { /* unreadable size: fall back to the box */ }
    return new ImageRun({ data: buf, transformation, type });
  }

  // Photos laid out two per row (a lone last photo is centered across the row).
  // Each is fitted inside a 4" x 3" box (a pair is held to the column width) at
  // its original aspect ratio; the JPEG bytes are embedded untouched, only the
  // displayed size is set, so there is no re-compression.
  async function photoGridDocx(photos) {
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: none, bottom: none, left: none, right: none };
    const cell = async (photo, span, maxW) => new TableCell({
      borders: noBorders, columnSpan: span,
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      width: { size: span === 2 ? 10080 : 5040, type: WidthType.DXA },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [await imageRunFromBlob(photo.blob, maxW, 288)] })]
    });
    const rows = [];
    for (let i = 0; i < photos.length; i += 2) {
      const pair = photos.slice(i, i + 2);
      rows.push(new TableRow({
        cantSplit: true,
        children: pair.length === 2
          ? [await cell(pair[0], 1, 320), await cell(pair[1], 1, 320)]
          : [await cell(pair[0], 2, 384)]
      }));
    }
    return new Table({
      width: { size: 10080, type: WidthType.DXA },
      columnWidths: [5040, 5040],
      borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
      rows
    });
  }

  const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const NO_CELL_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
  const plainCell = (children, width) => new TableCell({ borders: NO_CELL_BORDERS, width: { size: width, type: WidthType.PERCENTAGE }, children });
  const addrLines = (lines) => lines.map((l, i) => new Paragraph({ spacing: { after: i === 0 ? 40 : 0 }, children: [new TextRun({ text: l, bold: i === 0, size: 18 })] }));

  const children = [];

  // ---- Header: logo + the two company letterheads, exactly as in the
  // official WEG-EM blank Daily Status Report template. (The template's
  // four-color decorative bar is not reused in the body of the report — see
  // the DSR section below.) ----
  const logoDataUrl = REPORT_LOGO_DATA_URL;
  const logoW = 190, logoH = Math.round(logoW * (HEADER_LOGO_NATIVE.height / HEADER_LOGO_NATIVE.width));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [
      plainCell(logoDataUrl ? [new Paragraph({ children: [new ImageRun({ data: dataUrlToUint8Array(logoDataUrl), transformation: { width: logoW, height: logoH }, type: 'jpg' })] })] : [new Paragraph({ text: '' })], 30),
      plainCell(addrLines(WEG_ADDRESS_LINES), 35),
      plainCell(addrLines(EM_ADDRESS_LINES), 35)
    ] })]
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    // Extra room between the letterhead header and the title so it doesn't
    // read as crowded right under the logo/address block.
    spacing: { before: 480, after: 40 },
    children: [new TextRun({ text: scopeTitle(model.scope), bold: true, size: 32, color: '00579D' })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 20 },
    children: [new TextRun({ text: `DATE: ${formatDateLong(model.reportDate)}`, bold: true, size: 22 })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: `EM-WEG Project: ${model.job.siteName || 'Untitled job site'}`, bold: true, size: 22 })]
  }));

  // ---- Field Service Report overview: everything pulled together from the
  // job's DSR entries — SO#, service date range, team, safety topics,
  // first-aid status, overall job scope, then Work Completed / Technical
  // Comments / Current Status for each DSR date. The equipment test data
  // (generator / motor) follows further down. ----
  // One piece of equipment's test data: heading, optional Test Date line, then
  // each checked technical section as a table (with its photos).
  async function renderFsrEntryDocx(fm, showTestDate) {
    children.push(new Paragraph({ keepNext: true, children: [new TextRun({ text: `${fsrEntryLabel(fm.entry, fm.idx)}${fm.reportTypeLabel ? ' — ' + fm.reportTypeLabel : ''}`, bold: true, size: 22, color: '00579D' })], spacing: { before: 200, after: 80 } }));
    if (showTestDate && fm.entry.testDate) children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Test Date: ', bold: true }), new TextRun({ text: formatDateLong(fm.entry.testDate) })] }));
    if (fm.sections.length) {
      for (const section of fm.sections) {
        children.push(new Paragraph({ keepNext: true, spacing: { before: 100, after: 60 }, children: [new TextRun({ text: section.title, bold: true, color: '00579D' })] }));
        if (section.rows.length) children.push(twoColTable(section.rows, 40));
        if (section.photos.length) children.push(await photoGridDocx(section.photos));
        children.push(new Paragraph({ text: '', spacing: { after: 60 } }));
        if (section.photos.length) children.push(new Paragraph({ text: '', spacing: { after: 60 } }));
      }
    } else {
      children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: 'No technical inspection data entered.', italics: true })] }));
    }
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
  }

  if (model.scope === 'fsr' && model.fsrSummary) {
    const fsum = model.fsrSummary;
    const labelLine = (label, value) => children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `${label} `, bold: true }), ...multilineRuns(value || '—')] }));
    labelLine('SO#:', model.job.serviceOrder);
    labelLine('Service Date:', fsum.serviceDateText);
    labelLine('Team:', fsum.team.join(', '));

    children.push(new Paragraph({ keepNext: true, spacing: { before: 200, after: 60 }, children: [new TextRun({ text: 'Topics', bold: true, size: 22 })] }));
    FSR_TOPICS.forEach((t) => children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text: t })] })));

    children.push(new Paragraph({ spacing: { before: 200, after: 120 }, children: [
      new TextRun({ text: 'First Aid / Near Misses / Recordable Injuries to Date: ', bold: true }),
      new TextRun({ text: fsum.firstAidText })
    ] }));

    children.push(new Paragraph({ keepNext: true, spacing: { after: 60 }, children: [new TextRun({ text: 'Overall Job Scope', bold: true, size: 22 })] }));
    children.push(new Paragraph({ spacing: { after: 160 }, children: multilineRuns(fsum.overallJobScope || '—') }));

    for (const sec of fsum.sections) {
      children.push(new Paragraph({ keepNext: true, spacing: { before: 200, after: 60 }, children: [new TextRun({ text: sec.label, bold: true, size: 22 })] }));
      if (!sec.items.length) children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: '—' })] }));
      for (const item of sec.items) {
        children.push(new Paragraph({ keepNext: true, spacing: { before: 100, after: 20 }, children: [new TextRun({ text: formatDateLong(item.date), bold: true, color: '00579D' })] }));
        if (item.text) children.push(new Paragraph({ spacing: { after: 40 }, children: multilineRuns(item.text) }));
        if (item.photos.length) children.push(await photoGridDocx(item.photos));
        if (item.photos.length) children.push(new Paragraph({ text: '', spacing: { after: 60 } }));
        for (const fm of item.tests || []) await renderFsrEntryDocx(fm, false);
      }
    }
  }

  // ---- Time Sheet Report (TSR) entries ----
  // Table layout (Date / From / To / Straight / Overtime(1.5) / Premium(2x)
  // / Total Hours) and the rep/site info block above it match the official
  // WEG-EM Time Sheet Report template exactly.
  if (model.scope === 'tsr' || model.scope === 'combined') {
    // Only needed when this section shares the page with DSR/FSR — a
    // single-scope report's own title above already says "TIME SHEET
    // REPORT", so repeating it here would just say it twice.
    if (model.scope === 'combined') children.push(sectionHeading('Time Sheet Report'));

    children.push(new Paragraph({ children: [new TextRun({ text: 'EM Rep Name: ', bold: true }), new TextRun({ text: model.worker.name || '—' })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: 'Role: ', bold: true }), new TextRun({ text: model.worker.role || '—' })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: 'Customer / Client Name: ', bold: true }), new TextRun({ text: model.job.siteName || '—' })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: 'Job Site / Location: ', bold: true }), new TextRun({ text: model.job.siteLocation || '—' })] }));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Service order: ', bold: true }), new TextRun({ text: model.job.serviceOrder || '—' })] }));

    if (model.tsr.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'No time sheet entries were logged for this job.', italics: true })] }));
    }
    for (const tm of model.tsr) {
      const entry = tm.entry;
      if (tm.days.length === 0) {
        children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'No dates selected', italics: true })] }));
      } else {
        const totals = { straight: 0, overtime: 0, premium: 0, total: 0 };
        const headerRow = new TableRow({ children: [
          cell('Date', { bold: true, width: 13, shade: 'E8EEF5' }),
          cell('Day Type', { bold: true, width: 14, shade: 'E8EEF5' }),
          cell('From', { bold: true, width: 10, shade: 'E8EEF5' }),
          cell('To', { bold: true, width: 10, shade: 'E8EEF5' }),
          cell('Straight', { bold: true, width: 13, shade: 'E8EEF5' }),
          cell('Overtime (1.5)', { bold: true, width: 14, shade: 'E8EEF5' }),
          cell('Premium (2x)', { bold: true, width: 13, shade: 'E8EEF5' }),
          cell('Total Hours', { bold: true, width: 13, shade: 'E8EEF5' })
        ] });
        const dayRows = tm.days.map((dm) => {
          totals.straight += dm.hours.straight;
          totals.overtime += dm.hours.overtime;
          totals.premium += dm.hours.premium;
          totals.total += dm.totalHours;
          // 'Day Type' says which rule produced this row's split — the holiday
          // name is shown alongside 'Holiday' when that's the case, since a
          // holiday always overrides its weekday/weekend classification.
          const dayTypeLabel = dm.hours.holiday ? `Holiday (${dm.hours.holiday})` : dm.hours.dayType;
          return new TableRow({ children: [
            cell(formatDateMDY(dm.day.date), { width: 13 }),
            cell(dayTypeLabel, { width: 14 }),
            cell(formatClockTime(dm.day.startHour, dm.day.startMinute, dm.day.startPeriod), { width: 10 }),
            cell(formatClockTime(dm.day.endHour, dm.day.endMinute, dm.day.endPeriod), { width: 10 }),
            cell(formatHoursCell(dm.hours.straight), { width: 13 }),
            cell(formatHoursCell(dm.hours.overtime), { width: 14 }),
            cell(formatHoursCell(dm.hours.premium), { width: 13 }),
            cell(formatHoursCell(dm.totalHours), { width: 13 })
          ] });
        });
        const totalsRow = new TableRow({ children: [
          cell('Total', { bold: true, width: 13, shade: 'F2F5F8' }),
          cell('', { width: 14, shade: 'F2F5F8' }),
          cell('', { width: 10, shade: 'F2F5F8' }),
          cell('', { width: 10, shade: 'F2F5F8' }),
          cell(formatHoursCell(totals.straight), { bold: true, width: 13, shade: 'F2F5F8' }),
          cell(formatHoursCell(totals.overtime), { bold: true, width: 14, shade: 'F2F5F8' }),
          cell(formatHoursCell(totals.premium), { bold: true, width: 13, shade: 'F2F5F8' }),
          cell(formatHoursCell(totals.total), { bold: true, width: 13, shade: 'F2F5F8' })
        ] });
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dayRows, totalsRow] }));
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      }

      if (entry.approval) {
        const signedAt = new Date(entry.approval.signedAt);
        children.push(new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: 'Time of approval: ', bold: true }),
            new TextRun({ text: signedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }),
            new TextRun({ text: '     Date of approval: ', bold: true }),
            new TextRun({ text: signedAt.toLocaleDateString() })
          ]
        }));
        children.push(new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: 'Released By: ', bold: true }),
            new TextRun({ text: `${entry.approval.signedBy}${entry.approval.signedRole ? ' (' + entry.approval.signedRole + ')' : ''}` })
          ]
        }));
        if (entry.approval.signatureDataUrl) {
          children.push(new Paragraph({ children: [new ImageRun({ data: dataUrlToUint8Array(entry.approval.signatureDataUrl), transformation: { width: 220, height: 100 }, type: 'png' })] }));
        }
      } else {
        children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Not yet approved', italics: true, color: '999999' })] }));
      }
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    }
  }

  // ---- Daily Status Report (DSR) entries ----
  if (model.scope === 'dsr' || model.scope === 'combined') {
    // Only needed alongside TSR/FSR — a DSR-only report's own title above
    // already says "DAILY STATUS REPORT".
    if (model.scope === 'combined') children.push(sectionHeading('Daily Status Report'));
    if (model.dsr.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'No daily status entries were logged for this job.', italics: true })] }));
    }
    for (const dm of model.dsr) {
      const entry = dm.entry;
      // A DSR-only report already shows its date under the title, so the
      // per-entry date heading is only needed when several dates share a report.
      if (model.scope !== 'dsr') children.push(subHeading(formatDateLong(entry.date)));

      // Team / First Aid — plain full-width paragraphs, same left margin as
      // the rest of the DSR fields (no decorative bar alongside them).
      const teamLines = (entry.teamMembers || '').split('\n').map((l) => l.trim()).filter(Boolean);
      children.push(new Paragraph({ children: [new TextRun({ text: 'Team head /members:', bold: true })] }));
      (teamLines.length ? teamLines.map((l) => new Paragraph({ children: [new TextRun({ text: l })] })) : [new Paragraph({ children: [new TextRun({ text: '—' })] })])
        .forEach((p) => children.push(p));

      // Travel-only date: a short Travel entry replaces the full narrative.
      if (dm.travelOnly) {
        children.push(new Paragraph({ spacing: { before: 160, after: 60 }, children: [new TextRun({ text: 'TRAVEL DAY', bold: true, size: 22 })] }));
        children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Travel only — no on-site work performed on this date.' })] }));
        const travelNotes = (entry.travelNotes || '').trim();
        if (travelNotes) children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: travelNotes })] }));
        children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
        continue;
      }

      children.push(new Paragraph({ spacing: { before: 160, after: 120 }, children: [
        new TextRun({ text: 'First Aid / Near Misses / Recordable Injuries to Date: ', bold: true }),
        new TextRun({ text: dm.firstAidText })
      ] }));

      // Overall Job Scope — the Job's own overview field, shown inline here
      // (rather than as a separate "Job Overview" block above) so a DSR
      // report reads as one continuous sequence: Team, First Aid, Overall
      // Job Scope, then the day's own Further Job History.
      children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Overall Job Scope', bold: true, size: 22 })] }));
      children.push(new Paragraph({ spacing: { after: 160 }, children: multilineRuns((model.job.overallJobScope || '').trim() || '—') }));

      // Further Job History
      children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Further Job History', bold: true, size: 22 })] }));
      children.push(new Paragraph({ spacing: { after: 160 }, children: multilineRuns((entry.furtherJobHistory || '').trim() || '—') }));

      // Work Completed / Technical Comments / Current Status — each with any
      // number of optional photos directly underneath, matching what the
      // worker attached.
      const narrativeWithPhotos = [
        ['WORK COMPLETED:', entry.workCompleted, dm.workCompletedPhotos],
        ['TECHNICAL COMMENTS / CONCERNS / FINDINGS:', entry.technicalComments, dm.technicalCommentsPhotos],
        ['CURRENT STATUS / NEXT STEPS:', entry.currentStatus, dm.currentStatusPhotos]
      ];
      let prevHadPhotos = false;
      for (const [label, text, photosForField] of narrativeWithPhotos) {
        // One extra blank line of space when the previous field ended with photos,
        // so the next heading doesn't sit right up against the last image.
        children.push(new Paragraph({ spacing: { before: prevHadPhotos ? 440 : 160, after: 40 }, children: [new TextRun({ text: label, bold: true, size: 22 })] }));
        children.push(new Paragraph({ spacing: { after: 40 }, children: multilineRuns((text || '').trim() || '—') }));
        if (photosForField.length) children.push(await photoGridDocx(photosForField));
        prevHadPhotos = photosForField.length > 0;
      }
      children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
    }
  }

  // ---- Field Service Report (FSR) entries ----
  if (model.scope === 'fsr' || model.scope === 'combined') {
    // Only needed alongside TSR/DSR — an FSR-only report's own title above
    // already says "FIELD SERVICE REPORT".
    if (model.scope === 'combined') children.push(sectionHeading('Field Service Report'));

    if (model.scope === 'combined' && model.fsr.length === 0) {
      children.push(new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: 'No FSR entries were logged for this job.', italics: true })] }));
    }

    // In an FSR-only report the test data is already inside the combined
    // Work Completed section above; only the full combined report lists it here.
    if (model.scope === 'combined') for (const fm of model.fsr) await renderFsrEntryDocx(fm, true);
  }

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200 },
    children: [new TextRun({ text: 'This concludes this report.', italics: true })]
  }));

  // ---- Footer: "Page X of Y" bottom-right on every page, matching the
  // official letterhead template's footer ----
  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 18, color: '666666' })]
    })]
  });

  // Word's "Moderate" preset margins (1" top/bottom, 0.75" left/right) — the
  // library's own default is a full 1" on every side, which reads as
  // needlessly wide next to the PDF version's tighter ~0.56" margin.
  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 } } },
      footers: { default: footer },
      children
    }]
  });
  return Packer.toBlob(doc);
}

// ============================================================================
// PDF builder (jsPDF + jsPDF-AutoTable)
// ============================================================================
async function buildPdf(model) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  function ensureSpace(needed) {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }


  function heading(text, size = 13, color = [0, 87, 157]) {
    ensureSpace(size + 10);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(text, margin, y);
    y += size + 6;
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
  }

  function subHeading(text) {
    heading(text, 11.5, [0, 87, 157]);
  }

  // Prints a bold label followed by its value on the same line, at the left
  // margin — used for the TSR info block (EM Rep Name / Role / Job site
  // name / Service order) to match the official template.
  function labelValueLinePdf(label, value) {
    ensureSpace(16);
    doc.setFont(undefined, 'bold'); doc.setFontSize(10);
    const labelText = `${label} `;
    doc.text(labelText, margin, y);
    const labelW = doc.getTextWidth(labelText);
    doc.setFont(undefined, 'normal');
    doc.text(value || '—', margin + labelW, y);
    y += 14;
  }

  function bodyText(text, { italic = false, size = 10 } = {}) {
    doc.setFont(undefined, italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text || '—', pageWidth - margin * 2);
    ensureSpace(lines.length * (size + 3) + 6);
    doc.text(lines, margin, y);
    y += lines.length * (size + 3) + 6;
    doc.setFont(undefined, 'normal');
  }

  function twoColAutoTable(rows, labelWidth = 150) {
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: labelWidth, fontStyle: 'bold' } },
      body: rows.map(([label, value]) => [label, value == null || value === '' ? '—' : String(value)])
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  // Photos keep their original aspect ratio (scaled to fit inside maxW x maxH,
  // never stretched), are centered between the page margins, and are embedded
  // at the stored resolution — JPEGs go into the PDF byte-for-byte rather than
  // being re-compressed.
  // Photos two per row (a lone last photo is centered), each fitted inside a
  // 4" x 3" box (288 x 216 pt; a pair is held to its column width) at its
  // original aspect ratio. JPEGs are embedded as-is — no re-compression.
  async function addPhotoGrid(photos) {
    const contentW = pageWidth - margin * 2;
    const colW = contentW / 2;
    const prep = async (photo, maxW, maxH) => {
      const mime = (photo.blob.type || '').toLowerCase();
      let dataUrl = await blobToDataURL(photo.blob);
      let format = 'JPEG';
      if (mime.includes('png')) format = 'PNG';
      else if (!mime.includes('jpeg') && !mime.includes('jpg')) dataUrl = await resizeDataUrl(dataUrl, 2400, 'image/jpeg', 0.95);
      let size = { width: maxW, height: maxH };
      try {
        const natural = await getImageSize(photo.blob);
        size = fitInside(natural.width, natural.height, maxW, maxH);
      } catch { /* unreadable size: fall back to the box */ }
      return { dataUrl, format, size };
    };
    for (let i = 0; i < photos.length; i += 2) {
      const pair = photos.slice(i, i + 2);
      const items = [];
      if (pair.length === 2) {
        for (const ph of pair) items.push(await prep(ph, Math.min(288, colW - 12), 216));
      } else {
        items.push(await prep(pair[0], 288, 216));
      }
      const rowH = Math.max(...items.map((it) => it.size.height));
      ensureSpace(rowH + 12);
      items.forEach((it, k) => {
        const cellX = pair.length === 2 ? margin + k * colW : margin;
        const cellW = pair.length === 2 ? colW : contentW;
        const x = cellX + (cellW - it.size.width) / 2;
        const yy = y + (rowH - it.size.height) / 2;
        try { doc.addImage(it.dataUrl, it.format, x, yy, it.size.width, it.size.height); } catch { /* ignore malformed image */ }
      });
      y += rowH + 12;
    }
  }

  async function addSinglePhoto(photo, maxW = 300, maxH = 250) {
    const mime = (photo.blob.type || '').toLowerCase();
    let dataUrl = await blobToDataURL(photo.blob);
    let format = 'JPEG';
    if (mime.includes('png')) format = 'PNG';
    else if (!mime.includes('jpeg') && !mime.includes('jpg')) dataUrl = await resizeDataUrl(dataUrl, 2400, 'image/jpeg', 0.95);

    let size = { width: maxW, height: maxH };
    try {
      const natural = await getImageSize(photo.blob);
      size = fitInside(natural.width, natural.height, maxW, maxH);
    } catch { /* unreadable size: fall back to the box */ }

    ensureSpace(size.height + 12);
    const x = margin + (pageWidth - margin * 2 - size.width) / 2;
    try { doc.addImage(dataUrl, format, x, y, size.width, size.height); } catch { /* ignore malformed image */ }
    y += size.height + 12;
  }

  // ---- Header: logo + the two company letterheads (matches the official
  // WEG-EM blank Daily Status Report template), then title/date/project ----
  const logoDataUrl = REPORT_LOGO_DATA_URL;
  if (logoDataUrl) {
    try {
      const resizedLogo = await resizeDataUrl(logoDataUrl, 400, 'image/jpeg', 0.9);
      const logoW = 150, logoH = Math.round(logoW * (HEADER_LOGO_NATIVE.height / HEADER_LOGO_NATIVE.width));
      doc.addImage(resizedLogo, 'JPEG', margin, y, logoW, logoH);
    } catch { /* ignore */ }
  }
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  const addrX1 = margin + 220, addrX2 = margin + 375;
  const addrColWidth = addrX2 - addrX1 - 10;
  let maxAddrY = y;
  [[addrX1, WEG_ADDRESS_LINES], [addrX2, EM_ADDRESS_LINES]].forEach(([x, lines]) => {
    let ly = y + 10;
    lines.forEach((line, li) => {
      doc.setFont(undefined, li === 0 ? 'bold' : 'normal');
      const wrapped = doc.splitTextToSize(line, addrColWidth);
      doc.text(wrapped, x, ly);
      ly += wrapped.length * 11;
    });
    maxAddrY = Math.max(maxAddrY, ly);
  });
  doc.setFont(undefined, 'normal');
  // Extra room between the letterhead header and the title so it doesn't
  // read as crowded right under the logo/address block (matches the Word
  // builder's wider before-title gap).
  y = Math.max(maxAddrY, y + 68) + 24;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(18);
  doc.setTextColor(0, 87, 157);
  doc.text(scopeTitle(model.scope), pageWidth / 2, y, { align: 'center' });
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(`DATE: ${formatDateLong(model.reportDate)}`, pageWidth / 2, y + 20, { align: 'center' });
  doc.text(`EM-WEG Project: ${model.job.siteName || 'Untitled job site'}`, pageWidth / 2, y + 38, { align: 'center' });
  doc.setFont(undefined, 'normal');
  y += 60;

  // ---- Field Service Report overview (see the Word builder for the layout):
  // SO#, service dates, team, safety topics, first aid, overall job scope,
  // then Work Completed / Technical Comments / Current Status per DSR date.
  if (model.scope === 'fsr' && model.fsrSummary) {
    const fsum = model.fsrSummary;
    const contentW = pageWidth - margin * 2;

    function fsrLabelValue(label, value) {
      ensureSpace(16);
      doc.setFont(undefined, 'bold'); doc.setFontSize(10);
      const labelText = `${label} `;
      const labelW = doc.getTextWidth(labelText);
      doc.text(labelText, margin, y);
      doc.setFont(undefined, 'normal');
      const lines = doc.splitTextToSize(value || '—', contentW - labelW);
      doc.text(lines[0], margin + labelW, y);
      y += 14;
      for (const line of lines.slice(1)) { ensureSpace(14); doc.text(line, margin, y); y += 14; }
    }
    function fsrBold(text, size = 11) {
      ensureSpace(size + 8);
      doc.setFont(undefined, 'bold'); doc.setFontSize(size);
      doc.text(text, margin, y);
      y += size + 5;
      doc.setFont(undefined, 'normal');
    }

    fsrLabelValue('SO#:', model.job.serviceOrder);
    fsrLabelValue('Service Date:', fsum.serviceDateText);
    fsrLabelValue('Team:', fsum.team.join(', '));
    y += 8;

    fsrBold('Topics');
    doc.setFont(undefined, 'normal'); doc.setFontSize(10);
    for (const topic of FSR_TOPICS) {
      const lines = doc.splitTextToSize(topic, contentW - 18);
      ensureSpace(lines.length * 13 + 3);
      doc.text('\u2022', margin + 4, y);
      doc.text(lines, margin + 18, y);
      y += lines.length * 13 + 3;
    }
    y += 10;

    fsrLabelValue('First Aid / Near Misses / Recordable Injuries to Date:', fsum.firstAidText);
    y += 10;

    fsrBold('Overall Job Scope');
    bodyText(fsum.overallJobScope);
    y += 4;

    async function renderFsrEntryPdf(fm, showTestDate) {
      const firstSec = fm.sections[0];
      ensureSpace(firstSec && !firstSec.rows.length && firstSec.photos.length ? 360 : 90);
      heading(`${fsrEntryLabel(fm.entry, fm.idx)}${fm.reportTypeLabel ? ' — ' + fm.reportTypeLabel : ''}`);
      if (showTestDate && fm.entry.testDate) labelValueLinePdf('Test Date:', formatDateLong(fm.entry.testDate));
      if (fm.sections.length) {
        for (const section of fm.sections) {
          ensureSpace(!section.rows.length && section.photos.length ? 330 : 20);
          doc.setFont(undefined, 'bold');
          doc.setFontSize(10.5);
          doc.setTextColor(0, 87, 157);
          doc.text(section.title, margin, y);
          doc.setTextColor(0, 0, 0);
          y += 14;
          if (section.rows.length) twoColAutoTable(section.rows, 220);
          await addPhotoGrid(section.photos);
          if (section.photos.length) y += 14;
        }
      } else {
        bodyText('No technical inspection data entered.', { italic: true });
      }
      y += 6;
    }
    for (const sec of fsum.sections) {
      ensureSpace(40);
      fsrBold(sec.label, 10.5);
      if (!sec.items.length) bodyText('');
      for (const item of sec.items) {
        ensureSpace(34);
        doc.setFont(undefined, 'bold'); doc.setFontSize(10);
        doc.setTextColor(0, 87, 157);
        doc.text(formatDateLong(item.date), margin, y);
        doc.setTextColor(0, 0, 0);
        y += 14;
        if (item.text) bodyText(item.text);
        await addPhotoGrid(item.photos);
        if (item.photos.length) y += 14;
        for (const fm of item.tests || []) await renderFsrEntryPdf(fm, false);
      }
      y += 6;
    }
  }

  // ---- Time Sheet Report (TSR) entries ----
  // Table layout (Date / Day Type / From / To / Straight / Overtime(1.5) /
  // Premium(2x) / Total Hours) and the rep/site info block above it match
  // the official WEG-EM Time Sheet Report template, plus a 'Day Type'
  // column identifying which rule produced that row's split.
  function tsrHoursTable(days) {
    const totals = { straight: 0, overtime: 0, premium: 0, total: 0 };
    const body = days.map((dm) => {
      totals.straight += dm.hours.straight;
      totals.overtime += dm.hours.overtime;
      totals.premium += dm.hours.premium;
      totals.total += dm.totalHours;
      // A holiday always overrides its weekday/weekend classification, so
      // it's labeled 'Holiday' (with the holiday's name) rather than
      // whatever day of the week it happens to fall on.
      const dayTypeLabel = dm.hours.holiday ? `Holiday (${dm.hours.holiday})` : dm.hours.dayType;
      return [
        formatDateMDY(dm.day.date),
        dayTypeLabel,
        formatClockTime(dm.day.startHour, dm.day.startMinute, dm.day.startPeriod),
        formatClockTime(dm.day.endHour, dm.day.endMinute, dm.day.endPeriod),
        formatHoursCell(dm.hours.straight),
        formatHoursCell(dm.hours.overtime),
        formatHoursCell(dm.hours.premium),
        formatHoursCell(dm.totalHours)
      ];
    });
    const footRow = ['Total', '', '', '', formatHoursCell(totals.straight), formatHoursCell(totals.overtime), formatHoursCell(totals.premium), formatHoursCell(totals.total)];
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      head: [['Date', 'Day Type', 'From', 'To', 'Straight', 'Overtime (1.5)', 'Premium (2x)', 'Total Hours']],
      body,
      foot: [footRow],
      footStyles: { fontStyle: 'bold', fillColor: [242, 245, 248], textColor: [0, 0, 0] }
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  if (model.scope === 'tsr' || model.scope === 'combined') {
    // Only needed when this section shares the page with DSR/FSR — a
    // single-scope report's own title above already says "TIME SHEET
    // REPORT", so repeating it here would just say it twice.
    if (model.scope === 'combined') heading('Time Sheet Report', 14);

    labelValueLinePdf('EM Rep Name:', model.worker.name);
    labelValueLinePdf('Role:', model.worker.role);
    labelValueLinePdf('Customer / Client Name:', model.job.siteName);
    labelValueLinePdf('Job Site / Location:', model.job.siteLocation);
    labelValueLinePdf('Service order:', model.job.serviceOrder);
    y += 6;

    if (model.tsr.length === 0) {
      bodyText('No time sheet entries were logged for this job.', { italic: true });
    }
    for (const tm of model.tsr) {
      const entry = tm.entry;
      if (tm.days.length === 0) {
        bodyText('No dates selected', { italic: true });
      } else {
        tsrHoursTable(tm.days);
      }

      if (entry.approval) {
        const signedAt = new Date(entry.approval.signedAt);
        ensureSpace(18);
        doc.setFont(undefined, 'bold'); doc.setFontSize(10);
        doc.text('Time of approval: ', margin, y);
        let xAfter = margin + doc.getTextWidth('Time of approval: ');
        doc.setFont(undefined, 'normal');
        const timeText = signedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        doc.text(timeText, xAfter, y);
        xAfter += doc.getTextWidth(timeText) + 20;
        doc.setFont(undefined, 'bold');
        doc.text('Date of approval: ', xAfter, y);
        xAfter += doc.getTextWidth('Date of approval: ');
        doc.setFont(undefined, 'normal');
        doc.text(signedAt.toLocaleDateString(), xAfter, y);
        y += 16;

        ensureSpace(16);
        doc.setFont(undefined, 'bold'); doc.setFontSize(10);
        doc.text('Released By: ', margin, y);
        const releasedByX = margin + doc.getTextWidth('Released By: ');
        doc.setFont(undefined, 'normal');
        doc.text(`${entry.approval.signedBy}${entry.approval.signedRole ? ' (' + entry.approval.signedRole + ')' : ''}`, releasedByX, y);
        y += 16;

        if (entry.approval.signatureDataUrl) {
          ensureSpace(100);
          try {
            const resizedSig = await resizeDataUrl(entry.approval.signatureDataUrl, 400, 'image/png');
            doc.addImage(resizedSig, 'PNG', margin, y, 180, 82);
          } catch { /* ignore */ }
          y += 90;
        }
      } else {
        bodyText('Not yet approved', { italic: true });
      }
      y += 8;
    }
  }

  // ---- Daily Status Report (DSR) entries ----
  if (model.scope === 'dsr' || model.scope === 'combined') {
    // Only needed alongside TSR/FSR — a DSR-only report's own title above
    // already says "DAILY STATUS REPORT".
    if (model.scope === 'combined') heading('Daily Status Report', 14);
    if (model.dsr.length === 0) {
      bodyText('No daily status entries were logged for this job.', { italic: true });
    }

    // Prints a bold label, then its value right after on the same line when
    // it fits, wrapping onto the next line(s) otherwise — mirrors how the
    // official template shows "Label: value" inline.
    function labelValueLine(label, value, x, maxWidth) {
      ensureSpace(16);
      doc.setFont(undefined, 'bold'); doc.setFontSize(10);
      const labelText = `${label} `;
      const labelW = doc.getTextWidth(labelText);
      doc.text(labelText, x, y);
      doc.setFont(undefined, 'normal');
      const valueText = value || '—';
      if (labelW + doc.getTextWidth(valueText) <= maxWidth) {
        doc.text(valueText, x + labelW, y);
        y += 14;
      } else {
        y += 14;
        const wrapped = doc.splitTextToSize(valueText, maxWidth);
        ensureSpace(wrapped.length * 13);
        doc.text(wrapped, x, y);
        y += wrapped.length * 13;
      }
    }

    for (const dm of model.dsr) {
      const entry = dm.entry;
      if (model.scope !== 'dsr') subHeading(formatDateLong(entry.date));

      // Team / First Aid — plain full-width lines at the normal left margin,
      // same as the rest of the DSR fields (no decorative bar alongside them).
      ensureSpace(20);
      doc.setFont(undefined, 'bold'); doc.setFontSize(10);
      doc.text('Team head /members:', margin, y);
      y += 14;
      doc.setFont(undefined, 'normal');
      const teamLines = (entry.teamMembers || '').split('\n').map((l) => l.trim()).filter(Boolean);
      (teamLines.length ? teamLines : ['—']).forEach((l) => { ensureSpace(14); doc.text(l, margin, y); y += 14; });
      y += 6;

      // Travel-only date: a short Travel entry replaces the full narrative.
      if (dm.travelOnly) {
        ensureSpace(20);
        doc.setFont(undefined, 'bold'); doc.setFontSize(11);
        doc.text('TRAVEL DAY', margin, y);
        y += 16;
        bodyText('Travel only — no on-site work performed on this date.');
        const travelNotes = (entry.travelNotes || '').trim();
        if (travelNotes) bodyText(travelNotes);
        y += 10;
        continue;
      }

      labelValueLine('First Aid / Near Misses / Recordable Injuries to Date:', dm.firstAidText, margin, pageWidth - margin * 2);
      y += 14;

      // Overall Job Scope — the Job's own overview field, shown inline here
      // (rather than as a separate "Job Overview" block above) so a DSR
      // report reads as one continuous sequence: Team, First Aid, Overall
      // Job Scope, then the day's own Further Job History.
      ensureSpace(18);
      doc.setFont(undefined, 'bold'); doc.setFontSize(11);
      doc.text('Overall Job Scope', margin, y);
      y += 16;
      bodyText((model.job.overallJobScope || '').trim());
      y += 4;

      // Further Job History
      ensureSpace(18);
      doc.setFont(undefined, 'bold'); doc.setFontSize(11);
      doc.text('Further Job History', margin, y);
      y += 16;
      bodyText((entry.furtherJobHistory || '').trim());
      y += 4;

      // Work Completed / Technical Comments / Current Status — each with any
      // number of optional photos directly underneath.
      const narrativeWithPhotos = [
        ['WORK COMPLETED:', entry.workCompleted, dm.workCompletedPhotos],
        ['TECHNICAL COMMENTS / CONCERNS / FINDINGS:', entry.technicalComments, dm.technicalCommentsPhotos],
        ['CURRENT STATUS / NEXT STEPS:', entry.currentStatus, dm.currentStatusPhotos]
      ];
      for (const [label, text, photosForField] of narrativeWithPhotos) {
        ensureSpace(20);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(10.5);
        doc.text(label, margin, y);
        y += 14;
        bodyText((text || '').trim());
        await addPhotoGrid(photosForField);
        // One blank line of space after a field's photos, before the next heading.
        if (photosForField.length) y += 14;
      }
      y += 6;
    }
  }

  // ---- Field Service Report (FSR) entries ----
  if (model.scope === 'fsr' || model.scope === 'combined') {
    if (model.scope === 'combined') heading('Field Service Report', 14);

    if (model.scope === 'combined' && model.fsr.length === 0) {
      bodyText('No FSR entries were logged for this job.', { italic: true });
    }

    // In an FSR-only report the test data is already inside the Work Completed
    // section above; only the full combined report lists it here.
    if (model.scope === 'combined') {
      for (const fm of model.fsr) {
        heading(`${fsrEntryLabel(fm.entry, fm.idx)}${fm.reportTypeLabel ? ' — ' + fm.reportTypeLabel : ''}`);
        if (fm.entry.testDate) labelValueLinePdf('Test Date:', formatDateLong(fm.entry.testDate));
        if (fm.sections.length) {
          for (const section of fm.sections) {
            ensureSpace(!section.rows.length && section.photos.length ? 330 : 20);
            doc.setFont(undefined, 'bold');
            doc.setFontSize(10.5);
            doc.setTextColor(0, 87, 157);
            doc.text(section.title, margin, y);
            doc.setTextColor(0, 0, 0);
            y += 14;
            if (section.rows.length) twoColAutoTable(section.rows, 220);
            await addPhotoGrid(section.photos);
            if (section.photos.length) y += 14;
          }
        } else {
          bodyText('No technical inspection data entered.', { italic: true });
        }
        y += 6;
      }
    }
  }

  ensureSpace(30);
  doc.setFont(undefined, 'italic');
  doc.setFontSize(10);
  doc.text('This concludes this report.', pageWidth / 2, y + 14, { align: 'center' });

  // ---- Footer: "Page X of Y" bottom-right on every page, matching the
  // official letterhead template's footer ----
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 20, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }

  return doc.output('blob');
}

// ============================================================================
const Report = {
  // format: 'docx' | 'pdf'; scope: 'tsr' | 'dsr' | 'fsr' | 'combined'.
  // options.dsrDate (scope === 'dsr' only) narrows the report to that one
  // logged date instead of every DSR entry on the job — the filename then
  // uses that date instead of today's, so a folder of individual-date DSR
  // reports sorts and reads sensibly.
  async generate(job, worker, format, scope, options = {}) {
    const model = await buildReportModel(job, worker, scope, options);
    const safeWorker = (worker.name || 'worker').replace(/[^a-z0-9]+/gi, '_');
    const safeSite = (job.siteName || 'job').replace(/[^a-z0-9]+/gi, '_');
    const scopeTag = scope === 'tsr' ? 'TSR' : scope === 'dsr' ? 'DSR' : scope === 'fsr' ? 'FSR' : 'FULL';
    const dateTag = (scope === 'dsr' && options.dsrDate) ? options.dsrDate : DB.todayStr();
    if (format === 'pdf') {
      const blob = await buildPdf(model);
      return { blob, filename: `WEG_${scopeTag}_${safeSite}_${safeWorker}_${dateTag}.pdf` };
    }
    const blob = await buildDocx(model);
    return { blob, filename: `WEG_${scopeTag}_${safeSite}_${safeWorker}_${dateTag}.docx` };
  },

  saveLocally(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  canShareFile(file) {
    return !!(navigator.canShare && navigator.canShare({ files: [file] }));
  },

  // Tries the native share sheet (lets the worker pick Mail, Gmail, Outlook,
  // WhatsApp, AirDrop, etc. and attaches the real file). Falls back to
  // downloading the file plus opening a mailto: draft when the browser can't
  // share files (most desktop browsers, some older mobile browsers) — mailto
  // links can't carry attachments, so the fallback asks the worker to attach
  // the just-downloaded file manually.
  async shareViaEmail(blob, filename, { subject, body, to } = {}) {
    const file = new File([blob], filename, { type: blob.type });
    if (this.canShareFile(file)) {
      try {
        await navigator.share({ files: [file], title: subject, text: body });
        return { ok: true, method: 'share' };
      } catch (err) {
        if (err && err.name === 'AbortError') return { ok: false, method: 'share', cancelled: true };
        console.warn('Web Share failed, falling back to mailto', err);
      }
    }
    this.saveLocally(blob, filename);
    const fullBody = `${body}\n\n(The report file "${filename}" was just downloaded to your device — please attach it to this email before sending.)`;
    const mailto = `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullBody)}`;
    window.location.href = mailto;
    return { ok: true, method: 'mailto-fallback' };
  }
};

window.Report = Report;
