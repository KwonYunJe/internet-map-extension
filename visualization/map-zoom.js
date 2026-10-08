// Zoom the shared SVG coordinate system, including background and refraction.
// Existing getScreenCTM-based hit testing therefore stays aligned.
let mapZoomFrame = null;
let mapZoomTarget = {x:0,y:0,width:1200,height:700};
let mapPan = null;
const BACKGROUND_PARALLAX = 0.3;
const skyPointer = {x: 0, y: 0, targetX: 0, targetY: 0, frame: null};
const skyMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
skyMotionQuery.addEventListener("change", event => {
  if (event.matches) targetSkyPointer(0, 0);
});

function easeSkyPointer() {
  const reduced = skyMotionQuery.matches;
  if (reduced) skyPointer.targetX = skyPointer.targetY = 0;
  skyPointer.x += (skyPointer.targetX - skyPointer.x) * (reduced ? 1 : 0.07);
  skyPointer.y += (skyPointer.targetY - skyPointer.y) * (reduced ? 1 : 0.07);
  positionMapBackgrounds();
  if (Math.abs(skyPointer.x - skyPointer.targetX) + Math.abs(skyPointer.y - skyPointer.targetY) > 0.02) {
    skyPointer.frame = requestAnimationFrame(easeSkyPointer);
  } else skyPointer.frame = null;
}

function targetSkyPointer(x, y) {
  skyPointer.targetX = x; skyPointer.targetY = y;
  if (skyPointer.frame == null) skyPointer.frame = requestAnimationFrame(easeSkyPointer);
}

function mapBackgroundBounds() {
  const box = svg.viewBox.baseVal;
  const ratio = box.width / WIDTH;
  const scale = BACKGROUND_PARALLAX + (1 - BACKGROUND_PARALLAX) * ratio;
  // SVG meet keeps nodes circular; extend the shared background into any
  // letterbox area created by a responsive frame with a different aspect ratio.
  const width = svg.clientWidth, height = svg.clientHeight;
  const pixelsPerUnit = Math.min(width/box.width, height/box.height);
  const extraX = pixelsPerUnit > 0 ? Math.max(0,width/pixelsPerUnit-box.width) : 0;
  const extraY = pixelsPerUnit > 0 ? Math.max(0,height/pixelsPerUnit-box.height) : 0;
  const margin = pixelsPerUnit > 0 ? 8 / pixelsPerUnit : 0;
  return {x:(1-BACKGROUND_PARALLAX)*box.x-extraX/2-margin + skyPointer.x / (pixelsPerUnit || 1),
    y:(1-BACKGROUND_PARALLAX)*box.y-extraY/2-margin + skyPointer.y / (pixelsPerUnit || 1),
    width:WIDTH*scale+extraX+margin*2, height:HEIGHT*scale+extraY+margin*2};
}

function positionMapBackground(image, bounds = mapBackgroundBounds()) {
  for (const [name, value] of Object.entries(bounds)) {
    const text = String(value);
    if (image.getAttribute(name) !== text) image.setAttribute(name, text);
  }
}

function positionMapBackgrounds() {
  // Read layout once, before writes to any of the refraction copies.
  const bounds = mapBackgroundBounds();
  svg.querySelectorAll("[data-map-background]").forEach(image => positionMapBackground(image, bounds));
}

function applyMapView(box) {
  svg.setAttribute("viewBox", [box.x,box.y,box.width,box.height].join(" "));
  // Match every refracted copy to the distant background's world coordinates.
  positionMapBackgrounds();
}

function resetMapZoom() {
  cancelAnimationFrame(mapZoomFrame);
  mapZoomFrame = null;
  mapZoomTarget = {x:0,y:0,width:WIDTH,height:HEIGHT};
  applyMapView(mapZoomTarget);
}

function initializeMapZoom() {
  resetMapZoom();
  svg.addEventListener("pointermove", event => {
    if (event.pointerType === "touch" || mapPan || event.buttons ||
        skyMotionQuery.matches) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    targetSkyPointer(Math.max(-5, Math.min(5, ((event.clientX-rect.left)/rect.width-.5)*10)),
      Math.max(-5, Math.min(5, ((event.clientY-rect.top)/rect.height-.5)*10)));
  });
  svg.addEventListener("pointerleave", () => targetSkyPointer(0, 0));
  svg.addEventListener("pointerdown", () => {
    cancelAnimationFrame(skyPointer.frame); skyPointer.frame = null;
    skyPointer.targetX = skyPointer.x; skyPointer.targetY = skyPointer.y;
  });
  const frameObserver = new ResizeObserver(() => {
    positionMapBackgrounds();
  });
  frameObserver.observe(svg);
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
