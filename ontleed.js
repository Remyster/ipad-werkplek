(function () {
  "use strict";
  // 🪓 Ontleden: een taak die te groot voelt in kleine, afvinkbare stappen hakken.
  // Je gooit eruit wat er moet gebeuren (typen of 🎤), AI (Gemini, na toestemming) maakt een kort stappenplan.
  // Stap 1 is altijd belachelijk klein, zodat beginnen makkelijk is.
  //
  // Geheugen ("leren"): elk plan wordt bewaard in werkplek_stappen. Bij een nieuw plan krijgt de AI je laatste
  // plannen mee: hoe jij zulke klussen opdeelt en bij welke stap je eerder bleef hangen. Daar maakt hij de stappen
  // dan kleiner. De Werkplek ziet ook welke taken al lang openstaan en stelt voor die te ontleden.
  const $ = id => document.getElementById(id);
  const dialog = $("ontleed-dialog");
  if (!dialog) return;
  const H = () => window.WorkplaceWerkhub;
  const STUCK_DAYS = 3;     // geen voortgang in een plan na zoveel dagen = "bleef hangen"
  const OLD_DAYS = 10;      // taak staat zo lang open zonder plan = voorstel om te ontleden
  const MEMORY = 8;         // zoveel eerdere plannen gaan mee als geheugen
  let plans = [], loaded = false, current = null, openTasks = [];

  const days = since => Math.floor((Date.now() - new Date(since).getTime()) / 864e5);
  const say = text => { $("ontleed-status").textContent = text; };

  async function loadPlans() {
    try {
      plans = await H().call("werkplek_stappen?select=id,task_id,titel,invoer,stappen,afgerond_op,created_at,updated_at&order=updated_at.desc&limit=80") || [];
      loaded = true;
    } catch (error) { loaded = false; }
    window.WorkplaceNu?.render();
  }
  const planFor = taskId => plans.find(plan => plan.task_id === taskId && !plan.afgerond_op);
  const progress = plan => { const s = plan.stappen || []; return { done: s.filter(x => x.klaar).length, total: s.length, next: s.find(x => !x.klaar) }; };

  async function savePlan(plan) {
    const body = { task_id: plan.task_id || null, titel: plan.titel.slice(0, 300), invoer: (plan.invoer || "").slice(0, 4000),
      stappen: plan.stappen, afgerond_op: plan.afgerond_op || null, updated_at: new Date().toISOString() };
    if (plan.id) {
      await H().call(`werkplek_stappen?id=eq.${encodeURIComponent(plan.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });
      plan.updated_at = body.updated_at;
    } else {
      const rows = await H().call("werkplek_stappen?select=id,created_at,updated_at", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([body]) });
      Object.assign(plan, rows[0]);
      plans.unshift(plan);
    }
  }

  // ---------- geheugen voor de AI ----------
  function memory() {
    const lines = [];
    for (const plan of plans.filter(p => p !== current).slice(0, MEMORY)) {
      const { done, total, next } = progress(plan);
      const steps = (plan.stappen || []).map(s => `${s.klaar ? "✓" : "·"} ${s.tekst}`).join(" | ");
      let state = plan.afgerond_op ? "helemaal afgerond" : `${done}/${total} gedaan`;
      if (!plan.afgerond_op && next && days(plan.updated_at) >= STUCK_DAYS) state += `, bleef ${days(plan.updated_at)} dagen hangen bij "${next.tekst}"`;
      lines.push(`- ${plan.titel} (${state}): ${steps}`);
    }
    return lines.join("\n");
  }

  function prompt(title, text) {
    const mem = memory();
    return "Je helpt Remy beginnen aan een taak die hij uitstelt omdat hij te groot voelt. Remy heeft ADHD en werkt als operator/monteur " +
      "bij drinkwaterbedrijf PWN (werkbeschrijvingen, LMRA/TRA, metingen, installaties).\n\n" +
      `Taak: ${title}\nWat Remy zegt dat er moet gebeuren (rommelig, mag ingesproken zijn):\n${text || "(niets extra, alleen de taaknaam)"}\n\n` +
      (mem ? `Zijn eerdere stappenplannen (zo pakt hij dingen aan, en waar hij bleef hangen):\n${mem}\n\n` : "") +
      "Regels:\n" +
      "- 3 tot 8 stappen, in de volgorde waarin hij ze doet.\n" +
      "- Elke stap begint met een werkwoord, maximaal 12 woorden, concreet en zichtbaar af te vinken.\n" +
      "- Stap 1 is belachelijk klein: onder de 5 minuten (bijvoorbeeld: open het oude document, pak de map erbij).\n" +
      "- Geen stap langer dan 25 minuten; splits anders.\n" +
      "- Waar hij eerder bleef hangen bij een soortgelijke stap: maak die stap hier extra klein of splits hem.\n" +
      "- Gebruik wat Remy noemt plus logische tussenstappen. Verzin geen extra werk.\n" +
      "- Eenvoudig Nederlands, geen jargon dat hij niet zelf gebruikt.\n" +
      'Antwoord ALLEEN met JSON, zonder uitleg of codeblok: {"stappen":[{"tekst":"...","min":5}],"tip":"één korte bemoedigende zin, geen clichés"}';
  }

  function parse(answer) {
    const raw = String(answer).replace(/```[a-z]*\n?|```/gi, "").trim();
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const steps = (json.stappen || []).map(s => ({ tekst: String(s.tekst || "").trim().slice(0, 200), min: Math.max(1, Math.min(120, Number(s.min) || 0)) || null, klaar: false }))
      .filter(s => s.tekst).slice(0, 12);
    if (!steps.length) throw new Error("Geen stappen terug.");
    return { steps, tip: String(json.tip || "").slice(0, 200) };
  }

  // ---------- venster ----------
  function open(task, existing) {
    current = existing || planFor(task?.id) || { task_id: task?.id || null, titel: task?.titel || "", invoer: "", stappen: [] };
    $("ontleed-titel").value = current.titel;
    $("ontleed-titel").readOnly = !!current.task_id;
    $("ontleed-tekst").value = current.invoer || "";
    $("ontleed-tip").textContent = "";
    $("ontleed-consent-row").hidden = true;
    say(current.stappen.length ? "" : "Gooi eruit wat er moet gebeuren. Rommelig mag, ik maak er stapjes van.");
    renderSteps();
    dialog.showModal();
    if (!current.stappen.length) setTimeout(() => (current.titel ? $("ontleed-tekst") : $("ontleed-titel")).focus(), 50);
  }

  function renderSteps() {
    const list = $("ontleed-stappen");
    const steps = current.stappen;
    $("ontleed-plan").hidden = !steps.length;
    $("ontleed-go").textContent = steps.length ? "🪓 Opnieuw ontleden" : "🪓 Maak stappenplan";
    const firstOpen = steps.findIndex(s => !s.klaar);
    list.replaceChildren(...steps.map((step, index) => {
      const li = document.createElement("li");
      if (index === firstOpen) li.className = "ontleed-nu";
      const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: !!step.klaar, title: "Gedaan" });
      box.addEventListener("change", () => { step.klaar = box.checked; step.klaar_op = box.checked ? new Date().toISOString() : null; renderSteps(); autosave(); });
      const text = Object.assign(document.createElement("input"), { type: "text", value: step.tekst, maxLength: 200 });
      text.addEventListener("change", () => { step.tekst = text.value.trim() || step.tekst; autosave(); });
      const min = Object.assign(document.createElement("small"), { textContent: step.min ? `±${step.min} min` : "" });
      const del = Object.assign(document.createElement("button"), { type: "button", textContent: "✕", title: "Stap weg" });
      del.addEventListener("click", () => { steps.splice(index, 1); renderSteps(); autosave(); });
      li.append(box, text, min, del);
      return li;
    }));
    const { done, total } = progress(current);
    $("ontleed-voortgang").textContent = total ? `${done} van ${total} gedaan` : "";
  }

  // Per plan een eigen timer; het plan zelf wordt vastgehouden, dus sluiten van het venster verliest niets.
  const timers = new Map();
  let saveTimer = null;
  function autosave() {
    const plan = current;
    if (!plan) return;
    clearTimeout(timers.get(plan));
    timers.set(plan, saveTimer = setTimeout(async () => {
      timers.delete(plan);
      if (!plan.stappen.length) return;
      const all = plan.stappen.every(s => s.klaar);
      const wasDone = !!plan.afgerond_op;
      plan.afgerond_op = all ? (plan.afgerond_op || new Date().toISOString()) : null;
      try { await savePlan(plan); say(all ? "🎉 Alle stappen gedaan!" : "✓ Bewaard"); }
      catch (error) { say(`Bewaren mislukt: ${error.message || error}`); window.WorkplaceNu?.notify?.(`Stap bewaren mislukt: ${error.message || error}`); return; }
      window.WorkplaceNu?.render();
      if (all && !wasDone && plan.task_id) {
        const task = openTasks.find(t => t.id === plan.task_id);
        if (task && window.confirm(`Alle stappen van "${task.titel}" zijn gedaan. Taak ook afvinken in WerkHub?`)) { dialog.close(); window.WorkplaceNu?.finish(task); }
      }
    }, 500));
  }

  async function go() {
    const title = $("ontleed-titel").value.trim();
    const text = $("ontleed-tekst").value.trim();
    if (!title) { say("Geef de klus eerst een naam."); $("ontleed-titel").focus(); return; }
    const hub = H();
    if (!window.AiChat || !hub) { say("AI-module is niet geladen. Herlaad de app."); return; }
    if (!hub.hasAiConsent()) {
      if (!$("ontleed-consent").checked) { $("ontleed-consent-row").hidden = false; say("Vink aan dat AI (Gemini, buiten PWN) dit mag krijgen."); return; }
      hub.giveAiConsent();
    }
    $("ontleed-go").disabled = true;
    say("Even hakken…");
    try {
      const { steps, tip } = parse(await window.AiChat.sendPrompt("gemini", prompt(title, text)));
      current.titel = title;
      current.invoer = text;
      current.stappen = steps;
      current.afgerond_op = null;
      $("ontleed-tip").textContent = tip ? `💬 ${tip}` : "";
      renderSteps();
      await savePlan(current);
      say("✓ Bewaard. Begin gewoon met stap 1, de rest komt dan wel.");
      window.WorkplaceNu?.render();
    } catch (error) {
      say(`Ontleden mislukt: ${error.message || error}. Probeer opnieuw of voeg zelf stappen toe.`);
    } finally { $("ontleed-go").disabled = false; }
  }

  function addStep() {
    current.titel = current.titel || $("ontleed-titel").value.trim();
    if (!current.titel) { say("Geef de klus eerst een naam."); return; }
    current.stappen.push({ tekst: "Nieuwe stap", min: null, klaar: false });
    renderSteps();
    const inputs = $("ontleed-stappen").querySelectorAll("input[type=text]");
    inputs[inputs.length - 1]?.select();
    autosave();
  }

  async function removePlan() {
    if (!current?.id || !window.confirm(`Stappenplan van "${current.titel}" weggooien?`)) return;
    try {
      await H().call(`werkplek_stappen?id=eq.${encodeURIComponent(current.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      plans = plans.filter(p => p !== current);
      dialog.close();
      window.WorkplaceNu?.render();
    } catch (error) { say(`Weggooien mislukt: ${error.message || error}`); }
  }

  // ---------- in Wat nu ----------
  // Onder een taak: 🪓-knop, en als er een plan is de eerstvolgende stap met een vinkje.
  function decorate(li, task) {
    const plan = planFor(task.id);
    const axe = Object.assign(document.createElement("button"), { type: "button", className: "prio-axe", textContent: "🪓", title: plan ? "Stappenplan openen" : "Ontleden: in kleine stappen hakken" });
    axe.addEventListener("click", () => open(task));
    li.append(axe);
    if (!plan) return;
    const { done, total, next } = progress(plan);
    if (!next) return;
    li.append(stepLine(plan, next, `${done}/${total}`));
  }

  function stepLine(plan, next, count) {
    const line = document.createElement("span");
    line.className = "prio-stap";
    const box = Object.assign(document.createElement("button"), { type: "button", className: "prio-stap-check", title: "Stap gedaan", ariaLabel: `Stap gedaan: ${next.tekst}` });
    box.addEventListener("click", async () => {
      next.klaar = true;
      next.klaar_op = new Date().toISOString();
      const before = current;
      current = plan;
      autosave();
      current = before;
      window.WorkplaceNu?.render();
    });
    line.append(box, Object.assign(document.createElement("span"), { textContent: `▶ ${next.tekst}` }), Object.assign(document.createElement("small"), { textContent: ` ${count}` }));
    return line;
  }

  function renderBox(tasks) {
    openTasks = tasks || [];
    const list = $("prio-ontleden");
    if (!list) return;
    const rows = [];
    // Losse plannen (zonder WerkHub-taak) die nog lopen.
    for (const plan of plans.filter(p => !p.task_id && !p.afgerond_op)) {
      const li = document.createElement("li");
      const title = Object.assign(document.createElement("button"), { type: "button", className: "prio-title prio-link", textContent: plan.titel });
      title.addEventListener("click", () => open(null, plan));
      li.append(title);
      const { done, total, next } = progress(plan);
      if (next) li.append(stepLine(plan, next, `${done}/${total}`));
      rows.push(li);
    }
    // Wat al lang openstaat zonder plan: voorstel. Dit is wat de Werkplek van je taken leert.
    const old = openTasks.filter(t => t.created_at && days(t.created_at) >= OLD_DAYS && !planFor(t.id) && !(t.herhaling && t.herhaling !== "eenmalig"))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(0, 3);
    if (old.length) rows.push(Object.assign(document.createElement("li"), { className: "prio-sub", textContent: "Ligt al een tijdje. Zal ik hem ontleden?" }));
    for (const task of old) {
      const li = document.createElement("li");
      const title = Object.assign(document.createElement("button"), { type: "button", className: "prio-title prio-link", textContent: `🪓 ${task.titel}` });
      title.append(Object.assign(document.createElement("small"), { textContent: `${days(task.created_at)} dagen open` }));
      title.addEventListener("click", () => open(task));
      li.append(title);
      rows.push(li);
    }
    const add = Object.assign(document.createElement("button"), { type: "button", className: "prio-more", textContent: "＋ Iets anders ontleden" });
    add.addEventListener("click", () => open(null));
    const addLi = document.createElement("li");
    addLi.className = "prio-meer";
    addLi.append(add);
    if (!rows.length) rows.push(Object.assign(document.createElement("li"), { className: "prio-leeg", textContent: loaded ? "Voelt een taak te groot? Tik op 🪓 ernaast." : "Log in bij WerkHub voor je stappenplannen." }));
    rows.push(addLi);
    list.replaceChildren(...rows);
  }

  $("ontleed-go").addEventListener("click", go);
  $("ontleed-add").addEventListener("click", addStep);
  $("ontleed-delete").addEventListener("click", removePlan);
  $("ontleed-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { current = null; });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadPlans(); });
  setTimeout(loadPlans, 300);

  window.WorkplaceOntleed = { open, decorate, renderBox, reload: loadPlans, prompt, parse, memory: () => memory() };
})();
