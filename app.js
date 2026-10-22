(function () {
  "use strict";
  const M = window.IpadModel;
  const $ = id => document.getElementById(id);
  let data;
  let blocked = false;
  let tool = "pen";
  let gesture = null;
  let redo = [];
  let undo = [];
  let frame = null;
  let livePoints = 0;
  let renderedWidth = 0;
  let renderedHeight = 0;
  let selection = null;
  let inkClipboard = { strokes: [], blocks: [] };
  let longPressTimer = null;
  let longPressOrigin = null;
  const boundsCache = new WeakMap();
  const touches = new Map();
  let pinch = null;
  let pdfImages = [];
  let pdfGeneration = 0;
  const emptyDiagnostics = () => ({ pen: 0, touch: 0, mouse: 0, other: 0, ignored: 0, cancelled: 0, last: "-", recent: [] });
  let diagnostics = emptyDiagnostics();

  function report(error) {
    console.error("iPad Werkplek:", error);
    $("error").hidden = false;
    $("error").textContent = error.message || String(error);
  }

  // Na een penstreek niet meteen alles wegschrijven maar 1 seconde bundelen: dat haalt de
  // hapering weg bij de volgende letter. persist() zelf (en verbergen/sluiten van de app)
  // schrijft altijd meteen alles wat nog openstaat.
  let persistTimer = null;
  function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = null; persist(); }, 1000);
  }

  function persist() {
    clearTimeout(persistTimer);
    persistTimer = null;
    if (blocked) return false;
    try {
      window.WorkplaceStore.save(JSON.stringify(M.validate(data)));
      $("save-status").textContent = "Opgeslagen op dit apparaat.";
      window.WorkplaceSync?.markDirty();
      return true;
    } catch (error) {
      $("save-status").textContent = "Niet opgeslagen! Download een back-up.";
      report(error);
      return false;
    }

  }

  function active() { return data.documents.find(doc => doc.id === data.activeId); }
  function isMeasurement(doc = active()) { return !!doc.formType; }

  function context(id) {
    const ctx = $(id).getContext("2d");
    if (!ctx) throw new Error("Canvas tekenen is niet beschikbaar in deze browser.");
    return ctx;
  }

  function clear(id) {
    const ctx = context(id);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, $(id).width, $(id).height);
  }

  function strokeBounds(stroke) {
    let bounds = boundsCache.get(stroke);
    if (!bounds) {
      bounds = M.strokeBounds(stroke);
      boundsCache.set(stroke, bounds);
    }
    return bounds;
  }

  function worldContext(id) {
    const ctx = context(id);
    const rect = $("drawing").getBoundingClientRect();
    const ratio = $(id).width / rect.width;
    const { x, y, scale } = active().view;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, -x * ratio * scale, -y * ratio * scale);
    return ctx;
  }

  // ---- Inkt (v24.4): vloeiende bochten en dikte per punt ----
  // Bochten: een kwadratische curve door de middens van de punten, met het punt zelf als
  // stuurpunt. Dikte: elk penpunt heeft een factor w (snelheid/druk); de streek wordt dan
  // getekend als een aaneenschakeling van "capsules" (twee cirkels plus hun raaklijnen) in
  // één gevuld pad. Zo zijn er geen knikjes of gaten, ook niet in scherpe haarspeldbochten.
  const inkCache = new WeakMap();
  const smoothBrush = brush => brush === "pen" || brush === "fineliner" || brush === "marker";

  // Punten (met w) langs de vloeiende curve, fijn genoeg om als rechte stukjes te tekenen.
  function densify(points) {
    const out = [points[0]];
    const w = p => p.w || 1;
    const push = (x, y, width) => out.push({ x, y, w: width });
    const n = points.length - 1;
    for (let i = 1; i < n; i++) {
      const a = points[i - 1], b = points[i], c = points[i + 1];
      const sx = i === 1 ? a.x : (a.x + b.x) / 2, sy = i === 1 ? a.y : (a.y + b.y) / 2, sw = i === 1 ? w(a) : (w(a) + w(b)) / 2;
      const ex = (b.x + c.x) / 2, ey = (b.y + c.y) / 2, ew = (w(b) + w(c)) / 2;
      const steps = Math.max(1, Math.min(8, Math.ceil((Math.hypot(b.x - sx, b.y - sy) + Math.hypot(ex - b.x, ey - b.y)) / 3)));
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, u = 1 - t;
        push(u * u * sx + 2 * u * t * b.x + t * t * ex, u * u * sy + 2 * u * t * b.y + t * t * ey, u * u * sw + 2 * u * t * w(b) + t * t * ew);
      }
    }
    const last = points[n];
    push(last.x, last.y, w(last));
    return out;
  }

  // Eén capsule tussen twee cirkels; altijd met oplopende hoeken, zodat alle capsules dezelfde
  // draairichting hebben en de vulling (nonzero) ze netjes samenvoegt.
  function addCapsule(path, a, ra, b, rb) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d <= Math.abs(ra - rb) + .01) {
      const big = ra >= rb ? a : b, r = Math.max(ra, rb);
      path.moveTo(big.x + r, big.y);
      path.arc(big.x, big.y, r, 0, Math.PI * 2);
      return;
    }
    const angle = Math.atan2(dy, dx), beta = Math.acos((ra - rb) / d);
    path.moveTo(a.x + ra * Math.cos(angle + beta), a.y + ra * Math.sin(angle + beta));
    path.arc(a.x, a.y, ra, angle + beta, angle - beta + Math.PI * 2);
    path.arc(b.x, b.y, rb, angle - beta, angle + beta);
    path.closePath();
  }

  function variablePath(points, width, path = new Path2D()) {
    const dense = densify(points);
    for (let i = 1; i < dense.length; i++) addCapsule(path, dense[i - 1], width / 2 * dense[i - 1].w, dense[i], width / 2 * dense[i].w);
    return path;
  }

  function smoothPath(points, path = new Path2D()) {
    path.moveTo(points[0].x, points[0].y);
    if (points.length === 2) { path.lineTo(points[1].x, points[1].y); return path; }
    for (let i = 1; i < points.length - 1; i++) {
      const b = points[i], c = points[i + 1];
      path.quadraticCurveTo(b.x, b.y, i === points.length - 2 ? c.x : (b.x + c.x) / 2, i === points.length - 2 ? c.y : (b.y + c.y) / 2);
    }
    return path;
  }

  const hasWidths = points => points.length > 1 && points[0].w !== undefined;

  // true = getekend; false = oude manier (stippel, markeerstift, vormen).
  function drawInk(ctx, stroke, from) {
    const brush = stroke.brush || "pen";
    const points = stroke.points;
    if (!smoothBrush(brush) || stroke.shape || points.length < 2) return false;
    const variable = hasWidths(points);
    if (from > 0) {
      // Live tekenen: alleen de staart, met twee punten overlap zodat de curve aansluit.
      const tail = points.slice(Math.max(0, from - 3));
      if (tail.length < 2) return true;
      if (variable) ctx.fill(variablePath(tail, stroke.width));
      else ctx.stroke(smoothPath(tail));
      return true;
    }
    let cached = inkCache.get(points);
    if (!cached || cached.width !== stroke.width) {
      cached = { width: stroke.width, path: variable ? variablePath(points, stroke.width) : smoothPath(points) };
      inkCache.set(points, cached);
    }
    if (variable) ctx.fill(cached.path);
    else ctx.stroke(cached.path);
    return true;
  }

  // Inktdikte uit schrijfsnelheid (en echte pendruk als de pen die doorgeeft).
  // Snel = dunner, langzaam = voller, zoals bij een vulpen.
  function inkWidth(previous, sample, last) {
    let target = 1;
    if (last && last.t !== undefined && sample.timeStamp > last.t) {
      const speed = Math.hypot(sample.clientX - last.cx, sample.clientY - last.cy) / (sample.timeStamp - last.t);
      target = Math.max(.6, Math.min(1.3, 1.3 - .4 * speed));
    }
    const pressure = sample.pointerType === "pen" ? sample.pressure : 0;
    if (pressure > 0 && Math.abs(pressure - .5) > .02) target *= .6 + .8 * pressure;
    const value = previous * .7 + Math.max(.4, Math.min(1.6, target)) * .3;
    return Math.round(value * 100) / 100;
  }

  function drawStroke(ctx, stroke, from = 0) {
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    const brush = stroke.brush || "pen";
    ctx.globalAlpha = brush === "highlighter" ? .32 : 1;
    ctx.lineCap = brush === "highlighter" ? "square" : ["pen", "marker"].includes(brush) ? "round" : "butt";
    ctx.lineJoin = "round";
    ctx.setLineDash(brush === "dashed" ? [stroke.width * 3, stroke.width * 2] : []);
    let distance = 0;
    for (let i = 1; i < from; i++) distance += Math.hypot(stroke.points[i].x - stroke.points[i - 1].x, stroke.points[i].y - stroke.points[i - 1].y);
    ctx.lineDashOffset = -distance;
    const points = stroke.points;
    if (stroke.shape && points.length >= 2) {
      const a = points[0], b = points[points.length - 1];
      ctx.beginPath();
      if (stroke.shape === "line" || stroke.shape === "arrow") {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      } else if (stroke.shape === "rectangle") {
        ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      } else if (stroke.shape === "ellipse") {
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2,
          Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      } else if (stroke.shape === "check") {
        ctx.moveTo(a.x, a.y + (b.y - a.y) * .55);
        ctx.lineTo(a.x + (b.x - a.x) * .38, b.y);
        ctx.lineTo(b.x, a.y);
      } else if (stroke.shape === "warning") {
        ctx.moveTo((a.x + b.x) / 2, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(a.x, b.y);
        ctx.closePath();
        ctx.moveTo((a.x + b.x) / 2, a.y + (b.y - a.y) * .3);
        ctx.lineTo((a.x + b.x) / 2, a.y + (b.y - a.y) * .68);
        ctx.moveTo((a.x + b.x) / 2, a.y + (b.y - a.y) * .82);
        ctx.lineTo((a.x + b.x) / 2, a.y + (b.y - a.y) * .84);
      } else if (stroke.shape === "star") {
        const centerX = (a.x + b.x) / 2, centerY = (a.y + b.y) / 2;
        const outer = Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 2;
        for (let index = 0; index < 10; index++) {
          const angle = -Math.PI / 2 + index * Math.PI / 5;
          const radius = index % 2 ? outer * .42 : outer;
          const x = centerX + Math.cos(angle) * radius, y = centerY + Math.sin(angle) * radius;
          if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      ctx.stroke();
      if (stroke.shape === "arrow") {
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const size = Math.max(10, stroke.width * 4);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - Math.cos(angle - Math.PI / 6) * size, b.y - Math.sin(angle - Math.PI / 6) * size);
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - Math.cos(angle + Math.PI / 6) * size, b.y - Math.sin(angle + Math.PI / 6) * size);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (from === 0 && (brush === "pen" || points.length === 1)) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, stroke.width / 2 * (points[0].w || 1), 0, Math.PI * 2);
      ctx.fill();
    }
    if (drawInk(ctx, stroke, from)) { ctx.restore(); return; }
    if (points.length > 1) {
      ctx.beginPath();
      const start = Math.max(0, from - 1);
      ctx.moveTo(points[start].x, points[start].y);
      for (let i = start + 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLive() {
    if (gesture && gesture.stroke && livePoints < gesture.stroke.points.length) {
      drawStroke(worldContext("drawing"), gesture.stroke, livePoints);
      livePoints = gesture.stroke.points.length;
    }
    if (selection) drawSelectionOverlay();
    if (gesture && gesture.ring && (gesture.tool === "eraser" || gesture.tool === "scratch-eraser")) drawEraserRing();
  }

  // Cirkel op de gumgrootte rond de pen, zodat zichtbaar is wat de gum raakt.
  function drawEraserRing() {
    const canvas = $("drawing");
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = canvas.width / rect.width;
    const ctx = context("drawing");
    const radius = Math.max(gesture.tool === "scratch-eraser" ? 12 : 3, gesture.eraserRadius);
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(gesture.ring.x - rect.left, gesture.ring.y - rect.top, radius, 0, Math.PI * 2);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "rgb(255 255 255 / 85%)";
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#af6700";
    ctx.stroke();
    ctx.restore();
  }

  function blockBounds(block) {
    const ctx = context("saved-drawing");
    ctx.save();
    ctx.font = "18px system-ui, sans-serif";
    const lines = textLines(ctx, block.text).length;
    ctx.restore();
    return { left: block.x - 8, top: block.y - 8, right: block.x + 608, bottom: block.y + lines * 24 + 8 };
  }

  function selectionBounds() {
    const strokes = selection?.indexes || [], blocks = selection?.blocks || [];
    if (!strokes.length && !blocks.length) return null;
    const all = [
      ...strokes.map(index => strokeBounds(active().strokes[index])),
      ...blocks.map(index => blockBounds(active().textBlocks[index]))
    ];
    return {
      left: Math.min(...all.map(value => value.left)),
      top: Math.min(...all.map(value => value.top)),
      right: Math.max(...all.map(value => value.right)),
      bottom: Math.max(...all.map(value => value.bottom))
    };
  }

  function inkCanvas(strokes) {
    if (!strokes.length) {
      const empty = document.createElement("canvas");
      empty.width = empty.height = 8;
      const emptyContext = empty.getContext("2d");
      emptyContext.fillStyle = "#ffffff";
      emptyContext.fillRect(0, 0, 8, 8);
      return empty;
    }
    const bounds = strokes.map(strokeBounds);
    const margin = 24;
    const left = Math.min(...bounds.map(value => value.left)) - margin;
    const top = Math.min(...bounds.map(value => value.top)) - margin;
    const right = Math.max(...bounds.map(value => value.right)) + margin;
    const bottom = Math.max(...bounds.map(value => value.bottom)) + margin;
    const worldWidth = Math.max(8, right - left);
    const worldHeight = Math.max(8, bottom - top);
    const scale = Math.min(2, 1600 / Math.max(worldWidth, worldHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(8, Math.ceil(worldWidth * scale));
    canvas.height = Math.max(8, Math.ceil(worldHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Handschriftvoorbeeld maken is niet beschikbaar.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
    for (const stroke of strokes) drawStroke(ctx, stroke);
    return canvas;
  }

  // Zwevend menu boven de lasso-selectie: kopieer, knip, taak, subtaak.
  function placeSelectionMenu(bounds) {
    const menu = $("selection-menu");
    if (!menu) return;
    if (!bounds || gesture?.moveSelection || gesture?.lassoPoints) { menu.hidden = true; return; }
    const { x, y, scale } = active().view;
    const surface = $("surface").getBoundingClientRect();
    menu.hidden = false;
    const width = menu.offsetWidth || 300, height = menu.offsetHeight || 48;
    const left = (bounds.left - x) * scale;
    let top = (bounds.top - y) * scale - height - 10;
    if (top < 6) top = (bounds.bottom - y) * scale + 10;
    menu.style.left = `${Math.max(6, Math.min(surface.width - width - 6, left))}px`;
    menu.style.top = `${Math.max(6, Math.min(surface.height - height - 6, top))}px`;
  }

  function drawSelectionOverlay() {
    const ctx = worldContext("drawing");
    const bounds = selectionBounds();
    placeSelectionMenu(bounds);
    if (!bounds && !selection?.lasso?.length) return;
    const scale = active().view.scale;
    ctx.save();
    ctx.strokeStyle = "#af6700";
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([8 / scale, 6 / scale]);
    if (bounds) {
      const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
      ctx.fillStyle = "rgb(175 103 0 / 7%)";
      ctx.fillRect(bounds.left, bounds.top, width, height);
      ctx.strokeRect(bounds.left, bounds.top, width, height);
      ctx.setLineDash([]);
      ctx.fillStyle = "#af6700";
      const handle = 8 / scale; // groot genoeg om met vinger of pen vast te pakken
      for (const [x, y] of [[bounds.left, bounds.top], [bounds.right, bounds.top], [bounds.left, bounds.bottom], [bounds.right, bounds.bottom]]) {
        ctx.fillRect(x - handle, y - handle, handle * 2, handle * 2);
      }
    } else {
      ctx.beginPath();
      selection.lasso.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.closePath();
      ctx.fillStyle = "rgb(175 103 0 / 8%)";
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function hasSelection() {
    return !!(selection?.indexes?.length || selection?.blocks?.length);
  }

  function updateSelectionButtons() {
    const selected = hasSelection();
    $("selection-copy").disabled = !selected;
    $("selection-cut").disabled = !selected;
    $("selection-paste").disabled = !(inkClipboard.strokes.length || inkClipboard.blocks.length);
    if (!selected && $("selection-menu")) $("selection-menu").hidden = true;
  }

  // Wat zit er in de lasso: streken die voor minstens de helft binnen de lus liggen en
  // tekstblokken waarvan het midden erin ligt. Een tik (geen lus) kiest de streek of het blok eronder.
  function selectWithLasso(polygon) {
    const doc = active();
    const blocks = doc.textBlocks || [];
    const xs = polygon.map(point => point.x), ys = polygon.map(point => point.y);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (polygon.length < 3 || size < 8 / doc.view.scale) {
      const point = polygon[0];
      const reach = 10 / doc.view.scale;
      for (let index = doc.strokes.length - 1; index >= 0; index--) {
        const stroke = doc.strokes[index];
        if (M.intersectsBounds(strokeBounds(stroke), { left: point.x - reach, top: point.y - reach, right: point.x + reach, bottom: point.y + reach }) &&
            M.hitStroke(stroke, point, point, reach)) return { indexes: [index], blocks: [] };
      }
      for (let index = blocks.length - 1; index >= 0; index--) {
        const bounds = blockBounds(blocks[index]);
        if (point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom) return { indexes: [], blocks: [index] };
      }
      return null;
    }
    const box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    const indexes = [];
    doc.strokes.forEach((stroke, index) => {
      if (M.intersectsBounds(strokeBounds(stroke), box) && M.strokeInsideFraction(stroke, polygon) >= .5) indexes.push(index);
    });
    const chosen = [];
    blocks.forEach((block, index) => {
      const bounds = blockBounds(block);
      if (M.pointInPolygon({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }, polygon)) chosen.push(index);
    });
    return indexes.length || chosen.length ? { indexes, blocks: chosen } : null;
  }

  function clearSelection() {
    selection = null;
    updateSelectionButtons();
    clear("drawing");
  }

  function textLines(ctx, text) {
    const lines = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const char of paragraph) {
        if (line && ctx.measureText(line + char).width > 600) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  }

  function drawTextBlock(ctx, block) {
    ctx.font = "18px system-ui, sans-serif";
    ctx.textBaseline = "top";
    const lines = textLines(ctx, block.text);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(block.x - 8, block.y - 8, 616, lines.length * 24 + 16);
    ctx.fillStyle = "#173c39";
    lines.forEach((line, index) => ctx.fillText(line, block.x, block.y + index * 24));
  }

  function snapshot(strokes = active().strokes, blocks = active().textBlocks || []) {
    return { strokes: strokes.slice(), textBlocks: blocks.slice() };
  }

  function restore(state) {
    active().strokes = state.strokes;
    active().textBlocks = state.textBlocks;
  }

  function updateControls() {
    $("zoom").textContent = `${Math.round(active().view.scale * 100)}%`;
    $("undo").disabled = !undo.length && !active().strokes.length;
    $("redo").disabled = !redo.length;
    const doc = active();
    const pages = doc.pages || 1;
    const page = Math.min(pages, Math.max(1, Math.floor((doc.view.y + 24) / 1144) + 1));
    $("page-number").textContent = doc.kind === "page" ? `${page} / ${pages}` : "Whiteboard";
    $("previous-page").disabled = doc.kind !== "page" || page === 1;
    $("next-page").disabled = doc.kind !== "page" || page === pages;
    $("add-page").disabled = doc.kind !== "page" || pages >= 200;
  }

  function updateDiagnostics() {
    $("input-diagnostics").textContent = `Laatste invoer: ${diagnostics.last}. Pen: ${diagnostics.pen}; touch: ${diagnostics.touch}; muis: ${diagnostics.mouse}; onbekend: ${diagnostics.other}; genegeerd: ${diagnostics.ignored}; onderbroken: ${diagnostics.cancelled}. Alleen lokaal, niet opgeslagen.`;
    $("stroke-diagnostics").textContent = diagnostics.recent.length
      ? diagnostics.recent.map(item => `${item.type} / ${item.tool}: ${item.moves} bewegingen, ${item.samples} samples, ${item.points} tekenpunten; duur ${item.duration} ms; grootste ontvangstgat ${item.gap} ms; einde ${item.reason}.`).join("\n")
      : "Nog geen afgeronde streek. Maximaal de laatste 5; geen coordinaten of notitietekst.";
  }

  function endDiagnostics(old, reason) {
    const now = performance.now();
    diagnostics.recent.unshift({
      type: old.type || "onbekend", tool: old.tool,
      moves: old.metrics.moves, samples: old.metrics.samples,
      points: old.stroke ? old.stroke.points.length : 0,
      duration: Math.round(now - old.metrics.start),
      gap: Math.round(Math.max(old.metrics.gap, now - old.metrics.last)),
      reason
    });
    diagnostics.recent.length = Math.min(diagnostics.recent.length, 5);
    updateDiagnostics();
  }

  // Tekent achtergrond, PDF, inkt en tekstblokken die het gegeven gebied (wereldcoordinaten) raken.
  // ---- Typen op het blad (tool Tekst): werkt met elk toetsenbord, ook dat van je telefoon ----
  let textEdit = null; // { docId, index (-1 = nieuw), x, y }
  function openTextEditor(point) {
    const doc = active();
    if (!doc || isMeasurement(doc)) return;
    const blocks = doc.textBlocks || [];
    let index = -1;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blockBounds(blocks[i]);
      if (point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom) { index = i; break; }
    }
    if (index < 0 && blocks.length >= 100) { notify("Maximaal 100 tekstblokken per blad. Maak een nieuw blad."); return; }
    const x = index >= 0 ? blocks[index].x : point.x;
    const y = index >= 0 ? blocks[index].y : point.y - 12;
    textEdit = { docId: doc.id, index, x, y };
    const editor = $("text-editor");
    const { scale } = doc.view;
    const surface = $("surface").getBoundingClientRect();
    const left = (x - doc.view.x) * scale, top = (y - doc.view.y) * scale;
    editor.style.left = `${Math.max(4, Math.min(surface.width - 120, left))}px`;
    editor.style.top = `${Math.max(4, top)}px`;
    editor.style.fontSize = `${18 * scale}px`;
    editor.style.lineHeight = `${24 * scale}px`;
    editor.style.width = `${Math.max(160, Math.min(600 * scale, surface.width - Math.max(4, left) - 8))}px`;
    editor.value = index >= 0 ? blocks[index].text : "";
    editor.hidden = false;
    editor.style.height = "auto";
    editor.style.height = `${Math.max(editor.scrollHeight, 30 * scale)}px`;
    render();
    editor.focus();
    try { editor.setSelectionRange(editor.value.length, editor.value.length); } catch (error) { /* geen cursor */ }
  }
  function closeTextEditor(save = true) {
    if (!textEdit) return;
    const edit = textEdit;
    textEdit = null;
    const editor = $("text-editor");
    const text = editor.value.replace(/\s+$/, "");
    editor.hidden = true;
    editor.value = "";
    const doc = data.documents.find(item => item.id === edit.docId);
    if (doc && save) {
      const before = doc.textBlocks || [];
      const blocks = before.slice();
      let changed = false;
      if (edit.index >= 0 && edit.index < blocks.length) {
        if (!text.trim()) { blocks.splice(edit.index, 1); changed = true; }
        else if (blocks[edit.index].text !== text) { blocks[edit.index] = { ...blocks[edit.index], text: text.slice(0, 20000) }; changed = true; }
      } else if (text.trim()) {
        blocks.push({ text: text.slice(0, 20000), x: edit.x, y: edit.y });
        changed = true;
      }
      if (changed) {
        if (doc.id === data.activeId) remember(doc.strokes.slice(), before);
        doc.textBlocks = blocks;
        persist();
      }
    }
    if (doc && doc.id === data.activeId) render();
  }

  // Taakvakje: klein bolletje rechtsboven. Grijs = wacht op tekst, groen = taak in WerkHub, met vinkje = klaar.
  function drawBoxBadge(ctx, stroke) {
    const bounds = strokeBounds(stroke);
    const r = 7;
    const x = bounds.right + 4, y = bounds.top - 4;
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = stroke.box.done ? "#2e7d4f" : stroke.box.taskId ? "#3a9d6a" : "#ffffff";
    ctx.strokeStyle = stroke.box.taskId ? "#2e7d4f" : "#8ca49d";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    // Loopt de taak over meer regels, dan een dun groen haakje links ervan: dit hoort erbij.
    const area = stroke.box.area;
    if (area && !stroke.box.done && area.bottom > bounds.bottom + 12) {
      ctx.strokeStyle = "rgb(58 157 106 / 45%)";
      ctx.lineWidth = 2;
      const hx = Math.min(bounds.left, area.left) - 6;
      ctx.beginPath();
      ctx.moveTo(hx + 4, bounds.bottom + 3);
      ctx.lineTo(hx, bounds.bottom + 3);
      ctx.lineTo(hx, area.bottom);
      ctx.lineTo(hx + 4, area.bottom);
      ctx.stroke();
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (stroke.box.done) { ctx.moveTo(x - 3.5, y); ctx.lineTo(x - 1, y + 3); ctx.lineTo(x + 4, y - 3); ctx.stroke(); }
    else if (stroke.box.taskId) { ctx.moveTo(x - 3, y + 3); ctx.lineTo(x + 3, y - 3); ctx.moveTo(x - 1, y - 3); ctx.lineTo(x + 3, y - 3); ctx.lineTo(x + 3, y + 1); ctx.stroke(); }
    ctx.restore();
  }

  function paintScene(ctx, doc, viewport) {
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    if (doc.kind === "page") {
      const first = Math.max(0, Math.floor(viewport.top / 1144));
      const last = Math.min((doc.pages || 1) - 1, Math.floor(viewport.bottom / 1144));
      for (let page = first; page <= last; page++) {
        const top = page * 1144;
        ctx.strokeStyle = "#bbc9c5";
        ctx.lineWidth = 1;
        ctx.strokeRect(0, top, 800, 1120);
        ctx.strokeStyle = "#d9e1e5";
        ctx.beginPath();
        for (let y = 31; y < 1120; y += 32) {
          ctx.moveTo(0, top + y);
          ctx.lineTo(800, top + y);
        }
        ctx.stroke();
      }
    }
    for (const page of pdfImages) {
      if (page.top <= viewport.bottom && page.top + page.height >= viewport.top) {
        ctx.drawImage(page.image, 0, page.top, page.width, page.height);
      }
    }
    for (const stroke of doc.strokes) {
      if (M.intersectsBounds(strokeBounds(stroke), viewport)) drawStroke(ctx, stroke);
    }
    for (const stroke of doc.strokes) {
      if (stroke.box && M.intersectsBounds(strokeBounds(stroke), viewport)) drawBoxBadge(ctx, stroke);
    }
    (doc.textBlocks || []).forEach((block, index) => {
      if (textEdit && textEdit.docId === doc.id && textEdit.index === index) return; // wordt nu getypt
      if (block.y <= viewport.bottom && block.y + 1000 >= viewport.top) drawTextBlock(ctx, block);
    });
  }

  // Alleen een klein stuk van de opgeslagen laag opnieuw tekenen (gum): veel sneller dan het hele blad.
  function renderRegion(box) {
    const doc = active();
    if (isMeasurement(doc)) return;
    const pad = 3;
    const region = { left: box.left - pad, top: box.top - pad, right: box.right + pad, bottom: box.bottom + pad };
    const ctx = worldContext("saved-drawing");
    ctx.save();
    ctx.beginPath();
    ctx.rect(region.left, region.top, region.right - region.left, region.bottom - region.top);
    ctx.clip();
    ctx.clearRect(region.left, region.top, region.right - region.left, region.bottom - region.top);
    paintScene(ctx, doc, region);
    ctx.restore();
  }

  let dirtyBox = null;
  function markDirty(box) {
    if (!box) return;
    dirtyBox = dirtyBox
      ? { left: Math.min(dirtyBox.left, box.left), top: Math.min(dirtyBox.top, box.top), right: Math.max(dirtyBox.right, box.right), bottom: Math.max(dirtyBox.bottom, box.bottom) }
      : { ...box };
  }

  // Zoomen/schuiven: eerst alleen het bestaande beeld meeschalen (CSS, vrijwel gratis), pas
  // als je even stilhoudt of loslaat wordt alles scherp opnieuw getekend.
  let renderedView = null, previewTimer = null;
  function previewView() {
    const base = renderedView, view = active().view, saved = $("saved-drawing");
    if (!base) { render(); return; }
    const k = view.scale / base.scale;
    saved.style.transformOrigin = "0 0";
    saved.style.transform = `translate(${(base.x - view.x) * view.scale}px, ${(base.y - view.y) * view.scale}px) scale(${k})`;
    clear("drawing");
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { if (!gesture || !gesture.stroke) render(); }, 140);
  }

  function render() {
    frame = null;
    clearTimeout(previewTimer);
    $("saved-drawing").style.transform = "";
    const doc = active();
    if (isMeasurement(doc)) return;
    const rect = $("drawing").getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderedWidth = rect.width;
    renderedView = { ...doc.view };
    renderedHeight = rect.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    for (const id of ["drawing", "saved-drawing"]) {
      const width = Math.round(rect.width * ratio);
      const height = Math.round(rect.height * ratio);
      if ($(id).width !== width || $(id).height !== height) {
        $(id).width = width;
        $(id).height = height;
      }
      clear(id);
    }
    const ctx = worldContext("saved-drawing");
    paintScene(ctx, doc, {
      left: doc.view.x,
      top: doc.view.y,
      right: doc.view.x + rect.width / doc.view.scale,
      bottom: doc.view.y + rect.height / doc.view.scale
    });
    livePoints = 0;
    drawLive();
    updateControls();
  }

  function scheduleRender() {
    if (frame === null) frame = requestAnimationFrame(() => {
      frame = null;
      if (gesture && gesture.stroke) drawLive();
      else if (dirtyBox && gesture && (gesture.tool === "eraser" || gesture.tool === "scratch-eraser")) {
        const box = dirtyBox;
        dirtyBox = null;
        renderRegion(box);
      } else {
        dirtyBox = null;
        render();
      }
    });
  }

  function documentLabel(doc) {
    if (doc.formType === "dwat-akf") return `DWAT/AKF: ${doc.title || "Zonder titel"}`;
    if (doc.formType === "lws") return `LWS: ${doc.title || "Zonder titel"}`;
    return `${doc.kind === "page" ? "Schrift" : doc.pdf ? "PDF" : "Bord"}: ${doc.title || "Zonder titel"}`;
  }

  function documentOption(doc) {
    const option = document.createElement("option");
    option.value = doc.id;
    option.textContent = documentLabel(doc);
    option.selected = doc.id === data.activeId;
    return option;
  }

  const noFolderValue = "__zonder_map__";

  function folderValue(folderId) {
    return folderId || noFolderValue;
  }

  function folderTitle(folderId) {
    if (!folderId) return "Zonder map";
    return data.folders.find(folder => folder.id === folderId)?.title || "Onbekende map";
  }

  function list(folderId = undefined) {
    const folderSelect = $("content-folder");
    const requested = folderId === undefined
      ? folderSelect.value || folderValue(active().folderId)
      : folderValue(folderId);
    const folderOptions = [];
    const withoutFolder = document.createElement("option");
    withoutFolder.value = noFolderValue;
    withoutFolder.textContent = "Zonder map";
    folderOptions.push(withoutFolder);
    for (const folder of data.folders) {
      const option = document.createElement("option");
      option.value = folder.id;
      option.textContent = folder.title;
      folderOptions.push(option);
    }
    folderSelect.replaceChildren(...folderOptions);
    folderSelect.value = folderOptions.some(option => option.value === requested)
      ? requested
      : folderValue(active().folderId);

    const selectedFolderId = folderSelect.value === noFolderValue ? null : folderSelect.value;
    const docs = data.documents.filter(doc => (doc.folderId || null) === selectedFolderId);
    const options = docs.map(documentOption);
    if (!docs.some(doc => doc.id === data.activeId)) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = docs.length ? "Kies inhoud..." : "Deze map is leeg";
      placeholder.selected = true;
      options.unshift(placeholder);
    }
    $("documents").replaceChildren(...options);
    $("delete-document").disabled = !active();
    $("current-context").textContent = `Nu open: ${folderTitle(active().folderId)} → ${documentLabel(active())}`;
  }

  function fieldValue(key) {
    return active().formData[key] ?? "";
  }

  function measurementInput(key, label, type = "text") {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    const input = document.createElement("input");
    input.type = type;
    input.dataset.measureField = key;
    input.value = String(fieldValue(key));
    wrapper.append(input);
    return wrapper;
  }

  function checkbox(key, label) {
    const wrapper = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.measureField = key;
    input.checked = fieldValue(key) === true;
    wrapper.append(input, document.createTextNode(label));
    return wrapper;
  }

  function heading(text) {
    const element = document.createElement("h4");
    element.textContent = text;
    return element;
  }

  function table(headers, rows) {
    const wrapper = document.createElement("div");
    wrapper.className = "measurement-table-wrap";
    const element = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of headers) {
      const cell = document.createElement("th");
      cell.textContent = label;
      headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const cells of rows) {
      const row = document.createElement("tr");
      for (const item of cells) {
        const cell = document.createElement("td");
        if (item instanceof Node) cell.append(item);
        else cell.textContent = item;
        row.append(cell);
      }
      body.append(row);
    }
    element.append(head, body);
    wrapper.append(element);
    return wrapper;
  }

  function measurementCell(key, disabled = false) {
    if (disabled) {
      const span = document.createElement("span");
      span.className = "not-applicable";
      span.textContent = "n.v.t.";
      return span;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.measureField = key;
    input.value = String(fieldValue(key));
    return input;
  }

  function renderDwatAkf(container) {
    const visit = document.createElement("div");
    visit.className = "measure-grid";
    visit.append(measurementInput("visit.date", "Datum", "date"), measurementInput("visit.start", "Aanvang", "time"),
      measurementInput("visit.operator", "Operator"));
    container.append(heading("Bezoekgegevens"), visit);
    const points = [
      ["1", "PLG-TIAKF-EFF", "Waterverdeelstation, gebouw t.o. RO/UF-installaties - bouwdeel B"],
      ["2", "PLG-PI-AKF-0", "AKF-pilotkolom, 0 min contacttijd (inlaat)"],
      ["3", "PLG-PI-AKF-20", "AKF-pilotkolom, 20 min contacttijd"],
      ["4", "PLG-AKF-40", "AKF-pilotkolom, 40 min contacttijd"],
      ["5", "PLG-UVstrx-AKRx-EFF", "Monsterkraan AKF-kolommen pilot (tegen de muur)"]
    ];
    container.append(heading("Bemonsteringspunten - volgorde zoals in Excel"),
      table(["Punt", "Code", "Locatie"], points));
    const parameters = [
      ["Tijdstip", "time"], ["pH", "ph"], ["O2 (%/mg/L)", "o2"], ["EGV (uS/cm)", "egv"],
      ["Temperatuur (C)", "temperature"], ["Doorstroming (L/h)", "flow"], ["Troebelheid (FNU)", "turbidity"],
      ["Nitraat", "nitrate"], ["Waterlevel (kolom 1 bovenkant)", "waterlevel"]
    ];
    const rows = parameters.map(([label, key]) => [
      label,
      ...[1, 2, 3, 4, 5].map(point => measurementCell(`measure.${key}.${point}`,
        (key === "flow" && [1, 3, 5].includes(point)) || (key === "nitrate" && [2, 3].includes(point))))
    ]);
    container.append(heading("Metingen"),
      table(["Parameter", "Punt 1", "Punt 2", "Punt 3", "Punt 4", "Punt 5"], rows));
    container.append(heading("Waterdebietmeters"),
      table(["Meter", "Datum", "Tijd", "Stand / debiet"], [
        ["INF waterdebietmeter", measurementCell("meter.inf.date"), measurementCell("meter.inf.time"), measurementCell("meter.inf.value")],
        ["EFF waterdebietmeter", measurementCell("meter.eff.date"), measurementCell("meter.eff.time"), measurementCell("meter.eff.value")]
      ]));
    const notes = document.createElement("textarea");
    notes.dataset.measureField = "notes";
    notes.value = String(fieldValue("notes"));
    notes.placeholder = "Aantekeningen";
    container.append(heading("Aantekeningen"), notes);
  }

  function renderLws(container) {
    const visit = document.createElement("div");
    visit.className = "measure-grid";
    visit.append(measurementInput("visit.date", "Datum", "date"), measurementInput("visit.start", "Aanvang", "time"),
      measurementInput("weather.direction", "Windrichting"), measurementInput("weather.temperature", "Temperatuur lucht (C)"),
      measurementInput("weather.speed", "Windsnelheid (km/h)"));
    container.append(heading("Bezoekgegevens"), visit);
    const weather = document.createElement("div");
    weather.className = "check-row";
    for (const [key, label] of [["sunny", "Zonnig"], ["cloudy", "Bewolkt"], ["rain", "Regen"], ["wind", "Wind"], ["frost", "Vorst"]]) {
      weather.append(checkbox(`weather.${key}`, label));
    }
    container.append(weather, heading("Scan sensor status"));
    const sensor = document.createElement("div");
    sensor.className = "check-row";
    sensor.append(checkbox("sensor.blueOk", "BLAUW = OK"), checkbox("sensor.redCall", "ROOD = Tim bellen"),
      checkbox("sensor.cleaned", "Sensoren schoongemaakt"));
    container.append(sensor, heading("Ronde LWS"));
    const round = document.createElement("div");
    round.className = "check-row";
    for (const [key, label] of [
      ["pumps", "Check pompen"], ["container", "Container schoon"], ["oddities", "Kijk globaal of je iets raars ziet"],
      ["samples", "Grondmonstername stokken nog allemaal recht"]
    ]) round.append(checkbox(`round.${key}`, label));
    const observations = document.createElement("textarea");
    observations.dataset.measureField = "observations";
    observations.value = String(fieldValue("observations"));
    observations.placeholder = "Observaties / bijzonderheden";
    container.append(round, heading("Observaties / bijzonderheden"), observations);
  }

  function renderMeasurementForm() {
    const container = $("measurement-editor");
    container.replaceChildren();
    if (!isMeasurement()) return;
    const sheet = document.createElement("article");
    sheet.className = "measurement-sheet";
    const title = document.createElement("h3");
    title.textContent = active().formType === "dwat-akf" ? "Logboek DWAT / AKF-meetstaat" : "Logboek LWS Andijk";
    const help = document.createElement("p");
    help.className = "measurement-help";
    help.textContent = "Vul deze vaste meetstatus in, neem de waarden over in het officiële logboek en maak de lijst daarna leeg. Alles wordt automatisch bewaard en staat op al je apparaten. Tik op 🎤 om in te spreken.";
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = "Meetlijst leegmaken";
    clearButton.addEventListener("click", () => {
      if (!window.confirm("Alle ingevulde waarden en vinkjes uit deze meetlijst verwijderen? Controleer eerst of je alles hebt overgenomen.")) return;
      const previous = active().formData;
      active().formData = {};
      if (!persist()) {
        active().formData = previous;
        report(new Error("Meetlijst niet leeggemaakt: lokale opslag mislukt."));
        return;
      }
      renderMeasurementForm();
    });
    sheet.append(title, help, clearButton);
    if (active().formType === "dwat-akf") renderDwatAkf(sheet);
    else renderLws(sheet);
    container.append(sheet);
  }

  function selectDocument() {
    if (textEdit && textEdit.docId !== data.activeId) closeTextEditor(true);
    const doc = active();
    $("title").value = doc.title;
    $("text").value = doc.text;
    $("drawing-editor").hidden = isMeasurement(doc);
    $("measurement-editor").hidden = !isMeasurement(doc);
    $("focus").disabled = isMeasurement(doc);
    $("writing-ai-open").disabled = isMeasurement(doc);
    $("writing-ai-recognize").disabled = isMeasurement(doc);
    $("pdf-file").disabled = isMeasurement(doc);
    redo = [];
    undo = [];
    list(doc.folderId || null);
    renderFolderButtons();
    renderMeasurementForm();
    if (isMeasurement(doc)) {
      pdfImages = [];
      $("pdf-original").disabled = true;
      $("pdf-status").textContent = "Meetlijst wordt lokaal bewaard. Open een whiteboard voor een PDF-achtergrond.";
    } else {
      loadPdf();
      render();
    }
  }

  async function loadPdf() {
    const generation = ++pdfGeneration;
    pdfImages = [];
    const doc = active();
    $("pdf-original").disabled = !doc.pdf;
    $("pdf-status").textContent = doc.pdf
      ? `PDF laden: ${doc.pdf.name}`
      : "PDF Achtergrond gebruikt het huidige lege bord. PDF Nieuw bord maakt een apart bord in deze map. Maximaal 20 MB / 50 pagina's.";
    if (!doc.pdf) return;
    try {
      if (!navigator.onLine) $("pdf-status").textContent = `PDF laden: ${doc.pdf.name} (offline: alleen als hij al op dit apparaat staat)`;
      const images = await window.WorkplacePdf.images(doc.pdf.id, doc.pdf.name);
      if (generation !== pdfGeneration) return;
      pdfImages = images;
      $("pdf-status").textContent = `${doc.pdf.name}: ${images.length} pagina's. Schrijf erop of ernaast; PDF-achtergrond blijft intact.`;
      render();
    } catch (error) {
      if (generation !== pdfGeneration) return;
      $("pdf-status").textContent = error.message;
      report(error);
    }
  }

  async function deleteActiveDocument() {
    finish();
    const removed = active();
    if (!removed) return;
    // Vangnet: niets is meteen weg. Het document gaat 30 dagen naar de prullenbak.
    const previousDocuments = data.documents;
    const previousId = data.activeId;
    const previousTrash = data.trash;
    data.trash = [{ deletedAt: Date.now(), folderTitle: removed.folderId ? folderTitle(removed.folderId) : null,
      doc: { ...removed, folderId: null } }, ...(data.trash || [])].slice(0, 100);
    let remaining = data.documents.filter(doc => doc.id !== removed.id);
    if (!remaining.length) {
      const replacement = M.createDocument("page", crypto.randomUUID());
      remaining = [replacement];
    }
    data.documents = remaining;
    data.activeId = remaining.find(doc => (doc.folderId || null) === (removed.folderId || null))?.id || remaining[0].id;
    if (!persist()) {
      data.documents = previousDocuments;
      data.activeId = previousId;
      data.trash = previousTrash;
      selectDocument();
      report(new Error("Inhoud niet weggegooid: lokale opslag mislukt. Download eerst een back-up."));
      return;
    }
    selectDocument();
    notify(`"${removed.title || "Zonder titel"}" staat in de prullenbak.`, "Zet terug", () => restoreFromTrash(removed.id));
  }

  // Korte melding onderin met optioneel een knop (bijv. "Zet terug"). Verdwijnt vanzelf.
  let toastTimer = null;
  function notify(text, actionLabel = "", action = null, ms = 7000) {
    const toast = $("toast");
    if (!toast) { $("save-status").textContent = text; return; }
    const message = document.createElement("span");
    message.textContent = text;
    const parts = [message];
    if (actionLabel && action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = actionLabel;
      button.addEventListener("click", () => { toast.hidden = true; try { action(); } catch (error) { report(error); } });
      parts.push(button);
    }
    toast.replaceChildren(...parts);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
  }

  function restoreFromTrash(id) {
    finish();
    const item = (data.trash || []).find(entry => entry.doc.id === id);
    if (!item) throw new Error("Dit document staat niet meer in de prullenbak.");
    const folder = item.folderTitle ? data.folders.find(entry => normalizedFolderTitle(entry.title) === normalizedFolderTitle(item.folderTitle)) : null;
    const doc = { ...item.doc, folderId: folder ? folder.id : null };
    if (data.documents.some(entry => entry.id === doc.id)) doc.id = crypto.randomUUID();
    const previous = data;
    data = { ...data, documents: [...data.documents, doc], trash: data.trash.filter(entry => entry !== item), activeId: doc.id };
    try { M.validate(data); } catch (error) { data = previous; throw error; }
    if (!persist()) { data = previous; throw new Error("Terugzetten mislukt: opslag vol."); }
    selectDocument();
    notify(`"${doc.title || "Zonder titel"}" is terug${folder ? ` in ${folder.title}` : ""}.`);
    return doc.id;
  }

  function purgeOldTrash() {
    const limit = Date.now() - 30 * 24 * 3600 * 1000;
    if ((data.trash || []).some(item => item.deletedAt < limit)) data.trash = data.trash.filter(item => item.deletedAt >= limit);
  }

  function finish(event, reason = "bediening") {
    if (!gesture || (event && gesture.id !== event.pointerId)) return;
    const old = gesture;
    if (event && event.type === "pointerup" && old.stroke) addSamples([event]);
    if (event && event.type === "pointerup" && old.tool === "eraser") {
      eraseAt(M.point(event.clientX, event.clientY, $("drawing").getBoundingClientRect(), active().view));
    }
    if (event && event.type === "pointercancel") {
      diagnostics.cancelled++;
    }
    endDiagnostics(old, event ? event.type : reason);
    let scratchNote = "";
    if (old.stroke) {
      const scratched = autoScratchEnabled() && !old.stroke.shape && old.stroke.brush !== "highlighter"
        ? M.scribbleErase(active().strokes, old.stroke.points, old.stroke.width, strokeBounds) : null;
      if (scratched && scratched.changed) {
        // Doorgekrast: de krabbel zelf wordt niet bewaard, de inkt eronder verdwijnt in een ongedaan-stap.
        remember(active().strokes.slice());
        active().strokes = scratched.strokes;
        if (selection) selection = null;
        scratchNote = `Doorgekrast: ${scratched.removed} ${scratched.removed === 1 ? "streek" : "streken"} weg. Ongedaan zet ze terug.`;
        old.scratched = true;
      } else {
        if (!old.stroke.shape) old.stroke.points = M.simplifyPoints(old.stroke.points, Math.max(.55, old.stroke.width * .08));
        remember(active().strokes.slice());
        active().strokes.push(old.stroke);
        drawStroke(worldContext("saved-drawing"), old.stroke);
        old.committed = true;
      }
    } else if (old.tool === "eraser" && old.changed) {
      remember(old.before);
    } else if (old.tool === "scratch-eraser" && old.changed) {
      remember(old.before);
    } else if (old.tool === "select-ink" && old.moveSelection) {
      if (old.moved) remember(old.before, old.beforeBlocks);
    } else if (old.tool === "select-ink" && old.lassoPoints?.length && (!event || event.type !== "pointercancel")) {
      selection = selectWithLasso(old.lassoPoints);
    } else if (old.tool === "select-ink") {
      selection = null;
    }
    const textTap = old.tool === "text-tap" && event && event.type === "pointerup" &&
      Math.hypot(event.clientX - old.clientX, event.clientY - old.clientY) < 12;
    gesture = null;
    clear("drawing");
    livePoints = 0;
    if ($("drawing").hasPointerCapture(old.id)) $("drawing").releasePointerCapture(old.id);
    persistSoon();
    if (scratchNote) $("save-status").textContent = scratchNote;
    updateControls();
    updateSelectionButtons();
    if (!old.stroke || old.scratched) render();
    if (textTap) openTextEditor(M.point(event.clientX, event.clientY, $("drawing").getBoundingClientRect(), active().view));
    if (old.committed && window.WorkplaceSmart) {
      try { window.WorkplaceSmart.afterStroke(active(), old.stroke); }
      catch (error) { console.warn("Werkplek: vakjes:", error.message); }
    }
  }

  function autoScratchEnabled() {
    try { return localStorage.getItem("remy-ipad-auto-scratch") !== "0"; } catch (error) { return true; }
  }

  function remember(before, beforeBlocks) {
    undo.push(snapshot(before, beforeBlocks));
    if (undo.length > 50) undo.shift();
    redo = [];
  }

  function eraseAt(point) {
    const result = M.erase(active().strokes, gesture.lastPoint, point, gesture.eraserRadius / active().view.scale, strokeBounds);
    gesture.lastPoint = point;
    if (result.changed) {
      gesture.changed = true;
      active().strokes = result.strokes;
      markDirty(result.dirty);
      scheduleRender();
    }
  }

  function scratchEraseAt(point) {
    const before = active().strokes;
    const from = gesture.lastPoint;
    const radius = Math.max(12, gesture.eraserRadius / active().view.scale);
    const box = { left: Math.min(from.x, point.x) - radius, top: Math.min(from.y, point.y) - radius,
      right: Math.max(from.x, point.x) + radius, bottom: Math.max(from.y, point.y) + radius };
    const removed = [];
    const kept = before.filter(stroke => {
      const drop = !stroke.shape && M.intersectsBounds(strokeBounds(stroke), box) && M.hitStroke(stroke, from, point, radius);
      if (drop) removed.push(strokeBounds(stroke));
      return !drop;
    });
    gesture.lastPoint = point;
    if (kept.length !== before.length) {
      gesture.changed = true;
      active().strokes = kept;
      for (const bounds of removed) markDirty(bounds);
      scheduleRender();
    }
  }

  function copySelection(cut = false) {
    if (!hasSelection()) return;
    const doc = active();
    const picked = new Set(selection.indexes), pickedBlocks = new Set(selection.blocks || []);
    inkClipboard = {
      strokes: doc.strokes.filter((_, index) => picked.has(index)).map(stroke => JSON.parse(JSON.stringify(stroke))),
      blocks: (doc.textBlocks || []).filter((_, index) => pickedBlocks.has(index)).map(block => ({ ...block }))
    };
    if (cut) {
      remember(doc.strokes.slice(), (doc.textBlocks || []).slice());
      doc.strokes = doc.strokes.filter((_, index) => !picked.has(index));
      if (pickedBlocks.size) doc.textBlocks = doc.textBlocks.filter((_, index) => !pickedBlocks.has(index));
      selection = null;
      persist();
      render();
    }
    updateSelectionButtons();
  }

  // ---- ✨ Netjes: spelling verbeteren (Nederlands) ----
  // Getypte tekst: spelling, hoofdletters en leestekens verbeterd, woorden blijven staan.
  // Handschrift in de lasso: uitgeschreven als nette getypte tekst eronder.
  const TIDY_RULES = "Verbeter alleen spelling, hoofdletters en leestekens volgens de Nederlandse spelling (Groene Boekje). " +
    "Verander geen woorden, zinsbouw of betekenis. Laat namen, getallen, eenheden, afkortingen en vaktermen (zoals PWN, UF-RO, DWAT, AKF, LWS) precies staan. " +
    "Behoud de regeleinden. Geef alleen de verbeterde tekst terug, zonder uitleg, aanhalingstekens of Markdown.";

  function tidyAllowed(retry) {
    const hub = window.WorkplaceWerkhub;
    if (!window.AiChat || !hub) { notify("AI-module is niet geladen. Herlaad de app."); return false; }
    if (hub.hasAiConsent()) return true;
    notify("Mag AI (Gemini, buiten PWN) deze tekst lezen om de spelling te verbeteren?", "Ja, altijd", () => { hub.giveAiConsent(); retry(); }, 15000);
    return false;
  }

  const cleanAnswer = text => String(text || "").replace(/```[a-z]*\n?|```/gi, "").trim();

  async function tidyText(text) {
    if (text.length > 5000) throw new Error("Te veel tekst in één keer (maximaal 5000 tekens). Selecteer minder.");
    const answer = cleanAnswer(await window.AiChat.sendPrompt("gemini", `${TIDY_RULES}\n\nTekst:\n${text}`));
    if (!answer) throw new Error("AI gaf geen tekst terug.");
    return answer;
  }

  async function tidySelection() {
    if (!hasSelection() || !tidyAllowed(tidySelection)) return;
    const doc = active();
    const strokes = selection.indexes.map(index => doc.strokes[index]).filter(stroke => stroke && !stroke.box);
    const blockIndexes = (selection.blocks || []).filter(index => (doc.textBlocks || [])[index]);
    const bounds = selectionBounds();
    notify("✨ Bezig met netjes maken…", "", null, 20000);
    try {
      const beforeStrokes = doc.strokes.slice(), beforeBlocks = (doc.textBlocks || []).slice();
      let blocks = beforeBlocks.slice(), changed = 0, written = "";
      for (const index of blockIndexes) {
        const fixed = await tidyText(blocks[index].text);
        if (fixed !== blocks[index].text) { blocks[index] = { ...blocks[index], text: fixed.slice(0, 20000) }; changed++; }
      }
      if (strokes.length) {
        if (blocks.length >= 100) throw new Error("Maximaal 100 tekstblokken per blad. Maak een nieuw blad.");
        const canvas = inkCanvas(strokes);
        const image = window.AiChat.cropInk(canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height });
        written = cleanAnswer(await window.AiChat.askBoard(image, "Schrijf het handschrift uit. " + TIDY_RULES + " Onleesbare woorden: [onleesbaar]."));
        if (written) blocks.push({ text: written.slice(0, 20000), x: bounds.left, y: bounds.bottom + 20 });
      }
      if (active() !== doc) throw new Error("Je bent van blad gewisseld; er is niets veranderd.");
      if (!changed && !written) { notify(blockIndexes.length ? "Spelling was al goed. ✓" : "Geen tekst gevonden in de selectie."); return; }
      remember(beforeStrokes, beforeBlocks);
      doc.textBlocks = blocks;
      persist();
      render();
      if (written) {
        const ink = new Set(strokes);
        notify("✨ Uitgeschreven tekst staat eronder. Handschrift weghalen?", "Weghalen", () => {
          remember(doc.strokes.slice(), (doc.textBlocks || []).slice());
          doc.strokes = doc.strokes.filter(stroke => !ink.has(stroke));
          selection = null;
          persist();
          render();
          updateSelectionButtons();
        }, 12000);
      } else {
        notify(`✨ Spelling verbeterd in ${changed} tekstblok${changed === 1 ? "" : "ken"}. Ongedaan zet het terug.`);
      }
    } catch (error) {
      notify(`Netjes maken mislukt: ${error.message || error}`);
    }
  }

  async function tidyNotes() {
    const field = $("text");
    const text = field.value.trim();
    if (!text) { notify("Typ eerst iets in de notities."); return; }
    if (!tidyAllowed(tidyNotes)) return;
    notify("✨ Bezig met netjes maken…", "", null, 20000);
    try {
      const fixed = await tidyText(field.value);
      if (fixed === field.value.trim()) { notify("Spelling was al goed. ✓"); return; }
      const before = field.value;
      field.value = fixed;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      notify("✨ Spelling verbeterd.", "Ongedaan", () => { field.value = before; field.dispatchEvent(new Event("input", { bubbles: true })); });
    } catch (error) {
      notify(`Netjes maken mislukt: ${error.message || error}`);
    }
  }

  function pasteSelection() {
    const doc = active();
    const room = Math.max(0, 100 - (doc.textBlocks || []).length);
    const blocks = inkClipboard.blocks.slice(0, room);
    if (!inkClipboard.strokes.length && !blocks.length) return;
    remember(doc.strokes.slice(), (doc.textBlocks || []).slice());
    const pasted = inkClipboard.strokes.map(stroke => ({
      ...JSON.parse(JSON.stringify(stroke)),
      points: stroke.points.map(point => ({ ...point, x: point.x + 24, y: point.y + 24 }))
    }));
    const pastedBlocks = blocks.map(block => ({ ...block, x: block.x + 24, y: block.y + 24 }));
    const start = doc.strokes.length, blockStart = (doc.textBlocks || []).length;
    doc.strokes = [...doc.strokes, ...pasted];
    if (pastedBlocks.length) doc.textBlocks = [...(doc.textBlocks || []), ...pastedBlocks];
    selection = { indexes: pasted.map((_, index) => start + index), blocks: pastedBlocks.map((_, index) => blockStart + index) };
    inkClipboard = { strokes: pasted, blocks: pastedBlocks };
    persist();
    updateSelectionButtons();
    render();
  }

  function setFocusLabel(on) {
    const button = $("focus");
    const label = on ? "Terug naar overzicht" : "Brede schrijfmodus";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(on));
    button.querySelector("span").textContent = on ? "⤢" : "↔";
    button.querySelector("small").textContent = on ? "Terug" : "Breed";
  }

  function tab(name) {
    finish();
    pinch = null;
    touches.clear();
    document.body.classList.remove("writing-focus");
    setFocusLabel(false);
    for (const section of ["today", "writing", "hubs", "ai"]) $(section).hidden = section !== name;
    document.querySelectorAll("[data-tab]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.tab === name)));
    if (name === "writing" && !blocked) render();
  }

  const defaultFolders = [
    { key: "dwat-akf", title: "DWAT/AKF", formType: "dwat-akf" },
    { key: "lws", title: "LWS", formType: "lws" },
    { key: "billa-meeting", title: "Billa / Meeting" },
    { key: "uf-ro", title: "UF-RO" },
    { key: "overveen", title: "Overveen" },
    { key: "waag", title: "Waag" },
    { key: "pwn-guidelines", title: "PWN Guidelines" },
    { key: "pwn-contacten-routes", title: "PWN Contacten en Routes" },
    { key: "opleidingen-cursus", title: "Opleidingen / Cursus" }
  ];

  function normalizedFolderTitle(value) {
    return String(value).trim().toLowerCase().replace(/\s*&\s*/g, " en ").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
  }

  function fixedDocumentId(definition) {
    return definition.formType ? `form-${definition.formType}` : `notes-${definition.key}`;
  }

  // Oude, willekeurige ids van vaste documenten omzetten naar vaste ids (eenmalig per apparaat).
  // De oude ids worden onthouden zodat de sync ze in de cloud als verwijderd markeert.
  function migrateFixedIds() {
    const renamed = [];
    for (const definition of defaultFolders) {
      const fixedId = fixedDocumentId(definition);
      if (data.documents.some(doc => doc.id === fixedId)) continue;
      const folder = fixedFolder(definition);
      const doc = definition.formType
        ? data.documents.find(item => item.formType === definition.formType)
        : data.documents.find(item => folder && item.folderId === folder.id && item.title === `${definition.title} - notities`);
      if (!doc) continue;
      renamed.push(doc.id);
      if (data.activeId === doc.id) data.activeId = fixedId;
      doc.id = fixedId;
    }
    if (renamed.length) {
      try {
        const old = JSON.parse(localStorage.getItem("remy-ipad-sync-renamed") || "[]");
        localStorage.setItem("remy-ipad-sync-renamed", JSON.stringify([...new Set([...old, ...renamed])]));
      } catch (error) { /* sync ruimt het dan niet op; geen dataverlies */ }
    }
  }

  function fixedFolder(definition) {
    const target = normalizedFolderTitle(definition.title);
    return data.folders.find(folder => normalizedFolderTitle(folder.title) === target) || null;
  }

  function ensureDefaultFolders() {
    const map = new Map((data.folders || []).map(folder => [normalizedFolderTitle(folder.title), folder]));
    for (const definition of defaultFolders) {
      const key = normalizedFolderTitle(definition.title);
      if (!map.has(key)) {
        data.folders.push({ id: crypto.randomUUID(), title: definition.title });
        map.set(key, data.folders[data.folders.length - 1]);
      }
    }
    for (const doc of data.documents) {
      if (!doc.formType) continue;
      const definition = defaultFolders.find(item => item.formType === doc.formType);
      if (!definition) continue;
      const folder = map.get(normalizedFolderTitle(definition.title));
      doc.folderId = folder.id;
      if (doc.title === "Nieuwe DWAT/AKF-meetlijst" || doc.title === "Nieuwe LWS-meetlijst") {
        doc.title = definition.formType === "dwat-akf" ? "DWAT/AKF meetstatus" : "LWS meetstatus";
      }
    }
  }

  function renderFolderButtons() {
    const container = $("folder-buttons");
    if (!container || !data) return;
    container.replaceChildren(...defaultFolders.map(definition => {
      const folder = fixedFolder(definition);
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.folderKey = definition.key;
      button.textContent = definition.title;
      button.title = `Open ${definition.title}`;
      const activeFolder = !!folder && active() && active().folderId === folder.id;
      button.classList.toggle("active", activeFolder);
      button.setAttribute("aria-pressed", String(activeFolder));
      button.addEventListener("click", () => {
        try { openFixedFolder(definition); }
        catch (error) { report(error); }
      });
      return button;
    }));
  }

  function openFixedFolder(definition) {
    finish();
    const folder = fixedFolder(definition);
    if (!folder) throw new Error(`Werkmap ${definition.title} ontbreekt.`);
    let doc = definition.formType
      ? data.documents.find(item => item.formType === definition.formType)
      : data.documents.find(item => item.folderId === folder.id);
    if (!doc) {
      // Vaste ids, zodat elk apparaat hetzelfde meetformulier en notitieblad gebruikt (cloud-sync).
      const fixedId = fixedDocumentId(definition);
      doc = definition.formType
        ? M.createMeasurementDocument(definition.formType, fixedId)
        : M.createDocument("page", fixedId);
      doc.folderId = folder.id;
      if (!definition.formType) doc.title = `${definition.title} - notities`;
      data.documents.push(doc);
    }
    data.activeId = doc.id;
    if (!persist()) throw new Error(`Werkmap ${definition.title} kon niet worden geopend.`);
    selectDocument();
  }

  (async () => {
  try {
    window.WorkplaceStore.onError(error => {
      $("save-status").textContent = "Niet opgeslagen! Download een back-up.";
      report(error);
    });
    const stored = await window.WorkplaceStore.load(localStorage);
    data = stored === null ? null : M.validate(JSON.parse(stored));
    if (!data) {
      const doc = M.createDocument("page", crypto.randomUUID());
      data = { version: 1, activeId: doc.id, documents: [doc], folders: [] };
    }
    data.folders = data.folders || [];
    purgeOldTrash();
    ensureDefaultFolders();
    migrateFixedIds();
    persist();
  } catch (error) {
    blocked = true;
    $("save-status").textContent = "Opslag niet beschikbaar. Schrijven geblokkeerd.";
    report(error);
    $("writing").querySelectorAll("button, input, select, textarea").forEach(el => { el.disabled = true; });
  }

  $("today-date").textContent = new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => tab(button.dataset.tab)));

  if (!blocked) {
    window.WorkplaceWriting = {
      currentId() { finish(); return active().id; },
      // Documenten voor opslag in WerkHub. Meetlijsten blijven lokaal; PDF-bestanden gaan niet mee.
      exportForSync(all, quiet = false) {
        // quiet: automatische sync mag een lopende penstreek nooit afbreken.
        if (quiet && gesture) return null;
        if (!quiet) finish();
        const docs = (all ? data.documents : [active()]).filter(doc => !doc.formType);
        return docs.map(doc => {
          const copy = JSON.parse(JSON.stringify(doc));
          delete copy.pdf;
          delete copy.folderId;
          return { id: doc.id, title: doc.title || "", kind: doc.kind, folder_title: doc.folderId ? folderTitle(doc.folderId) : null,
            data: copy, had_pdf: !!doc.pdf };
        });
      },
      hasDocument(id) { return data.documents.some(doc => doc.id === id); },
      // ---- cloud-sync (sync.js) ----
      syncDocs() {
        const isDefault = folder => defaultFolders.some(definition => normalizedFolderTitle(definition.title) === normalizedFolderTitle(folder.title));
        const docs = data.documents.map(doc => {
          const copy = { ...doc };
          delete copy.view;
          delete copy.folderId;
          return { id: doc.id, kind: doc.formType ? "form" : doc.kind, title: doc.title || "",
            folder_title: doc.folderId ? folderTitle(doc.folderId) : null, json: JSON.stringify(copy), pdf: doc.pdf || null,
            empty: !doc.strokes.length && !(doc.textBlocks || []).length && !String(doc.text || "").trim() && !Object.keys(doc.formData || {}).length };
        });
        const custom = data.folders.filter(folder => !isDefault(folder)).map(folder => folder.title).sort();
        docs.push({ id: "__folders__", kind: "meta", title: "Mappen", folder_title: null, json: JSON.stringify({ folders: custom }) });
        return docs;
      },
      // Wijzigingen van een ander apparaat toepassen. Geeft per id terug: applied | busy | invalid.
      applyRemote(rows) {
        const result = {};
        const typing = () => document.activeElement instanceof HTMLElement && document.activeElement.matches("#writing input, #writing textarea, #writing select");
        let activeChanged = false, changed = false;
        const folderFor = title => {
          if (!title) return null;
          const key = normalizedFolderTitle(title);
          let folder = data.folders.find(item => normalizedFolderTitle(item.title) === key);
          if (!folder && data.folders.length < 100) {
            folder = { id: crypto.randomUUID(), title: String(title).slice(0, 120) };
            data.folders.push(folder);
          }
          return folder ? folder.id : null;
        };
        for (const row of rows) {
          if (row.kind === "meta") {
            for (const title of (row.data && Array.isArray(row.data.folders) ? row.data.folders : [])) {
              if (typeof title === "string" && title.trim()) folderFor(title);
            }
            result[row.id] = "applied";
            changed = true;
            continue;
          }
          const index = data.documents.findIndex(doc => doc.id === row.id);
          const isActive = row.id === data.activeId;
          if (isActive && (gesture || typing())) { result[row.id] = "busy"; continue; }
          if (row.deleted) {
            if (index >= 0) {
              const removed = data.documents[index];
              data.trash = [{ deletedAt: Date.now(), folderTitle: removed.folderId ? folderTitle(removed.folderId) : null, doc: { ...removed, folderId: null } }, ...(data.trash || [])].slice(0, 100);
              data.documents.splice(index, 1);
              if (!data.documents.length) data.documents.push(M.createDocument("page", crypto.randomUUID()));
              if (isActive) { data.activeId = data.documents[0].id; activeChanged = true; }
              changed = true;
            }
            result[row.id] = "applied";
            continue;
          }
          const previous = index >= 0 ? data.documents[index] : null;
          const doc = { ...(row.data || {}), id: row.id, folderId: folderFor(row.folder_title),
            view: previous ? previous.view : (row.data && row.data.view) || { x: 0, y: 0, scale: 1 } };
          try {
            M.validate({ version: 1, activeId: doc.id, documents: [doc], folders: data.folders });
          } catch (error) {
            console.warn("Werkplek-sync: document overgeslagen:", row.id, error.message);
            result[row.id] = "invalid";
            continue;
          }
          if (index >= 0) data.documents[index] = doc; else data.documents.push(doc);
          if (isActive) activeChanged = true;
          result[row.id] = "applied";
          changed = true;
        }
        if (changed) {
          persist();
          if (activeChanged) selectDocument(); else { list(); renderFolderButtons(); }
        }
        return result;
      },
      // ---- voor slim.js / nu.js (zoeken, prullenbak, versies, vakjes) ----
      notify,
      activeDocumentId() { return data.activeId; },
      isDrawing() { return !!gesture; },
      listDocuments() {
        return data.documents.filter(doc => !doc.formType).map(doc => ({
          id: doc.id, title: doc.title || "", kind: doc.kind, folder: folderTitle(doc.folderId),
          text: [doc.text || "", ...(doc.textBlocks || []).map(block => block.text)].join("\n"),
          transcript: doc.transcript || "", strokes: doc.strokes.length, transcriptStrokes: doc.transcriptStrokes || 0,
          defaultTitle: !doc.title || /^Nieuw (schriftblad|whiteboard)$/.test(doc.title) || / - notities$/.test(doc.title)
        }));
      },
      // Alle taakvakjes die nog open staan, over alle schriften en borden.
      openBoxes() {
        const list = [];
        for (const doc of data.documents) {
          if (doc.formType) continue;
          for (const stroke of doc.strokes) {
            if (!stroke.box || stroke.box.done) continue;
            const b = strokeBounds(stroke);
            list.push({ docId: doc.id, docTitle: doc.title || "Zonder titel", title: stroke.box.title || "", inWerkhub: !!stroke.box.taskId, x: b.left, y: b.top });
          }
        }
        return list;
      },
      // Naar een plek op een blad springen (bijvoorbeeld een vakje).
      goTo(id, x, y) {
        this.openDocument(id);
        const view = active().view;
        view.x = x - 40 / view.scale;
        view.y = y - 80 / view.scale;
        persistSoon();
        render();
      },
      openDocument(id) {
        finish();
        if (!data.documents.some(doc => doc.id === id)) throw new Error("Dit document bestaat niet meer.");
        data.activeId = id;
        persist();
        tab("writing");
        selectDocument();
      },
      documentCanvas(id) {
        const doc = data.documents.find(item => item.id === id);
        if (!doc || doc.formType) return null;
        return doc.strokes.length ? inkCanvas(doc.strokes) : null;
      },
      setTranscript(id, transcript, title) {
        const doc = data.documents.find(item => item.id === id);
        if (!doc) return false;
        doc.transcript = String(transcript || "").slice(0, 20000);
        doc.transcriptStrokes = doc.strokes.length;
        if (title) {
          doc.title = String(title).slice(0, 120);
          if (doc.id === data.activeId && document.activeElement !== $("title")) $("title").value = doc.title;
          list();
        }
        return persist();
      },
      trashList() {
        return (data.trash || []).map(item => ({ id: item.doc.id, title: item.doc.title || "", kind: item.doc.kind, folder: item.folderTitle, deletedAt: item.deletedAt }));
      },
      restoreFromTrash,
      purgeFromTrash(id) {
        const previous = data.trash;
        data.trash = (data.trash || []).filter(item => item.doc.id !== id);
        if (!persist()) { data.trash = previous; throw new Error("Opslaan mislukt."); }
      },
      documentSnapshot(id) {
        const doc = data.documents.find(item => item.id === id);
        return doc && !doc.formType ? JSON.stringify(doc) : null;
      },
      restoreVersion(id, json) {
        finish();
        const doc = data.documents.find(item => item.id === id);
        if (!doc) throw new Error("Dit document bestaat niet meer.");
        const version = JSON.parse(json);
        if (!version || version.id !== id || !Array.isArray(version.strokes)) throw new Error("Deze versie hoort niet bij dit document.");
        const before = JSON.stringify(doc);
        const next = { ...version, id: doc.id, folderId: doc.folderId, pdf: doc.pdf };
        if (!next.pdf) delete next.pdf;
        const documents = data.documents.map(item => item.id === id ? next : item);
        const candidate = { ...data, documents };
        M.validate(candidate);
        const previous = data;
        data = candidate;
        if (!persist()) { data = previous; throw new Error("Terugzetten mislukt: opslag vol."); }
        if (data.activeId === id) selectDocument();
        return before;
      },
      // Streken in een gebied (wereldcoördinaten) van het open document, als plaatje voor AI.
      inkIn(rect, exclude = null) {
        const doc = active();
        const strokes = doc.strokes.filter(stroke => stroke !== exclude && !stroke.box && M.intersectsBounds(strokeBounds(stroke), rect));
        return strokes.length ? { canvas: inkCanvas(strokes), count: strokes.length } : null;
      },
      inkFor(strokes) { return inkCanvas(strokes); },
      activeDocument() { return isMeasurement() ? null : active(); },
      selectedStrokes() {
        if (isMeasurement() || !selection?.indexes?.length) return [];
        return selection.indexes.map(index => active().strokes[index]).filter(Boolean);
      },
      strokeBounds,
      changed() { persist(); render(); },
      importFromSync(row) {
        finish();
        if (!row || typeof row.id !== "string" || !row.data || typeof row.data !== "object") throw new Error("WerkHub gaf een ongeldig document.");
        const doc = { ...row.data, id: row.id, title: typeof row.title === "string" ? row.title : row.data.title };
        delete doc.pdf;
        delete doc.formType;
        delete doc.formData;
        let folder = null;
        if (row.folder_title) {
          const target = normalizedFolderTitle(row.folder_title);
          folder = data.folders.find(item => normalizedFolderTitle(item.title) === target) || null;
        }
        const folders = folder || !row.folder_title ? data.folders : [...data.folders, { id: crypto.randomUUID(), title: String(row.folder_title).slice(0, 120) }];
        if (!folder && row.folder_title) folder = folders[folders.length - 1];
        doc.folderId = folder ? folder.id : null;
        const documents = data.documents.some(item => item.id === doc.id)
          ? data.documents.map(item => item.id === doc.id ? doc : item)
          : [...data.documents, doc];
        const next = { ...data, folders, documents, activeId: doc.id };
        M.validate(next);
        const previous = data;
        data = next;
        if (!persist()) { data = previous; throw new Error("Lokaal opslaan mislukt. Download eerst een back-up."); }
        selectDocument();
        return doc.title || "Zonder titel";
      },
      async createBackup() {
        finish();
        const snapshot = JSON.parse(JSON.stringify(data));
        return window.WorkplacePdf.backup(snapshot);
      },
      async restoreBackup(backup) {
        finish();
        const restored = await window.WorkplacePdf.restore(backup, M.validate);
        await window.WorkplaceStore.saveNow(JSON.stringify(M.validate(restored)));
        location.reload();
      },
      // Back-up openen zonder iets kwijt te raken: mappen op naam samenvoegen, documenten met
      // hetzelfde id vervangen, de rest erbij zetten.
      async mergeBackup(backup) {
        finish();
        const incoming = await window.WorkplacePdf.restore(backup, M.validate);
        const folders = [...data.folders];
        const folderMap = new Map();
        for (const folder of incoming.folders || []) {
          const match = folders.find(item => normalizedFolderTitle(item.title) === normalizedFolderTitle(folder.title));
          if (match) folderMap.set(folder.id, match.id);
          else { folders.push(folder); folderMap.set(folder.id, folder.id); }
        }
        const documents = [...data.documents];
        let added = 0, replaced = 0;
        for (const doc of incoming.documents || []) {
          const copy = { ...doc, folderId: doc.folderId ? (folderMap.get(doc.folderId) || null) : doc.folderId };
          const index = documents.findIndex(item => item.id === doc.id);
          if (index >= 0) { documents[index] = copy; replaced++; } else { documents.push(copy); added++; }
        }
        const next = { ...data, folders, documents };
        M.validate(next);
        const previous = data;
        data = next;
        if (!persist()) { data = previous; throw new Error("Lokaal opslaan mislukt: de opslag is vol."); }
        selectDocument();
        return { added, replaced };
      },
      captureInk() {
        finish();
        if (isMeasurement()) throw new Error("Open een schrift of whiteboard om handschrift te selecteren.");
        return inkCanvas(active().strokes);
      },
      // Voor "Opslaan als taak": de lasso-selectie (of anders het hele blad) als plaatje plus getypte tekst.
      captureSelection() {
        finish();
        if (isMeasurement()) throw new Error("Open een schrift of whiteboard om een taak uit te maken.");
        const doc = active();
        const selected = hasSelection();
        const strokes = selected ? selection.indexes.map(index => doc.strokes[index]).filter(Boolean) : doc.strokes;
        const blocks = selected ? selection.blocks.map(index => (doc.textBlocks || [])[index]).filter(Boolean) : (doc.textBlocks || []);
        return { selected, canvas: strokes.length ? inkCanvas(strokes) : null, text: blocks.map(block => block.text).join("\n").trim() };
      },
      insertAnswer(documentId, text) {
        finish();
        if (active().id !== documentId) throw new Error("Het oorspronkelijke blad is niet meer geopend. Open dat blad en probeer opnieuw.");
        if (typeof text !== "string" || !text.trim() || text.length > 20000) throw new Error("AI-antwoord is leeg of te groot om toe te voegen (maximaal 20.000 tekens).");
        const doc = active();
        if ((doc.textBlocks || []).length >= 100) throw new Error("Maximaal 100 tekstblokken per document. Maak een nieuw blad of bord.");
        const block = { text, x: doc.view.x + 24, y: doc.view.y + 24 };
        const ctx = worldContext("saved-drawing");
        ctx.font = "18px system-ui, sans-serif";
        const before = snapshot();
        const beforeView = { ...doc.view };
        for (const stroke of doc.strokes) {
          let left = Infinity, right = -Infinity, bottom = -Infinity;
          for (const point of stroke.points) {
            left = Math.min(left, point.x - stroke.width / 2);
            right = Math.max(right, point.x + stroke.width / 2);
            bottom = Math.max(bottom, point.y + stroke.width / 2);
          }
          if (right >= block.x - 8 && left <= block.x + 608) block.y = Math.max(block.y, bottom + 24);
        }
        for (const previous of doc.textBlocks || []) {
          if (Math.abs(previous.x - block.x) < 616) {
            block.y = Math.max(block.y, previous.y + textLines(ctx, previous.text).length * 24 + 24);
          }
        }
        doc.textBlocks = [...(doc.textBlocks || []), block];
        const rect = $("drawing").getBoundingClientRect();
        if (block.y > doc.view.y + rect.height / doc.view.scale - 48) doc.view.y = block.y - 24;
        if (!persist()) {
          restore(before);
          doc.view = beforeView;
          render();
          throw new Error("AI-antwoord niet toegevoegd: lokale opslag mislukt. Download een back-up.");
        }
        undo.push(before);
        if (undo.length > 50) undo.shift();
        redo = [];
        render();
      }
    };
    async function refreshPdfLibrary() {
      try {
        const files = await window.WorkplacePdf.list();
        const options = files.map(file => {
          const option = document.createElement("option");
          option.value = file.id;
          option.textContent = `${file.name} (${file.pages} pagina${file.pages === 1 ? "" : "'s"})`;
          return option;
        });
        if (!options.length) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "Nog geen PDF-bestanden";
          options.push(option);
        }
        $("pdf-library-list").replaceChildren(...options);
        $("pdf-library-open").disabled = !files.length;
        $("pdf-library-download").disabled = !files.length;
        $("pdf-library-status").textContent = files.length
          ? `${files.length} lokaal opgeslagen PDF-bestand${files.length === 1 ? "" : "en"}.`
          : "Voeg eerst een PDF toe met Achtergrond of Nieuw bord.";
      } catch (error) {
        $("pdf-library-status").textContent = error.message;
        $("pdf-library-open").disabled = true;
        $("pdf-library-download").disabled = true;
      }
    }

    $("pdf-library-open").addEventListener("click", async () => {
      try {
        finish();
        const reference = await window.WorkplacePdf.reference($("pdf-library-list").value);
        const doc = M.createDocument("board", crypto.randomUUID());
        doc.title = reference.name.replace(/\.pdf$/i, "").slice(0, 120) || "PDF";
        doc.folderId = active().folderId || null;
        doc.pdf = reference;
        data.documents.push(doc);
        data.activeId = doc.id;
        if (!persist()) throw new Error("PDF-bord kon niet lokaal worden opgeslagen.");
        selectDocument();
      } catch (error) { report(error); }
    });
    $("pdf-library-download").addEventListener("click", async () => {
      try { await window.WorkplacePdf.original($("pdf-library-list").value); }
      catch (error) { report(error); }
    });
    refreshPdfLibrary();

    async function importPdfInput(input, createBoard) {
      finish();
      const files = [...input.files];
      if (!files.length) return;
      const original = active();
      if (!createBoard && (original.kind !== "board" || original.pdf || isMeasurement(original))) {
        $("pdf-status").textContent = "Maak of open een whiteboard zonder PDF om dit bestand toe te voegen.";
        input.value = "";
        return;
      }
      input.disabled = true;
      let added = 0, lastDoc = null;
      const failed = [];
      try {
        for (const [index, file] of (createBoard ? files : files.slice(0, 1)).entries()) {
          $("pdf-status").textContent = files.length > 1 ? `PDF ${index + 1} van ${files.length} verwerken: ${file.name}` : "PDF verwerken...";
          try {
            const reference = await window.WorkplacePdf.importFile(file);
            let doc = original;
            if (createBoard) {
              doc = M.createDocument("board", crypto.randomUUID());
              doc.title = file.name.replace(/\.pdf$/i, "").slice(0, 120) || "Werkbeschrijving";
              doc.folderId = original.folderId || null;
              data.documents.push(doc);
            }
            doc.pdf = reference;
            if (!persist()) {
              if (createBoard) data.documents = data.documents.filter(item => item.id !== doc.id); else delete doc.pdf;
              throw new Error("lokale opslag vol");
            }
            added++;
            lastDoc = doc;
            window.WorkplacePdf.cloudUpload(reference.id).catch(error => console.warn("Werkplek: PDF-upload volgt later:", error.message));
          } catch (error) {
            failed.push(`${file.name}: ${error.message}`);
          }
        }
        if (lastDoc && createBoard) { data.activeId = lastDoc.id; persist(); selectDocument(); }
        else if (lastDoc) await loadPdf();
        await refreshPdfLibrary();
        const folderName = folderTitle(original.folderId);
        notify(`${added} PDF${added === 1 ? "" : "'s"} toegevoegd in ${folderName}${failed.length ? `. Niet gelukt: ${failed.join("; ")}` : ". Ze staan ook in de cloud en op je andere apparaten."}`, "", null, 9000);
        if (failed.length) report(new Error(`Niet alle PDF's toegevoegd: ${failed.join("; ")}`));
      } finally { input.disabled = false; input.value = ""; }
    }
    $("pdf-file").addEventListener("change", () => importPdfInput($("pdf-file"), false));
    $("work-pdf-file").addEventListener("change", () => importPdfInput($("work-pdf-file"), true));
    $("pdf-original").addEventListener("click", async () => {
      try { if (active().pdf) await window.WorkplacePdf.original(active().pdf.id); }
      catch (error) { report(error); }
    });
    $("width").addEventListener("input", () => { $("width-value").textContent = $("width").value; });
    $("reset-diagnostics").addEventListener("click", () => {
      finish();
      diagnostics = emptyDiagnostics();
      updateDiagnostics();
    });
    $("focus").addEventListener("click", () => {
      finish();
      const on = document.body.classList.toggle("writing-focus");
      setFocusLabel(on);
      $("content-backup").open = false;
      render();
    });
    $("save-now").addEventListener("click", () => {
      finish();
      if (persist()) $("save-status").textContent = `Nu opgeslagen om ${new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}.`;
    });
    selectDocument();
    $("content-folder").addEventListener("change", () => {
      list($("content-folder").value === noFolderValue ? null : $("content-folder").value);
    });
    $("documents").addEventListener("change", () => {
      if (!$("documents").value) return;
      finish();
      data.activeId = $("documents").value;
      selectDocument();
      persist();
    });
    $("delete-document").addEventListener("click", () => {
      deleteActiveDocument().catch(report);
    });
    $("new-folder").addEventListener("click", () => {
      finish();
      const title = window.prompt("Naam van de nieuwe map:", "");
      if (title === null) return;
      const clean = title.trim();
      if (!clean || clean.length > 120) {
        report(new Error("Geef een mapnaam van 1 tot en met 120 tekens."));
        return;
      }
      const previousId = active().id;
      const folder = { id: crypto.randomUUID(), title: clean };
      data.folders.push(folder);
      const doc = M.createDocument("page", crypto.randomUUID());
      doc.folderId = folder.id;
      doc.title = `${clean} - notities`;
      data.documents.push(doc);
      data.activeId = doc.id;
      selectDocument();
      if (!persist()) {
        data.documents = data.documents.filter(item => item.id !== doc.id);
        data.folders = data.folders.filter(item => item.id !== folder.id);
        data.activeId = previousId;
        selectDocument();
        report(new Error("Nieuwe map niet opgeslagen. Download eerst een back-up."));
      }
    });
    for (const [button, kind] of [["new-page", "page"], ["new-board", "board"]]) {
      $(button).addEventListener("click", () => {
        finish();
        // Nieuw blad/bord komt in de map die je in "Map" hebt gekozen (ook als die nog leeg is).
        const chosen = $("content-folder").value;
        const folderId = chosen === noFolderValue ? null
          : (chosen && data.folders.some(folder => folder.id === chosen) ? chosen : active().folderId || null);
        const doc = M.createDocument(kind, crypto.randomUUID());
        doc.folderId = folderId;
        data.documents.push(doc);
        data.activeId = doc.id;
        selectDocument();
        persist();
      });
    }
    $("measurement-editor").addEventListener("input", event => {
      const field = event.target.dataset.measureField;
      if (!field || !isMeasurement()) return;
      active().formData[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
      persist();
    });
    $("measurement-editor").addEventListener("change", event => {
      const field = event.target.dataset.measureField;
      if (!field || !isMeasurement()) return;
      active().formData[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
      persist();
    });
    for (const field of ["title", "text"]) $(field).addEventListener("input", () => {
      active()[field] = $(field).value;
      if (field === "title") list(active().folderId || null);
      persist();
    });
    const drawingToolIds = ["pen", "marker-tool", "highlighter-tool", "text-tool", "move", "eraser", "scratch-eraser", "select-ink", "shape-tool"];
    const brushSettings = {
      pen: { color: "#173c39", width: 4 }, fineliner: { color: "#173c39", width: 2 },
      dashed: { color: "#173c39", width: 4 }, marker: { color: "#173c39", width: 10 },
      highlighter: { color: "#ffe066", width: 22 }
    };
    let currentBrush = $("brush").value;
    const syncToolButtons = () => {
      const brush = $("brush").value, shape = $("shape").value;
      $("pen").setAttribute("aria-pressed", String(tool === "pen" && !shape && !["marker", "highlighter"].includes(brush)));
      $("marker-tool").setAttribute("aria-pressed", String(tool === "pen" && !shape && brush === "marker"));
      $("highlighter-tool").setAttribute("aria-pressed", String(tool === "pen" && !shape && brush === "highlighter"));
      $("shape-tool").setAttribute("aria-pressed", String(tool === "pen" && !!shape));
      for (const id of ["move", "eraser", "scratch-eraser", "select-ink"]) $(id).setAttribute("aria-pressed", String(tool === id));
      $("text-tool").setAttribute("aria-pressed", String(tool === "text"));
      $("drawing-tools").dataset.tool = tool;
    };
    const syncColorSwatches = () => document.querySelectorAll("[data-color]").forEach(button =>
      button.setAttribute("aria-pressed", String(button.dataset.color.toLowerCase() === $("color").value.toLowerCase())));
    const rememberBrushSettings = () => {
      if (brushSettings[currentBrush]) brushSettings[currentBrush] = { color: $("color").value, width: Number($("width").value) };
    };
    const activateTool = name => {
      finish();
      tool = name;
      if (name !== "select-ink") clearSelection();
      syncToolButtons();
    };
    const activateBrush = name => {
      rememberBrushSettings();
      currentBrush = name;
      $("brush").value = name;
      $("shape").value = "";
      const settings = brushSettings[name] || brushSettings.pen;
      $("color").value = settings.color;
      $("width").value = String(settings.width);
      $("width-value").textContent = String(settings.width);
      syncColorSwatches();
      activateTool("pen");
    };
    $("pen").addEventListener("click", () => activateBrush("pen"));
    $("marker-tool").addEventListener("click", () => activateBrush("marker"));
    $("highlighter-tool").addEventListener("click", () => activateBrush("highlighter"));
    for (const name of ["move", "eraser", "scratch-eraser", "select-ink"]) $(name).addEventListener("click", () => activateTool(name));
    $("text-tool").addEventListener("click", () => {
      activateTool("text");
      notify("Tekst: tik op het blad waar je wilt typen. Tik op bestaande tekst om hem aan te passen.", "", null, 4000);
    });
    const textEditor = $("text-editor");
    textEditor.addEventListener("pointerdown", event => event.stopPropagation());
    textEditor.addEventListener("input", () => {
      textEditor.style.height = "auto";
      textEditor.style.height = `${textEditor.scrollHeight}px`;
    });
    textEditor.addEventListener("blur", () => closeTextEditor(true));
    // iOS opent het toetsenbord soms pas bij de "click" na het tikken.
    $("drawing").addEventListener("click", () => { if (textEdit && document.activeElement !== textEditor) textEditor.focus(); });
    textEditor.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); closeTextEditor(false); }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); textEditor.blur(); }
    });
    $("shape-tool").addEventListener("click", () => {
      const palette = $("shape-palette");
      palette.hidden = !palette.hidden;
      $("shape-tool").setAttribute("aria-expanded", String(!palette.hidden));
    });
    $("shape-palette").querySelectorAll("[data-shape]").forEach(button => button.addEventListener("click", () => {
      $("shape").value = button.dataset.shape;
      $("shape-palette").hidden = true;
      $("shape-tool").setAttribute("aria-expanded", "false");
      activateTool("pen");
    }));
    document.querySelectorAll("[data-color]").forEach(button => button.addEventListener("click", () => {
      $("color").value = button.dataset.color;
      rememberBrushSettings();
      syncColorSwatches();
    }));
    $("color").addEventListener("input", () => { rememberBrushSettings(); syncColorSwatches(); });
    $("width").addEventListener("input", rememberBrushSettings);
    syncColorSwatches();
    $("selection-copy").addEventListener("click", () => copySelection(false));
    $("selection-cut").addEventListener("click", () => copySelection(true));
    $("selection-paste").addEventListener("click", pasteSelection);
    $("undo").addEventListener("click", () => {
      finish();
      selection = null;
      updateSelectionButtons();
      if (undo.length) {
        redo.push(snapshot());
        restore(undo.pop());
      } else if (active().strokes.length) {
        redo.push(snapshot());
        active().strokes = active().strokes.slice(0, -1);
      }
      persist();
      render();
    });
    $("redo").addEventListener("click", () => {
      finish();
      selection = null;
      updateSelectionButtons();
      if (redo.length) {
        undo.push(snapshot());
        restore(redo.pop());
      }
      persist();
      render();
    });
    for (const [id, factor] of [["zoom-in", 1.25], ["zoom-out", .8]]) $(id).addEventListener("click", () => {
      finish();
      const rect = $("drawing").getBoundingClientRect();
      active().view = M.zoom(active().view, factor, rect.width, rect.height);
      persist();
      render();
    });
    $("reset").addEventListener("click", () => {
      finish();
      active().view = { x: 0, y: 0, scale: 1 };
      persist();
      render();
    });
    $("finger").addEventListener("change", () => { finish(); });
    $("auto-scratch").checked = autoScratchEnabled();
    $("auto-scratch").addEventListener("change", () => {
      try { localStorage.setItem("remy-ipad-auto-scratch", $("auto-scratch").checked ? "1" : "0"); } catch (error) { /* voorkeur blijft alleen in dit venster */ }
    });
    $("clear-page").addEventListener("click", () => {
      finish();
      const doc = active();
      const page = Math.min((doc.pages || 1) - 1, Math.max(0, Math.floor((doc.view.y + 24) / 1144)));
      if (!window.confirm(doc.kind === "board" ? "Alle penstreken op dit whiteboard verwijderen? Ongedaan kan dit herstellen." : `Alle inkt op pagina ${page + 1} verwijderen? Andere pagina's en getypte tekst blijven bewaard.`)) return;
      const result = doc.kind === "board" ? { changed: !!doc.strokes.length, strokes: [] } : M.clearPage(doc.strokes, page);
      if (result.changed) { remember(doc.strokes.slice()); doc.strokes = result.strokes; persist(); render(); }
    });
    for (const [id, step] of [["previous-page", -1], ["next-page", 1], ["add-page", 0]]) $(id).addEventListener("click", () => {
      finish();
      const doc = active();
      if (doc.kind !== "page") return;
      const pages = doc.pages || 1;
      if (step === 0 && pages >= 200) { report(new Error("Maximaal 200 pagina's per schrift. Maak een nieuw schrift.")); return; }
      const current = Math.min(pages - 1, Math.max(0, Math.floor((doc.view.y + 24) / 1144)));
      if (step === 0) doc.pages = pages + 1;
      const page = step === 0 ? pages : Math.min(pages - 1, Math.max(0, current + step));
      doc.view.y = page * 1144;
      persist();
      render();
    });
    const canvas = $("drawing");
    const quickTools = $("quick-tools");
    const hideQuickTools = () => { quickTools.hidden = true; };
    const showQuickTools = (clientX, clientY) => {
      if (gesture?.stroke) {
        const pointerId = gesture.id;
        gesture.stroke = null;
        gesture = null;
        clear("drawing");
        if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
      }
      quickPoint = M.point(clientX, clientY, $("drawing").getBoundingClientRect(), active().view);
      const rect = $("surface").getBoundingClientRect();
      quickTools.style.left = `${Math.max(10, Math.min(rect.width - 340, clientX - rect.left))}px`;
      quickTools.style.top = `${Math.max(10, Math.min(rect.height - 230, clientY - rect.top))}px`;
      $("quick-color").value = $("color").value;
      $("quick-width").value = $("width").value;
      quickTools.hidden = false;
    };
    quickTools.addEventListener("pointerdown", event => event.stopPropagation());
    quickTools.querySelectorAll("[data-quick-brush]").forEach(button => button.addEventListener("click", () => {
      activateBrush(button.dataset.quickBrush);
      hideQuickTools();
    }));
    let quickPoint = null;
    quickTools.querySelector("[data-quick-box]").addEventListener("click", () => {
      hideQuickTools();
      if (!quickPoint || isMeasurement()) return;
      // Taakvakje stempelen: een vierkantje waar je de taak achter schrijft.
      const size = 26, { x, y } = quickPoint;
      const points = [{ x, y: y - size / 2 }, { x: x + size, y: y + size / 2 }];
      const stroke = { color: $("color").value, width: Math.max(2, Math.min(4, Number($("width").value) || 3)), brush: "pen", shape: "rectangle", points,
        box: { id: crypto.randomUUID() } };
      remember(active().strokes.slice());
      active().strokes.push(stroke);
      persist();
      render();
      notify("Taakvakje geplaatst. Schrijf je taak erachter; na een paar tellen staat hij in WerkHub.");
    });
    quickTools.querySelectorAll("[data-quick-task]").forEach(button => button.addEventListener("click", () => {
      hideQuickTools();
      window.WorkplaceWerkhub?.taskFromInk(button.dataset.quickTask);
    }));
    const selectionMenu = $("selection-menu");
    selectionMenu.addEventListener("pointerdown", event => event.stopPropagation());
    selectionMenu.querySelector("[data-sel='copy']").addEventListener("click", () => copySelection(false));
    selectionMenu.querySelector("[data-sel='cut']").addEventListener("click", () => copySelection(true));
    selectionMenu.querySelector("[data-sel='tidy']").addEventListener("click", tidySelection);
    $("text-tidy").addEventListener("click", tidyNotes);
    selectionMenu.querySelectorAll("[data-sel-task]").forEach(button => button.addEventListener("click", () => {
      // Zit er precies één taakvakje in de lasso, dan wordt de selectie de taak van dat vakje.
      if (window.WorkplaceSmart?.boxFromSelection()) return;
      window.WorkplaceWerkhub?.taskFromInk(button.dataset.selTask);
    }));
    quickTools.querySelector("[data-quick-tool='eraser']").addEventListener("click", () => {
      activateTool("eraser");
      hideQuickTools();
    });
    $("quick-color").addEventListener("input", () => { $("color").value = $("quick-color").value; rememberBrushSettings(); syncColorSwatches(); });
    $("quick-width").addEventListener("input", () => {
      $("width").value = $("quick-width").value;
      $("width-value").textContent = $("width").value;
      rememberBrushSettings();
    });
    const touchPair = () => [...touches.values()].slice(0, 2);
    const startPinch = () => {
      const [a, b] = touchPair();
      if (gesture && gesture.type === "pen") return;
      if (gesture) {
        endDiagnostics(gesture, "tweevingerzoom");
        gesture = null;
        clear("drawing");
        livePoints = 0;
      }
      pinch = { a, b, view: { ...active().view } };
    };
    $("writing").addEventListener("selectstart", event => {
      if (event.target instanceof Element && !event.target.closest("input, textarea, select")) event.preventDefault();
    });
    canvas.addEventListener("touchstart", event => event.preventDefault(), { passive: false });
    canvas.addEventListener("touchmove", event => event.preventDefault(), { passive: false });
    canvas.addEventListener("contextmenu", event => event.preventDefault());
    canvas.addEventListener("pointerdown", event => {
      event.preventDefault();
      hideQuickTools();
      const pageSelection = window.getSelection();
      if (pageSelection && !pageSelection.isCollapsed) pageSelection.removeAllRanges();
      if (document.activeElement instanceof HTMLElement && document.activeElement.matches("input, textarea, select")) document.activeElement.blur();
      const kind = ["pen", "touch", "mouse"].includes(event.pointerType) ? event.pointerType : "other";
      diagnostics[kind]++;
      diagnostics.last = kind;
      if (kind === "pen") {
        pinch = null;
        touches.clear();
        if ($("saved-drawing").style.transform) render(); // nooit schrijven op een meegeschaald voorbeeld
      }
      if (kind === "touch") {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        // Een tweede aanraking (handpalm) mag een lopende gumbeweging niet afbreken.
        const erasing = gesture && gesture.type === "touch" && (gesture.tool === "eraser" || gesture.tool === "scratch-eraser");
        if (touches.size >= 2 && !erasing && (!gesture || gesture.type !== "pen")) {
          canvas.setPointerCapture(event.pointerId);
          startPinch();
          updateDiagnostics();
          return;
        }
      }
      if (gesture && event.pointerType === "pen" && gesture.type === "touch") {
        // A classified pen replaces an uncommitted touch stroke, not a stored note.
        const old = gesture;
        endDiagnostics(old, "vervangen door pen");
        gesture = null;
        if (old.tool === "move") {
          active().view = old.view;
          render();
        }
        if (canvas.hasPointerCapture(old.id)) canvas.releasePointerCapture(old.id);
        clear("drawing");
        livePoints = 0;
      }
      if (gesture || event.button !== 0 || kind === "other") {
        diagnostics.ignored++;
        updateDiagnostics();
        return;
      }
      updateDiagnostics();
      canvas.setPointerCapture(event.pointerId);
      const point = M.point(event.clientX, event.clientY, canvas.getBoundingClientRect(), active().view);
      const now = performance.now();
      // Tekst-tool: tikken (vinger, pen of muis) opent het typen; slepen schuift het blad.
      const inputTool = tool === "text" ? "text-tap" : kind === "touch" && !$("finger").checked ? "move" : tool;
      gesture = { id: event.pointerId, type: event.pointerType, tool: inputTool, clientX: event.clientX, clientY: event.clientY, view: { ...active().view },
        metrics: { start: now, last: now, gap: 0, moves: 0, samples: 1 } };
      if (inputTool === "pen") {
        gesture.stroke = { color: $("color").value, width: Number($("width").value), brush: $("brush").value, points: [point] };
        // Pen en fineliner krijgen dikte per punt; begint iets dunner, zoals een echte pen die neerkomt.
        if (!$("shape").value && ["pen", "fineliner"].includes(gesture.stroke.brush)) {
          point.w = .85;
          gesture.ink = { t: event.timeStamp, cx: event.clientX, cy: event.clientY };
        }
        if ($("shape").value) {
          gesture.stroke.shape = $("shape").value;
          gesture.stroke.points.push({ ...point });
        }
      }
      if (inputTool === "eraser" || inputTool === "scratch-eraser") {
        gesture.eraserRadius = Number($("eraser-size").value);
        gesture.before = active().strokes.slice();
        gesture.lastPoint = point;
        gesture.ring = { x: event.clientX, y: event.clientY };
        if (inputTool === "eraser") eraseAt(point);
        else scratchEraseAt(point);
      }
      if (inputTool === "select-ink") {
        const bounds = selectionBounds();
        const margin = 12 / active().view.scale;
        const grab = 22 / active().view.scale;
        const corners = bounds ? [[bounds.left, bounds.top, bounds.right, bounds.bottom], [bounds.right, bounds.top, bounds.left, bounds.bottom],
          [bounds.left, bounds.bottom, bounds.right, bounds.top], [bounds.right, bounds.bottom, bounds.left, bounds.top]] : [];
        const corner = corners.find(([cx, cy]) => Math.hypot(point.x - cx, point.y - cy) <= grab);
        if (corner) {
          // Hoekje vastpakken: vergroten/verkleinen vanaf de tegenoverliggende hoek, inkt wordt mee dikker/dunner.
          gesture.before = active().strokes;
          gesture.beforeBlocks = active().textBlocks || [];
          gesture.moveSelection = {
            strokes: selection.indexes.map(index => ({ index, points: active().strokes[index].points })),
            blocks: (selection.blocks || []).map(index => ({ index, x: gesture.beforeBlocks[index].x, y: gesture.beforeBlocks[index].y }))
          };
          gesture.resize = { anchor: { x: corner[2], y: corner[3] }, start: { x: corner[0], y: corner[1] } };
          gesture.moveStart = point;
        } else if (bounds && point.x >= bounds.left - margin && point.x <= bounds.right + margin && point.y >= bounds.top - margin && point.y <= bounds.bottom + margin) {
          // Verplaatsen: de oude streken blijven ongewijzigd bewaard (voor Ongedaan); alleen kopieen schuiven mee.
          gesture.before = active().strokes;
          gesture.beforeBlocks = active().textBlocks || [];
          gesture.moveSelection = {
            strokes: selection.indexes.map(index => ({ index, points: active().strokes[index].points })),
            blocks: (selection.blocks || []).map(index => ({ index, x: gesture.beforeBlocks[index].x, y: gesture.beforeBlocks[index].y }))
          };
          gesture.moveStart = point;
        } else {
          selection = { indexes: [], blocks: [], lasso: gesture.lassoPoints = [point] };
        }
      }
      if (inputTool === "pen" && !$("shape").value) {
        longPressOrigin = { x: event.clientX, y: event.clientY };
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => showQuickTools(event.clientX, event.clientY), 650);
      }
      livePoints = 0;
      drawLive();
    });
    canvas.addEventListener("pointermove", event => {
      if (event.pointerType === "touch" && touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && touches.size >= 2) {
        event.preventDefault();
        const [a, b] = touchPair();
        const rect = canvas.getBoundingClientRect();
        active().view = M.pinch(pinch.view, pinch.a, pinch.b, a, b, rect);
        if (frame === null) frame = requestAnimationFrame(() => { frame = null; previewView(); });
        return;
      }
      if (!gesture || gesture.id !== event.pointerId) return;
      event.preventDefault();
      if (longPressOrigin && Math.hypot(event.clientX - longPressOrigin.x, event.clientY - longPressOrigin.y) > 8) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        longPressOrigin = null;
      }
      const now = performance.now();
      gesture.metrics.moves++;
      gesture.metrics.gap = Math.max(gesture.metrics.gap, now - gesture.metrics.last);
      gesture.metrics.last = now;
      if (gesture.stroke) {
        if (gesture.stroke.shape) {
          gesture.metrics.samples++;
          gesture.stroke.points[1] = M.point(event.clientX, event.clientY, canvas.getBoundingClientRect(), active().view);
          clear("drawing");
          livePoints = 0;
          drawStroke(worldContext("drawing"), gesture.stroke);
          return;
        }
        const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
        addSamples(events.length ? events : [event]);
        const lastSample = events[events.length - 1];
        if (lastSample && (lastSample.clientX !== event.clientX || lastSample.clientY !== event.clientY)) addSamples([event]);
        drawLive();
      } else if (gesture.tool === "eraser") {
        const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
        for (const sample of [...events, event]) {
          gesture.metrics.samples++;
          eraseAt(M.point(sample.clientX, sample.clientY, canvas.getBoundingClientRect(), active().view));
        }
        gesture.ring = { x: event.clientX, y: event.clientY };
        clear("drawing");
        drawLive();
      } else if (gesture.tool === "scratch-eraser") {
        const point = M.point(event.clientX, event.clientY, canvas.getBoundingClientRect(), active().view);
        scratchEraseAt(point);
        gesture.ring = { x: event.clientX, y: event.clientY };
        clear("drawing");
        drawLive();
      } else if (gesture.tool === "select-ink") {
        const point = M.point(event.clientX, event.clientY, canvas.getBoundingClientRect(), active().view);
        if (gesture.moveSelection && gesture.resize) {
          const { anchor, start } = gesture.resize;
          const sx = start.x - anchor.x, sy = start.y - anchor.y;
          const along = ((point.x - anchor.x) * sx + (point.y - anchor.y) * sy) / Math.max(1e-6, sx * sx + sy * sy);
          const k = Math.max(.15, Math.min(8, along));
          if (Math.abs(k - 1) > .001) gesture.moved = true;
          const strokes = gesture.before.slice();
          for (const item of gesture.moveSelection.strokes) {
            const original = gesture.before[item.index];
            strokes[item.index] = { ...original, width: Math.max(.5, Math.min(40, original.width * k)),
              points: item.points.map(value => ({ ...value, x: anchor.x + (value.x - anchor.x) * k, y: anchor.y + (value.y - anchor.y) * k })) };
          }
          active().strokes = strokes;
          if (gesture.moveSelection.blocks.length) {
            const moving = new Map(gesture.moveSelection.blocks.map(item => [item.index, item]));
            active().textBlocks = gesture.beforeBlocks.map((block, index) => moving.has(index)
              ? { ...block, x: anchor.x + (moving.get(index).x - anchor.x) * k, y: anchor.y + (moving.get(index).y - anchor.y) * k } : block);
          }
          scheduleRender();
        } else if (gesture.moveSelection) {
          const dx = point.x - gesture.moveStart.x, dy = point.y - gesture.moveStart.y;
          if (dx || dy) gesture.moved = true;
          const strokes = gesture.before.slice();
          for (const item of gesture.moveSelection.strokes) {
            strokes[item.index] = { ...gesture.before[item.index], points: item.points.map(value => ({ ...value, x: value.x + dx, y: value.y + dy })) };
          }
          active().strokes = strokes;
          if (gesture.moveSelection.blocks.length) {
            const moving = new Map(gesture.moveSelection.blocks.map(item => [item.index, item]));
            active().textBlocks = gesture.beforeBlocks.map((block, index) => moving.has(index) ? { ...block, x: moving.get(index).x + dx, y: moving.get(index).y + dy } : block);
          }
          scheduleRender();
        } else {
          const previous = gesture.lassoPoints[gesture.lassoPoints.length - 1];
          if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 2 / active().view.scale) gesture.lassoPoints.push(point);
          selection.lasso = gesture.lassoPoints;
          clear("drawing");
          drawSelectionOverlay();
        }
      } else {
        gesture.metrics.samples++;
        active().view.x = gesture.view.x - (event.clientX - gesture.clientX) / gesture.view.scale;
        active().view.y = gesture.view.y - (event.clientY - gesture.clientY) / gesture.view.scale;
        if (frame === null) frame = requestAnimationFrame(() => { frame = null; previewView(); });
      }
    });
    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      if (gesture) return;
      const rect = canvas.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      active().view.x += event.deltaX * unit / active().view.scale;
      active().view.y += event.deltaY * unit / active().view.scale;
      persist();
      render();
    }, { passive: false });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, event => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressOrigin = null;
      if (event.pointerType === "touch") {
        touches.delete(event.pointerId);
        if (pinch) {
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          if (touches.size < 2) { pinch = null; touches.clear(); render(); persistSoon(); }
          return;
        }
      }
      finish(event);
    });
    new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || (rect.width === renderedWidth && rect.height === renderedHeight)) return;
      finish(null, "formaatwijziging");
      render();
    }).observe(canvas);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        finish(null, "pagina verborgen");
        persist();
      }
    });
    window.addEventListener("pagehide", () => {
      finish(null, "pagina verlaten");
      persist();
    });
    let importMode = "merge";
    const readBackupFile = file => new Promise((resolve, reject) => {
      if (!file) return reject(new Error("Geen bestand gekozen."));
      if (file.size > 150 * 1024 * 1024) return reject(new Error("Dit bestand is te groot voor een Werkplek-back-up."));
      const reader = new FileReader();
      reader.onload = () => { try { resolve(JSON.parse(reader.result)); } catch (error) { reject(new Error("Dit is geen geldige Werkplek-back-up (geen JSON).")); } };
      reader.onerror = () => reject(new Error("Bestand lezen mislukt."));
      reader.readAsText(file);
    });
    $("import-merge").addEventListener("click", () => { importMode = "merge"; $("import-file").value = ""; $("import-file").click(); });
    $("import-replace").addEventListener("click", () => { importMode = "replace"; $("import-file").value = ""; $("import-file").click(); });
    $("import-file").addEventListener("change", async () => {
      const file = $("import-file").files[0];
      if (!file) return;
      try {
        const backup = await readBackupFile(file);
        if (importMode === "replace") {
          if (!window.confirm(`Alles vervangen door ${file.name}? Wat nu op deze iPad staat en niet in de back-up zit, is daarna weg.`)) return;
          $("save-status").textContent = "Back-up terugzetten...";
          await window.WorkplaceWriting.restoreBackup(backup);
          return;
        }
        $("save-status").textContent = "Back-up openen...";
        const result = await window.WorkplaceWriting.mergeBackup(backup);
        $("save-status").textContent = `Back-up geopend: ${result.added} nieuw, ${result.replaced} bijgewerkt. Niets anders is weggehaald.`;
      } catch (error) { report(error); }
    });
    $("export").addEventListener("click", async () => {
      finish();
      $("export").disabled = true;
      try {
        const snapshot = JSON.parse(JSON.stringify(data));
        const backup = await window.WorkplacePdf.backup(snapshot);
        window.WorkplacePdf.download(new Blob([JSON.stringify(backup)], { type: "application/json" }),
          `werkplek-backup-${new Date().toISOString().slice(0, 10)}.json`);
        $("save-status").textContent = "Lokale back-up gedownload.";
      } catch (error) { report(error); }
      finally { $("export").disabled = false; }
    });
  }
  })().catch(report);

  function addSamples(events) {
    const rect = $("drawing").getBoundingClientRect();
    for (const sample of events) {
      gesture.metrics.samples++;
      const point = M.point(sample.clientX, sample.clientY, rect, active().view);
      const last = gesture.stroke.points[gesture.stroke.points.length - 1];
      if (point.x === last.x && point.y === last.y) continue;
      if (gesture.ink) {
        point.w = inkWidth(last.w || 1, sample, gesture.ink);
        gesture.ink = { t: sample.timeStamp, cx: sample.clientX, cy: sample.clientY };
      }
      gesture.stroke.points.push(point);
    }
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const offlineErrorKey = "remy-ipad-offline-error-v14";
    if (localStorage.getItem(offlineErrorKey) === "1") {
      $("update-status").hidden = false;
      $("update-status").textContent = "Offline opslag kon niet volledig worden ingesteld. De online app blijft werken; herlaad later online voordat je zonder internet werkt.";
    }
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      $("update-status").hidden = false;
    });
    navigator.serviceWorker.addEventListener("message", event => {
      if (event.data?.type === "offline-ready") {
        localStorage.removeItem(offlineErrorKey);
        return;
      }
      if (event.data?.type === "offline-error") {
        localStorage.setItem(offlineErrorKey, "1");
        $("update-status").hidden = false;
        $("update-status").textContent = "Offline opslag kon niet volledig worden ingesteld. De online app blijft werken; herlaad later online voordat je zonder internet werkt.";
      }
    });
    navigator.serviceWorker.register("./sw.js").catch(error => {
      report(new Error(`Offline openen is niet ingesteld: ${error.message}`));
    });
  }
})();
