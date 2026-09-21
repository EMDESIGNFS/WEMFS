// report.js — builds a downloadable/shareable report for a day's log, as
// either a Word (.docx) document or a PDF, styled after WEG-EM's own "Daily
// Status Report" template. A day has two independent parts (see js/db.js):
// one Daily Status Report (DSR — custom-time hourly schedule, pre/post
// photos, and the four narrative fields) and zero or more Field Service
// Report (FSR) entries (one per unit/equipment, each with the WEG-EM
// technical inspection checklist and its own approval signature). The
// worker picks which to include — DSR only, FSR only, or combined — and
// which file format. Everything is generated in the browser — via a bundled
// copy of the `docx` library (js/vendor/docx.min.js) and jsPDF +
// jsPDF-AutoTable (js/vendor/jspdf.min.js, js/vendor/jspdf.autotable.min.js)
// — so report generation works fully offline with no server involved.

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
    const photo = allPhotos.find((p) => p.jobId === ownerId && p.type === 'section') || null;
    return { title: section.title, rows, photo };
  }).filter((s) => s.rows.length > 0 || s.photo); // nothing entered and no photo — leave it out entirely
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

function fsrReportTypeLabel(reportType) {
  return reportType === 'generator' ? 'Generator Report' : reportType === 'motor' ? 'Motor Report' : null;
}

function scopeTitle(scope) {
  if (scope === 'dsr') return 'DAILY STATUS REPORT';
  if (scope === 'fsr') return 'FIELD SERVICE REPORT';
  return 'DAILY STATUS & FIELD SERVICE REPORT';
}
function scopeLabel(scope) {
  if (scope === 'dsr') return 'Daily Status Report';
  if (scope === 'fsr') return 'Field Service Report';
  return 'Daily Status & Field Service Report';
}

// Builds the plain data both the Word and PDF renderers work from, so the
// two output formats can never drift out of sync with each other. `scope`
// is 'dsr', 'fsr', or 'combined' — it controls which of the two independent
// parts get built at all.
async function buildReportModel(log, worker, scope) {
  const tz = DB.getSettings().timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const photos = await DB.getPhotosForLog(log.id);
  const includeDsr = scope === 'dsr' || scope === 'combined';
  const includeFsr = scope === 'fsr' || scope === 'combined';

  const fsrEntries = includeFsr ? (log.fsrEntries || []) : [];
  const dsrSrc = log.dsr || DB.newDsr();

  let dsrModel = null;
  if (includeDsr) {
    dsrModel = {
      entries: (dsrSrc.entries || []).slice().sort((a, b) => timeEntryStartMinutes(a) - timeEntryStartMinutes(b)),
      prePhoto: photos.find((p) => p.jobId === 'dsr' && p.type === 'pre') || null,
      postPhoto: photos.find((p) => p.jobId === 'dsr' && p.type === 'post') || null,
      workCompleted: dsrSrc.workCompleted || '',
      workToBeCompleted: dsrSrc.workToBeCompleted || '',
      technicalComments: dsrSrc.technicalComments || '',
      recommendations: dsrSrc.recommendations || ''
    };
  }

  const fsrModels = fsrEntries.map((entry) => ({
    entry,
    reportTypeLabel: fsrReportTypeLabel(entry.reportType),
    sections: buildTestSectionsData(entry, photos)
  }));

  const projectLine = worker.area
    ? worker.area
    : (fsrEntries.length ? fsrEntries.map((e) => e.siteName || 'Untitled site').join(', ') : '—');

  return { worker, log, tz, projectLine, scope, dsr: dsrModel, fsr: fsrModels };
}

