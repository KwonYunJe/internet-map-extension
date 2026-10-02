// Zoom the shared SVG coordinate system, including background and refraction.
// Existing getScreenCTM-based hit testing therefore stays aligned.
let mapZoomFrame = null;
let mapZoomTarget = {x:0,y:0,width:1200,height:700};
let mapPan = null;
const BACKGROUND_PARALLAX = 0.3;

function positionMapBackground(image) {
  const box = svg.viewBox.baseVal;
  const ratio = box.width / WIDTH;
  const scale = BACKGROUND_PARALLAX + (1 - BACKGROUND_PARALLAX) * ratio;
  image.setAttribute("x", (1-BACKGROUND_PARALLAX)*box.x);
  image.setAttribute("y", (1-BACKGROUND_PARALLAX)*box.y);
  image.setAttribute("width", WIDTH*scale);
  image.setAttribute("height", HEIGHT*scale);
}

function applyMapView(box) {
  svg.setAttribute("viewBox", [box.x,box.y,box.width,box.height].join(" "));
  // Match every refracted copy to the distant background's world coordinates.
  svg.querySelectorAll("[data-map-background]").forEach(positionMapBackground);
}

function resetMapZoom() {
  cancelAnimationFrame(mapZoomFrame);
  mapZoomFrame = null;
  mapZoomTarget = {x:0,y:0,width:WIDTH,height:HEIGHT};
  applyMapView(mapZoomTarget);
}

function initializeMapZoom() {
  resetMapZoom();
  svg.addEventListener("pointerdown", event => {
    if (event.button !== 0 || svg.viewBox.baseVal.width >= WIDTH) return;
    cancelAnimationFrame(mapZoomFrame);
    mapZoomFrame = null;
    const box = svg.viewBox.baseVal, matrix = svg.getScreenCTM();
    if (!matrix) return;
    mapZoomTarget = {x:box.x,y:box.y,width:box.width,height:box.height};
    mapPan = {id:event.pointerId, clientX:event.clientX, clientY:event.clientY,
      box:{...mapZoomTarget}, unitsX:1/matrix.a, unitsY:1/matrix.d, moved:false};
    svg.setPointerCapture(event.pointerId);
  }, true);
  svg.addEventListener("pointermove", event => {
    if (!mapPan || mapPan.id !== event.pointerId) return;
    const dx = event.clientX-mapPan.clientX, dy = event.clientY-mapPan.clientY;
    if (!mapPan.moved && Math.hypot(dx,dy)<4) return;
    mapPan.moved = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    svg.onpointerleave?.();
    svg.style.cursor = "grabbing";
    const box = mapPan.box;
    mapZoomTarget = {...box,
      x:Math.max(0,Math.min(WIDTH-box.width,box.x-dx*mapPan.unitsX)),
      y:Math.max(0,Math.min(HEIGHT-box.height,box.y-dy*mapPan.unitsY))};
    applyMapView(mapZoomTarget);
  }, true);
  function endPan(event) {
    if (!mapPan || mapPan.id !== event.pointerId) return;
    const moved = mapPan.moved;
    mapPan = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    svg.style.cursor = "default";
    if (moved || event.type !== "pointerup") {
      svg.onpointerleave?.();
      event.stopImmediatePropagation();
    }
  }
  svg.addEventListener("pointerup", endPan, true);
  svg.addEventListener("pointercancel", endPan, true);
  svg.addEventListener("lostpointercapture", endPan, true);
  svg.addEventListener("wheel", event => {
    if (!Number.isFinite(event.deltaY) || !event.deltaY) return;
    event.preventDefault();
    if (mapPan) return;
    const point = getSvgPointerPosition(event);
    if (!point) return;
    svg.onpointerleave?.();
    const box = svg.viewBox.baseVal;
    const start = {x:box.x,y:box.y,width:box.width,height:box.height};
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1;
    const delta = Math.max(-100, Math.min(100, event.deltaY * unit));
    const scale = Math.max(1, Math.min(3, WIDTH / mapZoomTarget.width * Math.exp(-delta * 0.002)));
    const width = WIDTH / scale, height = HEIGHT / scale;
    const fx = Math.max(0, Math.min(1, (point.x - start.x) / start.width));
    const fy = Math.max(0, Math.min(1, (point.y - start.y) / start.height));
    mapZoomTarget = {
      x:Math.max(0, Math.min(WIDTH-width, point.x-fx*width)),
      y:Math.max(0, Math.min(HEIGHT-height, point.y-fy*height)),
      width,height
    };
    cancelAnimationFrame(mapZoomFrame);
    const target = {...mapZoomTarget};
    const begin = performance.now();
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220;
    function animateZoom(now) {
      const t = duration ? Math.min(1, (now-begin)/duration) : 1;
      const eased = 1 - (1-t) ** 3;
      const values = Object.fromEntries(["x","y","width","height"].map(key => [key, start[key] + (target[key]-start[key])*eased]));
      applyMapView(values);
      mapZoomFrame = t < 1 ? requestAnimationFrame(animateZoom) : null;
    }
    mapZoomFrame = requestAnimationFrame(animateZoom);
  }, {passive:false});
  window.addEventListener("pagehide", () => cancelAnimationFrame(mapZoomFrame));
}
