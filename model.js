(function () {
  "use strict";
  const KEY = "remy-ipad-werkplek-v1";
  const MAX_POINTS = 1000000;
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
    if (data.trash !== undefined && (!Array.isArray(data.trash) || data.trash.length > 100 || data.trash.some(item =>
        !item || !finite(item.deletedAt) || (item.folderTitle !== null && typeof item.folderTitle !== "string") ||
        !item.doc || typeof item.doc.id !== "string" || !["page", "board"].includes(item.doc.kind) ||
        typeof item.doc.title !== "string" || !Array.isArray(item.doc.strokes)))) {
      throw new Error("De prullenbak is ongeldig; de opslag is niet overschreven.");
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
      if ((doc.transcript !== undefined && (typeof doc.transcript !== "string" || doc.transcript.length > 20000)) ||
          (doc.transcriptStrokes !== undefined && !Number.isInteger(doc.transcriptStrokes))) {
        throw new Error("Een opgeslagen notitie-index is ongeldig; de opslag is niet overschreven.");
      }
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
            (stroke.brush !== undefined && !["pen", "fineliner", "dashed", "marker", "highlighter"].includes(stroke.brush)) ||
            (stroke.shape !== undefined && !["line", "rectangle", "ellipse", "arrow", "check", "warning", "star"].includes(stroke.shape)) ||
            stroke.width <= 0 || stroke.width > 40 || !Array.isArray(stroke.points) ||
            (stroke.box !== undefined && (!stroke.box || typeof stroke.box.id !== "string" || stroke.box.id.length > 64 ||
              (stroke.box.taskId !== undefined && (typeof stroke.box.taskId !== "string" || stroke.box.taskId.length > 64)) ||
              (stroke.box.done !== undefined && typeof stroke.box.done !== "boolean") ||
              (stroke.box.title !== undefined && (typeof stroke.box.title !== "string" || stroke.box.title.length > 200)))) ||
            !stroke.points.length || stroke.points.some(p => !p || !finite(p.x) || !finite(p.y) || (p.w !== undefined && (!finite(p.w) || p.w <= 0 || p.w > 3)))) {
          throw new Error("Opgeslagen penstreken zijn ongeldig; de opslag is niet overschreven.");
        }
        totalPoints += stroke.points.length;
        if (totalPoints > MAX_POINTS) throw new Error("Dit document bevat meer dan 1.000.000 tekenpunten. Splits het bord op en maak een back-up.");
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
    let points = stroke.points;
    if (stroke.shape && stroke.points.length >= 2) {
      const start = stroke.points[0], end = stroke.points[stroke.points.length - 1];
      if (stroke.shape === "rectangle") {
        points = [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }, start];
      } else if (stroke.shape === "ellipse") {
        points = Array.from({ length: 33 }, (_, index) => {
          const angle = index / 32 * Math.PI * 2;
          return { x: (start.x + end.x) / 2 + Math.cos(angle) * Math.abs(end.x - start.x) / 2,
            y: (start.y + end.y) / 2 + Math.sin(angle) * Math.abs(end.y - start.y) / 2 };
        });
      }
    }
    return points.some((d, i) => {
      const c = points[Math.max(0, i - 1)];
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
      const at = t => a.w === undefined || b.w === undefined ? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t };
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

  function erase(strokes, from, to, radius, boundsOf = strokeBounds) {
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    const local = p => ({ x: length ? ((p.x - from.x) * dx + (p.y - from.y) * dy) / length : 0,
      y: length ? (-(p.x - from.x) * dy + (p.y - from.y) * dx) / length : 0 });
    // Alleen streken in de buurt van de gum worden doorgerekend: dat houdt de gum snel op grote borden.
    const box = { left: Math.min(from.x, to.x) - radius, top: Math.min(from.y, to.y) - radius,
      right: Math.max(from.x, to.x) + radius, bottom: Math.max(from.y, to.y) + radius };
    let result = null, dirty = null;
    for (let index = 0; index < strokes.length; index++) {
      const stroke = strokes[index];
      let replacement = null;
      const bounds = boundsOf(stroke);
      if (intersectsBounds(bounds, box)) {
        if (stroke.shape) {
          if (hitStroke(stroke, from, to, radius)) replacement = [];
        } else {
          const r = radius + stroke.width / 2;
          const clipped = splitStroke(stroke, (a, b) => [
            ...circleInterval(a, b, from, r),
            ...circleInterval(a, b, to, r),
            ...(length ? rectangleInterval(local(a), local(b), 0, -r, length, r) : [])
          ]);
          if (clipped.changed) replacement = clipped.strokes;
        }
      }
      if (replacement) {
        dirty = dirty
          ? { left: Math.min(dirty.left, bounds.left), top: Math.min(dirty.top, bounds.top), right: Math.max(dirty.right, bounds.right), bottom: Math.max(dirty.bottom, bounds.bottom) }
          : { ...bounds };
      }
      if (replacement && !result) result = strokes.slice(0, index);
      if (result) result.push(...(replacement || [stroke]));
    }
    return result ? { changed: true, strokes: result, dirty } : { changed: false, strokes };
  }

  function clearPage(strokes, page) {
    return transformStrokes(strokes, (a, b) => {
      const top = page * 1144;
      if (a.x === b.x && a.y === b.y) return a.x >= 0 && a.x <= 800 && a.y >= top && a.y <= top + 1120 ? [[0, 1]] : [];
      return rectangleInterval(a, b, 0, top, 800, top + 1120);
    });
  }

  function simplifyPoints(points, tolerance = .75) {
    if (!Array.isArray(points) || points.length <= 2) return points ? points.slice() : [];
    const squareTolerance = tolerance * tolerance;
    const radial = [points[0]];
    let previous = points[0];
    for (let index = 1; index < points.length - 1; index++) {
      const point = points[index];
      const dx = point.x - previous.x, dy = point.y - previous.y;
      if (dx * dx + dy * dy >= squareTolerance) {
        radial.push(point);
        previous = point;
      }
    }
    radial.push(points[points.length - 1]);
    const simplify = (start, end, output) => {
      let maxDistance = squareTolerance, split = 0;
      const a = radial[start], b = radial[end];
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      for (let index = start + 1; index < end; index++) {
        const point = radial[index];
        const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
        const x = a.x + t * dx, y = a.y + t * dy;
        const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
        if (distance > maxDistance) { maxDistance = distance; split = index; }
      }
      if (!split) return;
      if (split - start > 1) simplify(start, split, output);
      output.push(radial[split]);
      if (end - split > 1) simplify(split, end, output);
    };
    const result = [radial[0]];
    simplify(0, radial.length - 1, result);
    result.push(radial[radial.length - 1]);
    return result;
  }

  function strokeBounds(stroke) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const point of stroke.points) {
      // w = inktdikte van dit punt (snelheid/druk), 1 als hij ontbreekt.
      const padding = stroke.width / 2 * (point.w || 1);
      left = Math.min(left, point.x - padding);
      top = Math.min(top, point.y - padding);
      right = Math.max(right, point.x + padding);
      bottom = Math.max(bottom, point.y + padding);
    }
    return { left, top, right, bottom };
  }

  function intersectsBounds(a, b) {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const a = polygon[index], b = polygon[previous];
      const crosses = (a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function strokeInPolygon(stroke, polygon) {
    if (!stroke || !Array.isArray(stroke.points) || !Array.isArray(polygon) || polygon.length < 3) return false;
    if (stroke.points.some(point => pointInPolygon(point, polygon))) return true;
    const orientation = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const crosses = (a, b, c, d) => orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);
    for (let pointIndex = 1; pointIndex < stroke.points.length; pointIndex++) {
      const a = stroke.points[pointIndex - 1], b = stroke.points[pointIndex];
      for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex++) {
        const c = polygon[edgeIndex], d = polygon[(edgeIndex + 1) % polygon.length];
        if (crosses(a, b, c, d)) return true;
      }
    }
    return false;
  }

  // Herkent een snelle heen-en-weer-krabbel in ruwe penpunten. Handschrift loopt
  // langs de hoofdrichting van links naar rechts; een krabbel gaat meerdere keren
  // terug langs diezelfde hoofdas. Geeft null terug als het geen krabbel is.
  function scribbleInfo(points, width = 4) {
    if (!Array.isArray(points) || points.length < 10) return null;
    let sx = 0, sy = 0, left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, length = 0;
    for (let index = 0; index < points.length; index++) {
      const p = points[index];
      sx += p.x; sy += p.y;
      left = Math.min(left, p.x); top = Math.min(top, p.y);
      right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
      if (index) length += Math.hypot(p.x - points[index - 1].x, p.y - points[index - 1].y);
    }
    const mx = sx / points.length, my = sy / points.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of points) {
      sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my);
    }
    const theta = .5 * Math.atan2(2 * sxy, sxx - syy);
    const c = Math.cos(theta), s = Math.sin(theta);
    const u = points.map(p => (p.x - mx) * c + (p.y - my) * s);
    const span = Math.max(...u) - Math.min(...u);
    const longest = Math.max(right - left, bottom - top), shortest = Math.min(right - left, bottom - top);
    if (span < 18 || longest > 600 || shortest > 260 || length < span * 3.5) return null;
    const minTravel = Math.max(8, span * .5);
    let low = u[0], high = u[0], direction = 0, extreme = u[0], reversals = 0;
    for (const value of u) {
      if (direction === 0) {
        low = Math.min(low, value); high = Math.max(high, value);
        if (high - low >= minTravel) { direction = value >= high ? 1 : -1; extreme = value; }
      } else if (direction === 1) {
        if (value > extreme) extreme = value;
        else if (extreme - value >= minTravel) { reversals++; direction = -1; extreme = value; }
      } else {
        if (value < extreme) extreme = value;
        else if (value - extreme >= minTravel) { reversals++; direction = 1; extreme = value; }
      }
    }
    if (reversals < 4) return null;
    const pad = width / 2 + 5;
    return { left: left - pad, top: top - pad, right: right + pad, bottom: bottom + pad, reversals, width };
  }

  // Verwijdert bestaande inkt onder een krabbel. Korte streken (letters/woorden)
  // verdwijnen helemaal; een lange streek die er doorheen loopt wordt alleen
  // binnen het krabbelvak afgeknipt. Vormen en markeerstift blijven staan.
  function scribbleErase(strokes, points, width, boundsOf = strokeBounds) {
    const box = scribbleInfo(points, width);
    if (!box) return { scribble: false, changed: false, removed: 0, strokes };
    const path = simplifyPoints(points, 2);
    const radius = width / 2 + 2;
    const big = Math.max(box.right - box.left, box.bottom - box.top) * 1.6 + 40;
    const result = [];
    let changed = false, removed = 0;
    for (const stroke of strokes) {
      if (stroke.shape || stroke.brush === "highlighter") { result.push(stroke); continue; }
      const b = boundsOf(stroke);
      if (!intersectsBounds(b, box)) { result.push(stroke); continue; }
      const covered = b.left >= box.left && b.right <= box.right && b.top >= box.top && b.bottom <= box.bottom;
      let hit = covered;
      for (let index = 1; !hit && index < path.length; index++) hit = hitStroke(stroke, path[index - 1], path[index], radius);
      if (!hit && path.length === 1) hit = hitStroke(stroke, path[0], path[0], radius);
      if (!hit) { result.push(stroke); continue; }
      changed = true;
      if (covered || Math.max(b.right - b.left, b.bottom - b.top) <= big) { removed++; continue; }
      const clipped = splitStroke(stroke, (a, d) => rectangleInterval(a, d, box.left, box.top, box.right, box.bottom));
      removed++;
      result.push(...clipped.strokes);
    }
    return { scribble: true, changed, removed, strokes: changed ? result : strokes };
  }

  // Aandeel van een streek (0-1) dat binnen de lasso valt; bemonstert langs de lijn,
  // zodat een korte of lange streek hetzelfde telt en een rakelings geraakte streek niet meegaat.
  function strokeInsideFraction(stroke, polygon) {
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length || !Array.isArray(polygon) || polygon.length < 3) return 0;
    let samples = [];
    if (stroke.shape && stroke.points.length >= 2) {
      const a = stroke.points[0], b = stroke.points[stroke.points.length - 1];
      samples = [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }];
    } else {
      samples.push(stroke.points[0]);
      for (let index = 1; index < stroke.points.length; index++) {
        const a = stroke.points[index - 1], b = stroke.points[index];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
        for (let step = 1; step <= steps; step++) samples.push({ x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps });
      }
    }
    let inside = 0;
    for (const sample of samples) if (pointInPolygon(sample, polygon)) inside++;
    return inside / samples.length;
  }

  function pinch(view, a, b, nextA, nextB, rect) {
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const scale = Math.max(.2, Math.min(4, view.scale * Math.hypot(nextB.x - nextA.x, nextB.y - nextA.y) / Math.max(1, distance)));
    const center = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    const next = { x: (nextA.x + nextB.x) / 2 - rect.left, y: (nextA.y + nextB.y) / 2 - rect.top };
    return { x: view.x + center.x / view.scale - next.x / scale, y: view.y + center.y / view.scale - next.y / scale, scale };
  }

  window.IpadModel = {
    KEY, createDocument, createMeasurementDocument, validate, load, save, point, zoom,
    hitStroke, erase, clearPage, scribbleInfo, scribbleErase, pinch, simplifyPoints, strokeBounds, intersectsBounds, pointInPolygon, strokeInPolygon, strokeInsideFraction
  };
})();
