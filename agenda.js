(function () {
  "use strict";
  // Agenda via WerkHub (Supabase edge function werkhub-agenda): Google-agenda's server-side
  // gelezen via het geheime iCal-adres. Geen iframe, geen Google-cookies in Safari.
  const ENDPOINT = "https://mdslvdrsggpksqrbtwci.supabase.co/functions/v1/werkhub-agenda";
  const $ = id => document.getElementById(id);
  const list = $("agenda-list"), status = $("agenda-status");
  if (!list) return;

  const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const time = date => date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

  function render(items) {
    const days = new Map();
    const now = Date.now();
    for (const item of items) {
      const start = item.allDay ? new Date(`${item.start}T00:00:00`) : new Date(item.start);
      const end = item.allDay ? new Date(`${item.end}T00:00:00`) : new Date(item.end);
      const key = dayKey(start);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push({ ...item, startDate: start, endDate: end });
    }
    const today = dayKey(new Date());
    const tomorrow = dayKey(new Date(Date.now() + 864e5));
    list.replaceChildren(...[...days.entries()].map(([key, entries]) => {
      const section = document.createElement("section");
      section.className = "agenda-day";
      const heading = document.createElement("h4");
      const date = entries[0].startDate;
      heading.textContent = key === today ? "Vandaag" : key === tomorrow ? "Morgen" :
        date.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
      section.append(heading);
      for (const entry of entries) {
        const row = document.createElement("div");
        row.className = "agenda-item" + (!entry.allDay && entry.startDate.getTime() <= now && entry.endDate.getTime() > now ? " now" : "");
        const when = document.createElement("time");
        when.textContent = entry.allDay ? "hele dag" : `${time(entry.startDate)}–${time(entry.endDate)}`;
        const what = document.createElement("div");
        what.textContent = entry.title;
        const meta = [entry.location, entry.calendar].filter(Boolean).join(" · ");
        if (meta) { const small = document.createElement("small"); small.textContent = meta; what.append(small); }
        row.append(when, what);
        section.append(row);
      }
      return section;
    }));
  }

  async function load() {
    let token;
    try { token = window.WorkplaceConnections.session(localStorage); }
    catch (error) { status.textContent = "Log in bij WerkHub (paneel hieronder) om je agenda te zien."; return; }
    status.textContent = "Agenda laden...";
    try {
      const config = await window.WorkplaceConnections.config();
      const response = await fetch(`${ENDPOINT}?days=14`, {
        cache: "no-store", credentials: "omit", headers: { apikey: config.key, Authorization: `Bearer ${token}` }
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 503) { status.textContent = "Agenda nog niet ingesteld: zet je geheime iCal-adres in Supabase (secret AGENDA_ICS_URLS)."; return; }
      if (response.status === 401) { status.textContent = "WerkHub-login verlopen. Log opnieuw in."; return; }
      if (!response.ok || !Array.isArray(body.items)) throw new Error(body.error || `HTTP ${response.status}`);
      render(body.items);
      window.WorkplaceAgenda.items = body.items;
      document.dispatchEvent(new CustomEvent("agenda-updated"));
      const stamp = new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
      status.textContent = (body.items.length ? `Bijgewerkt om ${stamp}.` : "Geen afspraken de komende twee weken.") +
        (body.errors?.length ? ` Let op: ${body.errors.join("; ")}` : "");
    } catch (error) {
      status.textContent = `Agenda laden mislukt: ${error.message || error}`;
    }
  }

  $("agenda-refresh").addEventListener("click", load);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  setInterval(load, 15 * 60 * 1000);
  window.WorkplaceAgenda = { load, render, items: null };
  load();
})();
