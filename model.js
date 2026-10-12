(function () {
  "use strict";
  const KEY = "remy-ipad-werkplek-v1";
  const MAX_POINTS = 100000;
  const finite = value => typeof value === "number" && Number.isFinite(value);

  function createDocument(kind, id) {
    if (!["page", "board"].includes(kind)) throw new Error("Onbekend documenttype.");
    return { id, kind, title: kind === "page" ? "Nieuw schriftblad" : "Nieuw whiteboard",
      text: "", strokes: [], pages: 1, view: { x: 0, y: 0, scale: 1 } };
  }

  function validate(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.documents) || !data.documents.length) {
      throw new Error("De opgeslagen notities hebben een onbekend formaat.");
    }
    const ids = new Set();
    let totalPoints = 0;
    for (const doc of data.documents) {
      if (!doc || typeof doc.id !== "string" || !doc.id || ids.has(doc.id) ||
          !["page", "board"].includes(doc.kind) || typeof doc.title !== "string" ||
          doc.title.length > 120 || typeof doc.text !== "string" || !Array.isArray(doc.strokes) ||
          (doc.pages !== undefined && (!Number.isInteger(doc.pages) || doc.pages < 1 || doc.pages > 200)) ||
          !doc.view || !finite(doc.view.x) || !finite(doc.view.y) ||
          !finite(doc.view.scale) || doc.view.scale < .2 || doc.view.scale > 4) {
        throw new Error("Een opgeslagen document is ongeldig; de opslag is niet overschreven.");
      }
      ids.add(doc.id);
      for (const stroke of doc.strokes) {
        if (!stroke || !/^#[0-9a-f]{6}$/i.test(stroke.color) || !finite(stroke.width) ||
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

  window.IpadModel = { KEY, createDocument, validate, load, save, point, zoom, hitStroke };
})();
