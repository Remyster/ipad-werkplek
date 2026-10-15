(function () {
  "use strict";
  // Wat nu? Eén kaart bovenaan Vandaag: je volgende taak, je volgende afspraak en een focustimer.
  const $ = id => document.getElementById(id);
  const card = $("nu-card");
  if (!card) return;
  const FOCUS_KEY = "remy-ipad-focus";
  const DONE_KEY = "remy-ipad-done-today";
  const DURATION_KEY = "remy-ipad-focus-minutes";
  const read = (key, fallback = null) => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch (error) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* alleen gemak */ } };
  const H = () => window.WorkplaceWerkhub;
  const say = text => { $("nu-status").textContent = text; };
  const notify = (text, label, action) => window.WorkplaceWriting?.notify ? window.WorkplaceWriting.notify(text, label, action) : say(text);
  const todayKey = () => new Date().toISOString().slice(0, 10);

  let tasks = [], index = 0, minutes = Number(read(DURATION_KEY, 25)) || 25, tick = null, audio = null;

  // ---- taken ----
  function rank(task) {
    const today = todayKey();
    const sub = task.taaktype === "subtaak" ? 1 : 0;
    const bezig = task.status === "bezig" ? 0 : 1;
    const deadline = task.deadline || "9999-12-31";
    return [sub, deadline < today ? 0 : 1, bezig, deadline];
  }
  const compare = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };

  function deadlineText(deadline) {
    if (!deadline) return "";
    const days = Math.round((new Date(deadline + "T00:00:00") - new Date(todayKey() + "T00:00:00")) / 864e5);
    if (days < 0) return `${-days} ${days === -1 ? "dag" : "dagen"} te laat`;
    if (days === 0) return "deadline vandaag";
    if (days === 1) return "deadline morgen";
    return `deadline over ${days} dagen`;
  }

  function current() {
    const focus = read(FOCUS_KEY);
    if (focus && focus.taskId) return tasks.find(task => task.id === focus.taskId) || { id: focus.taskId, titel: focus.title, status: "bezig" };
    return tasks.length ? tasks[index % tasks.length] : null;
  }

  function renderTask() {
    const task = current();
    const done = read(DONE_KEY, {});
    const doneToday = done.date === todayKey() ? done.count : 0;
    $("nu-done-count").textContent = doneToday ? `Vandaag al ${doneToday} af 💪` : "";
    if (!task) {
      $("nu-task").textContent = tasks.length === 0 && loaded ? "Geen open taken. Lekker bezig!" : "Volgende taak laden…";
      $("nu-meta").textContent = "";
      $("nu-done").disabled = true;
      $("nu-skip").disabled = true;
      return;
    }
    $("nu-task").textContent = task.titel;
    $("nu-meta").textContent = [task.status === "bezig" ? "mee bezig" : "", task.taaktype === "subtaak" ? "subtaak" : "", deadlineText(task.deadline),
      tasks.length > 1 ? `${(index % tasks.length) + 1} van ${tasks.length}` : ""].filter(Boolean).join(" · ");
    $("nu-meta").classList.toggle("late", !!task.deadline && task.deadline < todayKey());
    $("nu-done").disabled = false;
    $("nu-skip").disabled = tasks.length < 2 || !!read(FOCUS_KEY);
  }

  let loaded = false;
  async function loadTasks() {
    try { window.WorkplaceConnections.session(localStorage); }
    catch (error) { loaded = true; tasks = []; renderTask(); $("nu-task").textContent = "Log in bij WerkHub (hieronder) voor je volgende taak."; say("Focustimer werkt ook zonder taak."); return; }
    try {
      tasks = (await H().openTasks()).sort(compare);
      loaded = true;
      index = Math.min(index, Math.max(0, tasks.length - 1));
      renderTask();
      say("");
    } catch (error) {
      say(`Taken laden mislukt: ${error.message || error}`);
    }
  }

  async function markDone() {
    const task = current();
    if (!task) return;
    $("nu-done").disabled = true;
    try {
      await H().setTaskStatus(task.id, "klaar");
      const done = read(DONE_KEY, {});
      write(DONE_KEY, { date: todayKey(), count: (done.date === todayKey() ? done.count : 0) + 1 });
      stopTimer(false);
      tasks = tasks.filter(item => item.id !== task.id);
      if (index >= tasks.length) index = 0;
      celebrate();
      renderTask();
      notify(`✓ Af: ${task.titel}`, "Ongedaan", async () => {
        try { await H().setTaskStatus(task.id, task.status === "klaar" ? "backlog" : task.status); await loadTasks(); } catch (error) { notify(error.message); }
      });
    } catch (error) {
      say(`Afvinken mislukt: ${error.message || error}`);
    } finally {
      $("nu-done").disabled = false;
    }
  }

  function celebrate() {
    card.classList.remove("cheer");
    void card.offsetWidth;
    card.classList.add("cheer");
    chime([660, 880, 1320]);
  }

  // ---- geluid (zacht, alleen na een tik ontgrendeld) ----
  function unlockAudio() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch (error) { audio = null; }
  }
  function chime(notes = [523, 659, 784]) {
    if (!audio) return;
    notes.forEach((frequency, i) => {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const start = audio.currentTime + i * .18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.18, start + .03);
      gain.gain.exponentialRampToValueAtTime(.001, start + .6);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + .65);
    });
  }

  // ---- afspraak ----
  function nextEvent() {
    const items = window.WorkplaceAgenda?.items || [];
    const now = Date.now();
    return items.filter(item => !item.allDay && new Date(item.end).getTime() > now)
      .sort((a, b) => a.start.localeCompare(b.start))[0] || null;
  }
  function minutesUntil(event) { return Math.round((new Date(event.start).getTime() - Date.now()) / 60000); }
  function renderEvent() {
    const event = nextEvent();
    const box = $("nu-event");
    if (!event) { box.textContent = window.WorkplaceAgenda?.items ? "Geen afspraken meer vandaag of morgen." : ""; box.className = "nu-event"; return; }
    const until = minutesUntil(event);
    const start = new Date(event.start);
    const clock = start.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
    const sameDay = start.toDateString() === new Date().toDateString();
    let when;
    if (until <= 0) when = "nu bezig";
    else if (until < 60) when = `over ${until} min (${clock})`;
    else when = sameDay ? `om ${clock}` : start.toLocaleDateString("nl-NL", { weekday: "long" }) + ` ${clock}`;
    box.textContent = `📅 ${event.title} · ${when}${event.location ? ` · ${event.location}` : ""}`;
    box.className = "nu-event" + (until > 0 && until <= 15 ? " soon" : "");
    // Timer niet langer dan tot 5 min voor je afspraak.
    const room = until - 5;
    $("nu-fit").hidden = !(sameDay && room >= 5 && room < minutes);
    $("nu-fit").textContent = `Past tot afspraak: ${room} min`;
    $("nu-fit").dataset.minutes = String(room);
  }

  // ---- focustimer ----
  function format(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  function renderTimer() {
    const focus = read(FOCUS_KEY);
    const running = !!focus;
    $("nu-timer").hidden = !running;
    $("nu-start").hidden = running;
    $("nu-durations").hidden = running;
    const pill = $("focus-pill");
    if (!running) { pill.hidden = true; return; }
    const left = focus.endAt - Date.now();
    $("nu-clock").textContent = format(left);
    $("nu-progress").style.width = `${Math.min(100, Math.max(0, 100 - left / (focus.total * 60000) * 100))}%`;
    pill.hidden = false;
    pill.textContent = `⏱ ${format(left)}${focus.title ? ` · ${focus.title.slice(0, 28)}` : ""}`;
    if (left <= 0) timeUp(focus);
  }
  function startTimer(length = minutes) {
    unlockAudio();
    const task = current();
    write(FOCUS_KEY, { endAt: Date.now() + length * 60000, total: length, taskId: task?.id || null, title: task?.titel || "" });
    if (task && task.status === "backlog" && H()) H().setTaskStatus(task.id, "bezig").then(() => { task.status = "bezig"; renderTask(); }).catch(() => {});
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    runTicker();
    renderTask();
    say(`Focus ${length} min${task ? `: ${task.titel}` : ""}. Je hoeft nu even niks anders.`);
  }
  function stopTimer(message = true) {
    localStorage.removeItem(FOCUS_KEY);
    clearInterval(tick);
    tick = null;
    renderTimer();
    renderTask();
    if (message) say("Timer gestopt.");
  }
  function timeUp(focus) {
    localStorage.removeItem(FOCUS_KEY);
    clearInterval(tick);
    tick = null;
    renderTimer();
    renderTask();
    chime();
    const text = focus.title ? `Tijd! Klaar met "${focus.title}"?` : "Tijd! Even pauze.";
    try { if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") new Notification("Werkplek", { body: text }); } catch (error) { /* geen melding */ }
    notify(text, focus.taskId ? "Ja, klaar" : "Nog 5 min", focus.taskId ? () => markDone() : () => startTimer(5));
    say(text + " Tik Klaar, of start nog een rondje.");
  }
  function runTicker() {
    clearInterval(tick);
    renderTimer();
    if (read(FOCUS_KEY)) tick = setInterval(renderTimer, 1000);
  }

  // ---- bediening ----
  function setMinutes(value) {
    minutes = value;
    write(DURATION_KEY, value);
    document.querySelectorAll("[data-nu-minutes]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.nuMinutes) === value)));
    $("nu-start").textContent = `▶ Start ${value} min`;
    renderEvent();
  }
  document.querySelectorAll("[data-nu-minutes]").forEach(button => button.addEventListener("click", () => setMinutes(Number(button.dataset.nuMinutes))));
  $("nu-start").addEventListener("click", () => startTimer(minutes));
  $("nu-fit").addEventListener("click", () => startTimer(Number($("nu-fit").dataset.minutes) || minutes));
  $("nu-stop").addEventListener("click", () => stopTimer(true));
  $("nu-plus").addEventListener("click", () => {
    const focus = read(FOCUS_KEY);
    if (!focus) return;
    write(FOCUS_KEY, { ...focus, endAt: focus.endAt + 5 * 60000, total: focus.total + 5 });
    renderTimer();
  });
  $("nu-done").addEventListener("click", () => { unlockAudio(); markDone(); });
  $("nu-skip").addEventListener("click", () => { if (tasks.length) { index = (index + 1) % tasks.length; renderTask(); } });
  $("nu-refresh").addEventListener("click", () => { loadTasks(); window.WorkplaceAgenda?.load(); });
  $("focus-pill").addEventListener("click", () => {
    document.querySelector("[data-tab=today]")?.click();
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.addEventListener("agenda-updated", renderEvent);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { renderTimer(); renderEvent(); loadTasks(); } });
  setInterval(renderEvent, 60000);
  setInterval(loadTasks, 5 * 60000);

  setMinutes(minutes);
  runTicker();
  renderTask();
  // Even wachten tot de WerkHub-module geladen is.
  setTimeout(loadTasks, 50);
  window.WorkplaceNu = { loadTasks, startTimer, stopTimer, markDone, rank, compare };
})();
