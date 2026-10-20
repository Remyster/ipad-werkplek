(function () {
  "use strict";
  const HUB = "https://remyster.github.io/solo-leveling/";
  const DATABASE = "https://mdslvdrsggpksqrbtwci.supabase.co";

  function session(storage) {
    const raw = storage.getItem("werkhub_auth");
    if (!raw) throw new Error("Geen WerkHub-login in deze browser. Gebruik Log in bij WerkHub binnen deze app, log daar in en klik daarna Laad open taken. Een beginscherm-app kan aparte opslag hebben.");
    let value;
    try { value = JSON.parse(raw); } catch (error) { throw new Error("WerkHub-login is ongeldig. Log opnieuw in via het WerkHub-paneel."); }
    if (!value || typeof value.access_token !== "string" || !value.access_token ||
        typeof value.expires_at !== "number" || value.expires_at * 1000 <= Date.now() + 30000) {
      throw new Error("WerkHub-login ontbreekt of is verlopen. Gebruik Log in bij WerkHub binnen deze app, daarna Laad open taken.");
    }
    return value.access_token;
  }

  function publicConfig(html) {
    const url = html.match(/const\s+SB_URL\s*=\s*['"]([^'"]+)['"]/);
    const key = html.match(/const\s+SB_KEY\s*=\s*['"]([^'"]+)['"]/);
    if (!url || url[1] !== DATABASE || !key) throw new Error("WerkHub-configuratie is veranderd. De koppeling moet worden bijgewerkt.");
    if (!key[1].startsWith("sb_publishable_")) {
      const parts = key[1].split(".");
      if (parts.length !== 3) throw new Error("WerkHub bevat geen herkenbare publieke clientsleutel.");
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role !== "anon") throw new Error("Niet-publieke WerkHub-sleutels worden geweigerd.");
    }
    return { url: DATABASE, key: key[1] };
  }

  function tasks(value) {
    if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== "string" ||
        typeof item.titel !== "string" || typeof item.status !== "string" ||
        (item.deadline !== null && !/^\d{4}-\d{2}-\d{2}$/.test(item.deadline)) ||
        (item.project !== null && typeof item.project !== "string"))) {
      throw new Error("WerkHub gaf een onverwacht taakformaat. Er worden geen taken getoond.");
    }
    return value;
  }

  async function loadTasks(storage, request = fetch) {
    const token = session(storage);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const source = await request(HUB, { cache: "no-store", credentials: "omit", signal: controller.signal });
      if (!source.ok) throw new Error(`WerkHub-configuratie laden mislukt (HTTP ${source.status}).`);
      const config = publicConfig(await source.text());
      const response = await request(`${config.url}/rest/v1/work_tasks?select=id,titel,status,deadline,project&status=neq.klaar&order=deadline.asc.nullslast&limit=100`, {
        method: "GET", cache: "no-store", credentials: "omit", signal: controller.signal,
        headers: { apikey: config.key, Authorization: `Bearer ${token}` }
      });
      if (response.status === 401) throw new Error("WerkHub-login is verlopen. Open WerkHub en log opnieuw in.");
      if (response.status === 403) throw new Error("Geen toegang tot WerkHub-taken. Controleer de databaserechten.");
      if (!response.ok) throw new Error(`WerkHub-taken laden mislukt (HTTP ${response.status}).`);
      return tasks(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }

  let cachedConfig = null;
  async function config(request = fetch) {
    if (cachedConfig) return cachedConfig;
    const source = await request(HUB, { cache: "no-store", credentials: "omit" });
    if (!source.ok) throw new Error(`WerkHub-configuratie laden mislukt (HTTP ${source.status}).`);
    cachedConfig = publicConfig(await source.text());
    return cachedConfig;
  }

  // Geldige login, zo nodig zelf ververst met het refresh-token (zelfde login als WerkHub).
  let refreshing = null;
  async function freshSession(storage = localStorage, request = fetch) {
    try { return session(storage); } catch (error) {
      let value;
      try { value = JSON.parse(storage.getItem("werkhub_auth") || "null"); } catch (parseError) { value = null; }
      if (!value || typeof value.refresh_token !== "string" || !value.refresh_token) throw error;
      if (!refreshing) refreshing = (async () => {
        const settings = await config(request);
        const response = await request(`${settings.url}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST", cache: "no-store", credentials: "omit",
          headers: { apikey: settings.key, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: value.refresh_token })
        });
        if (!response.ok) throw new Error("WerkHub-login is verlopen. Log opnieuw in via WerkHub op Vandaag.");
        const fresh = await response.json();
        if (!fresh || typeof fresh.access_token !== "string") throw new Error("WerkHub gaf geen geldige login terug.");
        storage.setItem("werkhub_auth", JSON.stringify(fresh));
        return fresh.access_token;
      })().finally(() => { refreshing = null; });
      return refreshing;
    }
  }

  window.WorkplaceConnections = { session, freshSession, publicConfig, config, tasks, loadTasks };
  // WerkHub en AI Hub staan altijd open, naast elkaar op Vandaag.
  const workhubFrame = document.getElementById("workhub-frame");
  workhubFrame.src = HUB;
  const frame = document.getElementById("hub-frame");
  if (frame) frame.src = "https://remyster.github.io/ai-hub-remy/";

  function calendarUrl(id, second = "") {
    for (const value of [id, ...(second ? [second] : [])]) {
      if (!value || value.length > 300 || !/^[a-zA-Z0-9_.@+-]+$/.test(value) || !value.includes("@")) throw new Error("Vul een geldige agenda-ID in, geen URL of geheime link.");
    }
    const url = new URL("https://calendar.google.com/calendar/embed");
    url.search = new URLSearchParams({ src: id, ctz: "Europe/Amsterdam", mode: "AGENDA", showTitle: "0", showPrint: "0" }).toString();
    if (second) url.searchParams.append("src", second);
    return url.href;
  }
  window.WorkplaceConnections.calendarUrl = calendarUrl;
  const CALENDAR_KEY = "remy-ipad-calendar-settings";
  const calendar = document.getElementById("calendar-frame");
  const calendarFields = ["calendar-name", "calendar-id", "calendar-name-private", "calendar-id-private"];
  function readCalendarSettings() {
    try {
      const value = JSON.parse(localStorage.getItem(CALENDAR_KEY) || "null");
      return value && typeof value === "object" ? value : {};
    } catch (error) {
      return {};
    }
  }
  function saveCalendarSettings() {
    const settings = Object.fromEntries(calendarFields.map(id => [id, document.getElementById(id).value.trim()]));
    localStorage.setItem(CALENDAR_KEY, JSON.stringify(settings));
    return settings;
  }
  const savedCalendar = readCalendarSettings();
  for (const id of calendarFields) document.getElementById(id).value = savedCalendar[id] || "";
  document.getElementById("show-calendar").addEventListener("click", () => {
    try {
      const settings = saveCalendarSettings();
      calendar.src = calendarUrl(settings["calendar-id"], settings["calendar-id-private"]);
      calendar.hidden = false;
      const names = [settings["calendar-name"], settings["calendar-name-private"]].filter(Boolean).join(" en ");
      document.getElementById("calendar-status").textContent = `${names || "Agenda"} opgeslagen en geopend. Een leeg of geblokkeerd paneel vraagt om Google-login/toestemming.`;
    } catch (error) { document.getElementById("calendar-status").textContent = error.message; }
  });
  for (const id of calendarFields) document.getElementById(id).addEventListener("change", saveCalendarSettings);
  document.getElementById("hide-calendar").addEventListener("click", () => {
    calendar.hidden = true;
    calendar.removeAttribute("src");
  });
  if (savedCalendar["calendar-id"] && localStorage.getItem("remy-ipad-old-calendar") === "1") {
    try {
      calendar.src = calendarUrl(savedCalendar["calendar-id"], savedCalendar["calendar-id-private"]);
      calendar.hidden = false;
      document.getElementById("calendar-status").textContent = `${savedCalendar["calendar-name"] || "Opgeslagen agenda"} automatisch geopend.`;
    } catch (error) {
      document.getElementById("calendar-status").textContent = error.message;
    }
  }
})();
