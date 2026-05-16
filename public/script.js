const regInput = document.getElementById("regInput");
const resultEl = document.getElementById("result");

/* ========== AUTH ELEMENTS ========== */
const loginBtn = document.getElementById("loginBtn");
const loginModal = document.getElementById("loginModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const modalTitle = document.getElementById("modalTitle");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authStatus = document.getElementById("authStatus");
const forgotBtn = document.getElementById("forgotBtn");

let currentMode = "login"; // "login" or "register"

/* ============================
   FORMATTERS
============================ */

function formatDate(dateString) {
  if (!dateString) return "Unknown";

  const d = new Date(dateString);
  if (isNaN(d)) return "Unknown";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;

  return `${day}.${month}.${year} ${hours}:${minutes}${ampm}`;
}

function formatMiles(value) {
  if (!value) return "Unknown";
  const miles = Number(value).toLocaleString("en-UK");
  return `${miles} miles`;
}

/* ============================
   VEHICLE CHECK
============================ */

async function checkVehicle() {
  const reg = regInput.value.trim();

  if (!reg) {
    resultEl.innerHTML = `<div class="disclaimer-text" style="color:#f87171;">Please enter a registration.</div>`;
    return;
  }

  resultEl.innerHTML = `<div class="disclaimer-text" style="color:#60a5fa;">Checking ${reg.toUpperCase()}...</div>`;

  try {
    const res = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationNumber: reg })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Lookup failed");
    }

    renderResult(data);
  } catch (err) {
    console.error(err);
    resultEl.innerHTML = `<div class="disclaimer-text" style="color:#f87171;">Error: ${err.message}</div>`;
  }
}

/* ============================
   RESULT RENDERING
============================ */

function renderResult(data) {
  const today = new Date();

  /* TAX STATUS */
  let taxClass = "tax-red";
  let taxText = data.taxStatus || "Unknown";
  let taxDays = "";
  let taxColor = "mot-red";

  if (taxText.toLowerCase().includes("taxed")) {
    taxClass = "tax-green";
    taxColor = "mot-green";

    const expiry = data.taxDueDate ? new Date(data.taxDueDate) : null;
    if (expiry) {
      const diff = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
      if (diff > 0) {
        taxDays = `${diff} day${diff === 1 ? "" : "s"} remaining`;
      } else {
        taxDays = `EXPIRED`;
        taxColor = "mot-red";
      }
    }
  } else if (taxText.toLowerCase().includes("sorn")) {
    taxClass = "tax-red";
    taxText = "SORN";
    taxDays = "SORN (off road)";
  } else {
    taxClass = "tax-red"; // untaxed red
  }

  /* MOT STATUS */
  const motExpiry = data.motExpiryDate ? new Date(data.motExpiryDate) : null;
  let motStatus = "Unknown";
  let motColor = "mot-red";

  if (!motExpiry) {
    motStatus = "Not due first MOT yet";
    motColor = "mot-green";
  } else {
    const diff = Math.ceil((motExpiry - today) / (1000 * 60 * 60 * 24));
    if (diff > 0) {
      motStatus = `${diff} day${diff === 1 ? "" : "s"} remaining`;
      motColor = "mot-green";
    } else {
      motStatus = "EXPIRED";
      motColor = "mot-red";
    }
  }

  const motHistoryHtml = buildMotCards(data.motHistory || []);

  resultEl.innerHTML = `
    <div class="result-card glass">

      <div class="result-plate">
        <div class="result-reg">${data.registration}</div>
      </div>

      <h2 class="car-title">${data.make} ${data.model}</h2>

      <div class="grid">

        <div class="info-box">
          <div class="info-title">Make</div>
          <div class="info-value">${data.make}</div>
        </div>

        <div class="info-box">
          <div class="info-title">Model</div>
          <div class="info-value">${data.model}</div>
        </div>

        <div class="info-box">
          <div class="info-title">Colour</div>
          <div class="info-value">${data.colour}</div>
        </div>

        <div class="info-box">
          <div class="info-title">Fuel Type</div>
          <div class="info-value">${data.fuelType}</div>
        </div>

        <div class="info-box">
          <div class="info-title">Engine Size</div>
          <div class="info-value">${data.engineCapacity} cc</div>
        </div>

        <div class="info-box">
          <div class="info-title">Year</div>
          <div class="info-value">${data.year}</div>
        </div>

        <div class="info-box">
          <div class="info-title">Tax Status</div>
          <div class="info-value ${taxClass}">${taxText}</div>
        </div>

        ${
          taxDays
            ? `<div class="info-box">
                <div class="info-title">Tax Renewal</div>
                <div class="info-value ${taxColor}">${taxDays}</div>
              </div>`
            : ""
        }

        <div class="info-box">
          <div class="info-title">MOT Expiry</div>
          <div class="info-value">${formatDate(data.motExpiryDate)}</div>
        </div>

        <div class="info-box">
          <div class="info-title">MOT Status</div>
          <div class="info-value ${motColor}">${motStatus}</div>
        </div>

      </div>

      <div class="mot-history-toggle">
        <button class="secondary-btn" onclick="toggleMotHistory()">View MOT History</button>
      </div>

      <div id="motHistoryContainer" class="mot-history-container hidden">
        <h3 style="margin-bottom:10px;">MOT History</h3>
        ${motHistoryHtml}
      </div>

    </div>
  `;
}

