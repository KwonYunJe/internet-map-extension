(function () {
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
  const MAX_DEVICE_PIXEL_RATIO = 1.5;
  const DEFAULT_WIDTH = 1200;
  const DEFAULT_HEIGHT = 700;

  const TEXTURE_WIDTH = 256;
  const TEXTURE_HEIGHT = 64;

  function createTextureCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = TEXTURE_WIDTH;
    canvas.height = TEXTURE_HEIGHT;

    const context = canvas.getContext("2d");
    context.fillStyle = "#244984";
    context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

    let seed = 421;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let index = 0; index < 24; index += 1) {
      const x = random() * TEXTURE_WIDTH;
      const y = random() * TEXTURE_HEIGHT;
      const radius = 12 + random() * 35;
      const glow = context.createRadialGradient(x, y, 0, x, y, radius);

      glow.addColorStop(
        0,
        index % 2
          ? "rgba(174,139,255,.68)"
          : "rgba(125,225,255,.56)"
      );
      glow.addColorStop(1, "rgba(50,70,150,0)");

      context.fillStyle = glow;
      context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    }

    for (let index = 0; index < 128; index += 1) {
      const alpha = 0.9 + random() * 0.1;
      const x = Math.floor(random() * TEXTURE_WIDTH);
      const y = Math.floor(random() * TEXTURE_HEIGHT);
      const size = random() > 0.78 ? 2 : 1;

      context.fillStyle = `rgba(255,255,255,${alpha})`;
      context.fillRect(x, y, size, size);
    }

    return canvas;
  }

  function getViewBoxSize(svg) {
    const viewBox = svg.viewBox?.baseVal;

    return {
      width:
        typeof WIDTH === "number"
          ? WIDTH
          : viewBox?.width || DEFAULT_WIDTH,
      height:
        typeof HEIGHT === "number"
          ? HEIGHT
          : viewBox?.height || DEFAULT_HEIGHT
    };
  }

  function createCanvasHost(svg, width, height) {
    const host = document.createElementNS(SVG_NAMESPACE, "foreignObject");
    host.setAttribute("x", "0");
    host.setAttribute("y", "0");
    host.setAttribute("width", String(width));
    host.setAttribute("height", String(height));
    host.setAttribute("pointer-events", "none");
    host.setAttribute("class", "edge-canvas-host");

    const canvas = document.createElementNS(HTML_NAMESPACE, "canvas");
    canvas.setAttribute("class", "edge-canvas");
    canvas.style.display = "block";
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.pointerEvents = "none";
    host.appendChild(canvas);

    return { host, canvas };
  }

  function getNodePoint(pair, reverse) {
    const source = reverse ? pair.nodeB : pair.nodeA;
    const target = reverse ? pair.nodeA : pair.nodeB;

    return {
      sourceX: source?.renderX ?? source?.screenX ?? 0,
      sourceY: source?.renderY ?? source?.screenY ?? 0,
      targetX: target?.renderX ?? target?.screenX ?? 0,
      targetY: target?.renderY ?? target?.screenY ?? 0
    };
  }

  function getGroupClass(pair) {
    return pair.groupElement?.getAttribute("class") || "";
  }

  function getGroupOpacity(pair) {
    const raw = pair.groupElement?.style?.opacity;
    const value = raw === "" ? 1 : Number(raw);

    return Number.isFinite(value) ? value : 1;
  }

  function getMaterial(pair) {
    const className = getGroupClass(pair);
    const opacity = getGroupOpacity(pair);

    if (className.includes("dimmed")) {
      return {
        alpha: 0.13 * opacity,
        halo: 0.12 * opacity,
        outerHalo: 0.04 * opacity,
        texture: 0.2 * opacity,
        selected: false
      };
    }

    const selected =
      className.includes("edge-highlight") ||
      className.includes("edge-hovered");

    return {
      alpha: (selected ? 0.92 : 0.62) * opacity,
      halo: (selected ? 0.46 : 0.28) * opacity,
      outerHalo: (selected ? 0.24 : 0.12) * opacity,
      texture: (selected ? 0.58 : 0.42) * opacity,
      selected
    };
  }

  function createGradient(context, pair, reverse, cache) {
    const { sourceX, sourceY, targetX, targetY } = getNodePoint(pair, reverse);
    const key = [
      reverse ? "r" : "f",
      sourceX,
      sourceY,
      targetX,
      targetY
    ].join(",");
    const cached = cache.get(key);

    if (cached) {
      return cached;
    }

    const gradient = context.createLinearGradient(
      sourceX,
      sourceY,
      targetX,
      targetY
    );

    if (reverse) {
      gradient.addColorStop(0, "rgba(103,229,255,1)");
      gradient.addColorStop(0.5, "rgba(118,138,255,1)");
      gradient.addColorStop(1, "rgba(210,155,255,1)");
    } else {
      gradient.addColorStop(0, "rgba(89,139,255,1)");
      gradient.addColorStop(0.48, "rgba(170,134,255,1)");
      gradient.addColorStop(1, "rgba(103,229,255,1)");
    }

    cache.set(key, gradient);

    return gradient;
  }

  function makeSignature(pairs, width, height, ratio) {
    const parts = [width, height, ratio];

    for (const pair of pairs) {
      parts.push(
        pair.geometryKey || "",
        getGroupClass(pair),
        pair.groupElement?.style?.opacity || "",
        pair.aToBElement?.getAttribute("d") || "",
        pair.bToAElement?.getAttribute("d") || ""
      );
    }

    return parts.join("|");
  }

  function createPath(cache, usedPaths, description) {
    if (!description) return null;

    let path = cache.get(description);

    if (!path) {
      try {
        path = new Path2D(description);
        cache.set(description, path);
      } catch {
        path = null;
      }
    }

    if (path) {
      usedPaths.add(description);
    }

    return path;
  }

  function drawRibbon(context, path, pair, reverse, pattern, material, gradientCache) {
    if (!path || material.alpha <= 0) return;

    const gradient = createGradient(context, pair, reverse, gradientCache);

    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = material.outerHalo;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = material.selected ? 13 : 8;
    context.strokeStyle = gradient;
    context.stroke(path);
    context.fillStyle = gradient;
    context.fill(path);
    context.restore();

    context.save();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = material.halo;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = material.selected ? 5 : 3;
    context.strokeStyle = gradient;
    context.stroke(path);
    context.fillStyle = gradient;
    context.fill(path);
    context.restore();

    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = material.alpha;
    context.fillStyle = gradient;
    context.fill(path);
    context.restore();

    if (pattern) {
      context.save();
      context.globalCompositeOperation = "screen";
      context.globalAlpha = material.texture;
      context.fillStyle = pattern;
      context.fill(path);
      context.restore();
    }
  }

  function createEdgeCanvasLayer(svg, edgeLayer, pairs) {
    const { width, height } = getViewBoxSize(svg);
    const ratio = Math.min(
      MAX_DEVICE_PIXEL_RATIO,
      Math.max(1, window.devicePixelRatio || 1)
    );
    const { host, canvas } = createCanvasHost(svg, width, height);
    const context = canvas.getContext("2d", { alpha: true });
    const cacheCanvas = document.createElement("canvas");
    const cacheContext = cacheCanvas.getContext("2d", { alpha: true });
    const textureCanvas = createTextureCanvas();
    const pathCache = new Map();
    const gradientCache = new Map();

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    cacheCanvas.width = canvas.width;
    cacheCanvas.height = canvas.height;
    canvas.dataset.edgeCanvasRatio = String(ratio);
    canvas.dataset.edgeCanvasDraws = "0";

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    cacheContext.setTransform(ratio, 0, 0, ratio, 0, 0);

    edgeLayer.style.visibility = "hidden";
    svg.insertBefore(host, edgeLayer);

    let lastSignature = "";
    let destroyed = false;

    function clear(target) {
      target.save();
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.clearRect(0, 0, canvas.width, canvas.height);
      target.restore();
    }

    function render() {
      clear(cacheContext);
      gradientCache.clear();
      const usedPaths = new Set();

      const pattern = cacheContext.createPattern(textureCanvas, "repeat");

      for (const pair of pairs) {
        const material = getMaterial(pair);
        const forwardPath = createPath(
          pathCache,
          usedPaths,
          pair.aToBElement?.getAttribute("d") || ""
        );
        const reversePath = createPath(
          pathCache,
          usedPaths,
          pair.bToAElement?.getAttribute("d") || ""
        );

        drawRibbon(
          cacheContext,
          forwardPath,
          pair,
          false,
          pattern,
          material,
          gradientCache
        );
        drawRibbon(
          cacheContext,
          reversePath,
          pair,
          true,
          pattern,
          material,
          gradientCache
        );
      }

      for (const key of pathCache.keys()) {
        if (!usedPaths.has(key)) {
          pathCache.delete(key);
        }
      }

      clear(context);
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(cacheCanvas, 0, 0);
      context.restore();

      canvas.dataset.edgeCanvasDraws = String(
        Number(canvas.dataset.edgeCanvasDraws || "0") + 1
      );
    }

    function update() {
      if (destroyed) return;

      const signature = makeSignature(pairs, width, height, ratio);

      if (signature === lastSignature) {
        return;
      }

      lastSignature = signature;
      render();
    }

    function destroy() {
      destroyed = true;
      edgeLayer.style.visibility = "";
      host.remove();
      pathCache.clear();
    }

    update();

    return {
      update,
      destroy
    };
  }

  window.createEdgeCanvasLayer = createEdgeCanvasLayer;
})();
