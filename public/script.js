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

      <img src="https://files.catbox.moe/ulokbl.png" class="car-image" alt="Vehicle">

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

window.checkVehicle = checkVehicle;
