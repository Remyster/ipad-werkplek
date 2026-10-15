(function () {
  "use strict";

  // Supported providers. The model identifier is deliberately NOT part of the
  // client contract: Claude/Gemini/OpenRouter model IDs change over time and
  // must not be guessed in the browser. The backend reads the model name from
  // its own environment (ANTHROPIC_MODEL / GEMINI_MODEL / OPENROUTER_MODEL).
  const PROVIDERS = ["anthropic", "gemini", "openrouter"];
  const PROMPT_LIMIT = 6000;
  const TIMEOUT_MS = 90000;
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

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
    if (!checked) throw new Error("Vink eerst de toestemming aan: er wordt informatie naar een externe AI-dienst buiten PWN gestuurd.");
  }

  // Text chat never includes document context or client-selected model names.
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

  function handwritingBody(image) {
    if (!image || image.mimeType !== "image/png" || typeof image.data !== "string" ||
        !image.data.startsWith("iVBORw0KGgo") || image.data.length % 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
      throw new Error("Selecteer eerst een geldig stukje handschrift.");
    }
    const bytes = image.data.length / 4 * 3 - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
    if (bytes > MAX_IMAGE_BYTES) throw new Error("Het geselecteerde stukje is te groot (maximaal 2 MB). Selecteer minder handschrift.");
    return { provider: "gemini", task: "handwriting", image: { mimeType: "image/png", data: image.data } };
  }

  function boardQuestionBody(image, prompt) {
    const body = handwritingBody(image);
    return { ...body, task: "board-question", prompt: validatePrompt(prompt) };
  }

  function cropInk(source, region) {
    if (!region || ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
        region.x < 0 || region.y < 0 || region.width < 8 || region.height < 8 ||
        region.x + region.width > source.width || region.y + region.height > source.height) {
      throw new Error("Selecteer een groter stukje handschrift binnen het voorbeeld.");
    }
    const crop = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(region.width, region.height));
    crop.width = Math.max(1, Math.round(region.width * scale));
    crop.height = Math.max(1, Math.round(region.height * scale));
    const ctx = crop.getContext("2d");
    if (!ctx) throw new Error("Afbeelding maken is niet beschikbaar.");
    ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, crop.width, crop.height);
    const pixels = ctx.getImageData(0, 0, crop.width, crop.height).data;
    let hasInk = false;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245)) { hasInk = true; break; }
    }
    if (!hasInk) throw new Error("Geen zichtbare peninkt in de selectie. Selecteer je geschreven tekst.");
    const data = crop.toDataURL("image/png").split(",")[1];
    return handwritingBody({ mimeType: "image/png", data }).image;
  }

  async function sendBody(body, storage, request) {
    const token = sessionToken(storage);
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
      if (response.status === 401) throw new Error("WerkHub-login is verlopen. Log opnieuw in via het WerkHub-paneel.");
      if (response.status === 403) throw new Error("Geen toegang tot deze AI-functie met dit account.");
      if (response.status === 429) throw new Error("Te veel verzoeken. Probeer het over een minuut opnieuw.");
      if (response.status === 413) throw new Error("Afbeelding te groot. Selecteer minder handschrift.");
      if (response.status === 422) throw new Error("Herkenning kon niet volledig worden afgerond. Selecteer een kleiner stukje en probeer opnieuw.");
      if (response.status === 503) throw new Error("Deze AI-dienst is nog niet ingesteld. Controleer de providerkey en het model bij Supabase Secrets.");
      if (!response.ok) throw new Error(`AI-verzoek mislukt (HTTP ${response.status}). Controleer of de nieuwste backend is gepubliceerd.`);
      let payload;
      try { payload = await response.json(); }
      catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error("Antwoord van de AI-backend kon niet worden gelezen.");
      }
      return answerText(payload);
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("AI-verzoek duurde te lang en is afgebroken.");
      if (response) throw error;
      throw new Error("AI-backend is niet bereikbaar. Controleer de verbinding.");
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendPrompt(provider, prompt, storage = localStorage, request = fetch) {
    return sendBody(requestBody(provider, prompt), storage, request);
  }

  async function recognizeHandwriting(image, storage = localStorage, request = fetch) {
    return sendBody(handwritingBody(image), storage, request);
  }

  async function askBoard(image, prompt, storage = localStorage, request = fetch) {
    return sendBody(boardQuestionBody(image, prompt), storage, request);
  }

  // Pure helpers exposed for inspection/testing, mirroring the
  // WorkplaceConnections pattern already used by connections.js.
  window.AiChat = {
    PROVIDERS, PROMPT_LIMIT, ENDPOINT,
    validateProvider, validatePrompt, requireConsent, requestBody, answerText,
    sessionToken, sendPrompt, cropInk, handwritingBody, boardQuestionBody, recognizeHandwriting, askBoard
  };

  const dialog = document.getElementById("writing-ai-dialog");
  if (dialog) {
    const quickForm = document.getElementById("writing-ai-form");
    const quickPrompt = document.getElementById("writing-ai-prompt");
    const quickConsent = document.getElementById("writing-ai-consent");
    const quickSend = document.getElementById("writing-ai-send");
    const quickStatus = document.getElementById("writing-ai-status");
    const quickAnswer = document.getElementById("writing-ai-answer");
    const boardCheckbox = document.getElementById("writing-ai-board");
    const boardLabel = document.getElementById("writing-ai-board-label");
    const insertButton = document.getElementById("writing-ai-insert");
    const openButton = document.getElementById("writing-ai-open");
    const recognizeButton = document.getElementById("writing-ai-recognize");
    const imagePanel = document.getElementById("writing-ai-image-panel");
    const selectionCanvas = document.getElementById("writing-ai-selection");
    const preview = document.getElementById("writing-ai-preview");
    const selectAll = document.getElementById("writing-ai-select-all");
    const transcriptPanel = document.getElementById("writing-ai-transcript-panel");
    const transcript = document.getElementById("writing-ai-transcript");
    let documentId;
    let generation = 0;
    let result = "";
    let recognizing = false;
    let inkSource = null;
    let selectedImage = null;
    let selecting = null;
    function resetImage() {
      inkSource = null;
      selectedImage = null;
      selecting = null;
      selectionCanvas.width = 0;
      selectionCanvas.height = 0;
      preview.removeAttribute("src");
      preview.hidden = true;
      transcript.value = "";
      transcriptPanel.hidden = true;
    }
    function openQuick(imageMode) {
      if (!window.WorkplaceWriting) return;
      resetImage();
      recognizing = imageMode;
      documentId = window.WorkplaceWriting.currentId();
      generation++;
      result = "";
      quickForm.reset();
      quickPrompt.required = !recognizing;
      quickPrompt.hidden = recognizing;
      boardLabel.hidden = recognizing;
      document.getElementById("writing-ai-prompt-label").hidden = recognizing;
      document.getElementById("writing-ai-heading").textContent = recognizing ? "Herken handschrift met Gemini" : "Vraag aan Claude";
      document.getElementById("writing-ai-consent-label").textContent = recognizing
        ? "De selectie bevat uitsluitend openbare of fictieve informatie, geen interne PWN-gegevens of persoonsgegevens; ik geef toestemming om dit beeld naar Gemini te sturen."
        : "Alleen openbare of fictieve informatie; ik geef toestemming om deze vraag en eventueel gekozen peninkt naar de AI-dienst te sturen.";
      dialog.classList.toggle("recognizing", recognizing);
      imagePanel.hidden = !recognizing;
      quickAnswer.hidden = recognizing;
      quickSend.textContent = recognizing ? "Herken geselecteerd handschrift" : "Stel vraag";
      quickSend.disabled = false;
      selectAll.disabled = false;
      insertButton.disabled = true;
      quickAnswer.textContent = "";
      quickStatus.textContent = recognizing ? "Selecteer eerst inkt. Er wordt nog niets verstuurd." : "Kies zelf of Gemini ook alle peninkt leest. PDF en getypte tekst worden nooit meegestuurd.";
      try {
        if (recognizing) {
          inkSource = window.WorkplaceWriting.captureInk();
          selectionCanvas.width = inkSource.width;
          selectionCanvas.height = inkSource.height;
          selectionCanvas.getContext("2d").drawImage(inkSource, 0, 0);
        }
      } catch (error) {
        quickStatus.textContent = error.message;
        quickSend.disabled = true;
      }
      dialog.showModal();
      if (!recognizing) quickPrompt.focus();
    }
    openButton.addEventListener("click", () => openQuick(false));
    recognizeButton.addEventListener("click", () => openQuick(true));
    boardCheckbox.addEventListener("change", () => {
      quickConsent.checked = false;
      quickStatus.textContent = boardCheckbox.checked
        ? "Alle peninkt van dit blad wordt verkleind naar maximaal 1600 px. PDF en getypte tekst blijven lokaal."
        : "Alleen je getypte vraag wordt verstuurd.";
    });
    function chooseRegion(region) {
      generation++;
      result = "";
      selectedImage = null;
      transcript.value = "";
      transcriptPanel.hidden = true;
      insertButton.disabled = true;
      quickConsent.checked = false;
      preview.removeAttribute("src");
      preview.hidden = true;
      try {
        selectedImage = cropInk(inkSource, region);
        preview.src = "data:image/png;base64," + selectedImage.data;
        preview.hidden = false;
        quickStatus.textContent = "Controleer het voorbeeld, vink toestemming aan en klik Herken.";
      } catch (error) { quickStatus.textContent = error.message; }
    }
    selectAll.addEventListener("click", () => {
      if (inkSource && !quickSend.disabled) chooseRegion({ x: 0, y: 0, width: inkSource.width, height: inkSource.height });
    });
    const selectionPoint = event => {
      const rect = selectionCanvas.getBoundingClientRect();
      return { x: Math.max(0, Math.min(selectionCanvas.width, (event.clientX - rect.left) * selectionCanvas.width / rect.width)),
        y: Math.max(0, Math.min(selectionCanvas.height, (event.clientY - rect.top) * selectionCanvas.height / rect.height)) };
    };
    const regionBetween = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
    selectionCanvas.addEventListener("pointerdown", event => {
      if (!inkSource || quickSend.disabled || selecting || event.button !== 0) return;
      event.preventDefault();
      selecting = { id: event.pointerId, start: selectionPoint(event) };
      selectionCanvas.setPointerCapture(event.pointerId);
    });
    selectionCanvas.addEventListener("pointermove", event => {
      if (!selecting || selecting.id !== event.pointerId) return;
      event.preventDefault();
      const region = regionBetween(selecting.start, selectionPoint(event));
      const ctx = selectionCanvas.getContext("2d");
      ctx.drawImage(inkSource, 0, 0);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = "#af6700";
      ctx.lineWidth = 3;
      ctx.strokeRect(region.x, region.y, region.width, region.height);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      selectionCanvas.addEventListener(type, event => {
        if (!selecting || selecting.id !== event.pointerId) return;
        const start = selecting.start;
        selecting = null;
        if (selectionCanvas.hasPointerCapture(event.pointerId)) selectionCanvas.releasePointerCapture(event.pointerId);
        selectionCanvas.getContext("2d").drawImage(inkSource, 0, 0);
        if (type === "pointerup") chooseRegion(regionBetween(start, selectionPoint(event)));
      });
    }
    document.getElementById("writing-ai-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      if (dialog.open) return;
      generation++;
      result = "";
      quickForm.reset();
      quickAnswer.textContent = "";
      resetImage();
      insertButton.disabled = true;
      (recognizing ? recognizeButton : openButton).focus();
    });
    quickForm.addEventListener("submit", async event => {
      event.preventDefault();
      const requestGeneration = ++generation;
      result = "";
      quickAnswer.textContent = "";
      insertButton.disabled = true;
      transcriptPanel.hidden = true;
      transcript.value = "";
      try {
        requireConsent(quickConsent.checked);
        if (recognizing && !selectedImage) throw new Error("Selecteer eerst een stukje handschrift en controleer het voorbeeld.");
        quickSend.disabled = true;
        selectAll.disabled = true;
        quickStatus.textContent = recognizing ? "Gemini leest je selectie. Je kunt het venster sluiten en verder schrijven." : "Claude denkt na. Je kunt het venster sluiten en verder schrijven.";
        let answer;
        if (recognizing) {
          answer = await recognizeHandwriting(selectedImage);
        } else if (boardCheckbox.checked) {
          const source = window.WorkplaceWriting.captureInk();
          const image = cropInk(source, { x: 0, y: 0, width: source.width, height: source.height });
          answer = await askBoard(image, quickPrompt.value);
        } else {
          answer = await sendPrompt("anthropic", quickPrompt.value);
        }
        if (requestGeneration !== generation || !dialog.open) return;
        result = answer;
        quickAnswer.textContent = answer;
        if (recognizing) {
          transcript.value = answer;
          transcriptPanel.hidden = false;
        }
        insertButton.disabled = false;
        quickStatus.textContent = recognizing ? "Concepttranscript ontvangen. Controleer namen, getallen en [onleesbaar]; je kunt de tekst aanpassen." : "Antwoord ontvangen. Toevoegen is optioneel.";
      } catch (error) {
        if (requestGeneration === generation && dialog.open) quickStatus.textContent = error.message || String(error);
      } finally {
        if (requestGeneration === generation) { quickSend.disabled = false; selectAll.disabled = false; }
      }
    });
    insertButton.addEventListener("click", () => {
      try {
        window.WorkplaceWriting.insertAnswer(documentId, recognizing ? transcript.value : result);
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