/* ============================
   MOT HISTORY
============================ */

function buildMotCards(tests) {
  if (!tests.length) {
    return `<div class="disclaimer-text">No MOT history found.</div>`;
  }

  return tests
    .map(test => {
      const isPass = (test.result || "").toUpperCase() === "PASSED";
      const defectsHtml = buildDefects(test.defects || []);

      return `
        <div class="mot-card">
          <div class="${isPass ? "pass" : "fail"}">
            ${isPass ? "PASS" : "FAIL"}
          </div>
          <div style="margin-top:6px;">Date: ${formatDate(test.completedDate)}</div>
          <div>Mileage: ${formatMiles(test.mileage)}</div>
          ${defectsHtml}
        </div>
      `;
    })
    .join("");
}

function buildDefects(defects) {
  if (!defects.length) {
    return `<div class="clean-pass">No defects recorded on this test.</div>`;
  }

  const groups = {
    ADVISORY: [],
    MINOR: [],
    MAJOR: [],
    DANGEROUS: []
  };

  defects.forEach(d => {
    const type = (d.type || "ADVISORY").toUpperCase();
    if (!groups[type]) groups[type] = [];
    groups[type].push(d.text);
  });

  let html = "";

  Object.entries(groups).forEach(([type, items]) => {
    if (!items.length) return;

    const cls =
      type === "ADVISORY"
        ? "advisory"
        : type === "MINOR"
        ? "minor"
        : type === "MAJOR"
        ? "major"
        : "dangerous";

    html += `
      <div class="defect-group ${cls}">
        <strong>${type}</strong>
        ${items.map(text => `<div class="defect-item">${text}</div>`).join("")}
      </div>
    `;
  });

  return html;
}

function toggleMotHistory() {
  const el = document.getElementById("motHistoryContainer");
  if (!el) return;
  el.classList.toggle("hidden");
}

/* ============================
   AUTH MODAL LOGIC
============================ */

function openLoginModal() {
  loginModal.style.display = "flex";
  authStatus.textContent = "";
}

function closeLoginModal() {
  loginModal.style.display = "none";
  authEmail.value = "";
  authPassword.value = "";
  authStatus.textContent = "";
}

function setMode(mode) {
  currentMode = mode;
  if (mode === "login") {
    modalTitle.textContent = "Login";
    authSubmitBtn.textContent = "Login";
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
  } else {
    modalTitle.textContent = "Create Account";
    authSubmitBtn.textContent = "Register";
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
  }
  authStatus.textContent = "";
}

async function submitAuth() {
  const email = authEmail.value.trim();
  const password = authPassword.value.trim();

  if (!email || !password) {
    authStatus.textContent = "Email and password required.";
    return;
  }

  const endpoint = currentMode === "login" ? "/api/login" : "/api/register";

  authStatus.textContent = currentMode === "login" ? "Logging in..." : "Creating account...";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Request failed");
    }

    authStatus.textContent = currentMode === "login" ? "Logged in." : "Account created.";
    setTimeout(closeLoginModal, 800);
  } catch (err) {
    console.error(err);
    authStatus.textContent = "Error: " + err.message;
  }
}

function handleForgotPassword() {
  const email = authEmail.value.trim();
  const subject = encodeURIComponent("Password reset request");
  const body = encodeURIComponent(
    `Hi,\n\nI need a password reset for BIISMO REG.\n\nEmail: ${email || "(not provided)"}\n\nThanks.`
  );
  window.location.href = `mailto:BiismoReg@gmail.com?subject=${subject}&body=${body}`;
}

/* ============================
   EVENT WIRING
============================ */

if (loginBtn) loginBtn.addEventListener("click", openLoginModal);
if (closeModalBtn) closeModalBtn.addEventListener("click", closeLoginModal);
if (tabLogin) tabLogin.addEventListener("click", () => setMode("login"));
if (tabRegister) tabRegister.addEventListener("click", () => setMode("register"));
if (authSubmitBtn) authSubmitBtn.addEventListener("click", submitAuth);
if (forgotBtn) forgotBtn.addEventListener("click", handleForgotPassword);

window.checkVehicle = checkVehicle;
window.toggleMotHistory = toggleMotHistory;

async function checkAuthState() {
  const res = await fetch("/api/me");
  const data = await res.json();

  const loginBtn = document.getElementById("loginBtn");

  if (data.email) {
    loginBtn.textContent = "My Account";
    loginBtn.onclick = () => window.location.href = "/account.html";
  } else {
    loginBtn.textContent = "Login / Create Account";
    loginBtn.onclick = openLoginModal;
  }
}

checkAuthState();

async function openMotHistory() {
  const res = await fetch("/api/me");
  const data = await res.json();

  const container = document.getElementById("motHistoryContainer");
  const warning = document.getElementById("motWarning");

  if (!data.email) {
    warning.classList.remove("hidden");
    setTimeout(() => warning.classList.add("hidden"), 2500);
    return;
  }

  container.classList.remove("blurred");
  container.classList.toggle("hidden");
}
