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

  // Works out WHY the pairing service could not be reached, so the message can
  // say what to do. Returns plain-language text.
  async diagnose(code) {
    const probe = async (url) => {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
        await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal }); clearTimeout(t); return true;
      } catch { return false; }
    };
    const host = (this.peerOptions && this.peerOptions.host) || '0.peerjs.com';
    const [net, svc, relay] = await Promise.all([probe('https://www.gstatic.com/generate_204'), probe(`https://${host}/`), probe(this.signalBase + '/')]);
    if (!net && !svc && !relay) return 'This device has no working internet right now. Connect it to Wi-Fi or mobile data and try again.';
    if (!svc && !relay) return `This device is online, but it cannot reach either pairing route (${host} or ${this.signalBase.replace(/^https?:\/\//, '')}). A VPN, firewall, proxy or security program on this device or network is blocking them. Turn the VPN off, try another browser, or switch networks, then try again.`;
    return `Both pairing routes failed on this device even though the services answer. The live connections they need are being blocked or dropped — typically by a VPN, firewall / security software, a proxy, or a browser extension on this device. Try another browser (for example Edge or Firefox), turn the VPN or extensions off, or use Backup / Restore instead.`;
  },

  // ---------- Backup pairing route: plain HTTPS (no WebSocket) ----------
  // Some computers / networks / security tools block the WebSocket the PeerJS
  // pairing service needs. This second route swaps the two small connection
  // messages through a public HTTPS message relay instead (ntfy.sh, a free
  // open-source pub/sub service, topic = the 8-digit code), then opens the same
  // direct, encrypted WebRTC link. Only the connection details pass through it.
  signalBase: 'https://ntfy.sh',
  rtcConfig: null,   // null = PeerJS's default (STUN + its free TURN relays, which help on phone hotspots / mobile data)
  _rtc() {
    if (this.rtcConfig) return this.rtcConfig;
    const d = window.peerjs && window.peerjs.util && window.peerjs.util.defaultConfig;
    return d || { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  },
  // The relay only carries ~4 KB per message: drop relay candidates if the offer/answer is too big.
  _fit(sdp) {
    if (sdp.length < 3300) return sdp;
    return sdp.split(/\r?\n/).filter((l) => !(l.startsWith('a=candidate') && / typ relay/.test(l))).join('\r\n') + '\r\n';
  },
  signalTopic(code) { return 'wegfs-xfer-' + code; },
  async _publish(code, obj) {
    const r = await fetch(`${this.signalBase}/${this.signalTopic(code)}`, { method: 'POST', body: JSON.stringify(obj) });
    if (!r.ok) throw new Error('relay ' + r.status);
  },
  // Listens to the code's topic. onMsg(obj) per message; onOpen() once connected;
  // onFail(err) if the relay can't be reached at all. Returns stop().
  _subscribe(code, { onMsg, onOpen, onFail }) {
    const ctl = new AbortController();
    let stopped = false, opened = false;
    const run = async () => {
      while (!stopped) {
        try {
          const r = await fetch(`${this.signalBase}/${this.signalTopic(code)}/json?since=3m`, { signal: ctl.signal, cache: 'no-store' });
          if (!r.ok) throw new Error('relay ' + r.status);
          if (!opened) { opened = true; if (onOpen) onOpen(); }
          const reader = r.body.getReader(), dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
              if (!line) continue;
              let j; try { j = JSON.parse(line); } catch { continue; }
              if (j.event !== 'message') continue;
              let m; try { m = JSON.parse(j.message); } catch { continue; }
              if (onMsg) onMsg(m);
            }
          }
        } catch (e) {
          if (stopped) return;
          if (!opened) { if (onFail) onFail(e); return; }
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
    };
    run();
    return () => { stopped = true; try { ctl.abort(); } catch { /* ignore */ } };
  },
  // One line describing how far the direct link got — shown on failures so the cause can be read off.
  _iceInfo(pc) {
    if (!pc) return '';
    const count = (d) => { const t = (d && d.sdp) || ''; const c = (x) => (t.match(new RegExp('typ ' + x + '\\b', 'g')) || []).length; return `host ${c('host')}, srflx ${c('srflx')}, relay ${c('relay')}`; };
    return ` [link: ${pc.iceConnectionState}; this device: ${count(pc.localDescription)}; other device: ${count(pc.remoteDescription)}]`;
  },
  _gather(pc, timeout = 5000) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const t = setTimeout(resolve, timeout);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
    });
  },
  // Typing/scanning side: send an offer, wait (until the other side taps Allow) for the answer.
  async signalConnect(code, waitMs = 60000) {
    const pc = new RTCPeerConnection(this._rtc());
    const dc = pc.createDataChannel('wegfs', { ordered: true });
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
    await pc.setLocalDescription(await pc.createOffer());
    await this._gather(pc);
    let stop = null, timer = null;
    try {
      const answered = new Promise((resolve, reject) => {
        stop = this._subscribe(code, { onMsg: (m) => { if (m.t === 'answer' && m.to === id) resolve(m.sdp); }, onFail: reject });
        timer = setTimeout(() => reject(new Error('no answer')), waitMs);
      });
      answered.catch(() => {});
      await this._publish(code, { t: 'offer', id, sdp: this._fit(pc.localDescription.sdp) });
      const sdp = await answered;
      await pc.setRemoteDescription({ type: 'answer', sdp });
      return { pc, dc };
    } catch (e) { try { pc.close(); } catch { /* ignore */ } throw e; }
    finally { clearTimeout(timer); if (stop) stop(); }
  },
  // Code-showing side: turn a received offer into an answer.
  async signalAnswer(code, offer) {
    const pc = new RTCPeerConnection(this._rtc());
    const dcPromise = new Promise((resolve) => {
      pc.ondatachannel = (e) => { const ch = e.channel; ch._early = []; ch.onmessage = (ev) => ch._early.push(ev.data); resolve(ch); };
    });
    await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await this._gather(pc);
    await this._publish(code, { t: 'answer', to: offer.id, sdp: this._fit(pc.localDescription.sdp) });
    return { pc, dcPromise };
  },

  // ---------- connection ----------
  _opened(dc, pc, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (dc.readyState === 'open') return resolve();
      const t = setTimeout(() => reject(new Error('The connection could not be opened. Check that both devices have internet and try again with a new code.' + Transfer._iceInfo(pc))), timeoutMs);
      dc.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      if (pc) pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') { clearTimeout(t); reject(new Error('The connection could not be opened. Check that both devices have internet and try again with a new code.' + Transfer._iceInfo(pc))); }
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
    // Some browsers cap the size of one message (as low as 64 KB), and a job can carry signature
    // images: split anything big into numbered parts that the other side stitches back together.
    const sendJson = (o) => {
      const str = JSON.stringify(o);
      if (str.length <= 40000) { dc.send(str); return; }
      const id = Math.random().toString(36).slice(2), n = Math.ceil(str.length / 40000);
      for (let i = 0; i < n; i++) dc.send(JSON.stringify({ t: 'part', id, i, n, s: str.slice(i * 40000, (i + 1) * 40000) }));
    };
    const parts = {};
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
      let bytesIn = 0, bytesOut = 0, lastMove = Date.now(), watching = false, lastTick = 0;
      const watchdog = setInterval(() => {
        if (watching && !finished && Date.now() - lastMove > 45000) fail(new Error('No data has moved for 45 seconds, so the transfer was stopped. The link between the devices is too slow or was interrupted. Keep both screens on, then try again — ideally with both devices on the same Wi-Fi. Anything already received was kept.'));
      }, 5000);
      let queue = Promise.resolve();

      const fail = (err) => { if (!finished) { finished = true; clearInterval(watchdog); reject(err); } };
      const maybeFinish = () => {
        if (!finished && peerDone && sentDone) { finished = true; clearInterval(watchdog); setTimeout(() => { try { dc.close(); } catch { /* ignore */ } }, 300); resolve(summary); }
      };
      const progress = () => onProgress({ got, expected, sent, toSend, bytesIn, bytesOut });
      const tick = () => { const now = Date.now(); if (now - lastTick > 250) { lastTick = now; progress(); } };

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
        watching = true; lastMove = Date.now();
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
            bytesOut += Math.min(Transfer.CHUNK, buf.byteLength - i); lastMove = Date.now(); tick();
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
          bytesIn += data.byteLength; lastMove = Date.now(); tick();
          return;
        }
        let msg = JSON.parse(data);
        if (msg.t === 'part') {
          const p = parts[msg.id] || (parts[msg.id] = { n: msg.n, got: 0, a: [] });
          p.a[msg.i] = msg.s; p.got++;
          bytesIn += msg.s.length; lastMove = Date.now(); tick();
          if (p.got < p.n) return;
          delete parts[msg.id];
          msg = JSON.parse(p.a.join(''));
        }
        lastMove = Date.now();
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
    const stops = [];      // relay-route listeners to stop when the sheet closes
    let expireTimer = null;
    const cleanup = () => { closed = true; clearTimeout(expireTimer); if (stopScan) stopScan(); peers.forEach((p) => { try { p.destroy(); } catch { /* ignore */ } }); stops.forEach((f) => { try { f(); } catch { /* ignore */ } }); backdrop.remove(); };
    const sheet = (html) => { backdrop.innerHTML = `<div class="modal-sheet xfer-sheet">${html}<p class="xfer-build">${typeof APP_VERSION_LABEL !== 'undefined' ? APP_VERSION_LABEL : 'Beta'} · build ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'}</p></div>`; };
    const bindCancel = () => backdrop.querySelectorAll('[data-xfer-cancel]').forEach((b) => b.addEventListener('click', cleanup));

    const progressHtml = () => `
      <h3>Transferring…</h3>
      <div class="xfer-bar"><div class="xfer-bar-fill" id="xfer-fill"></div></div>
      <p class="text-dim" id="xfer-text">Connecting…</p>
      <p class="text-dim" style="font-size:12px;">Keep both screens on and this page open until it finishes.</p>`;
    const runTransfer = async (dc, peer, status) => {
      sheet(progressHtml());
      let lock = null;
      try { if (navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); stops.push(() => { try { lock.release(); } catch { /* ignore */ } }); } } catch { /* optional */ }
      const mb = (n) => (n / 1048576).toFixed(1);
      if (status) { const t = backdrop.querySelector('#xfer-text'); if (t) t.textContent = status; }
      try {
        await Transfer._opened(dc, peer);
        const sum = await Transfer.exchange(dc, (p) => {
          const total = p.expected + p.toSend, done = p.got + p.sent;
          const fill = backdrop.querySelector('#xfer-fill'), text = backdrop.querySelector('#xfer-text');
          if (fill) fill.style.width = (total ? Math.round(100 * done / total) : 100) + '%';
          if (text) text.textContent = total ? `${done} of ${total} items · sent ${mb(p.bytesOut)} MB · received ${mb(p.bytesIn)} MB` : 'Comparing…';
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
    // For "could not reach the pairing service": check what is actually wrong first.
    const failNetwork = async (which, code) => {
      sheet(`<h3>Checking your connection…</h3><div class="xfer-bar"><div class="xfer-bar-fill" style="width:40%"></div></div>`);
      let why;
      try { why = await Transfer.diagnose(code); } catch { why = 'Could not check the connection.'; }
      if (closed) return;
      failScreen(why + (code ? `  (code: ${code}${typeof APP_VERSION !== 'undefined' ? ', build ' + APP_VERSION : ''})` : ''), which);
    };
    const failScreen = (msg, which) => {
      sheet(`<h3>Couldn't connect</h3><p>${esc(msg)}</p><button class="btn btn-primary btn-block" id="xfer-again">Try again</button><button class="btn btn-block mt8" data-xfer-cancel>Close</button>`);
      bindCancel();
      backdrop.querySelector('#xfer-again').addEventListener('click', () => (which === 'show' ? startShowCode() : startEnterCode()));
    };

    // The device that shows the code. Two routes listen at once: the PeerJS
    // pairing service, and the plain-HTTPS relay (for computers that block WebSockets).
    const startShowCode = (attempt = 0) => {
      peers.splice(0).forEach((p) => { try { p.destroy(); } catch { /* ignore */ } });
      stops.splice(0).forEach((f) => f());
      clearTimeout(expireTimer);
      const code = Transfer.newCode();
      let taken = false, shown = false, pjFailed = false, sigFailed = false;
      sheet('<h3>Show a code</h3><p class="text-dim">Getting a code…</p>');

      const showScreen = () => {
        if (shown || closed) return;
        shown = true;
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
          stops.splice(0).forEach((f) => f());
          sheet('<h3>Code expired</h3><p>Nobody entered it in time.</p><button class="btn btn-primary btn-block" id="xfer-newcode">Show a new code</button><button class="btn btn-block mt8" data-xfer-cancel>Close</button>');
          bindCancel();
          backdrop.querySelector('#xfer-newcode').addEventListener('click', () => startShowCode());
        }, Transfer.CODE_LIFETIME_MS);
      };
      const bothFailed = () => { if (pjFailed && sigFailed && !shown && !closed) failNetwork('show', 'network'); };

      const askAllow = (onAllow, onDeny) => {
        sheet(`
          <h3>Allow this device?</h3>
          <p>A device entered your code and wants to sync with this one. Only allow it if that was you.</p>
          <button class="btn btn-primary btn-block" id="xfer-allow">Yes, sync now</button>
          <button class="btn btn-block mt8" id="xfer-deny">No, that wasn't me</button>`);
        backdrop.querySelector('#xfer-deny').addEventListener('click', () => { onDeny(); cleanup(); });
        backdrop.querySelector('#xfer-allow').addEventListener('click', onAllow);
      };

      // The other device may reach us by either route (or both at once): ask once, then
      // race whatever arrives and use whichever link opens first.
      const cands = [];
      let allowed = false, asked = false, winner = null, failed = 0, deadline = null;
      const notes = [];
      const waitPj = (conn) => new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('direct link (route 1) did not open')), 45000);
        const ok = () => { clearTimeout(t); resolve({ dc: conn.dataChannel, pc: null, close: () => { try { conn.close(); } catch { /* ignore */ } } }); };
        if (conn.open) ok(); else { conn.on('open', ok); conn.on('error', (e) => { clearTimeout(t); reject(new Error('route 1: ' + (e.type || e.message))); }); conn.on('close', () => { clearTimeout(t); reject(new Error('route 1 closed')); }); }
      });
      const waitRelay = async (offer) => {
        const { pc, dcPromise } = await Transfer.signalAnswer(code, offer);
        try {
          const dc = await Promise.race([dcPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('route 2: the other device did not finish connecting.' + Transfer._iceInfo(pc))), 45000))]);
          await Transfer._opened(dc, pc, 45000);
          return { dc, pc, close: () => { try { pc.close(); } catch { /* ignore */ } } };
        } catch (e) { try { pc.close(); } catch { /* ignore */ } throw e; }
      };
      const startCand = (c) => {
        (c.kind === 'pj' ? waitPj(c.conn) : waitRelay(c.offer)).then((link) => {
          if (winner || closed) { link.close(); return; }
          winner = link; clearTimeout(deadline);
          cands.forEach((o) => { if (o !== c && o.kind === 'pj') { try { o.conn.close(); } catch { /* ignore */ } } });
          stops.splice(0).forEach((f) => f());
          runTransfer(link.dc, link.pc).catch(() => {});
        }).catch((e) => {
          notes.push(e.message || String(e)); failed++;
          if (!winner && !closed && failed >= 2) failScreen(notes.join(' · '), 'show');
        });
      };
      const allowNow = () => {
        allowed = true; sheet(progressHtml());
        { const el = backdrop.querySelector('#xfer-text'); if (el) el.textContent = 'Connecting…'; }
        cands.forEach(startCand);
        deadline = setTimeout(() => { if (!winner && !closed) failScreen((notes.join(' · ') || 'The other device did not finish connecting.'), 'show'); }, 60000);
      };
      const addCand = (c) => {
        cands.push(c); clearTimeout(expireTimer);
        if (allowed) { startCand(c); return; }
        if (!asked) { asked = true; askAllow(allowNow, () => { cands.forEach((o) => { if (o.kind === 'pj') { try { o.conn.close(); } catch { /* ignore */ } } }); }); }
      };

      // Route 1: PeerJS pairing service
      let peer = null;
      try { peer = Transfer.newPeer(Transfer.idForCode(code)); } catch { pjFailed = true; }
      if (peer) {
        peers.push(peer);
        peer.on('open', showScreen);
        peer.on('error', (e) => {
          if (closed || taken) return;
          if (e.type === 'unavailable-id' && attempt < 5) { startShowCode(attempt + 1); return; }
          pjFailed = true; bothFailed();
        });
        peer.on('connection', (conn) => {
          if (cands.some((c) => c.kind === 'pj')) { conn.close(); return; }   // one device per code
          taken = true;
          conn.on('open', () => { if (conn.dataChannel) { conn.dataChannel._early = []; conn.dataChannel.onmessage = (ev) => conn.dataChannel._early.push(ev.data); } });
          addCand({ kind: 'pj', conn });
        });
      }

      // Route 2: HTTPS relay
      let gotOffer = false;
      stops.push(Transfer._subscribe(code, {
        onOpen: () => showScreen(),
        onFail: () => { sigFailed = true; bothFailed(); },
        onMsg: (m) => {
          if (m.t !== 'offer' || gotOffer) return;
          gotOffer = true; taken = true;
          addCand({ kind: 'relay', offer: m });
        }
      }));
    };

    // The device that types (or scans) the code: tries BOTH routes at the same time (PeerJS pairing
    // service and the HTTPS relay) and uses whichever link opens first.
    const connectWithCode = (code) => {
      sheet(`<h3>Connecting…</h3><div class="xfer-bar"><div class="xfer-bar-fill" style="width:35%"></div></div><p class="text-dim" id="xfer-text">Looking for the other device… It will ask to <b>allow</b> this — tap <b>Yes, sync now</b> there.</p><button class="btn btn-ghost btn-block mt8" data-xfer-cancel>Cancel</button>`);
      bindCancel();
      let winner = null, failures = 0;
      const reasons = {};
      const finish = (link, route) => {
        if (winner || closed) { link.close(); return; }
        winner = link;
        runTransfer(link.dc, link.pc, 'Connected — waiting for the other device…').catch(() => {});
      };
      const failed = (route, e) => {
        reasons[route] = e;
        failures++;
        if (!winner && !closed && failures < 2 && route === 'pj') {
          const el = backdrop.querySelector('#xfer-text');
          if (el) el.textContent = ((e && e.type) === 'peer-unavailable' ? 'Not found on the main route — still trying the backup route… ' : 'Main route unavailable — still trying the backup route… ') + 'Check the code is showing on the other device and tap Yes, sync now there.';
        }
        if (winner || closed || failures < 2) return;
        const pjType = reasons.pj && (reasons.pj.type || reasons.pj.message);
        if (pjType === 'peer-unavailable') failScreen('No device is showing that code. Check the digits — or tap Show code again on the other device. (If it asked "Allow this device?", tap Yes within a minute.)', 'enter');
        else failNetwork('enter', pjType || (reasons.relay && reasons.relay.message) || 'network');
      };

      // Route 1: PeerJS pairing service
      (() => {
        let peer, connCreated = false, done = false;
        const fail = (e) => { if (done) return; done = true; failed('pj', e); };
        try { peer = Transfer.newPeer('wegfs-c-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')); }
        catch (e) { fail(e); return; }
        peers.push(peer);
        const timer = setTimeout(() => fail(new Error('timeout')), 60000);
        peer.on('error', (e) => {
          if (connCreated && e.type === 'network') return;   // signalling socket dropped mid-handshake: the link may still come up
          clearTimeout(timer); fail(e);
        });
        peer.on('open', () => {
          const conn = peer.connect(Transfer.idForCode(code), { reliable: true, serialization: 'raw' });
          connCreated = true;
          conn.on('open', () => { clearTimeout(timer); done = true; finish({ dc: conn.dataChannel, pc: null, close: () => { try { conn.close(); } catch { /* ignore */ } } }, 'pj'); });
          conn.on('error', (e) => { clearTimeout(timer); fail(e); });
          conn.on('close', () => { if (!winner) { clearTimeout(timer); fail(new Error('closed')); } });
        });
      })();

      // Route 2: HTTPS relay (no WebSocket needed)
      Transfer.signalConnect(code).then(async (l) => {
        try {
          await Transfer._opened(l.dc, l.pc, 45000);
          finish({ dc: l.dc, pc: l.pc, close: () => { try { l.pc.close(); } catch { /* ignore */ } } }, 'relay');
        } catch (e) { try { l.pc.close(); } catch { /* ignore */ } failed('relay', e); }
      }).catch((e) => failed('relay', e));
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
