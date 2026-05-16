const regInput = document.getElementById("regInput");
const resultEl = document.getElementById("result");

const loginBtn = document.getElementById("loginBtn");
const accountBtn = document.getElementById("accountBtn");
const loginModal = document.getElementById("loginModal");
const loginEmailInput = document.getElementById("loginEmail");
const sendLoginLinkBtn = document.getElementById("sendLoginLinkBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const loginStatus = document.getElementById("loginStatus");

// ============ AUTH UI ============

async function fetchMe() {
  try {
    const res = await fetch("/api/me");
    const data = await res.json();

    if (data.email) {
      if (loginBtn) loginBtn.style.display = "none";
      if (accountBtn) accountBtn.style.display = "inline-block";
    } else {
      if (loginBtn) loginBtn.style.display = "inline-block";
      if (accountBtn) accountBtn.style.display = "none";
    }

    // Account page population
    const accountEmailEl = document.getElementById("accountEmail");
    const tierBadge = document.getElementById("tierBadge");
    const tierText = document.getElementById("tierText");

    if (accountEmailEl && data.email) {
      accountEmailEl.textContent = data.email;
    }

    if (tierBadge && data.tier) {
      tierBadge.textContent =
        data.tier === "premium"
          ? "Premium Tier"
          : data.tier === "platinum"
          ? "Platinum Tier"
          : "Free Tier";

      tierBadge.classList.remove("free", "premium", "platinum");
      tierBadge.classList.add(data.tier);

      if (tierText) {
        tierText.textContent = `You are currently on the ${data.tier.charAt(0).toUpperCase() + data.tier.slice(1)} tier.`;
      }
    }

    if (window.location.pathname === "/account") {
      loadGarage();
      loadRecent();
    }
  } catch (err) {
    console.error("fetchMe error:", err);
  }
}

function openLoginModal() {
  if (loginModal) loginModal.style.display = "block";
}

function closeLoginModal() {
  if (loginModal) loginModal.style.display = "none";
  if (loginStatus) loginStatus.textContent = "";
}

async function sendLoginLink() {
  const email = loginEmailInput.value.trim();

  if (!email) {
    loginStatus.textContent = "Please enter an email.";
    return;
  }

  loginStatus.textContent = "Logging you in...";
  try {
    const res = await fetch("/api/login-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Login failed");
    }

    loginStatus.textContent = "Logged in! You can now use My Garage.";
    await fetchMe();
    setTimeout(closeLoginModal, 800);
  } catch (err) {
    console.error(err);
    loginStatus.textContent = "Error: " + err.message;
  }
}

async function logout() {
  try {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  } catch (err) {
    console.error("Logout error:", err);
  }
}

function goToAccount() {
  window.location.href = "/account";
}

// ============ VEHICLE CHECK ============

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

function renderResult(data) {
  const taxClass =
    data.taxStatus && data.taxStatus.toLowerCase().includes("taxed")
      ? "tax-green"
      : "tax-red";

  const motCards = buildMotCards(data.motHistory || []);

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
          <div class="info-value ${taxClass}">${data.taxStatus}</div>
        </div>

        <div class="info-box">
          <div class="info-title">MOT Expiry</div>
          <div class="info-value">${data.motExpiryDate || "Unknown"}</div>
        </div>

      </div>

      <p class="scroll-hint">Swipe to view more →</p>

      <div class="actions-row">
        <button onclick="saveToGarage('${data.registration}','${escapeHtml(
          data.make
        )}','${escapeHtml(data.model)}','${data.motExpiryDate || ""}','${escapeHtml(
    data.taxStatus || ""
  )}')">
          Save to My Garage
        </button>
        <button onclick="goToAccount()">Open Account</button>
      </div>

      <div style="margin-top:24px;">
        <h3 style="margin-bottom:10px;">MOT History</h3>
        ${motCards}
      </div>

    </div>
  `;
}

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
          <div style="margin-top:6px;">Date: ${test.completedDate || "Unknown"}</div>
          <div>Mileage: ${test.mileage} ${test.mileageUnit}</div>
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
        ${items
          .map(
            text => `<div class="defect-item">${text}</div>`
          )
          .join("")}
      </div>
    `;
  });

  return html;
}

