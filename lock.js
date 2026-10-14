(function () {
  "use strict";
  const ACCESS_CODE = "2109";
  const SESSION_KEY = "remy-ipad-workplace-unlocked";
  const lock = document.getElementById("app-lock");
  const form = document.getElementById("app-lock-form");
  const input = document.getElementById("app-lock-pin");
  const error = document.getElementById("app-lock-error");

  function unlock() {
    sessionStorage.setItem(SESSION_KEY, "1");
    lock.hidden = true;
    document.body.classList.remove("locked");
  }

  document.body.classList.add("locked");
  if (sessionStorage.getItem(SESSION_KEY) === "1") unlock();
  else setTimeout(() => input.focus(), 0);

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (input.value === ACCESS_CODE) {
      unlock();
      return;
    }
    error.textContent = "Code klopt niet.";
    input.value = "";
    input.focus();
  });
  window.WorkplaceLock = Object.freeze({ unlockWithCode: value => value === ACCESS_CODE && (unlock() || true) });
})();
