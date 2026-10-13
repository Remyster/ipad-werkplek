(function () {
  "use strict";
  const KEY = "remy-ipad-werkplek-v1";
  const MAX_POINTS = 100000;
  const finite = value => typeof value === "number" && Number.isFinite(value);

  function createDocument(kind, id) {
    if (!["page", "board"].includes(kind)) throw new Error("Onbekend documenttype.");
    return { id, kind, title: kind === "page" ? "Nieuw schriftblad" : "Nieuw whiteboard",
      text: "", strokes: [], pages: 1, view: { x: 0, y: 0, scale: 1 }, folderId: null };
  }

  function createMeasurementDocument(formType, id) {
    if (!["dwat-akf", "lws"].includes(formType)) throw new Error("Onbekend meetlijsttype.");
    const doc = createDocument("page", id);
    doc.title = formType === "dwat-akf" ? "DWAT/AKF meetstatus" : "LWS meetstatus";
    doc.formType = formType;
    doc.formData = {};
    return doc;
  }

  function validate(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.documents) || !data.documents.length) {
      throw new Error("De opgeslagen notities hebben een onbekend formaat.");
    }
    if (data.folders !== undefined && (!Array.isArray(data.folders) || data.folders.length > 100)) {
      throw new Error("De opgeslagen mappen zijn ongeldig; de opslag is niet overschreven.");
    }
    const folderIds = new Set();
    for (const folder of data.folders || []) {
      if (!folder || typeof folder.id !== "string" || !folder.id || folderIds.has(folder.id) ||
          typeof folder.title !== "string" || !folder.title.trim() || folder.title.length > 120) {
        throw new Error("Een opgeslagen map is ongeldig; de opslag is niet overschreven.");
      }
      folderIds.add(folder.id);
    }
    const ids = new Set();
    let totalPoints = 0;
    for (const doc of data.documents) {
      if (!doc || typeof doc.id !== "string" || !doc.id || ids.has(doc.id) ||
          !["page", "board"].includes(doc.kind) || typeof doc.title !== "string" ||
          doc.title.length > 120 || typeof doc.text !== "string" || !Array.isArray(doc.strokes) ||
          (doc.folderId !== undefined && doc.folderId !== null &&
            (typeof doc.folderId !== "string" || !folderIds.has(doc.folderId))) ||
          (doc.formType !== undefined && !["dwat-akf", "lws"].includes(doc.formType)) ||
          (doc.pages !== undefined && (!Number.isInteger(doc.pages) || doc.pages < 1 || doc.pages > 200)) ||
          !doc.view || !finite(doc.view.x) || !finite(doc.view.y) ||
          !finite(doc.view.scale) || doc.view.scale < .2 || doc.view.scale > 4) {
        throw new Error("Een opgeslagen document is ongeldig; de opslag is niet overschreven.");
      }
      if (doc.formType !== undefined && (!doc.formData || typeof doc.formData !== "object" ||
          Array.isArray(doc.formData) || Object.keys(doc.formData).length > 250 ||
          Object.entries(doc.formData).some(([key, value]) => !/^[a-z0-9_.-]{1,80}$/i.test(key) ||
            !["string", "boolean"].includes(typeof value) ||
            (typeof value === "string" && value.length > 20000)))) {
        throw new Error("Een opgeslagen meetlijst is ongeldig; de opslag is niet overschreven.");
      }
      ids.add(doc.id);
      if (doc.textBlocks !== undefined && (!Array.isArray(doc.textBlocks) ||
          doc.textBlocks.length > 100 || doc.textBlocks.some(block => !block ||
            !finite(block.x) || !finite(block.y) || typeof block.text !== "string" ||
            !block.text.trim() || block.text.length > 20000))) {
        throw new Error("Opgeslagen tekstblokken zijn ongeldig; de opslag is niet overschreven.");
      }
      if (doc.pdf && (doc.kind !== "board" || typeof doc.pdf.id !== "string" || !doc.pdf.id ||
          typeof doc.pdf.name !== "string" || !Array.isArray(doc.pdf.pages) || !doc.pdf.pages.length ||
          doc.pdf.pages.length > 50 || doc.pdf.pages.some(p => !p || !finite(p.top) || p.top < 0 ||
            !finite(p.width) || p.width <= 0 || !finite(p.height) || p.height <= 0))) {
        throw new Error("PDF-verwijzing in de notitie is ongeldig.");
      }
      for (const stroke of doc.strokes) {
        if (!stroke || !/^#[0-9a-f]{6}$/i.test(stroke.color) || !finite(stroke.width) ||
            (stroke.brush !== undefined && !["pen", "fineliner", "dashed"].includes(stroke.brush)) ||
            stroke.width <= 0 || stroke.width > 20 || !Array.isArray(stroke.points) ||
            !stroke.points.length || stroke.points.some(p => !p || !finite(p.x) || !finite(p.y))) {
          throw new Error("Opgeslagen penstreken zijn ongeldig; de opslag is niet overschreven.");
        }
        totalPoints += stroke.points.length;
        if (totalPoints > MAX_POINTS) throw new Error("Deze schrijfproef ondersteunt maximaal 100.000 penpunten. Exporteer je back-up.");
      }
    }
    if (!ids.has(data.activeId)) throw new Error("Het actieve document ontbreekt.");
    return data;
  }

  function load(storage) {
    const raw = storage.getItem(KEY);
    return raw === null ? null : validate(JSON.parse(raw));
  }

  function save(storage, data) {
    storage.setItem(KEY, JSON.stringify(validate(data)));
  }

  function point(clientX, clientY, rect, view) {
    return { x: (clientX - rect.left) / view.scale + view.x,
      y: (clientY - rect.top) / view.scale + view.y };
  }

  function zoom(view, factor, width, height) {
    const scale = Math.min(4, Math.max(.2, view.scale * factor));
    return { x: view.x + width / (2 * view.scale) - width / (2 * scale),
      y: view.y + height / (2 * view.scale) - height / (2 * scale), scale };
  }

  function distanceToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }

  function hitStroke(stroke, a, b, radius) {
    const limit = radius + stroke.width / 2;
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return stroke.points.some((d, i) => {
      const c = stroke.points[Math.max(0, i - 1)];
      const intersects = cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
      return intersects || Math.min(distanceToSegment(c, a, b), distanceToSegment(d, a, b),
        distanceToSegment(a, c, d), distanceToSegment(b, c, d)) <= limit;
    });
  }

  function splitStroke(stroke, intervals) {
    const fragments = [];
    let current = [];
    let changed = false;
    const flush = () => { if (current.length) fragments.push({ ...stroke, points: current }); current = []; };
    if (stroke.points.length === 1) return intervals(stroke.points[0], stroke.points[0]).length ? { changed: true, strokes: [] } : { changed: false, strokes: [stroke] };
    for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1], b = stroke.points[i];
      const ranges = intervals(a, b).sort((x, y) => x[0] - y[0]);
      let cursor = 0;
      const at = t => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const append = (start, end) => {
        if (end <= start) return;
        const p = at(start);
        if (!current.length) current.push(p);
        current.push(at(end));
      };
      for (const [start, end] of ranges) {
        if (end <= cursor) continue;
        changed = true;
        append(cursor, start);
        flush();
        cursor = Math.max(cursor, end);
      }
      append(cursor, 1);
    }
    flush();
    return changed ? { changed, strokes: fragments } : { changed: false, strokes: [stroke] };
  }

  function rectangleInterval(a, b, left, top, right, bottom) {
    let low = 0, high = 1;
    for (const [start, delta, min, max] of [[a.x, b.x - a.x, left, right], [a.y, b.y - a.y, top, bottom]]) {
      if (delta === 0) { if (start < min || start > max) return []; }
      else {
        const t1 = (min - start) / delta, t2 = (max - start) / delta;
        low = Math.max(low, Math.min(t1, t2));
        high = Math.min(high, Math.max(t1, t2));
      }
    }
    return high > low ? [[low, high]] : [];
  }

  function circleInterval(a, b, center, radius) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const x = a.x - center.x, y = a.y - center.y;
    const length = dx * dx + dy * dy;
    if (!length) return x * x + y * y <= radius * radius ? [[0, 1]] : [];
    const dot = x * dx + y * dy;
    const discriminant = dot * dot - length * (x * x + y * y - radius * radius);
    if (discriminant <= 0) return [];
    const low = Math.max(0, (-dot - Math.sqrt(discriminant)) / length);
    const high = Math.min(1, (-dot + Math.sqrt(discriminant)) / length);
    return high > low ? [[low, high]] : [];
  }

  function transformStrokes(strokes, intervals) {
    let changed = false;
    const result = strokes.flatMap(stroke => {
      const clipped = splitStroke(stroke, (a, b) => intervals(a, b, stroke));
      changed = changed || clipped.changed;
      return clipped.strokes;
    });
    return { changed, strokes: changed ? result : strokes };
  }

  function erase(strokes, from, to, radius) {
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    const local = p => ({ x: length ? ((p.x - from.x) * dx + (p.y - from.y) * dy) / length : 0,
      y: length ? (-(p.x - from.x) * dy + (p.y - from.y) * dx) / length : 0 });
    return transformStrokes(strokes, (a, b, stroke) => {
      const r = radius + stroke.width / 2;
      return [...circleInterval(a, b, from, r), ...circleInterval(a, b, to, r),
        ...(length ? rectangleInterval(local(a), local(b), 0, -r, length, r) : [])];
    });
  }

  function clearPage(strokes, page) {
    return transformStrokes(strokes, (a, b) => {
      const top = page * 1144;
      if (a.x === b.x && a.y === b.y) return a.x >= 0 && a.x <= 800 && a.y >= top && a.y <= top + 1120 ? [[0, 1]] : [];
      return rectangleInterval(a, b, 0, top, 800, top + 1120);
    });
  }

  function pinch(view, a, b, nextA, nextB, rect) {
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const scale = Math.max(.2, Math.min(4, view.scale * Math.hypot(nextB.x - nextA.x, nextB.y - nextA.y) / Math.max(1, distance)));
    const center = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    const next = { x: (nextA.x + nextB.x) / 2 - rect.left, y: (nextA.y + nextB.y) / 2 - rect.top };
    return { x: view.x + center.x / view.scale - next.x / scale, y: view.y + center.y / view.scale - next.y / scale, scale };
  }

  window.IpadModel = { KEY, createDocument, createMeasurementDocument, validate, load, save, point, zoom, hitStroke, erase, clearPage, pinch };
})();