// ============ MY GARAGE & RECENT (ACCOUNT PAGE) ============

async function saveToGarage(registration, make, model, motExpiryDate, taxStatus) {
  try {
    const res = await fetch("/api/garage/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registration,
        make,
        model,
        motExpiryDate,
        taxStatus
      })
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.error === "Not logged in") {
        alert("Please log in to use My Garage.");
        openLoginModal();
        return;
      }
      throw new Error(data.error || "Failed to save");
    }

    alert("Saved to My Garage.");
  } catch (err) {
    console.error("saveToGarage error:", err);
    alert("Error: " + err.message);
  }
}

async function loadGarage() {
  const garageGrid = document.getElementById("garageGrid");
  if (!garageGrid) return;

  garageGrid.innerHTML = "Loading garage...";

  try {
    const res = await fetch("/api/garage");
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to load garage");
    }

    if (!data.garage.length) {
      garageGrid.innerHTML = `<div class="disclaimer-text">No vehicles in your garage yet.</div>`;
      return;
    }

    garageGrid.innerHTML = data.garage
      .map(
        v => `
        <div class="garage-card">
          <div class="reg">${v.registration}</div>
          <div class="model">${v.make} ${v.model}</div>
          <div>
            <span class="status-dot ${
              v.taxStatus && v.taxStatus.toLowerCase().includes("taxed")
                ? "status-green"
                : "status-red"
            }"></span>
            ${v.taxStatus || "Unknown"}
          </div>
          <div style="margin-top:6px;font-size:14px;color:#666;">
            MOT: ${v.motExpiryDate || "Unknown"}
          </div>
        </div>
      `
      )
      .join("");
  } catch (err) {
    console.error("loadGarage error:", err);
    garageGrid.innerHTML = `<div class="disclaimer-text">Error loading garage.</div>`;
  }
}

async function loadRecent() {
  const recentList = document.getElementById("recentList");
  if (!recentList) return;

  recentList.innerHTML = "Loading recently viewed...";

  try {
    const res = await fetch("/api/recent");
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to load recent");
    }

    if (!data.recent.length) {
      recentList.innerHTML = `<div class="disclaimer-text">No recently viewed vehicles yet.</div>`;
      return;
    }

    recentList.innerHTML = data.recent
      .map(
        v => `
        <div class="recent-item">
          <span>${v.registration} — ${v.make} ${v.model}</span>
          <span style="font-size:14px;color:#666;">
            MOT: ${v.motExpiryDate || "Unknown"} | ${v.taxStatus || "Unknown"}
          </span>
        </div>
      `
      )
      .join("");
  } catch (err) {
    console.error("loadRecent error:", err);
    recentList.innerHTML = `<div class="disclaimer-text">Error loading recently viewed.</div>`;
  }
}

// ============ SUBSCRIPTION UPGRADE ============

async function upgradeTier(tier) {
  try {
    const res = await fetch("/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier })
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.error === "Not logged in") {
        alert("Please log in first.");
        openLoginModal();
        return;
      }
      throw new Error(data.error || "Upgrade failed");
    }

    alert(`Upgraded to ${tier} tier.`);
    fetchMe();
  } catch (err) {
    console.error("upgradeTier error:", err);
    alert("Error: " + err.message);
  }
}

// ============ HELPERS ============

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ============ EVENT WIRING ============

if (loginBtn) loginBtn.addEventListener("click", openLoginModal);
if (closeModalBtn) closeModalBtn.addEventListener("click", closeLoginModal);
if (sendLoginLinkBtn) sendLoginLinkBtn.addEventListener("click", sendLoginLink);

window.checkVehicle = checkVehicle;
window.goToAccount = goToAccount;
window.saveToGarage = saveToGarage;
window.logout = logout;
window.upgradeTier = upgradeTier;

// Initial auth state
fetchMe();
