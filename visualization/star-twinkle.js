// Makes the stars already painted into background.png twinkle.
// The PNG is analysed once: every local brightness peak that stands out from
// its surroundings becomes a star. Each star is then given a sparkle sprite and
// (often) a dimmer disc in the local sky colour. Stars are spread at random
// over animation groups with unrelated periods, so the sky never pulses in
// sync. Each group is pre-rendered into one transparent bitmap, so the map
// only animates the opacity of a handful of images instead of thousands of
// vector shapes.
const STAR_TWINKLE_GROUPS = 3;
const STAR_DIM_GROUPS = 1;
const STAR_MIN_LUMA = 120;
const STAR_MIN_CONTRAST = 55;
const STAR_MAX_COUNT = 24;
let starFieldPromise = null;

function detectBackgroundStars() {
  return starFieldPromise ||= new Promise(resolve => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const w = image.naturalWidth, h = image.naturalHeight;
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, w, h).data;
        const luma = new Float32Array(w * h);
        for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
          luma[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
        }
        const stars = [];
        const margin = 7, peakRadius = 3, ringRadius = 6;
        const ring = [];
        for (let a = 0; a < 16; a++) {
          const angle = a / 16 * Math.PI * 2;
          ring.push(Math.round(Math.sin(angle) * ringRadius) * w + Math.round(Math.cos(angle) * ringRadius));
        }
        for (let y = margin; y < h - margin; y++) {
          for (let x = margin; x < w - margin; x++) {
            const i = y * w + x, value = luma[i];
            if (value < STAR_MIN_LUMA) continue;
            let peak = true;
            for (let dy = -peakRadius; dy <= peakRadius && peak; dy++) {
              for (let dx = -peakRadius; dx <= peakRadius; dx++) {
                const other = luma[i + dy * w + dx];
                // Ties (saturated plateaus) resolve to the first pixel.
                if (other > value || (other === value && (dy < 0 || (dy === 0 && dx < 0)))) { peak = false; break; }
              }
            }
            if (!peak) continue;
            // Local sky: mean of the darker half of a ring around the peak.
            const samples = ring.map(offset => i + offset).sort((a, b) => luma[a] - luma[b]).slice(0, 8);
            let sky = 0, r = 0, g = 0, b = 0;
            for (const s of samples) { sky += luma[s]; r += data[s * 4]; g += data[s * 4 + 1]; b += data[s * 4 + 2]; }
            sky /= 8;
            if (value - sky < STAR_MIN_CONTRAST) continue;
            const half = sky + (value - sky) * 0.5;
            let area = 0;
            for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (luma[i + dy * w + dx] > half) area++;
            stars.push({
              x: x + 0.5, y: y + 0.5,
              radius: Math.max(0.75, Math.sqrt(area / Math.PI)),
              strength: Math.min(1, (value - sky) / 200),
              sky: `rgb(${Math.round(r / 8)},${Math.round(g / 8)},${Math.round(b / 8)})`
            });
          }
        }
        stars.sort((a, b) => b.strength * b.radius - a.strength * a.radius);
        resolve({ width: w, height: h, stars: stars.slice(0, STAR_MAX_COUNT) });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = chrome.runtime.getURL("visualization/assets/cosmic-background-v2.png");
  });
}

function createStarTwinkleLayer() {
  const layer = createSvgElement("svg");
  layer.setAttribute("class", "map-stars");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  layer.setAttribute("overflow", "hidden");
  layer.setAttribute("preserveAspectRatio", "xMidYMid slice");
  layer.setAttribute("data-map-background", "");
  positionMapBackground(layer);
  detectBackgroundStars().then(field => {
    if (field?.stars.length && layer.isConnected) populateStarLayer(layer, field);
  });
  return layer;
}

let starGroupImagesPromise = null;

function renderStarGroupImages(field) {
  return starGroupImagesPromise ||= (async () => {
    const random = (min, max) => min + Math.random() * (max - min);
    const makeCanvas = () => {
      const canvas = document.createElement("canvas");
      canvas.width = field.width; canvas.height = field.height;
      return canvas;
    };
    const sparkles = Array.from({ length: STAR_TWINKLE_GROUPS }, makeCanvas);
    const dims = Array.from({ length: STAR_DIM_GROUPS }, makeCanvas);
    for (const star of field.stars) {
      if (Math.random() < 0.65) {
        const context = dims[Math.floor(Math.random() * dims.length)].getContext("2d");
        context.fillStyle = star.sky;
        context.beginPath();
        context.arc(star.x, star.y, star.radius * 1.7 + 0.6, 0, Math.PI * 2);
        context.fill();
      }
      const context = sparkles[Math.floor(Math.random() * sparkles.length)].getContext("2d");
      const radius = star.radius * (2.2 + star.strength * 1.6);
      const glow = context.createRadialGradient(star.x, star.y, 0, star.x, star.y, radius);
      glow.addColorStop(0, "rgba(255,255,255,1)");
      glow.addColorStop(0.18, "rgba(244,242,255,.9)");
      glow.addColorStop(0.45, "rgba(201,212,255,.28)");
      glow.addColorStop(1, "rgba(159,178,255,0)");
      context.globalAlpha = 0.45 + star.strength * 0.55;
      context.fillStyle = glow;
      context.fillRect(star.x - radius, star.y - radius, radius * 2, radius * 2);
      // The brightest stars also flash short diffraction spikes.
      if (star.strength > 0.8 && star.radius > 1.4) {
        const length = star.radius * 7, width = Math.max(0.45, star.radius * 0.32);
        for (const angle of [0, Math.PI / 2]) {
          context.save();
          context.translate(star.x, star.y);
          context.rotate(angle);
          context.scale(1, width / length);
          const spike = context.createRadialGradient(0, 0, 0, 0, 0, length);
          spike.addColorStop(0, "rgba(255,255,255,.95)");
          spike.addColorStop(0.35, "rgba(223,229,255,.25)");
          spike.addColorStop(1, "rgba(223,229,255,0)");
          context.fillStyle = spike;
          context.fillRect(-length, -length, length * 2, length * 2);
          context.restore();
        }
      }
      context.globalAlpha = 1;
    }
    const toUrl = canvas => new Promise(resolve => canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null)));
    const describe = (canvases, className, minDuration, maxDuration) => Promise.all(canvases.map(async canvas => {
      const duration = random(minDuration, maxDuration);
      return { url: await toUrl(canvas), className, duration, delay: -random(0, duration) };
    }));
    const groups = [...await describe(dims, "star-dim", 18, 30), ...await describe(sparkles, "star-sparkle", 16, 28)];
    return groups.filter(group => group.url);
  })();
}

async function populateStarLayer(layer, field) {
  const groups = await renderStarGroupImages(field);
  if (!layer.isConnected) return;
  layer.setAttribute("viewBox", `0 0 ${field.width} ${field.height}`);
  for (const group of groups) {
    const image = createSvgElement("image");
    image.setAttribute("href", group.url);
    image.setAttribute("width", field.width);
    image.setAttribute("height", field.height);
    image.setAttribute("class", group.className);
    image.style.setProperty("--star-duration", `${group.duration.toFixed(2)}s`);
    image.style.setProperty("--star-delay", `${group.delay.toFixed(2)}s`);
    layer.appendChild(image);
  }
}
