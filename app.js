(function () {
  "use strict";
  const M = window.IpadModel;
  const $ = id => document.getElementById(id);
  const svgNS = "http://www.w3.org/2000/svg";
  let data;
  let blocked = false;
  let tool = "pen";
  let gesture = null;
  let redo = [];
  let frame = null;

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

  function element(name, attrs) {
    const node = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }

  function render() {
    frame = null;
    const doc = active();
    const svg = $("drawing");
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const { x, y, scale } = doc.view;
    svg.setAttribute("viewBox", `${x} ${y} ${rect.width / scale} ${rect.height / scale}`);
    svg.replaceChildren();
    if (doc.kind === "page") {
      const defs = element("defs", {});
      const pattern = element("pattern", { id: "ruled", width: 800, height: 32, patternUnits: "userSpaceOnUse" });
      pattern.append(element("path", { d: "M 0 31 L 800 31", stroke: "#d9e1e5", "stroke-width": 1 }));
      defs.append(pattern);
      svg.append(defs, element("rect", { x: 0, y: 0, width: 800, height: 1120, fill: "url(#ruled)", stroke: "#bbc9c5" }));
    }
    for (const stroke of doc.strokes.concat(gesture && gesture.stroke ? [gesture.stroke] : [])) {
      const points = stroke.points.map(p => `${p.x},${p.y}`).join(" ");
      if (stroke.points.length === 1) {
        svg.append(element("circle", { cx: stroke.points[0].x, cy: stroke.points[0].y, r: stroke.width / 2, fill: stroke.color }));
      } else {
        svg.append(element("polyline", { points, fill: "none", stroke: stroke.color,
          "stroke-width": stroke.width, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      }
    }
    $("zoom").textContent = `${Math.round(scale * 100)}%`;
    $("undo").disabled = !doc.strokes.length;
    $("redo").disabled = !redo.length;
  }

  function scheduleRender() {
    if (frame === null) frame = requestAnimationFrame(render);
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
    list();
    render();
  }

  function finish(event) {
    if (!gesture || (event && gesture.id !== event.pointerId)) return;
    const old = gesture;
    if (old.stroke) {
      active().strokes.push(old.stroke);
      redo = [];
    }
    gesture = null;
    if ($("drawing").hasPointerCapture(old.id)) $("drawing").releasePointerCapture(old.id);
    persist();
    render();
  }

  function tab(name) {
    finish();
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
    for (const name of ["pen", "move"]) $(name).addEventListener("click", () => {
      finish();
      tool = name;
      $("pen").setAttribute("aria-pressed", String(name === "pen"));
      $("move").setAttribute("aria-pressed", String(name === "move"));
    });
    $("undo").addEventListener("click", () => {
      finish();
      if (active().strokes.length) redo.push(active().strokes.pop());
      persist();
      render();
    });
    $("redo").addEventListener("click", () => {
      finish();
      if (redo.length) active().strokes.push(redo.pop());
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
    const svg = $("drawing");
    svg.addEventListener("pointerdown", event => {
      if (gesture || event.button !== 0 || (tool === "pen" && event.pointerType === "touch" && !$("finger").checked)) return;
      event.preventDefault();
      svg.setPointerCapture(event.pointerId);
      const point = M.point(event.clientX, event.clientY, svg.getBoundingClientRect(), active().view);
      gesture = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, view: { ...active().view } };
      if (tool === "pen") gesture.stroke = { color: $("color").value, width: Number($("width").value), points: [point] };
      render();
    });
    svg.addEventListener("pointermove", event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      event.preventDefault();
      if (gesture.stroke) {
        const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
        for (const sample of events.length ? events : [event]) {
          const point = M.point(sample.clientX, sample.clientY, svg.getBoundingClientRect(), active().view);
          const last = gesture.stroke.points[gesture.stroke.points.length - 1];
          if (Math.hypot(point.x - last.x, point.y - last.y) >= .6 / active().view.scale) gesture.stroke.points.push(point);
        }
      } else {
        active().view.x = gesture.view.x - (event.clientX - gesture.clientX) / gesture.view.scale;
        active().view.y = gesture.view.y - (event.clientY - gesture.clientY) / gesture.view.scale;
      }
      scheduleRender();
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) svg.addEventListener(name, finish);
    new ResizeObserver(scheduleRender).observe(svg);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { finish(); persist(); }
    });
    window.addEventListener("pagehide", () => { finish(); persist(); });
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

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      report(new Error(`Offline openen is niet ingesteld: ${error.message}`));
    });
  }
})();