async function fetchLogoDataUrl() {
  try {
    const res = await fetch('icons/weg-logo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blobToDataURL(blob);
  } catch {
    return null;
  }
}

// ============================================================================
// Word (.docx) builder
// ============================================================================
async function buildDocx(model) {
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun, ShadingType
  } = window.docx;

  const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

  const cell = (text, { bold = false, width, shade, italic = false, color } = {}) => new TableCell({
    borders: CELL_BORDERS,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shade ? { type: ShadingType.SOLID, fill: shade, color: 'auto' } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: text == null || text === '' ? '—' : String(text), bold, italics: italic, color })] })]
  });

  const twoColTable = (rows, labelWidth = 30) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([label, value]) => new TableRow({ children: [cell(label, { bold: true, width: labelWidth }), cell(value, { width: 100 - labelWidth })] }))
  });

  const sectionHeading = (text) => new Paragraph({ children: [new TextRun({ text, bold: true, size: 24 })], spacing: { before: 240, after: 120 } });

  async function imageRunFromBlob(blob, width, height) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const type = (blob.type || '').includes('png') ? 'png' : 'jpg';
    return new ImageRun({ data: buf, transformation: { width, height }, type });
  }

  const children = [];

  // ---- Header: logo, title, date, project ----
  const logoDataUrl = await fetchLogoDataUrl();
  if (logoDataUrl) {
    children.push(new Paragraph({
      children: [new ImageRun({ data: dataUrlToUint8Array(logoDataUrl), transformation: { width: 130, height: 83 }, type: 'png' })]
    }));
  }
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 40 },
    children: [new TextRun({ text: scopeTitle(model.scope), bold: true, size: 32, color: '00579D' })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 20 },
    children: [new TextRun({ text: `DATE: ${formatDateLong(model.log.date)}`, bold: true, size: 22 })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: `EM-WEG Project: ${model.projectLine}`, bold: true, size: 22 })]
  }));

  // ---- Meta table ----
  const metaRows = [
    ['Worker:', `${model.worker.name}${model.worker.role ? ' — ' + model.worker.role : ''}`],
    ...(model.worker.area ? [['Area / Location:', model.worker.area]] : []),
    ['Time zone:', model.tz.replace(/_/g, ' ')],
    ['Report generated:', new Date().toLocaleString()]
  ];
  children.push(twoColTable(metaRows));
  children.push(new Paragraph({ text: '', spacing: { after: 120 } }));

  // ---- Daily Status Report (DSR) ----
  if (model.dsr) {
    children.push(sectionHeading('Daily Status Report'));

    const hourRows = model.dsr.entries.length
      ? model.dsr.entries.map((e) => [formatTimeRangeEntry(e), e.description || ''])
      : [['—', 'No time entries logged']];
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [cell('Time', { bold: true, width: 25, shade: 'E8F0FA' }), cell('Work performed', { bold: true, width: 75, shade: 'E8F0FA' })] }),
        ...hourRows.map(([t, d]) => new TableRow({ children: [cell(t, { width: 25 }), cell(d, { width: 75 })] }))
      ]
    }));
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));

    const photoCell = async (label, photo) => {
      const inner = [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: label, bold: true })] })];
      if (photo) {
        inner.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [await imageRunFromBlob(photo.blob, 220, 165)] }));
      } else {
        inner.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '(no photo)', italics: true })] }));
      }
      return new TableCell({ borders: CELL_BORDERS, width: { size: 50, type: WidthType.PERCENTAGE }, children: inner });
    };
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ children: [await photoCell('Pre-work photo', model.dsr.prePhoto), await photoCell('Post-work photo', model.dsr.postPhoto)] })]
    }));
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));

    const narrative = [
      ['WORK COMPLETED:', model.dsr.workCompleted],
      ['WORK TO BE COMPLETED (Next 24 Hours):', model.dsr.workToBeCompleted],
      ['TECHNICAL COMMENTS / CONCERNS / FINDINGS:', model.dsr.technicalComments],
      ['RECOMMENDATIONS:', model.dsr.recommendations]
    ];
    for (const [label, text] of narrative) {
      children.push(new Paragraph({ spacing: { before: 160, after: 40 }, children: [new TextRun({ text: label, bold: true, size: 22 })] }));
      children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: (text || '').trim() || '—' })] }));
    }
    children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
  }

  // ---- Field Service Report (FSR) entries ----
  if (model.scope === 'fsr' || model.scope === 'combined') {
    children.push(sectionHeading('Field Service Report'));

    if (model.fsr.length === 0) {
      children.push(new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: 'No FSR entries were logged for this day.', italics: true })] }));
    }

    for (const fm of model.fsr) {
      const entry = fm.entry;
      children.push(new Paragraph({
        spacing: { before: 200, after: 60 },
        children: [new TextRun({ text: `Unit / Site: ${entry.siteName || 'Untitled'}`, bold: true, size: 24, color: '00579D' })]
      }));

      const lineParts = [
        entry.serviceOrder ? `Service Order / Unit Number: ${entry.serviceOrder}` : null,
        fm.reportTypeLabel ? `Report Type: ${fm.reportTypeLabel}` : null
      ].filter(Boolean);
      if (lineParts.length) {
        children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: lineParts.join('    |    '), bold: true })] }));
      }

      children.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({
          text: entry.approval
            ? `Approved by ${entry.approval.signedBy}${entry.approval.signedRole ? ' (' + entry.approval.signedRole + ')' : ''} on ${new Date(entry.approval.signedAt).toLocaleString()}`
            : 'Not yet approved',
          italics: true,
          color: entry.approval ? '1B7F3A' : '999999'
        })]
      }));

      if (fm.sections.length) {
        for (const section of fm.sections) {
          children.push(new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: section.title, bold: true, color: '00579D' })] }));
          if (section.rows.length) children.push(twoColTable(section.rows, 40));
          if (section.photo) {
            children.push(new Paragraph({ spacing: { before: 60 }, children: [await imageRunFromBlob(section.photo.blob, 220, 165)] }));
          }
          children.push(new Paragraph({ text: '', spacing: { after: 60 } }));
        }
      } else {
        children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: 'No technical inspection data entered.', italics: true })] }));
      }

      if (entry.approval && entry.approval.signatureDataUrl) {
        children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: 'Vendor / client signature:', bold: true })] }));
        children.push(new Paragraph({ children: [new ImageRun({ data: dataUrlToUint8Array(entry.approval.signatureDataUrl), transformation: { width: 220, height: 100 }, type: 'png' })] }));
        children.push(twoColTable([
          ['Approver name:', entry.approval.signedBy || ''],
          ['Role / Position:', entry.approval.signedRole || '—']
        ], 30));
      }
      children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
    }
  }

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200 },
    children: [new TextRun({ text: 'This concludes this report.', italics: true })]
  }));

  const doc = new Document({ sections: [{ children }] });
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

  async function addImagePair(labelA, photoA, labelB, photoB) {
    const boxW = (pageWidth - margin * 2 - 12) / 2;
    const boxH = 150;
    ensureSpace(boxH + 24);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.text(labelA, margin, y);
    doc.text(labelB, margin + boxW + 12, y);
    doc.setFont(undefined, 'normal');
    const imgY = y + 6;
    doc.rect(margin, imgY, boxW, boxH);
    doc.rect(margin + boxW + 12, imgY, boxW, boxH);
    if (photoA) {
      const dataUrl = await resizeDataUrl(await blobToDataURL(photoA.blob), 500, 'image/jpeg', 0.82);
      try { doc.addImage(dataUrl, 'JPEG', margin + 4, imgY + 4, boxW - 8, boxH - 8); } catch { /* ignore malformed image */ }
    } else {
      doc.setFontSize(9);
      doc.text('(no photo)', margin + 8, imgY + boxH / 2);
    }
    if (photoB) {
      const dataUrl = await resizeDataUrl(await blobToDataURL(photoB.blob), 500, 'image/jpeg', 0.82);
      try { doc.addImage(dataUrl, 'JPEG', margin + boxW + 16, imgY + 4, boxW - 8, boxH - 8); } catch { /* ignore malformed image */ }
    } else {
      doc.setFontSize(9);
      doc.text('(no photo)', margin + boxW + 20, imgY + boxH / 2);
    }
    y = imgY + boxH + 16;
  }

  async function addSinglePhoto(photo, maxW = 220, maxH = 165) {
    ensureSpace(maxH + 12);
    const dataUrl = await resizeDataUrl(await blobToDataURL(photo.blob), 500, 'image/jpeg', 0.82);
    try { doc.addImage(dataUrl, 'JPEG', margin, y, maxW, maxH); } catch { /* ignore malformed image */ }
    y += maxH + 12;
  }

  // ---- Header: logo, title, date, project ----
  const logoDataUrl = await fetchLogoDataUrl();
  if (logoDataUrl) {
    try {
      const resizedLogo = await resizeDataUrl(logoDataUrl, 260, 'image/png');
      doc.addImage(resizedLogo, 'PNG', margin, y, 90, 57);
    } catch { /* ignore */ }
  }
  doc.setFont(undefined, 'bold');
  doc.setFontSize(18);
  doc.setTextColor(0, 87, 157);
  doc.text(scopeTitle(model.scope), pageWidth / 2, y + 20, { align: 'center' });
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(`DATE: ${formatDateLong(model.log.date)}`, pageWidth / 2, y + 42, { align: 'center' });
  doc.text(`EM-WEG Project: ${model.projectLine}`, pageWidth / 2, y + 60, { align: 'center' });
  doc.setFont(undefined, 'normal');
  y += 90;

  // ---- Meta table ----
  const metaRows = [
    ['Worker:', `${model.worker.name}${model.worker.role ? ' — ' + model.worker.role : ''}`],
    ...(model.worker.area ? [['Area / Location:', model.worker.area]] : []),
    ['Time zone:', model.tz.replace(/_/g, ' ')],
    ['Report generated:', new Date().toLocaleString()]
  ];
  twoColAutoTable(metaRows, 130);

  // ---- Daily Status Report (DSR) ----
  if (model.dsr) {
    heading('Daily Status Report', 14);

    const hourRows = model.dsr.entries.length
      ? model.dsr.entries.map((e) => [formatTimeRangeEntry(e), e.description || ''])
      : [['—', 'No time entries logged']];
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
      head: [['Time', 'Work performed']],
      headStyles: { fillColor: [232, 240, 250], textColor: [0, 0, 0] },
      columnStyles: { 0: { cellWidth: 110 } },
      body: hourRows
    });
    y = doc.lastAutoTable.finalY + 12;

    await addImagePair('Pre-work photo', model.dsr.prePhoto, 'Post-work photo', model.dsr.postPhoto);

    const narrative = [
      ['WORK COMPLETED:', model.dsr.workCompleted],
      ['WORK TO BE COMPLETED (Next 24 Hours):', model.dsr.workToBeCompleted],
      ['TECHNICAL COMMENTS / CONCERNS / FINDINGS:', model.dsr.technicalComments],
      ['RECOMMENDATIONS:', model.dsr.recommendations]
    ];
    for (const [label, text] of narrative) {
      ensureSpace(20);
      doc.setFont(undefined, 'bold');
      doc.setFontSize(10.5);
      doc.text(label, margin, y);
      y += 14;
      bodyText((text || '').trim());
    }
    y += 6;
  }

  // ---- Field Service Report (FSR) entries ----
  if (model.scope === 'fsr' || model.scope === 'combined') {
    heading('Field Service Report', 14);

    if (model.fsr.length === 0) {
      bodyText('No FSR entries were logged for this day.', { italic: true });
    }

    for (const fm of model.fsr) {
      const entry = fm.entry;
      heading(`Unit / Site: ${entry.siteName || 'Untitled'}`);

      const lineParts = [
        entry.serviceOrder ? `Service Order / Unit Number: ${entry.serviceOrder}` : null,
        fm.reportTypeLabel ? `Report Type: ${fm.reportTypeLabel}` : null
      ].filter(Boolean);
      if (lineParts.length) bodyText(lineParts.join('    |    '));

      bodyText(
        entry.approval
          ? `Approved by ${entry.approval.signedBy}${entry.approval.signedRole ? ' (' + entry.approval.signedRole + ')' : ''} on ${new Date(entry.approval.signedAt).toLocaleString()}`
          : 'Not yet approved',
        { italic: true }
      );

      if (fm.sections.length) {
        for (const section of fm.sections) {
          ensureSpace(20);
          doc.setFont(undefined, 'bold');
          doc.setFontSize(10.5);
          doc.setTextColor(0, 87, 157);
          doc.text(section.title, margin, y);
          doc.setTextColor(0, 0, 0);
          y += 14;
          if (section.rows.length) twoColAutoTable(section.rows, 220);
          if (section.photo) await addSinglePhoto(section.photo);
        }
      } else {
        bodyText('No technical inspection data entered.', { italic: true });
      }

      if (entry.approval && entry.approval.signatureDataUrl) {
        ensureSpace(140);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(10.5);
        doc.text('Vendor / client signature:', margin, y);
        y += 8;
        try {
          const resizedSig = await resizeDataUrl(entry.approval.signatureDataUrl, 400, 'image/png');
          doc.addImage(resizedSig, 'PNG', margin, y, 180, 82);
        } catch { /* ignore */ }
        y += 90;
        twoColAutoTable([
          ['Approver name:', entry.approval.signedBy || ''],
          ['Role / Position:', entry.approval.signedRole || '—']
        ], 130);
      }
      y += 6;
    }
  }

  ensureSpace(30);
  doc.setFont(undefined, 'italic');
  doc.setFontSize(10);
  doc.text('This concludes this report.', pageWidth / 2, y + 14, { align: 'center' });

  return doc.output('blob');
}

// ============================================================================
const Report = {
  // format: 'docx' | 'pdf'; scope: 'dsr' | 'fsr' | 'combined'
  async generate(log, worker, format, scope) {
    const model = await buildReportModel(log, worker, scope);
    const safeWorker = (worker.name || 'worker').replace(/[^a-z0-9]+/gi, '_');
    const scopeTag = scope === 'dsr' ? 'DSR' : scope === 'fsr' ? 'FSR' : 'DSR_FSR';
    if (format === 'pdf') {
      const blob = await buildPdf(model);
      return { blob, filename: `WEG_${scopeTag}_${safeWorker}_${log.date}.pdf` };
    }
    const blob = await buildDocx(model);
    return { blob, filename: `WEG_${scopeTag}_${safeWorker}_${log.date}.docx` };
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
