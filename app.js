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

  function persist() {
    if (blocked) return false;
    try {
      const result = window.WorkplaceStore.save(JSON.stringify(M.validate(data)));
      $("save-status").textContent = result.localOk ? "Lokaal opgeslagen. Drive-back-up via Back-up." : "Lokaal opgeslagen (grote opslag). Drive-back-up via Back-up.";
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
      ctx.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
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
      const handle = 5 / scale;
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
    for (const block of doc.textBlocks || []) {
      if (block.y <= viewport.bottom && block.y + 1000 >= viewport.top) drawTextBlock(ctx, block);
    }
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

  function render() {
    frame = null;
    const doc = active();
    if (isMeasurement(doc)) return;
    const rect = $("drawing").getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderedWidth = rect.width;
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
    help.textContent = "Vul deze vaste meetstatus in, neem de waarden over in het officiële logboek en maak de lijst daarna leeg. Opslag is lokaal en via jouw bewuste Drive-back-up.";
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
      const images = await window.WorkplacePdf.images(doc.pdf.id);
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
    gesture = null;
    clear("drawing");
    livePoints = 0;
    if ($("drawing").hasPointerCapture(old.id)) $("drawing").releasePointerCapture(old.id);
    persist();
    if (scratchNote) $("save-status").textContent = scratchNote;
    updateControls();
    updateSelectionButtons();
    if (!old.stroke || old.scratched) render();
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

  function pasteSelection() {
    const doc = active();
    const room = Math.max(0, 100 - (doc.textBlocks || []).length);
    const blocks = inkClipboard.blocks.slice(0, room);
    if (!inkClipboard.strokes.length && !blocks.length) return;
    remember(doc.strokes.slice(), (doc.textBlocks || []).slice());
    const pasted = inkClipboard.strokes.map(stroke => ({
      ...JSON.parse(JSON.stringify(stroke)),
      points: stroke.points.map(point => ({ x: point.x + 24, y: point.y + 24 }))
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
      doc = definition.formType
        ? M.createMeasurementDocument(definition.formType, crypto.randomUUID())
        : M.createDocument("page", crypto.randomUUID());
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
      const file = input.files[0];
      if (!file) return;
      const original = active();
      let doc = original;
      if (!createBoard && (doc.kind !== "board" || doc.pdf || isMeasurement(doc))) {
        $("pdf-status").textContent = "Maak of open een whiteboard zonder PDF om dit bestand toe te voegen.";
        input.value = "";
        return;
      }
      input.disabled = true;
      $("pdf-status").textContent = "PDF lokaal verwerken...";
      try {
        const reference = await window.WorkplacePdf.importFile(file);
        const previousId = original.id;
        if (createBoard) {
          doc = M.createDocument("board", crypto.randomUUID());
          doc.title = file.name.replace(/\.pdf$/i, "").slice(0, 120) || "Werkbeschrijving";
          doc.folderId = original.folderId || null;
          data.documents.push(doc);
          data.activeId = doc.id;
        }
        doc.pdf = reference;
        if (!persist()) {
          if (createBoard) {
            data.documents = data.documents.filter(item => item.id !== doc.id);
            data.activeId = previousId;
          } else {
            delete doc.pdf;
          }
          throw new Error("PDF niet aan de werkmap toegevoegd: lokale opslag mislukt. Download eerst een back-up.");
        }
        if (createBoard) selectDocument();
        else await loadPdf();
        await refreshPdfLibrary();
      } catch (error) { report(error); $("pdf-status").textContent = error.message; }
      finally { input.disabled = false; input.value = ""; }
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
        const folderId = active().folderId || null;
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
    const drawingToolIds = ["pen", "marker-tool", "highlighter-tool", "move", "eraser", "scratch-eraser", "select-ink", "shape-tool"];
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
    selectionMenu.querySelectorAll("[data-sel-task]").forEach(button => button.addEventListener("click", () => {
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
      if (kind === "pen") { pinch = null; touches.clear(); }
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
      const inputTool = kind === "touch" && !$("finger").checked ? "move" : tool;
      gesture = { id: event.pointerId, type: event.pointerType, tool: inputTool, clientX: event.clientX, clientY: event.clientY, view: { ...active().view },
        metrics: { start: now, last: now, gap: 0, moves: 0, samples: 1 } };
      if (inputTool === "pen") {
        gesture.stroke = { color: $("color").value, width: Number($("width").value), brush: $("brush").value, points: [point] };
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
        if (bounds && point.x >= bounds.left - margin && point.x <= bounds.right + margin && point.y >= bounds.top - margin && point.y <= bounds.bottom + margin) {
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
        render();
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
        if (gesture.moveSelection) {
          const dx = point.x - gesture.moveStart.x, dy = point.y - gesture.moveStart.y;
          if (dx || dy) gesture.moved = true;
          const strokes = gesture.before.slice();
          for (const item of gesture.moveSelection.strokes) {
            strokes[item.index] = { ...gesture.before[item.index], points: item.points.map(value => ({ x: value.x + dx, y: value.y + dy })) };
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
        scheduleRender();
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
          if (touches.size < 2) { pinch = null; touches.clear(); persist(); }
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
      if (point.x !== last.x || point.y !== last.y) gesture.stroke.points.push(point);
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
