(function () {
  "use strict";
  // Wat nu: je WerkHub-taken in drie bakken (Eisenhower).
  // Eisenhower: Doen (urgent+belangrijk), Gepland (belangrijk; zonder datum: Plannen), Delegeren (urgent, niet belangrijk), Rest (tussendoor).
  // Vinkje = klaar in WerkHub en weg uit de lijst. Geen timer.
  const $ = id => document.getElementById(id);
  const card = $("nu-card");
  if (!card) return;
  const H = () => window.WorkplaceWerkhub;
  const say = text => { $("nu-status").textContent = text; };
  const notify = (text, label, action) => window.WorkplaceWriting?.notify ? window.WorkplaceWriting.notify(text, label, action) : say(text);
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  // Zelfde regel als WerkHub: zonder gekozen prioriteit is een taak met deadline binnen 2 dagen urgent.
  function bucket(task) {
    // Een subtaak met belangrijk_vanaf schuift op die dag naar Belangrijk, net als in WerkHub (v30).
    if (task.taaktype === "subtaak") return task.belangrijk_vanaf && task.belangrijk_vanaf <= iso(new Date()) ? "belangrijk" : task.prioriteit === "delegeren" ? "delegeren" : "wel";
    // Vaste taak (komt elke dag/week/maand terug): op de dag zelf of te laat bij Doen, anders niet in Wat nu.
    if (task.herhaling && task.herhaling !== "eenmalig") return task.deadline && task.deadline <= iso(new Date()) ? "urgent" : "vast";
    if (task.prioriteit === "urgent" || task.prioriteit === "belangrijk") return task.prioriteit;
    const soon = iso(new Date(Date.now() + 2 * 864e5));
    return task.deadline && task.deadline <= soon ? "urgent" : "belangrijk";
  }

  // Vaste taken: zelfde regels als WerkHub v35.
  const isFixed = task => !!task.herhaling && task.herhaling !== "eenmalig";
  function nextDate(from, rhythm) {
    const d = new Date(from + "T12:00:00");
    if (rhythm === "dagelijks") d.setDate(d.getDate() + 1);
    else if (rhythm === "wekelijks") d.setDate(d.getDate() + 7);
    else if (rhythm === "tweewekelijks") d.setDate(d.getDate() + 14);
    else if (rhythm === "maandelijks") d.setMonth(d.getMonth() + 1);
    else return from;
    return iso(d);
  }
  const plusDays = n => iso(new Date(Date.now() + n * 864e5));
  const shortDate = value => new Date(value + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  // Zelfde regels als WerkHub v35: ritme_datum onthoudt de vaste dag als je "alleen deze keer" uitstelt.
  const rhythmDay = task => task.ritme_datum || task.deadline || iso(new Date());
  function nextInRhythm(task) {
    const today = iso(new Date());
    let d = nextDate(rhythmDay(task), task.herhaling);
    for (let i = 0; i < 400 && d <= today; i++) d = nextDate(d, task.herhaling);
    return d;
  }
  const longDate = value => new Date(value + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  const weekday = value => new Date(value + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "long" });

  // Keuzevenster: geeft de waarde van de gekozen knop terug, of null bij annuleren.
  function choose(title, text, options) {
    const dialog = $("choice-dialog");
    $("choice-title").textContent = title;
    $("choice-text").textContent = text;
    return new Promise(resolve => {
      let picked = null;
      $("choice-options").replaceChildren(...options.map((option, index) => {
        const button = Object.assign(document.createElement("button"), { type: "button", className: index === 0 ? "choice-main" : "" });
        button.append(Object.assign(document.createElement("b"), { textContent: option.label }), Object.assign(document.createElement("small"), { textContent: option.sub }));
        button.addEventListener("click", () => { picked = option.value; dialog.close(); });
        return button;
      }));
      dialog.addEventListener("close", () => resolve(picked), { once: true });
      dialog.showModal();
    });
  }

  async function saveFixed(task, li, deadline, ritme, status, message) {
    li.classList.add("gone");
    try {
      await H().setTaskDeadline(task.id, deadline, status, ritme);
      setTimeout(() => load(), 250);
      notify(`${message}: ${task.titel}`, "Ongedaan", async () => {
        try { await H().setTaskDeadline(task.id, task.deadline || deadline, task.status, task.ritme_datum || null); await load(); } catch (error) { notify(error.message || String(error)); }
      });
    } catch (error) { li.classList.remove("gone"); say(`Opslaan mislukt: ${error.message || error}`); }
  }

  async function postpone(task, li, days) {
    const target = plusDays(days);
    let once = true;
    if (task.herhaling !== "dagelijks") {
      const after = nextInRhythm({ ...task, deadline: target, ritme_datum: rhythmDay(task) });
      const answer = await choose(`${task.titel} naar ${longDate(target)}`, "Is dit alleen deze keer, of voortaan?", [
        { label: "Alleen deze keer", sub: `Volgende keer weer in het ritme: ${longDate(after)}.`, value: "once" },
        { label: "Vanaf nu", sub: `Het ritme schuift mee: voortaan op ${weekday(target)}.`, value: "always" }
      ]);
      if (!answer) return;
      once = answer === "once";
    }
    saveFixed(task, li, target, once ? rhythmDay(task) : null, null, `⏩ ${once ? "Deze keer" : "Voortaan"} ${shortDate(target)}`);
  }

  async function skip(task, li) {
    const next = nextInRhythm(task);
    saveFixed(task, li, next, null, null, `⏭ Overgeslagen, volgende keer ${shortDate(next)}`);
  }

  async function fixedDone(task, li) {
    const inRhythm = nextInRhythm(task), fromToday = nextDate(iso(new Date()), task.herhaling);
    let next = inRhythm;
    if (iso(new Date()) !== rhythmDay(task) && inRhythm !== fromToday) {
      next = await choose("Gedaan! Wanneer de volgende keer?", `${task.titel} stond voor ${longDate(rhythmDay(task))}.`, [
        { label: `🔁 In het ritme: ${longDate(inRhythm)}`, sub: "Het vaste ritme blijft zoals het was.", value: inRhythm },
        { label: `📅 Vanaf vandaag: ${longDate(fromToday)}`, sub: "Het ritme schuift mee met vandaag.", value: fromToday }
      ]);
      if (!next) return;
    }
    saveFixed(task, li, next, null, "backlog", `✓ Gedaan, volgende keer ${shortDate(next)}`);
  }

  function deadlineText(deadline) {
    if (!deadline) return "";
    const days = Math.round((new Date(deadline + "T12:00:00") - new Date(iso(new Date()) + "T12:00:00")) / 864e5);
    if (days < 0) return `${-days} ${days === -1 ? "dag" : "dagen"} te laat`;
    if (days === 0) return "vandaag";
    if (days === 1) return "morgen";
    return new Date(deadline + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  }

  function calendarLink(task) {
    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.set("action", "TEMPLATE");
    url.searchParams.set("text", task.titel);
    url.searchParams.set("details", "Ingepland vanuit de Werkplek (WerkHub-taak).");
    url.searchParams.set("ctz", "Europe/Amsterdam");
    return url.href;
  }

  function row(task) {
    const li = document.createElement("li");
    const check = Object.assign(document.createElement("button"), { type: "button", className: "prio-check", title: "Klaar", ariaLabel: `Klaar: ${task.titel}` });
    check.addEventListener("click", () => done(task, li));
    const title = Object.assign(document.createElement("span"), { className: "prio-title", textContent: task.titel });
    const when = deadlineText(task.deadline) + (task.ritme_datum && task.ritme_datum !== task.deadline ? " · verzet" : "");
    if (when) title.append(Object.assign(document.createElement("small"), { textContent: when }));
    li.append(check, title);
    if (isFixed(task) && bucket(task) === "urgent") {
      const actions = document.createElement("span");
      actions.className = "prio-fixed";
      for (const [label, title, run] of [["+1 dag", "Een dag later", () => postpone(task, li, 1)], ["+2 dagen", "Twee dagen later", () => postpone(task, li, 2)], ["⏭ Overslaan", "Deze keer niet", () => skip(task, li)]]) {
        const button = Object.assign(document.createElement("button"), { type: "button", textContent: label, title });
        button.addEventListener("click", run);
        actions.append(button);
      }
      li.append(actions);
    }
    if (bucket(task) === "belangrijk") {
      li.append(Object.assign(document.createElement("a"), { className: "prio-plan", href: calendarLink(task), target: "_blank", rel: "noopener noreferrer", textContent: "📅 Plan" }));
    }
    return li;
  }

  const MAX_SHOWN = 5;
  const expanded = new Set();
  let tasks = [];
  function render() {
    const order = (a, b) => (a.deadline || "9999") < (b.deadline || "9999") ? -1 : (a.deadline || "9999") > (b.deadline || "9999") ? 1 : 0;
    const open = tasks.filter(task => task.status !== "wacht_op");
    for (const key of ["urgent", "belangrijk", "delegeren", "wel"]) {
      const list = $(`prio-${key}`);
      let items = open.filter(task => bucket(task) === key).sort(order);
      // Gepland: wat al een datum heeft eerst; daaronder "Plannen" = nog zonder datum.
      const unplanned = key === "belangrijk" ? items.filter(task => !task.deadline) : [];
      if (unplanned.length) items = [...items.filter(task => task.deadline), ...unplanned];
      // Maximaal 5 per bak (eerstvolgende datum eerst). Vink je er een af, dan schuift de volgende omhoog.
      const shown = expanded.has(key) ? items : items.slice(0, MAX_SHOWN);
      const rows = shown.map(row);
      const firstUnplanned = shown.findIndex(task => unplanned.includes(task));
      if (firstUnplanned >= 0) {
        const head = Object.assign(document.createElement("li"), { className: "prio-sub", textContent: `🗓️ Plannen · nog zonder datum (${unplanned.length})` });
        rows.splice(firstUnplanned, 0, head);
      }
      if (items.length > MAX_SHOWN) {
        const more = Object.assign(document.createElement("button"), { type: "button", className: "prio-more",
          textContent: expanded.has(key) ? "Minder tonen" : `+ ${items.length - MAX_SHOWN} meer` });
        more.addEventListener("click", () => { expanded.has(key) ? expanded.delete(key) : expanded.add(key); render(); });
        const li = document.createElement("li");
        li.className = "prio-meer";
        li.append(more);
        rows.push(li);
      }
      list.replaceChildren(...(items.length ? rows : [Object.assign(document.createElement("li"), {
        className: "prio-leeg", textContent: key === "urgent" ? "Niks urgents. Lekker." : key === "belangrijk" ? "Niks gepland." : key === "delegeren" ? "Niks om door te geven." : "Geen klusjes voor tussendoor."
      })]));
    }
    const waiting = tasks.filter(task => task.status === "wacht_op");
    $("prio-wacht").hidden = !waiting.length;
    $("prio-wacht").textContent = waiting.length ? `⏳ Wacht op iemand: ${waiting.map(task => task.titel).join(" · ")}` : "";
  }

  async function done(task, li) {
    li.classList.add("gone");
    // Vaste taak: niet op klaar, maar door naar de volgende keer (bij twijfel vragen we het ritme).
    if (isFixed(task)) { li.classList.remove("gone"); fixedDone(task, li); return; }
    try {
      await H().setTaskStatus(task.id, "klaar");
      setTimeout(() => { tasks = tasks.filter(item => item.id !== task.id); render(); }, 250);
      notify(`✓ Klaar: ${task.titel}`, "Ongedaan", async () => {
        try { await H().setTaskStatus(task.id, task.status === "wacht_op" ? "wacht_op" : "backlog"); await load(); }
        catch (error) { notify(error.message || String(error)); }
      });
    } catch (error) {
      li.classList.remove("gone");
      say(`Afvinken mislukt: ${error.message || error}`);
    }
  }

  async function load() {
    try { window.WorkplaceConnections.session(localStorage); }
    catch (error) { tasks = []; render(); say("Log in bij WerkHub (hieronder) voor je taken."); return; }
    try {
      tasks = await H().openTasks();
      render();
      say("");
    } catch (error) {
      say(`Taken laden mislukt: ${error.message || error}`);
    }
  }

  $("nu-refresh").addEventListener("click", () => { load(); window.WorkplaceAgenda?.load(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  setInterval(load, 3 * 60000);
  render();
  setTimeout(load, 50);
  window.WorkplaceNu = { load, bucket };
})();
