// Deterministic optical displacement fields, not painted scene textures.
// f(u)=u*(0.5+0.5*u²): magnification at the center, compression near
// the boundary, and zero displacement exactly at the boundary.
function lensSample(u) { return u * (0.5 + 0.5 * u * u); }

function encodeLensField(size, sample) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [dx, dy] = sample((x + 0.5) / size, (y + 0.5) / size);
    const i = (y * size + x) * 4;
    pixels.data[i] = Math.round(Math.max(0, Math.min(1, 0.5 + dx)) * 255);
    pixels.data[i + 1] = Math.round(Math.max(0, Math.min(1, 0.5 + dy)) * 255);
    pixels.data[i + 2] = 128;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}

let circularLensMap;
function getCircularLensMap() {
  return circularLensMap ||= encodeLensField(384, (x, y) => {
    const dx = x - 0.5, dy = y - 0.5;
    const radius = Math.hypot(dx, dy) * 2;
    if (radius >= 1) return [0, 0];
    const factor = 0.5 * (radius * radius - 1);
    return [dx * factor, dy * factor];
  });
}

function createLensSurface(defs, id) {
  const clip = createSvgElement("clipPath");
  clip.id = `${id}-clip`;
  clip.setAttribute("clipPathUnits", "userSpaceOnUse");
  const shape = createSvgElement("path");
  clip.appendChild(shape);
  const filter = createSvgElement("filter");
  filter.id = `${id}-filter`;
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("primitiveUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const map = createSvgElement("feImage");
  map.setAttribute("preserveAspectRatio", "none");
  map.setAttribute("result", "lensField");
  const smoothing = createSvgElement("feGaussianBlur");
  smoothing.setAttribute("in", "lensField");
  smoothing.setAttribute("stdDeviation", "0.004");
  smoothing.setAttribute("edgeMode", "duplicate");
  smoothing.setAttribute("result", "smoothLensField");
  const displacement = createSvgElement("feDisplacementMap");
  displacement.setAttribute("in", "SourceGraphic");
  displacement.setAttribute("in2", "smoothLensField");
  displacement.setAttribute("xChannelSelector", "R");
  displacement.setAttribute("yChannelSelector", "G");
  filter.append(map, smoothing, displacement);
  for (const element of [filter, map]) {
    for (const [key, value] of Object.entries({x:0,y:0,width:1,height:1})) element.setAttribute(key,value);
  }
  displacement.setAttribute("scale", "1");
  defs.append(clip, filter);
  const group = createSvgElement("g");
  group.setAttribute("clip-path", `url(#${clip.id})`);
  group.setAttribute("pointer-events", "none");
  const image = createMapBackgroundImage();
  const content = createSvgElement("g");
  content.setAttribute("class", "lens-filter-content");
  content.setAttribute("filter", `url(#${filter.id})`);
  content.appendChild(image);
  group.appendChild(content);
  return {group, image, shape, filter, map, displacement, overlays: []};
}

function setLensBounds(surface, bounds) {
  // Keep the filter raster in a stationary unit square. Only the scene beneath
  // it moves; fractional world-space filter bounds caused visible raster jitter.
  const {x,y,width:w,height:h} = bounds;
  surface.group.setAttribute("transform", `matrix(${w} 0 0 ${h} ${x} ${y})`);
  const inverse = `matrix(${1/w} 0 0 ${1/h} ${-x/w} ${-y/h})`;
  for (const element of [surface.image, surface.shape, ...surface.overlays]) element.setAttribute("transform", inverse);
}

function updateNodeLens(node) {
  const surface = node.lensSurface;
  if (!surface) return;
  const x = node.renderX ?? node.screenX, y = node.renderY ?? node.screenY;
  const r = node.renderRadius ?? node.screenRadius;
  surface.shape.setAttribute("d", `M ${x-r} ${y} a ${r} ${r} 0 1 0 ${2*r} 0 a ${r} ${r} 0 1 0 ${-2*r} 0`);
  setLensBounds(surface, {x:x-r,y:y-r,width:r*2,height:r*2});
  if (!surface.map.hasAttribute("href")) surface.map.setAttribute("href", getCircularLensMap());
  const dimmed = node.domGroup.classList.contains("dimmed") && !node.hovered;
  surface.group.setAttribute("opacity", dimmed ? "0.09" : "1");
}

function updateBridgeLens(pair) {
  const surface = pair.lensSurface;
  const d = pair.gelElement.getAttribute("d") || "";
  surface.shape.setAttribute("d", d);
  pair.glassElement.setAttribute("d", d);
  pair.reflectionElement.setAttribute("d", d);
  pair.shadowElement.setAttribute("d", d);
  if (!d || !pair.gelElement.closest(".edge-highlight")) return;
  const box = pair.gelElement.getBBox();
  if (box.width < 1 || box.height < 1) return;
  const bounds = {x:box.x-2,y:box.y-2,width:box.width+4,height:box.height+4};
  setLensBounds(surface, bounds);
  // Reuse the normalized field throughout wobble/hover motion. Replacing PNGs
  // every 120ms made the optical surface jump between asynchronously decoded maps.
  if (surface.map.hasAttribute("href")) return;
  const a = pair.nodeA, b = pair.nodeB;
  const ax = a.renderX ?? a.screenX, ay = a.renderY ?? a.screenY;
  const bx = b.renderX ?? b.screenX, by = b.renderY ?? b.screenY;
  const distance = Math.hypot(bx-ax, by-ay);
  const ux=(bx-ax)/distance, uy=(by-ay)/distance;
  const total = pair.gelElement.getTotalLength();
  const polygon = Array.from({length:97}, (_,i) => {
    const p=pair.gelElement.getPointAtLength(total*i/96);
    return {x:(p.x-ax)*ux+(p.y-ay)*uy,y:-(p.x-ax)*uy+(p.y-ay)*ux};
  });
  // Cross-sections follow the actual merged outline, including asymmetric bends.
  const sections=Array.from({length:129},(_,i)=>{
    const x=distance*i/128, hits=[];
    for(let j=1;j<polygon.length;j++) {
      const p=polygon[j-1],q=polygon[j];
      if((p.x<=x&&q.x>x)||(q.x<=x&&p.x>x)) hits.push(p.y+(q.y-p.y)*(x-p.x)/(q.x-p.x));
    }
    return hits.length>=2 ? [Math.min(...hits),Math.max(...hits)] : null;
  });
  if (distance < 1) return;
  surface.map.setAttribute("href",encodeLensField(384,(x,y)=>{
    const wx=bounds.x+x*bounds.width-ax, wy=bounds.y+y*bounds.height-ay;
    const t=(wx*ux+wy*uy)/distance*128;
    if(t<0||t>=128)return [0,0];
    const left=sections[Math.floor(t)],right=sections[Math.ceil(t)];
    if(!left||!right)return [0,0];
    const f=t-Math.floor(t),lo=left[0]*(1-f)+right[0]*f,hi=left[1]*(1-f)+right[1]*f;
    const half=(hi-lo)/2,center=(hi+lo)/2,v=-wx*uy+wy*ux;
    if(half<0.5)return [0,0];
    const u=(v-center)/half;
    if(Math.abs(u)>=1)return [0,0];
    const delta=(lensSample(u)-u)*half;
    return [-uy*delta/bounds.width,ux*delta/bounds.height];
  }));
}
