// camera.js — captures pre/post work photos.
// Uses a plain <input type="file" accept="image/*" multiple> (see pickPhotos), optionally with a
// capture="environment" hint. That hint is what makes the difference:
// present, most mobile browsers open the native camera app directly; absent,
// they open the normal file/photo picker (gallery, Files, cloud drives, and
// usually still a camera option too). No getUserMedia permission prompts
// either way — the most reliable approach for a field PWA. Images are
// downscaled on a canvas before saving so a full day of photos doesn't blow
// up IndexedDB / mobile storage.

const Camera = {
  MAX_DIM: 2048,     // longest edge, px
  JPEG_QUALITY: 0.9,

  // source: 'camera' opens the device camera directly; 'gallery' (default)
  // opens the normal photo/file picker. Resolves with a compressed Blob, or
  // null if the user cancelled without picking anything.
  capture(source = 'gallery') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (source === 'camera') input.capture = 'environment';
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);

      const cleanup = () => input.remove();

      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) { cleanup(); resolve(null); return; }
        try {
          const blob = await Camera._resize(file);
          cleanup();
          resolve(blob);
        } catch (err) {
          console.error('Photo processing failed', err);
          cleanup();
          resolve(file); // fall back to the original file rather than losing the photo
        }
      }, { once: true });

      // If the user backs out of the camera without picking anything, most
      // browsers never fire 'change'; there's no reliable cancel event, so we
      // just leave the (invisible) input in the DOM until 'change' fires or
      // the view is torn down.
      input.click();
    });
  },

  // The single "Upload" entry point used everywhere in the app. Opens the
  // device's own picker (no `capture` hint), which on an iPhone offers Photo
  // Library / Take Photo / Choose File and, with `multiple`, lets several
  // photos be selected from the library at once. Resolves with an array of
  // compressed Blobs (empty if the user cancelled).
  pickPhotos() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);

      input.addEventListener('change', async () => {
        const files = Array.from(input.files || []);
        input.remove();
        const blobs = [];
        // One at a time, so a big batch doesn't hold every full-size photo in memory at once.
        for (const file of files) {
          try { blobs.push(await Camera._resize(file)); }
          catch (err) {
            console.error('Photo processing failed', err);
            blobs.push(file); // keep the original rather than losing the photo
          }
        }
        resolve(blobs);
      }, { once: true });

      input.click();
    });
  },

  _resize(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, Camera.MAX_DIM / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);

        canvas.toBlob((blob) => {
          if (blob) resolve(blob); else reject(new Error('toBlob failed'));
        }, 'image/jpeg', Camera.JPEG_QUALITY);
      };
      img.onerror = reject;
      img.src = url;
    });
  }
};

window.Camera = Camera;
