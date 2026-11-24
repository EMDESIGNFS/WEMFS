// transfer.js — move jobs, reports and photos from one device to another
// (e.g. phone <-> laptop). No account needed.
//
// How it pairs (one step): device A taps "Show code" and gets an 8-digit
// number plus a QR code of it. Device B taps "Enter code" and either types the
// number or scans the QR. That is the whole handshake. The devices find each
// other through the free public PeerJS pairing service (only connection
// details pass through it, never your data), then open a direct, encrypted
// WebRTC connection. If a direct path isn't possible PeerJS's public relay may
// carry the (still encrypted) data. Both devices need internet to pair.
//
// What moves: both devices compare what they have and each sends the other
// whatever it is missing or has a newer copy of (per job, newest edit wins;
// photos are only ever added). Nothing is ever deleted by a transfer.

const Transfer = {
  CHUNK: 16384,
  PREFIX: 'WEGFS:',   // text inside the QR code: 'WEGFS:' + 8 digits
  // Pairing-service settings. Empty = the free public PeerJS cloud. (Tests point this at a local server.)
  peerOptions: {},
  CODE_LIFETIME_MS: 5 * 60 * 1000,
  newPeer(id) { return new Peer(id, Object.assign({ debug: 0 }, this.peerOptions)); },
  newCode() { return String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).padStart(8, '0'); },
  idForCode(code) { return 'wegfs-' + code; },

  // ---------- connection ----------
  _opened(dc, pc, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (dc.readyState === 'open') return resolve();
      const t = setTimeout(() => reject(new Error('The connection could not be opened. Check that both devices have internet and try again with a new code.')), timeoutMs);
      dc.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      if (pc) pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') { clearTimeout(t); reject(new Error('The connection could not be opened. Check that both devices have internet and try again with a new code.')); }
      });
    });
  },

  // ---------- the exchange ----------
  // Runs on both ends once the channel is open. Resolves with a summary.
  async exchange(dc, onProgress = () => {}) {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1 << 20;
    // The peer may start talking before our own data is read — hold its messages until we're ready.
    const early = dc._early || [];
    dc.onmessage = (e) => early.push(e.data);
    const sendJson = (o) => dc.send(JSON.stringify(o));
    const waitDrain = async () => {
      while (dc.bufferedAmount > 4 * (1 << 20)) {
        await new Promise((r) => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
      }
    };

    const stamp = (x) => x.updatedAt || x.createdAt || 0;
    const workers = await DB.getAllWorkersRaw();
    const jobs = await DB.getAllJobsRaw();
    const photoIds = await DB.getAllPhotoIds();
    const mine = {
      workers: Object.fromEntries(workers.map((w) => [w.id, stamp(w)])),
      jobs: Object.fromEntries(jobs.map((j) => [j.id, j.updatedAt || 0])),
      photos: photoIds
    };

    return new Promise((resolve, reject) => {
      const summary = { received: { workers: 0, jobs: 0, photos: 0 }, sent: { workers: 0, jobs: 0, photos: 0 } };
      let finished = false, peerDone = false, sentDone = false;
      let expected = 0, got = 0, toSend = 0, sent = 0;
      let cur = null;                // photo being received
      let queue = Promise.resolve();

      const fail = (err) => { if (!finished) { finished = true; reject(err); } };
      const maybeFinish = () => {
        if (!finished && peerDone && sentDone) { finished = true; setTimeout(() => { try { dc.close(); } catch { /* ignore */ } }, 300); resolve(summary); }
      };
      const progress = () => onProgress({ got, expected, sent, toSend });

      dc.onclose = () => fail(new Error('The connection was lost before the transfer finished. Nothing was lost — you can try again.'));
      dc.onerror = () => fail(new Error('The connection failed.'));

      const handlePeerHello = async (peer) => {
        // What the peer is missing / has older copies of, and what I'll receive.
        const sendWorkers = workers.filter((w) => !(w.id in peer.workers) || stamp(w) > peer.workers[w.id]);
        const sendJobs = jobs.filter((j) => !(j.id in peer.jobs) || (j.updatedAt || 0) > peer.jobs[j.id]);
        const peerHas = new Set(peer.photos);
        const sendPhotos = photoIds.filter((id) => !peerHas.has(id));
        toSend = sendWorkers.length + sendJobs.length + sendPhotos.length;
        const myPhotos = new Set(photoIds);
        expected = Object.keys(peer.workers).filter((id) => !(id in mine.workers) || peer.workers[id] > mine.workers[id]).length
          + Object.keys(peer.jobs).filter((id) => !(id in mine.jobs) || peer.jobs[id] > mine.jobs[id]).length
          + peer.photos.filter((id) => !myPhotos.has(id)).length;
        progress();

        for (const w of sendWorkers) { sendJson({ t: 'worker', d: w }); summary.sent.workers++; sent++; progress(); }
        for (const j of sendJobs) { sendJson({ t: 'job', d: j }); summary.sent.jobs++; sent++; progress(); await waitDrain(); }
        for (const id of sendPhotos) {
          const ph = await DB.getPhoto(id);
          if (!ph) { sent++; continue; }
          const buf = await ph.blob.arrayBuffer();
          sendJson({ t: 'photo', d: { id: ph.id, jobId: ph.jobId, ownerId: ph.ownerId, type: ph.type, takenAt: ph.takenAt, mime: ph.blob.type || 'image/jpeg', size: buf.byteLength } });
          for (let i = 0; i < buf.byteLength; i += Transfer.CHUNK) {
            await waitDrain();
            dc.send(buf.slice(i, i + Transfer.CHUNK));
          }
          sendJson({ t: 'photoEnd' });
          summary.sent.photos++; sent++; progress();
        }
        sendJson({ t: 'done' });
        sentDone = true;
        maybeFinish();
      };

      const handle = async (data) => {
        if (typeof data !== 'string') {                       // a piece of a photo
          if (cur) cur.chunks.push(data);
          return;
        }
        const msg = JSON.parse(data);
        if (msg.t === 'hello') { await handlePeerHello(msg.d); }
        else if (msg.t === 'worker') {
          const have = await DB.getWorker(msg.d.id);
          if (!have || stamp(msg.d) > stamp(have)) { await DB.putWorkerRaw(msg.d); summary.received.workers++; }
          got++; progress();
        } else if (msg.t === 'job') {
          const have = await DB.getJobRaw(msg.d.id);
          if (!have || (msg.d.updatedAt || 0) > (have.updatedAt || 0)) { await DB.putJobRaw(msg.d); summary.received.jobs++; }
          got++; progress();
        } else if (msg.t === 'photo') { cur = { meta: msg.d, chunks: [] }; }
        else if (msg.t === 'photoEnd') {
          if (cur) {
            const m = cur.meta;
            if (!(await DB.getPhoto(m.id))) {
              await DB.putPhotoRaw({ id: m.id, jobId: m.jobId, ownerId: m.ownerId, type: m.type, takenAt: m.takenAt, blob: new Blob(cur.chunks, { type: m.mime }) });
              summary.received.photos++;
            }
            cur = null; got++; progress();
          }
        } else if (msg.t === 'done') { peerDone = true; maybeFinish(); }
      };

      dc.onmessage = (e) => { queue = queue.then(() => handle(e.data)).catch(fail); };
      early.splice(0).forEach((d) => { queue = queue.then(() => handle(d)).catch(fail); });
      sendJson({ t: 'hello', d: mine });
    });
  },

  // ---------- QR helpers ----------
  drawQr(canvas, text) {
    const qr = qrcode(0, 'L');
    qr.addData(text, text === text.toUpperCase() ? 'Alphanumeric' : 'Byte');
    qr.make();
    const n = qr.getModuleCount(), scale = 6, quiet = 4;
    const size = (n + quiet * 2) * scale;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    return n;
  },

  // Camera scanner. Calls onCode(text) once for a transfer code. Returns stop().
  async startScanner(videoEl, onCode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera is not available here — type the code instead.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } });
    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', 'true');
    await videoEl.play();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let stopped = false;
    const stop = () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); videoEl.srcObject = null; };
    const tick = () => {
      if (stopped) return;
      if (videoEl.videoWidth) {
        const scale = Math.min(1, 1100 / videoEl.videoWidth);
        canvas.width = Math.round(videoEl.videoWidth * scale); canvas.height = Math.round(videoEl.videoHeight * scale);
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (hit && hit.data && hit.data.startsWith(Transfer.PREFIX)) { stop(); onCode(hit.data.slice(Transfer.PREFIX.length).replace(/\D/g, '')); return; }
      }
      setTimeout(tick, 120);
    };
    tick();
    return stop;
  },

  // ---------- the on-screen wizard ----------
  open(role) {
    if (role === 'send') role = 'show'; else if (role === 'receive') role = 'enter';
    if (typeof RTCPeerConnection === 'undefined') { alert('This browser cannot do direct transfer. Use Backup / Restore instead.'); return; }
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    document.body.appendChild(backdrop);
    let stopScan = null, closed = false;
    const peers = [];      // PeerJS peers opened by the code flow
    let expireTimer = null;
    const cleanup = () => { closed = true; clearTimeout(expireTimer); if (stopScan) stopScan(); peers.forEach((p) => { try { p.destroy(); } catch { /* ignore */ } }); backdrop.remove(); };
    const sheet = (html) => { backdrop.innerHTML = `<div class="modal-sheet xfer-sheet">${html}</div>`; };
    const bindCancel = () => backdrop.querySelectorAll('[data-xfer-cancel]').forEach((b) => b.addEventListener('click', cleanup));

    const progressHtml = () => `
      <h3>Transferring…</h3>
      <div class="xfer-bar"><div class="xfer-bar-fill" id="xfer-fill"></div></div>
      <p class="text-dim" id="xfer-text">Connecting…</p>`;
    const runTransfer = async (dc, peer, status) => {
      sheet(progressHtml());
      if (status) { const t = backdrop.querySelector('#xfer-text'); if (t) t.textContent = status; }
      try {
        await Transfer._opened(dc, peer);
        const sum = await Transfer.exchange(dc, (p) => {
          const total = p.expected + p.toSend, done = p.got + p.sent;
          const fill = backdrop.querySelector('#xfer-fill'), text = backdrop.querySelector('#xfer-text');
          if (fill) fill.style.width = (total ? Math.round(100 * done / total) : 100) + '%';
          if (text) text.textContent = total ? `${done} of ${total} items…` : 'Comparing…';
        });
        if (closed) return;
        if (!DB.getCurrentWorkerId()) await DB.recoverWorker();
        const r = sum.received, s = sum.sent;
        sheet(`
          <h3>✓ Transfer complete</h3>
          <p>Received: <b>${r.jobs}</b> job(s), <b>${r.photos}</b> photo(s)${r.workers ? ', profile' : ''}.</p>
          <p>Sent: <b>${s.jobs}</b> job(s), <b>${s.photos}</b> photo(s).</p>
          <p class="text-dim">Both devices now have the same jobs. Where a job existed on both, the most recently edited copy was kept.</p>
          <button class="btn btn-primary btn-block" id="xfer-done">Open my jobs</button>`);
        backdrop.querySelector('#xfer-done').addEventListener('click', () => { cleanup(); location.hash = '#/jobs'; location.reload(); });
      } catch (e) {
        if (closed) return;
        sheet(`<h3>Transfer didn't finish</h3><p>${esc(e.message)}</p><button class="btn btn-block" data-xfer-cancel>Close</button>`);
        bindCancel();
      }
    };

    // ----- Main way: 8-digit code -----
    const fmtCode = (c) => c.slice(0, 4) + ' ' + c.slice(4);
    const failScreen = (msg, which) => {
      sheet(`<h3>Couldn't connect</h3><p>${esc(msg)}</p><button class="btn btn-primary btn-block" id="xfer-again">Try again</button><button class="btn btn-block mt8" data-xfer-cancel>Close</button>`);
      bindCancel();
      backdrop.querySelector('#xfer-again').addEventListener('click', () => (which === 'show' ? startShowCode() : startEnterCode()));
    };

    // The device that shows the code.
    const startShowCode = (attempt = 0) => {
      peers.splice(0).forEach((p) => { try { p.destroy(); } catch { /* ignore */ } });
      clearTimeout(expireTimer);
      const code = Transfer.newCode();
      let peer, taken = false;
      try { peer = Transfer.newPeer(Transfer.idForCode(code)); } catch (e) { failScreen('The pairing service could not be started. ' + e.message, 'show'); return; }
      peers.push(peer);
      sheet('<h3>Show a code</h3><p class="text-dim">Getting a code…</p>');
      peer.on('open', () => {
        sheet(`
          <h3>Show a code</h3>
          <p>On the other device tap <b>Enter code</b>, then type this number or scan the QR code:</p>
          <div class="xfer-code-big" id="xfer-code-big">${fmtCode(code)}</div>
          <p class="text-dim" style="text-align:center;margin:0 0 6px;">…or scan this with the other device's camera:</p>
          <canvas class="xfer-qr" id="xfer-qr"></canvas>
          <p class="text-dim">Waiting for the other device… The code works for 5 minutes.</p>
          <button class="btn btn-ghost btn-block mt8" data-xfer-cancel>Cancel</button>
          `);
        bindCancel();
        try { Transfer.drawQr(backdrop.querySelector('#xfer-qr'), Transfer.PREFIX + code); } catch { /* QR is optional: the digits still work */ }
        expireTimer = setTimeout(() => {
          if (taken || closed) return;
          peers.splice(0).forEach((p) => { try { p.destroy(); } catch { /* ignore */ } });
          sheet('<h3>Code expired</h3><p>Nobody entered it in time.</p><button class="btn btn-primary btn-block" id="xfer-newcode">Show a new code</button><button class="btn btn-block mt8" data-xfer-cancel>Close</button>');
          bindCancel();
          backdrop.querySelector('#xfer-newcode').addEventListener('click', () => startShowCode());
        }, Transfer.CODE_LIFETIME_MS);
      });
      peer.on('error', (e) => {
        if (closed || taken) return;
        if (e.type === 'unavailable-id' && attempt < 5) { startShowCode(attempt + 1); return; }
        failScreen('Could not reach the pairing service — is this device online? (' + (e.type || e.message) + ')', 'show');
      });
      peer.on('connection', (conn) => {
        if (taken) { conn.close(); return; }          // only one device per code
        taken = true; clearTimeout(expireTimer);
        let opened = conn.open;
        conn.on('open', () => { opened = true; if (conn.dataChannel) { conn.dataChannel._early = []; conn.dataChannel.onmessage = (ev) => conn.dataChannel._early.push(ev.data); } });
        sheet(`
          <h3>Allow this device?</h3>
          <p>A device entered your code and wants to sync with this one. Only allow it if that was you.</p>
          <button class="btn btn-primary btn-block" id="xfer-allow">Yes, sync now</button>
          <button class="btn btn-block mt8" id="xfer-deny">No, that wasn't me</button>`);
        backdrop.querySelector('#xfer-deny').addEventListener('click', () => { try { conn.close(); } catch { /* ignore */ } cleanup(); });
        backdrop.querySelector('#xfer-allow').addEventListener('click', async () => {
          sheet(progressHtml());
          try {
            if (!conn.open) await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('The other device disconnected.')), 20000); conn.on('open', () => { clearTimeout(t); resolve(); }); conn.on('error', reject); });
            await runTransfer(conn.dataChannel, null);
          } catch (e) { failScreen(e.message, 'show'); }
        });
      });
    };

    // The device that types (or scans) the code.
    const connectWithCode = (code) => {
      sheet(progressHtml());
      { const t = backdrop.querySelector('#xfer-text'); if (t) t.textContent = 'Looking for the other device…'; }
      let peer;
      try { peer = Transfer.newPeer(); } catch (e) { failScreen('The pairing service could not be started. ' + e.message, 'enter'); return; }
      peers.push(peer);
      let settled = false;
      const giveUp = (msg) => { if (settled || closed) return; settled = true; try { peer.destroy(); } catch { /* ignore */ } failScreen(msg, 'enter'); };
      const timeout = setTimeout(() => giveUp('The two devices could not link up within 25 seconds. Check that the code is still showing on the other device (it lasts 5 minutes) and that BOTH devices have working internet. If the laptop is on the phone\'s hotspot, try normal Wi-Fi on one of them.'), 25000);
      peer.on('error', (e) => {
        clearTimeout(timeout);
        giveUp(e.type === 'peer-unavailable' ? 'No device is showing that code. Check the digits — or tap Show code again on the other device.'
          : 'Could not reach the pairing service — is this device online? (' + (e.type || e.message) + ')');
      });
      peer.on('open', () => {
        const conn = peer.connect(Transfer.idForCode(code), { reliable: true, serialization: 'raw' });
        conn.on('open', async () => {
          clearTimeout(timeout); settled = true;
          try { await runTransfer(conn.dataChannel, null, 'Connected — waiting for the other device to allow it…'); } catch (e) { failScreen(e.message, 'enter'); }
        });
        conn.on('error', (e) => { clearTimeout(timeout); giveUp('The connection failed (' + (e.type || e.message) + ').'); });
      });
    };

    const startEnterCode = () => {
      sheet(`
        <h3>Enter code</h3>
        <p>On the other device tap <b>Show code</b>. Then scan the QR code it shows, or type the 8 digits:</p>
        <div class="xfer-scan" id="xfer-scan-wrap"><video class="xfer-video" id="xfer-scan-video" muted playsinline></video></div>
        <button class="btn btn-primary btn-block" id="xfer-scan-btn">📷 Scan QR code</button>
        <input type="text" inputmode="numeric" autocomplete="off" maxlength="9" class="xfer-code-input mt8" id="xfer-code-input" placeholder="0000 0000" />
        <p class="xfer-error hidden"></p>
        <button class="btn btn-block mt8" id="xfer-connect">Connect with typed code</button>
        <button class="btn btn-ghost btn-block mt8" data-xfer-cancel>Cancel</button>`);
      bindCancel();
      const input = backdrop.querySelector('#xfer-code-input');
      const err = (m) => { const el = backdrop.querySelector('.xfer-error'); if (el) { el.textContent = m; el.classList.toggle('hidden', !m); } };
      input.addEventListener('input', () => { const d = input.value.replace(/\D/g, '').slice(0, 8); input.value = d.length > 4 ? d.slice(0, 4) + ' ' + d.slice(4) : d; err(''); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') backdrop.querySelector('#xfer-connect').click(); });
      backdrop.querySelector('#xfer-connect').addEventListener('click', () => {
        const code = input.value.replace(/\D/g, '');
        if (code.length !== 8) { err('Type all 8 digits.'); return; }
        if (stopScan) { stopScan(); stopScan = null; }
        connectWithCode(code);
      });
      backdrop.querySelector('#xfer-scan-btn').addEventListener('click', async () => {
        try {
          backdrop.querySelector('#xfer-scan-wrap').classList.add('on');
          stopScan = await Transfer.startScanner(backdrop.querySelector('#xfer-scan-video'), (code) => {
            stopScan = null;
            if (code.length === 8) connectWithCode(code); else err('That QR code is not from this app.');
          });
        } catch (e) { backdrop.querySelector('#xfer-scan-wrap').classList.remove('on'); err('Could not open the camera. ' + (e.message || '') + ' Type the code instead.'); }
      });
    };

    if (role === 'show') startShowCode();
    else startEnterCode();
  }
};

window.Transfer = Transfer;
