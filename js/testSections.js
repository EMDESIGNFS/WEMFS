// testSections.js — generic renderer + data-binder for the WEG-EM technical
// inspection checklist (see js/reportSections.js for the schema and the
// row-type reference). One generic engine drives both the on-device form
// (this file) and the Excel export (report.js), so the ~30 sections and
// ~400+ underlying fields don't need to be hand-coded twice.
//
// Data shape stored on a job: job.testSections = {
//   [sectionKey]: { enabled: bool, values: { [rowKey]: <leaf|pair|dual|grid> } }
// }
// Leaf shapes by row type:
//   text/select (not paired):  "string"
//   text/select (paired p:true): { found:"string", left:"string" }
//   unit/unit2 (not paired):   { value:"string", unit:"string" }
//   unit/unit2 (paired):       { found:{value,unit}, left:{value,unit} }
//   dual:                      { [fieldKey]: {value,unit} }
//   grid:                      [[v00, v01, ...], [v10, ...], ...]  (strings)

const TestSections = {
  esc(s) { return escapeHtml(String(s == null ? '' : s)); },

  sectionsForScope(scope) {
    return REPORT_SECTIONS.filter((s) => s.scope === scope);
  },

  // ---------- Checklist (section picker) ----------
  // photoHtmlFn(sectionKey) is optional — when given, its return value (HTML)
  // is inserted at the top of each expanded section's body, so the app can
  // offer a "capture/upload a photo for this section" slot without this file
  // needing to know anything about the app's photo storage.
  renderChecklist(job, photoHtmlFn) {
    if (!job.reportType) return '';
    const specificScope = job.reportType === 'generator' ? 'generator' : 'motor';
    const specificLabel = job.reportType === 'generator' ? 'Generator Report-Specific Sections' : 'Motor Report-Specific Sections';
    const groups = [
      { label: 'Common Sections', sections: this.sectionsForScope('common') },
      { label: specificLabel, sections: this.sectionsForScope(specificScope) }
    ];
    return groups.map((g) => `
      <div class="test-group-label">${this.esc(g.label)}</div>
      ${g.sections.map((s) => this.renderSectionToggle(job, s, photoHtmlFn)).join('')}
    `).join('');
  },

  renderSectionToggle(job, section, photoHtmlFn) {
    const state = job.testSections[section.key] || { enabled: false, values: {} };
    const checked = !!state.enabled;
    return `
      <div class="test-section${checked ? ' expanded' : ''}" data-test-section="${section.key}">
        <label class="test-section-toggle">
          <input type="checkbox" data-test-toggle="${section.key}" ${checked ? 'checked' : ''} />
          <span>${this.esc(section.title)}</span>
        </label>
        ${checked ? `<div class="test-section-body" data-test-body="${section.key}">${photoHtmlFn ? photoHtmlFn(section.key) : ''}${this.renderSectionBody(section, state.values || {})}</div>` : ''}
      </div>
    `;
  },

  // ---------- Section body (fields) ----------
  renderSectionBody(section, values) {
    const v = this.applyCalculations(section, values);
    return section.rows.map((row) => this.renderRow(row, v[row.k])).join('');
  },

  // ---------- Automatic calculations (P.I.) ----------
  // Rows flagged `calc: 'pi'` are read-only: Polarization Index = the
  // 10-minute insulation resistance divided by the 1-minute reading (rows
  // `min_10` and `min_1` of the same section). Resistance units are
  // converted first, so e.g. 1 GΩ / 500 MΩ is handled correctly.
  OHM_FACTORS: { 'mΩ': 1e-3, 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6, 'GΩ': 1e9 },

  _ohms(leaf) {
    if (leaf == null) return null;
    const raw = typeof leaf === 'object' ? leaf.value : leaf;
    const n = parseFloat(raw);
    if (!isFinite(n)) return null;
    const unit = (typeof leaf === 'object' && leaf.unit) || 'MΩ';
    return n * (this.OHM_FACTORS[unit] || 1);
  },

  _ratio(num, den) {
    if (num == null || den == null || den <= 0) return '';
    return (num / den).toFixed(2);
  },

  // Returns a copy of `values` with every calc row recomputed from the
  // readings (blank when a reading is missing).
  applyCalculations(section, values) {
    const out = Object.assign({}, values || {});
    for (const row of section.rows) {
      if (row.calc !== 'pi') continue;
      const r1 = section.rows.find((r) => r.k === 'min_1');
      const r10 = section.rows.find((r) => r.k === 'min_10');
      if (!r1 || !r10) continue;
      if (row.t === 'grid') {
        const g1 = (out.min_1 && out.min_1[0]) || [];
        const g10 = (out.min_10 && out.min_10[0]) || [];
        out[row.k] = [row.cols.map((_, ci) => {
          const a = parseFloat(g1[ci]), b = parseFloat(g10[ci]);
          return this._ratio(isFinite(b) ? b : null, isFinite(a) ? a : null);
        })];
      } else {
        out[row.k] = this._ratio(this._ohms(out.min_10), this._ohms(out.min_1));
      }
    }
    return out;
  },

  // Live update while the worker types: recompute the calc rows from what's
  // currently in the form and write the results into their read-only inputs.
  refreshCalculated(section, containerEl) {
    if (!section.rows.some((r) => r.calc)) return;
    const values = this.applyCalculations(section, this.collectSectionValues(section, containerEl));
    for (const row of section.rows) {
      if (!row.calc) continue;
      if (row.t === 'grid') {
        const table = containerEl.querySelector(`table.tf-grid-table[data-row="${row.k}"]`);
        row.cols.forEach((_, ci) => {
          const el = table && table.querySelector(`[data-grid-r="0"][data-grid-c="${ci}"]`);
          if (el) el.value = (values[row.k][0] || [])[ci] || '';
        });
      } else {
        const el = containerEl.querySelector(`[data-row="${row.k}"][data-part="value"]`);
        if (el) el.value = values[row.k] || '';
      }
    }
  },

  // Reference pictures shown inside a section (not an input, never saved or
  // printed): e.g. where the numbered readings are taken.
  DIAGRAMS: {
    bearing_locations: `
      <svg viewBox="0 0 640 224" role="img" aria-label="Outboard and inboard bearing with shaft, measurement locations 1 and 2 on top, 3 and 4 on the bottom" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:640px;display:block;margin:0 auto;">
        <rect x="0" y="0" width="640" height="224" rx="10" fill="#f1f5f9"/>
        <line x1="320" y1="12" x2="320" y2="212" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="5 4"/>
        <text x="150" y="22" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="17" fill="#0f172a">Outboard</text>
        <text x="150" y="40" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#475569">Exciter end</text>
        <rect x="60" y="54" width="180" height="62" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>
        <rect x="60" y="146" width="180" height="62" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>
        <rect x="14" y="116" width="272" height="30" fill="#c7ccd4" stroke="#0f172a" stroke-width="2"/>
        <text x="150" y="137" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="17" fill="#0f172a">Shaft</text>
        <text x="150" y="89" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="15" fill="#0f172a">Bearing</text>
        <text x="150" y="181" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="15" fill="#0f172a">Bearing</text>
        <g font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="20" fill="#0f172a" text-anchor="middle">
          <circle cx="82" cy="76" r="13" fill="#facc15" stroke="#0f172a" stroke-width="1.5"/><text x="82" y="83">1</text>
          <circle cx="218" cy="76" r="13" fill="#facc15" stroke="#0f172a" stroke-width="1.5"/><text x="218" y="83">2</text>
          <circle cx="82" cy="186" r="13" fill="#facc15" stroke="#0f172a" stroke-width="1.5"/><text x="82" y="193">3</text>
          <circle cx="218" cy="186" r="13" fill="#facc15" stroke="#0f172a" stroke-width="1.5"/><text x="218" y="193">4</text>
        </g>
        <text x="480" y="22" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="17" fill="#0f172a">Inboard</text>
        <text x="480" y="40" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#475569">Opposite exciter end</text>
        <rect x="390" y="54" width="180" height="62" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>
        <rect x="390" y="146" width="180" height="62" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>
        <rect x="344" y="116" width="272" height="30" fill="#c7ccd4" stroke="#0f172a" stroke-width="2"/>
        <text x="480" y="137" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="17" fill="#0f172a">Shaft</text>
        <text x="480" y="89" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="15" fill="#0f172a">Bearing</text>
        <text x="480" y="181" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="15" fill="#0f172a">Bearing</text>
        <g font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="20" fill="#0f172a" text-anchor="middle">
          <circle cx="412" cy="76" r="13" fill="#facc15" stroke="#0f172a" stroke-width="1.5"/><text x="412" y="83">1</text>
          <circle cx="548" cy="76" r="13" fill="#facc15" stroke="#0f172a" stroke-width="1.5"/><text x="548" y="83">2</text>
          <circle cx="412" cy="186" r="13" fill="#facc15" stroke="#0f172a" stroke-width="1.5"/><text x="412" y="193">3</text>
          <circle cx="548" cy="186" r="13" fill="#facc15" stroke="#0f172a" stroke-width="1.5"/><text x="548" y="193">4</text>
        </g>
      </svg>`
  },

  renderRow(row, val) {
    if (row.t === 'diagram') {
      return `<div class="tf-row tf-diagram"><label class="tf-label">${this.esc(row.l)}</label>${this.DIAGRAMS[row.img] || ''}<p class="text-dim" style="margin:6px 0 0;font-size:12px;">Same four locations on both bearings: 1 and 2 are the top (left / right), 3 and 4 are the bottom (left / right). Outboard is the exciter end; inboard is the opposite-exciter end. Take the readings below at these points.</p></div>`;
    }
    if (row.t === 'grid') return this.renderGrid(row, val);
    if (row.t === 'dual') return this.renderDual(row, val);
    if (row.p) {
      const found = (val && val.found !== undefined) ? val.found : (row.t === 'unit' || row.t === 'unit2' ? {} : '');
      const left = (val && val.left !== undefined) ? val.left : (row.t === 'unit' || row.t === 'unit2' ? {} : '');
      return `
        <div class="tf-row tf-paired">
          <label class="tf-label">${this.esc(row.l)}</label>
          <div class="tf-pair-inputs">
            <div class="tf-pair-slot"><span class="tf-pair-tag">As Found</span>${this.renderLeaf(row, found, { pair: 'found' })}</div>
            <div class="tf-pair-slot"><span class="tf-pair-tag">As Left</span>${this.renderLeaf(row, left, { pair: 'left' })}</div>
          </div>
        </div>
      `;
    }
    return `
      <div class="tf-row">
        <label class="tf-label">${this.esc(row.l)}${row.calc ? ' <span class="tf-grid-unit">(auto-calculated)</span>' : ''}</label>
        ${this.renderLeaf(row, val, {})}
      </div>
    `;
  },

  attrStr(row, attrs) {
    let s = `data-row="${row.k}"`;
    if (attrs.pair) s += ` data-pair="${attrs.pair}"`;
    if (attrs.sub) s += ` data-sub="${attrs.sub}"`;
    return s;
  },

  renderLeaf(row, leafVal, attrs) {
    const a = this.attrStr(row, attrs);
    if (row.t === 'text') {
      if (row.calc) return `<input type="text" class="tf-calc" readonly tabindex="-1" ${a} data-part="value" value="${this.esc(leafVal || '')}" placeholder="auto" />`;
      return `<input type="text" ${a} data-part="value" value="${this.esc(leafVal || '')}" />`;
    }
    if (row.t === 'select') {
      const opts = ['<option value="">—</option>'].concat(
        row.o.map((o) => `<option value="${this.esc(o)}" ${o === leafVal ? 'selected' : ''}>${this.esc(o)}</option>`)
      ).join('');
      return `<select ${a} data-part="value">${opts}</select>`;
    }
    if (row.t === 'unit' || row.t === 'unit2') {
      const unitOptions = row.t === 'unit' ? UNIT_GROUPS[row.g].options : row.o;
      const defaultUnit = row.t === 'unit' ? row.u : row.o[0];
      const v = leafVal || {};
      const unitOpts = unitOptions.map((u) => `<option value="${this.esc(u)}" ${(v.unit || defaultUnit) === u ? 'selected' : ''}>${this.esc(u)}</option>`).join('');
      return `
        <div class="tf-unit-pair">
          <input type="number" step="any" inputmode="decimal" ${a} data-part="value" value="${this.esc(v.value || '')}" placeholder="0" />
          <select ${a} data-part="unit">${unitOpts}</select>
        </div>
      `;
    }
    return '';
  },

  renderDual(row, val) {
    const v = val || {};
    return `
      <div class="tf-row tf-dual">
        <label class="tf-label">${this.esc(row.l)}</label>
        <div class="tf-dual-inputs">
          ${row.fields.map((f) => `
            <div class="tf-dual-slot">
              <span class="tf-pair-tag">${this.esc(f.l)}</span>
              ${this.renderLeaf({ k: row.k, t: 'unit', g: f.g, u: f.u }, v[f.k], { sub: f.k })}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  renderGrid(row, val) {
    const grid = val || [];
    const unitNote = row.u2 ? ` <span class="tf-grid-unit">(${this.esc(row.u2)})</span>` : (row.calc ? ' <span class="tf-grid-unit">(auto-calculated)</span>' : '');
    return `
      <div class="tf-row tf-grid">
        <label class="tf-label">${this.esc(row.l)}${unitNote}</label>
        <div class="tf-grid-scroll">
          <table class="tf-grid-table" data-row="${row.k}">
            <thead><tr><th></th>${row.cols.map((c) => `<th>${this.esc(c)}</th>`).join('')}</tr></thead>
            <tbody>
              ${row.rows.map((rLabel, ri) => `
                <tr>
                  <th>${this.esc(rLabel)}</th>
                  ${row.cols.map((c, ci) => `<td><input type="${row.calc ? 'text' : 'number'}" ${row.calc ? 'class="tf-calc" readonly tabindex="-1" placeholder="auto"' : 'step="any" inputmode="decimal"'} data-grid-r="${ri}" data-grid-c="${ci}" value="${this.esc((grid[ri] && grid[ri][ci]) || '')}" /></td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // ---------- Reading values back out of the DOM ----------
  collectSectionValues(section, containerEl) {
    const values = {};
    section.rows.forEach((row) => {
      if (row.t === 'diagram') return;
      values[row.k] = this.collectRow(row, containerEl);
    });
    return values;
  },

  collectLeaf(row, containerEl, attrs) {
    const sel = (part) => {
      let s = `[data-row="${row.k}"][data-part="${part}"]`;
      if (attrs.pair) s += `[data-pair="${attrs.pair}"]`; else s += ':not([data-pair])';
      if (attrs.sub) s += `[data-sub="${attrs.sub}"]`; else s += ':not([data-sub])';
      return s;
    };
    if (row.t === 'text' || row.t === 'select') {
      const el = containerEl.querySelector(sel('value'));
      return el ? el.value : '';
    }
    if (row.t === 'unit' || row.t === 'unit2') {
      const valEl = containerEl.querySelector(sel('value'));
      const unitEl = containerEl.querySelector(sel('unit'));
      return { value: valEl ? valEl.value : '', unit: unitEl ? unitEl.value : '' };
    }
    return null;
  },

  collectRow(row, containerEl) {
    if (row.t === 'grid') {
      const table = containerEl.querySelector(`table.tf-grid-table[data-row="${row.k}"]`);
      const grid = [];
      row.rows.forEach((_, ri) => {
        grid[ri] = [];
        row.cols.forEach((__, ci) => {
          const el = table ? table.querySelector(`[data-grid-r="${ri}"][data-grid-c="${ci}"]`) : null;
          grid[ri][ci] = el ? el.value : '';
        });
      });
      return grid;
    }
    if (row.t === 'dual') {
      const out = {};
      row.fields.forEach((f) => {
        out[f.k] = this.collectLeaf({ k: row.k, t: 'unit' }, containerEl, { sub: f.k });
      });
      return out;
    }
    if (row.p) {
      return {
        found: this.collectLeaf(row, containerEl, { pair: 'found' }),
        left: this.collectLeaf(row, containerEl, { pair: 'left' })
      };
    }
    return this.collectLeaf(row, containerEl, {});
  },

  // Counts how many leaf fields actually have a non-empty value, for the
  // "3 of 24 fields filled" hint shown on a collapsed section.
  countFilled(section, values) {
    let filled = 0, total = 0;
    const leafFilled = (v, isUnit) => {
      if (v == null) return false;
      if (isUnit) return !!(v.value && String(v.value).trim() !== '');
      return String(v).trim() !== '';
    };
    section.rows.forEach((row) => {
      if (row.t === 'diagram') return;
      if (row.t === 'grid') {
        const grid = values[row.k] || [];
        row.rows.forEach((_, ri) => row.cols.forEach((__, ci) => {
          total++;
          if (grid[ri] && String(grid[ri][ci] || '').trim() !== '') filled++;
        }));
      } else if (row.t === 'dual') {
        const v = values[row.k] || {};
        row.fields.forEach((f) => {
          total++;
          if (leafFilled(v[f.k], true)) filled++;
        });
      } else if (row.p) {
        const v = values[row.k] || {};
        const isUnit = row.t === 'unit' || row.t === 'unit2';
        total += 2;
        if (leafFilled(v.found, isUnit)) filled++;
        if (leafFilled(v.left, isUnit)) filled++;
      } else {
        total++;
        const isUnit = row.t === 'unit' || row.t === 'unit2';
        if (leafFilled(values[row.k], isUnit)) filled++;
      }
    });
    return { filled, total };
  }
};

window.TestSections = TestSections;
