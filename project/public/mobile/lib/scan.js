// Barcode scanner. Lazy-loaded by screens that need it. Uses @zxing/browser
// from an ESM CDN so no npm install / bundler is required. ~70KB gzipped.
//
// iOS Safari: camera permission prompts EVERY session even when installed
// as a PWA. Android Chrome persists the grant. Document this in onboarding.

let readerPromise = null;

async function getReader() {
  if (!readerPromise) {
    readerPromise = import('https://esm.sh/@zxing/browser@0.1.5')
      .then(mod => new mod.BrowserMultiFormatReader());
  }
  return readerPromise;
}

// Opens an in-DOM scan view. Returns a Promise resolving to the decoded
// string when the user successfully scans, or rejecting if they cancel.
// `onLookup` (optional) lets the caller pre-validate a decode (e.g. confirm
// the barcode exists in the equipment table) — return false to keep scanning.
export async function showScanner({ title = 'Scan barcode', onLookup } = {}) {
  return new Promise(async (resolve, reject) => {
    const root = document.createElement('div');
    root.className = 'scan';
    root.innerHTML = `
      <video autoplay playsinline muted></video>
      <div class="scan-overlay"><div class="reticle"></div></div>
      <div class="scan-footer">
        <div class="grow muted" style="color:#fff" data-status>${escapeHtml(title)}</div>
        <button class="btn secondary" data-cancel>Cancel</button>
      </div>
    `;
    document.body.appendChild(root);
    const video = root.querySelector('video');
    const status = root.querySelector('[data-status]');
    const cancelBtn = root.querySelector('[data-cancel]');

    let controls = null;
    let done = false;

    const cleanup = () => {
      done = true;
      try { controls?.stop(); } catch {}
      try { root.remove(); } catch {}
    };
    cancelBtn.onclick = () => { cleanup(); reject(new Error('cancelled')); };

    try {
      const reader = await getReader();
      // decodeFromVideoDevice with deviceId=undefined picks the first camera
      // matching the constraints. Some browsers ignore facingMode here, but
      // most phones default to the back camera anyway.
      controls = await reader.decodeFromVideoDevice(
        undefined, video,
        async (result, err) => {
          if (done) return;
          if (result) {
            const code = result.getText();
            status.textContent = 'Found: ' + code;
            if (onLookup) {
              const ok = await onLookup(code).catch(() => false);
              if (!ok) {
                status.textContent = 'Not recognized — keep scanning';
                return;
              }
            }
            cleanup();
            resolve(code);
          }
        }
      );
      // Request back camera explicitly via constraint override after start.
      // Some Androids honor this only post-getUserMedia.
      const tracks = video.srcObject?.getVideoTracks?.() || [];
      for (const t of tracks) {
        try { await t.applyConstraints({ facingMode: { ideal: 'environment' } }); } catch {}
      }
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
