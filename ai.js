(function () {
  "use strict";

  // Supported providers. The model identifier is deliberately NOT part of the
  // client contract: Claude/Gemini/OpenRouter model IDs change over time and
  // must not be guessed in the browser. The backend reads the model name from
  // its own environment (ANTHROPIC_MODEL / GEMINI_MODEL / OPENROUTER_MODEL).
  const PROVIDERS = ["anthropic", "gemini", "openrouter"];
  const PROMPT_LIMIT = 6000;
  const TIMEOUT_MS = 45000;

  // Pinned to the same Supabase project already used for the WerkHub login
  // (see connections.js DATABASE constant). This is NOT user-configurable:
  // an editable endpoint field would let a modified page or injected script
  // send the WerkHub session token to an attacker-controlled URL instead.
  const ENDPOINT = "https://mdslvdrsggpksqrbtwci.supabase.co/functions/v1/werkplek-ai";

  function validateProvider(value) {
    if (!PROVIDERS.includes(value)) throw new Error("Kies een ondersteunde AI-provider (Claude, Gemini of OpenRouter).");
    return value;
  }

  function validatePrompt(value) {
    const prompt = typeof value === "string" ? value.trim() : "";
    if (!prompt) throw new Error("Voer eerst een vraag of opdracht in.");
    if (prompt.length > PROMPT_LIMIT) throw new Error(`De vraag is te lang (max ${PROMPT_LIMIT} tekens).`);
    return prompt;
  }

  function requireConsent(checked) {
    if (!checked) throw new Error("Vink eerst de toestemming aan: er wordt tekst naar een externe AI-dienst buiten PWN gestuurd.");
  }

  // Request body sent to the backend. Intentionally only {provider, prompt}:
  // no model name, no extra context, nothing persisted.
  function requestBody(provider, prompt) {
    return { provider: validateProvider(provider), prompt: validatePrompt(prompt) };
  }

  function answerText(payload) {
    if (!payload || typeof payload !== "object" || typeof payload.answer !== "string" || !payload.answer) {
      throw new Error("Onverwacht antwoordformaat van de AI-backend.");
    }
    return payload.answer;
  }

  // The session token is never typed/pasted by the user: it is read from the
  // existing WerkHub login (connections.js) and used only as an in-memory
  // Authorization header. It is never written to storage by this file.
  function sessionToken(storage) {
    const connections = window.WorkplaceConnections;
    if (!connections || typeof connections.session !== "function") {
      throw new Error("WerkHub-koppeling is niet geladen. Herlaad de app en probeer het opnieuw.");
    }
    return connections.session(storage);
  }

  async function sendPrompt(provider, prompt, storage = localStorage, request = fetch) {
    const token = sessionToken(storage);
    const body = requestBody(provider, prompt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await request(ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("AI-verzoek duurde te lang en is afgebroken.");
      throw new Error("AI-backend is niet bereikbaar. Controleer de verbinding.");
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401) throw new Error("WerkHub-login is verlopen. Log opnieuw in via het WerkHub-paneel.");
    if (response.status === 403) throw new Error("Geen toegang tot deze AI-functie met dit account.");
    if (response.status === 429) throw new Error("Te veel verzoeken. Probeer het over een minuut opnieuw.");
    if (!response.ok) throw new Error(`AI-verzoek mislukt (HTTP ${response.status}).`);
    let payload;
    try { payload = await response.json(); } catch (error) { throw new Error("Antwoord van de AI-backend kon niet worden gelezen."); }
    return answerText(payload);
  }

  // Pure helpers exposed for inspection/testing, mirroring the
  // WorkplaceConnections pattern already used by connections.js.
  window.AiChat = {
    PROVIDERS, PROMPT_LIMIT, ENDPOINT,
    validateProvider, validatePrompt, requireConsent, requestBody, answerText,
    sessionToken, sendPrompt
  };

  const dialog = document.getElementById("writing-ai-dialog");
  if (dialog) {
    const quickForm = document.getElementById("writing-ai-form");
    const quickPrompt = document.getElementById("writing-ai-prompt");
    const quickConsent = document.getElementById("writing-ai-consent");
    const quickSend = document.getElementById("writing-ai-send");
    const quickStatus = document.getElementById("writing-ai-status");
    const quickAnswer = document.getElementById("writing-ai-answer");
    const insertButton = document.getElementById("writing-ai-insert");
    const openButton = document.getElementById("writing-ai-open");
    let documentId;
    let generation = 0;
    let result = "";
    openButton.addEventListener("click", () => {
      if (!window.WorkplaceWriting) return;
      documentId = window.WorkplaceWriting.currentId();
      generation++;
      result = "";
      quickForm.reset();
      quickSend.disabled = false;
      insertButton.disabled = true;
      quickAnswer.textContent = "";
      quickStatus.textContent = "Alleen je getypte vraag wordt verstuurd, niet je handschrift of PDF.";
      dialog.showModal();
      quickPrompt.focus();
    });
    document.getElementById("writing-ai-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      if (dialog.open) return;
      generation++;
      result = "";
      quickForm.reset();
      quickAnswer.textContent = "";
      insertButton.disabled = true;
      openButton.focus();
    });
    quickForm.addEventListener("submit", async event => {
      event.preventDefault();
      const requestGeneration = ++generation;
      result = "";
      quickAnswer.textContent = "";
      insertButton.disabled = true;
      try {
        requireConsent(quickConsent.checked);
        quickSend.disabled = true;
        quickStatus.textContent = "Claude denkt na. Je kunt het venster sluiten en verder schrijven.";
        const answer = await sendPrompt("anthropic", quickPrompt.value);
        if (requestGeneration !== generation || !dialog.open) return;
        result = answer;
        quickAnswer.textContent = answer;
        insertButton.disabled = false;
        quickStatus.textContent = "Antwoord ontvangen. Toevoegen is optioneel.";
      } catch (error) {
        if (requestGeneration === generation && dialog.open) quickStatus.textContent = error.message || String(error);
      } finally {
        if (requestGeneration === generation) quickSend.disabled = false;
      }
    });
    insertButton.addEventListener("click", () => {
      try {
        window.WorkplaceWriting.insertAnswer(documentId, result);
        insertButton.disabled = true;
        quickStatus.textContent = "Antwoord lokaal toegevoegd. Ongedaan kan dit verwijderen.";
      } catch (error) { quickStatus.textContent = error.message || String(error); }
    });
  }

  const form = document.getElementById("ai-form");
  if (!form) return;
  const providerField = document.getElementById("ai-provider");
  const promptField = document.getElementById("ai-prompt");
  const sendButton = document.getElementById("ai-send");
  const status = document.getElementById("ai-status");
  const answerBox = document.getElementById("ai-answer");
  const consentField = document.getElementById("ai-consent");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (status) status.textContent = "";
    if (answerBox) answerBox.textContent = "";
    try {
      requireConsent(!!(consentField && consentField.checked));
      if (sendButton) sendButton.disabled = true;
      if (status) status.textContent = "Bezig met versturen...";
      const result = await sendPrompt(
        providerField ? providerField.value : "",
        promptField ? promptField.value : ""
      );
      if (answerBox) answerBox.textContent = result;
      if (status) status.textContent = "Antwoord ontvangen.";
    } catch (error) {
      if (status) status.textContent = error.message || String(error);
    } finally {
      if (sendButton) sendButton.disabled = false;
    }
  });
})();
