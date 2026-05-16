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

  const motExpiry = data.motExpiryDate ? new Date(data.motExpiryDate) : null;
  const today = new Date();
  let motDays = "Unknown";
  let motColor = "mot-green";

  if (motExpiry) {
    const diff = Math.ceil((motExpiry - today) / (1000 * 60 * 60 * 24));
    if (diff > 0) {
      motDays = `${diff} day${diff === 1 ? "" : "s"} remaining`;
      motColor = "mot-green";
    } else {
      motDays = `${Math.abs(diff)} day${diff === -1 ? "" : "s"} overdue`;
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
          <div class="info-value ${taxClass}">${data.taxStatus}</div>
        </div>

        <div class="info-box">
          <div class="info-title">MOT Expiry</div>
          <div class="info-value">${data.motExpiryDate || "Unknown"}</div>
        </div>

        <div class="info-box">
          <div class="info-title">MOT Status</div>
          <div class="info-value ${motColor}">${motDays}</div>
        </div>

      </div>

      <p class="scroll-hint">Swipe to view more →</p>
    </div>
  `;
}

window.checkVehicle = checkVehicle;
