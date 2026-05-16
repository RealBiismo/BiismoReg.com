const regInput = document.getElementById("regInput");
const resultEl = document.getElementById("result");

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
      taxDays =
        diff > 0
          ? `${diff} day${diff === 1 ? "" : "s"} remaining`
          : `Expired (${Math.abs(diff)} day${diff === -1 ? "" : "s"} ago)`;
    }
  } else if (taxText.toLowerCase().includes("sorn")) {
    taxClass = "tax-red";
    taxText = "SORN";
    taxDays = "SORN (off road)";
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
      motStatus = `Expired (${Math.abs(diff)} day${diff === -1 ? "" : "s"} ago)`;
      motColor = "mot-red";
    }
  }

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
          <div class="info-title">Tax Status</div>
          <div class="info-value ${taxClass}">${taxText}</div>
        </div>

        <div class="info-box">
          <div class="info-title">MOT Status</div>
          <div class="info-value ${motColor}">${motStatus}</div>
        </div>

        ${
          taxDays
            ? `<div class="info-box">
                <div class="info-title">Tax Renewal</div>
                <div class="info-value ${taxColor}">${taxDays}</div>
              </div>`
            : ""
        }

      </div>

      <div style="margin-top:24px;">
        <h3 style="margin-bottom:10px;">MOT History</h3>
        ${buildMotCards(data.motHistory || [])}
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

window.checkVehicle = checkVehicle;
