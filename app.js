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
  let inkClipboard = [];
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
      M.save(localStorage, data);
      $("save-status").textContent = "Lokaal opgeslagen. Drive-back-up via Back-up.";
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
    ctx.globalAlpha = brush === "highlighter" ? .28 : brush === "marker" ? .72 : 1;
    ctx.lineCap = ["pen", "marker", "highlighter"].includes(brush) ? "round" : "butt";
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
  }

  function selectionBounds() {
    if (!selection?.indexes?.length) return null;
    const bounds = selection.indexes.map(index => strokeBounds(active().strokes[index]));
    return {
      left: Math.min(...bounds.map(value => value.left)),
      top: Math.min(...bounds.map(value => value.top)),
      right: Math.max(...bounds.map(value => value.right)),
      bottom: Math.max(...bounds.map(value => value.bottom))
    };
  }

  function drawSelectionOverlay() {
    const ctx = worldContext("drawing");
    const bounds = selectionBounds() || selection.region;
    if (!bounds) return;
    ctx.save();
    ctx.strokeStyle = "#af6700";
    ctx.lineWidth = 2 / active().view.scale;
    ctx.setLineDash([8 / active().view.scale, 6 / active().view.scale]);
    ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    ctx.restore();
  }

  function updateSelectionButtons() {
    const hasSelection = !!selection?.indexes?.length;
    $("selection-copy").disabled = !hasSelection;
    $("selection-cut").disabled = !hasSelection;
    $("selection-paste").disabled = !inkClipboard.length;
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

  function snapshot(strokes = active().strokes) {
    return { strokes: strokes.slice(), textBlocks: (active().textBlocks || []).slice() };
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
    const viewport = {
      left: doc.view.x,
      top: doc.view.y,
      right: doc.view.x + rect.width / doc.view.scale,
      bottom: doc.view.y + rect.height / doc.view.scale
    };
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
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
    for (const page of pdfImages) {
      if (page.top <= viewport.bottom && page.top + page.height >= viewport.top) {
        ctx.drawImage(page.image, 0, page.top, page.width, page.height);
      }
    }
    for (const stroke of doc.strokes) {
      if (M.intersectsBounds(strokeBounds(stroke), viewport)) drawStroke(ctx, stroke);
    }
    for (const block of doc.textBlocks || []) {
      if (block.y <= viewport.bottom && block.y + 1000 >= viewport.top) drawTextBlock(ctx, block);
    }
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
    if (!removed || !window.confirm(`"${removed.title || "Zonder titel"}" weggooien? Dit verwijdert het hele ${removed.formType ? "meetformulier" : removed.kind === "page" ? "schrift" : "bord"} van dit apparaat.`)) return;
    const previousDocuments = data.documents;
    const previousId = data.activeId;
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
      selectDocument();
      report(new Error("Inhoud niet weggegooid: lokale opslag mislukt. Download eerst een back-up."));
      return;
    }
    selectDocument();
    $("save-status").textContent = `"${removed.title || "Zonder titel"}" is weggegooid.`;
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
      if (!old.stroke.shape) old.stroke.points = M.simplifyPoints(old.stroke.points, Math.max(.55, old.stroke.width * .08));
      remember(active().strokes.slice());
      active().strokes.push(old.stroke);
      drawStroke(worldContext("saved-drawing"), old.stroke);
    } else if (old.tool === "eraser" && old.changed) {
      remember(old.before);
    } else if (old.tool === "scratch-eraser" && old.changed) {
      remember(old.before);
    } else if (old.tool === "select-ink" && old.moveSelection) {
      remember(old.before);
    } else if (old.tool === "select-ink" && old.selectStart && old.selectEnd) {
      const region = {
        left: Math.min(old.selectStart.x, old.selectEnd.x),
        top: Math.min(old.selectStart.y, old.selectEnd.y),
        right: Math.max(old.selectStart.x, old.selectEnd.x),
        bottom: Math.max(old.selectStart.y, old.selectEnd.y)
      };
      const indexes = active().strokes.map((stroke, index) => M.intersectsBounds(strokeBounds(stroke), region) ? index : -1).filter(index => index >= 0);
      selection = indexes.length ? { indexes } : null;
    }
    gesture = null;
    clear("drawing");
    livePoints = 0;
    if ($("drawing").hasPointerCapture(old.id)) $("drawing").releasePointerCapture(old.id);
    persist();
    updateControls();
    updateSelectionButtons();
    if (!old.stroke) render();
  }

  function remember(before) {
    undo.push(snapshot(before));
    if (undo.length > 50) undo.shift();
    redo = [];
  }

  function eraseAt(point) {
    const result = M.erase(active().strokes, gesture.lastPoint, point, gesture.eraserRadius / active().view.scale);
    gesture.lastPoint = point;
    if (result.changed) {
      gesture.changed = true;
      active().strokes = result.strokes;
      scheduleRender();
    }
  }

  function scratchEraseAt(point) {
    const before = active().strokes;
    const from = gesture.lastPoint;
    const radius = Math.max(8, gesture.eraserRadius / active().view.scale);
    const kept = before.filter(stroke => !M.hitStroke(stroke, from, point, radius));
    gesture.lastPoint = point;
    if (kept.length !== before.length) {
      gesture.changed = true;
      active().strokes = kept;
      scheduleRender();
    }
  }

  function copySelection(cut = false) {
    if (!selection?.indexes?.length) return;
    const selected = new Set(selection.indexes);
    inkClipboard = active().strokes.filter((_, index) => selected.has(index)).map(stroke => JSON.parse(JSON.stringify(stroke)));
    if (cut) {
      remember(active().strokes.slice());
      active().strokes = active().strokes.filter((_, index) => !selected.has(index));
      selection = null;
      persist();
      render();
    }
    updateSelectionButtons();
  }

  function pasteSelection() {
    if (!inkClipboard.length) return;
    remember(active().strokes.slice());
    const pasted = inkClipboard.map(stroke => ({
      ...JSON.parse(JSON.stringify(stroke)),
      points: stroke.points.map(point => ({ x: point.x + 24, y: point.y + 24 }))
    }));
    const start = active().strokes.length;
    active().strokes.push(...pasted);
    selection = { indexes: pasted.map((_, index) => start + index) };
    inkClipboard = pasted;
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

  try {
    data = M.load(localStorage);
    if (!data) {
      const doc = M.createDocument("page", crypto.randomUUID());
      data = { version: 1, activeId: doc.id, documents: [doc], folders: [] };
    }
    data.folders = data.folders || [];
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
      async createBackup() {
        finish();
        const snapshot = JSON.parse(JSON.stringify(data));
        return window.WorkplacePdf.backup(snapshot);
      },
      async restoreBackup(backup) {
        finish();
        const restored = await window.WorkplacePdf.restore(backup, M.validate);
        M.save(localStorage, restored);
        location.reload();
      },
      captureInk() {
        finish();
        if (isMeasurement()) throw new Error("Open een schrift of whiteboard om handschrift te selecteren.");
        if (!active().strokes.length) {
          const empty = document.createElement("canvas");
          empty.width = empty.height = 8;
          const emptyContext = empty.getContext("2d");
          emptyContext.fillStyle = "#ffffff";
          emptyContext.fillRect(0, 0, 8, 8);
          return empty;
        }
        const bounds = active().strokes.map(strokeBounds);
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
        for (const stroke of active().strokes) drawStroke(ctx, stroke);
        return canvas;
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
      $("drawing-tools").open = !on;
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
    const drawingToolIds = ["pen", "move", "eraser", "scratch-eraser", "select-ink"];
    const activateTool = name => {
      finish();
      tool = name;
      if (name !== "select-ink") clearSelection();
      for (const id of drawingToolIds) $(id).setAttribute("aria-pressed", String(name === id));
    };
    for (const name of drawingToolIds) $(name).addEventListener("click", () => activateTool(name));
    $("selection-copy").addEventListener("click", () => copySelection(false));
    $("selection-cut").addEventListener("click", () => copySelection(true));
    $("selection-paste").addEventListener("click", pasteSelection);
    $("undo").addEventListener("click", () => {
      finish();
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
      const rect = $("surface").getBoundingClientRect();
      quickTools.style.left = `${Math.max(10, Math.min(rect.width - 340, clientX - rect.left))}px`;
      quickTools.style.top = `${Math.max(10, Math.min(rect.height - 150, clientY - rect.top))}px`;
      $("quick-color").value = $("color").value;
      $("quick-width").value = $("width").value;
      quickTools.hidden = false;
    };
    quickTools.addEventListener("pointerdown", event => event.stopPropagation());
    quickTools.querySelectorAll("[data-quick-brush]").forEach(button => button.addEventListener("click", () => {
      $("brush").value = button.dataset.quickBrush;
      activateTool("pen");
      hideQuickTools();
    }));
    quickTools.querySelector("[data-quick-tool='eraser']").addEventListener("click", () => {
      activateTool("eraser");
      hideQuickTools();
    });
    $("quick-color").addEventListener("input", () => { $("color").value = $("quick-color").value; });
    $("quick-width").addEventListener("input", () => {
      $("width").value = $("quick-width").value;
      $("width-value").textContent = $("width").value;
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
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
      if (document.activeElement instanceof HTMLElement && document.activeElement.matches("input, textarea, select")) document.activeElement.blur();
      const kind = ["pen", "touch", "mouse"].includes(event.pointerType) ? event.pointerType : "other";
      diagnostics[kind]++;
      diagnostics.last = kind;
      if (kind === "pen") { pinch = null; touches.clear(); }
      if (kind === "touch") {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size >= 2 && (!gesture || gesture.type !== "pen")) {
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
        if (inputTool === "eraser") eraseAt(point);
      }
      if (inputTool === "select-ink") {
        const bounds = selectionBounds();
        if (bounds && point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom) {
          gesture.before = JSON.parse(JSON.stringify(active().strokes));
          gesture.moveSelection = selection.indexes.map(index => ({
            index,
            points: active().strokes[index].points.map(value => ({ ...value }))
          }));
          gesture.moveStart = point;
        } else {
          clearSelection();
          gesture.selectStart = point;
          gesture.selectEnd = point;
          selection = { indexes: [], region: { left: point.x, top: point.y, right: point.x, bottom: point.y } };
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
      } else if (gesture.tool === "scratch-eraser") {
        const point = M.point(event.clientX, event.clientY, canvas.getBoundingClientRect(), active().view);
        scratchEraseAt(point);
      } else if (gesture.tool === "select-ink") {
        const point = M.point(event.clientX, event.clientY, canvas.getBoundingClientRect(), active().view);
        if (gesture.moveSelection) {
          const dx = point.x - gesture.moveStart.x, dy = point.y - gesture.moveStart.y;
          for (const item of gesture.moveSelection) {
            const stroke = active().strokes[item.index];
            stroke.points = item.points.map(value => ({ x: value.x + dx, y: value.y + dy }));
            boundsCache.delete(stroke);
          }
          scheduleRender();
        } else {
          gesture.selectEnd = point;
          selection.region = {
            left: Math.min(gesture.selectStart.x, point.x),
            top: Math.min(gesture.selectStart.y, point.y),
            right: Math.max(gesture.selectStart.x, point.x),
            bottom: Math.max(gesture.selectStart.y, point.y)
          };
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
