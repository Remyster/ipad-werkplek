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
  const emptyDiagnostics = () => ({ pen: 0, touch: 0, mouse: 0, other: 0, ignored: 0, cancelled: 0, last: "-", recent: [] });
  let diagnostics = emptyDiagnostics();

  function report(error) {
    console.error("iPad Werkplek:", error);
    $("error").hidden = false;
    $("error").textContent = error.message || String(error);
  }

  function persist() {
    if (blocked) return;
    try {
      M.save(localStorage, data);
      $("save-status").textContent = "Lokaal opgeslagen. Geen cloudback-up.";
    } catch (error) {
      $("save-status").textContent = "Niet opgeslagen! Download een back-up.";
      report(error);
    }
  }

  function active() { return data.documents.find(doc => doc.id === data.activeId); }

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

  function worldContext(id) {
    const ctx = context(id);
    const rect = $("drawing").getBoundingClientRect();
    const ratio = $(id).width / rect.width;
    const { x, y, scale } = active().view;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, -x * ratio * scale, -y * ratio * scale);
    return ctx;
  }

  function drawStroke(ctx, stroke, from = 0) {
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const points = stroke.points;
    if (from === 0) {
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
  }

  function drawLive() {
    if (!gesture || !gesture.stroke) return;
    if (livePoints < gesture.stroke.points.length) {
      drawStroke(worldContext("drawing"), gesture.stroke, livePoints);
      livePoints = gesture.stroke.points.length;
    }
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

  function render() {
    frame = null;
    const doc = active();
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
    if (doc.kind === "page") {
      const first = Math.max(0, Math.floor(doc.view.y / 1144));
      const last = Math.min((doc.pages || 1) - 1, Math.floor((doc.view.y + rect.height / doc.view.scale) / 1144));
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
    for (const stroke of doc.strokes) drawStroke(ctx, stroke);
    livePoints = 0;
    drawLive();
    updateControls();
  }

  function scheduleRender() {
    if (frame === null) frame = requestAnimationFrame(() => {
      frame = null;
      if (gesture && gesture.stroke) drawLive();
      else render();
    });
  }

  function list() {
    $("documents").replaceChildren(...data.documents.map(doc => {
      const option = document.createElement("option");
      option.value = doc.id;
      option.textContent = `${doc.kind === "page" ? "Schrift" : "Bord"}: ${doc.title || "Zonder titel"}`;
      option.selected = doc.id === data.activeId;
      return option;
    }));
  }

  function selectDocument() {
    const doc = active();
    $("title").value = doc.title;
    $("text").value = doc.text;
    redo = [];
    undo = [];
    list();
    render();
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
    if (old.stroke) {
      remember(active().strokes.slice());
      active().strokes.push(old.stroke);
      drawStroke(worldContext("saved-drawing"), old.stroke);
    } else if (old.tool === "eraser" && old.before.length !== active().strokes.length) {
      remember(old.before);
    }

    function remember(before) {
      undo.push(before);
      if (undo.length > 50) undo.shift();
      redo = [];
    }

    function eraseAt(point) {
      const before = active().strokes.length;
      active().strokes = active().strokes.filter(stroke =>
        !M.hitStroke(stroke, gesture.lastPoint, point, 12 / active().view.scale));
      gesture.lastPoint = point;
      if (before !== active().strokes.length) render();
    }
    gesture = null;
    clear("drawing");
    livePoints = 0;
    if ($("drawing").hasPointerCapture(old.id)) $("drawing").releasePointerCapture(old.id);
    persist();
    updateControls();
  }

  function tab(name) {
    finish();
    document.body.classList.remove("writing-focus");
    $("focus").setAttribute("aria-pressed", "false");
    $("focus").textContent = "Brede schrijfmodus";
    for (const section of ["today", "writing", "hubs"]) $(section).hidden = section !== name;
    document.querySelectorAll("[data-tab]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.tab === name)));
    if (name === "writing" && !blocked) render();
  }

  try {
    data = M.load(localStorage);
    if (!data) {
      const doc = M.createDocument("page", crypto.randomUUID());
      data = { version: 1, activeId: doc.id, documents: [doc] };
    }
    persist();
  } catch (error) {
    blocked = true;
    $("save-status").textContent = "Opslag niet beschikbaar. Schrijven geblokkeerd.";
    report(error);
    $("writing").querySelectorAll("button, input, select, textarea").forEach(el => { el.disabled = true; });
  }

  $("today-date").textContent = new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => tab(button.dataset.tab)));
  $("start-writing").addEventListener("click", () => tab("writing"));

  if (!blocked) {
    $("reset-diagnostics").addEventListener("click", () => {
      finish();
      diagnostics = emptyDiagnostics();
      updateDiagnostics();
    });
    $("toggle-documents").addEventListener("click", () => {
      finish();
      const open = $("document-panel").hidden;
      $("document-panel").hidden = !open;
      document.querySelector(".workspace").classList.toggle("documents-open", open);
      $("toggle-documents").setAttribute("aria-expanded", String(open));
      render();
    });
    $("focus").addEventListener("click", () => {
      finish();
      const on = document.body.classList.toggle("writing-focus");
      $("focus").setAttribute("aria-pressed", String(on));
      $("focus").textContent = on ? "Terug naar overzicht" : "Brede schrijfmodus";
      $("document-panel").hidden = true;
      document.querySelector(".workspace").classList.remove("documents-open");
      $("toggle-documents").setAttribute("aria-expanded", "false");
      render();
    });
    selectDocument();
    $("documents").addEventListener("change", () => {
      finish();
      data.activeId = $("documents").value;
      selectDocument();
      persist();
    });
    for (const [button, kind] of [["new-page", "page"], ["new-board", "board"]]) {
      $(button).addEventListener("click", () => {
        finish();
        const doc = M.createDocument(kind, crypto.randomUUID());
        data.documents.push(doc);
        data.activeId = doc.id;
        selectDocument();
        persist();
      });
    }
    for (const field of ["title", "text"]) $(field).addEventListener("input", () => {
      active()[field] = $(field).value;
      if (field === "title") list();
      persist();
    });
    for (const name of ["pen", "move", "eraser"]) $(name).addEventListener("click", () => {
      finish();
      tool = name;
      for (const id of ["pen", "move", "eraser"]) $(id).setAttribute("aria-pressed", String(name === id));
    });
    $("undo").addEventListener("click", () => {
      finish();
      if (undo.length) {
        redo.push(active().strokes.slice());
        active().strokes = undo.pop();
      } else if (active().strokes.length) {
        redo.push(active().strokes.slice());
        active().strokes = active().strokes.slice(0, -1);
      }
      persist();
      render();
    });
    $("redo").addEventListener("click", () => {
      finish();
      if (redo.length) {
        undo.push(active().strokes.slice());
        active().strokes = redo.pop();
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
    $("writing").addEventListener("selectstart", event => {
      if (event.target instanceof Element && !event.target.closest("input, textarea, select")) event.preventDefault();
    });
    canvas.addEventListener("touchstart", event => event.preventDefault(), { passive: false });
    canvas.addEventListener("touchmove", event => event.preventDefault(), { passive: false });
    canvas.addEventListener("contextmenu", event => event.preventDefault());
    canvas.addEventListener("pointerdown", event => {
      event.preventDefault();
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
      if (document.activeElement instanceof HTMLElement && document.activeElement.matches("input, textarea, select")) document.activeElement.blur();
      const kind = ["pen", "touch", "mouse"].includes(event.pointerType) ? event.pointerType : "other";
      diagnostics[kind]++;
      diagnostics.last = kind;
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
      if (inputTool === "pen") gesture.stroke = { color: $("color").value, width: Number($("width").value), points: [point] };
      if (inputTool === "eraser") {
        gesture.before = active().strokes.slice();
        gesture.lastPoint = point;
        eraseAt(point);
      }
      livePoints = 0;
      drawLive();
    });
    canvas.addEventListener("pointermove", event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      event.preventDefault();
      const now = performance.now();
      gesture.metrics.moves++;
      gesture.metrics.gap = Math.max(gesture.metrics.gap, now - gesture.metrics.last);
      gesture.metrics.last = now;
      if (gesture.stroke) {
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
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, finish);
    new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || (rect.width === renderedWidth && rect.height === renderedHeight)) return;
      finish(null, "formaatwijziging");
      render();
    }).observe(canvas);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { finish(null, "pagina verborgen"); persist(); }
    });
    window.addEventListener("pagehide", () => { finish(null, "pagina verlaten"); persist(); });
    $("export").addEventListener("click", () => {
      finish();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `werkplek-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  }

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
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      $("update-status").hidden = false;
    });
    navigator.serviceWorker.register("./sw.js").catch(error => {
      report(new Error(`Offline openen is niet ingesteld: ${error.message}`));
    });
  }
})();
