import express from "express";
import dotenv from "dotenv";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
  session({
    secret: "biismoreg-secret-key",
    resave: false,
    saveUninitialized: false
  })
);

/* =========================
   ENV
========================= */

const DVLA_API_KEY = process.env.DVLA_API_KEY;

const MOT_CLIENT_ID = process.env.MOT_CLIENT_ID;
const MOT_CLIENT_SECRET = process.env.MOT_CLIENT_SECRET;
const MOT_API_KEY = process.env.MOT_API_KEY;
const MOT_SCOPE = process.env.MOT_SCOPE;
const MOT_TOKEN_URL = process.env.MOT_TOKEN_URL;

/* =========================
   USERS "DB" (users.txt)
   Format: email|tier
========================= */

const USERS_FILE = path.join(__dirname, "users.txt");

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "");
}

function getAllUsers() {
  const raw = fs.readFileSync(USERS_FILE, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  return lines.map(line => {
    const [email, tier] = line.split("|");
    return { email, tier: tier || "free" };
  });
}

function findUser(email) {
  return getAllUsers().find(u => u.email === email) || null;
}

function upsertUser(email, tier = "free") {
  const users = getAllUsers();
  const existingIndex = users.findIndex(u => u.email === email);

  if (existingIndex >= 0) {
    users[existingIndex].tier = tier;
  } else {
    users.push({ email, tier });
  }

  const content = users.map(u => `${u.email}|${u.tier}`).join("\n") + "\n";
  fs.writeFileSync(USERS_FILE, content);
}

/* =========================
   IN-MEMORY STATE
   My Garage & Recently Viewed
========================= */

const userState = {}; // { [email]: { garage: [], recent: [] } }

function getUserState(email) {
  if (!userState[email]) {
    userState[email] = { garage: [], recent: [] };
  }
  return userState[email];
}

/* =========================
   TOKEN CACHE
========================= */

let cachedToken = null;
let tokenExpiry = 0;

/* =========================
   GET MOT TOKEN
========================= */

async function getMotToken() {
  const now = Date.now();

  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const tokenRes = await fetch(MOT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: MOT_CLIENT_ID,
      client_secret: MOT_CLIENT_SECRET,
      scope: MOT_SCOPE,
      grant_type: "client_credentials"
    })
  });

  const tokenData = await tokenRes.json();
  console.log("TOKEN:", tokenData);

  if (!tokenData.access_token) {
    throw new Error("MOT token failed");
  }

  cachedToken = tokenData.access_token;
  tokenExpiry = now + (tokenData.expires_in || 3600) * 1000;

  return cachedToken;
}

/* =========================
   AUTH ROUTES
========================= */

// Magic-link style: email only, no password.
// Creates user if not exists, logs in, default tier "free".
app.post("/api/login-link", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  let user = findUser(email);
  if (!user) {
    upsertUser(email, "free");
    user = { email, tier: "free" };
  }

  req.session.userEmail = email;

  return res.json({
    ok: true,
    email: user.email,
    tier: user.tier
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  const email = req.session.userEmail;
  if (!email) {
    return res.json({ email: null });
  }

  const user = findUser(email) || { email, tier: "free" };
  return res.json({
    email: user.email,
    tier: user.tier
  });
});

// Simple upgrade endpoint (no payments, just demo)
app.post("/api/upgrade", (req, res) => {
  const email = req.session.userEmail;
  const tier = req.body.tier;

  if (!email) {
    return res.status(401).json({ error: "Not logged in" });
  }

  if (!["free", "premium", "platinum"].includes(tier)) {
    return res.status(400).json({ error: "Invalid tier" });
  }

  upsertUser(email, tier);
  return res.json({ ok: true, tier });
});

/* =========================
   GARAGE & RECENT ROUTES
========================= */

app.post("/api/garage/add", (req, res) => {
  const email = req.session.userEmail;
  if (!email) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const { registration, make, model, motExpiryDate, taxStatus } = req.body;

  if (!registration) {
    return res.status(400).json({ error: "Registration required" });
  }

  const state = getUserState(email);
  const exists = state.garage.find(
    v => v.registration === registration.toUpperCase()
  );

  if (!exists) {
    state.garage.push({
      registration: registration.toUpperCase(),
      make: make || "Unknown",
      model: model || "Unknown",
      motExpiryDate: motExpiryDate || null,
      taxStatus: taxStatus || "Unknown"
    });
  }

  return res.json({ ok: true, garage: state.garage });
});

app.get("/api/garage", (req, res) => {
  const email = req.session.userEmail;
  if (!email) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const state = getUserState(email);
  return res.json({ garage: state.garage });
});

app.get("/api/recent", (req, res) => {
  const email = req.session.userEmail;
  if (!email) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const state = getUserState(email);
  return res.json({ recent: state.recent || [] });
});

/* =========================
   MAIN VEHICLE API
========================= */

app.post("/api/check", async (req, res) => {
  try {
    const reg = req.body.registrationNumber
      ?.toUpperCase()
      .replace(/\s/g, "");

    if (!reg) {
      return res.status(400).json({ error: "Registration required" });
    }

    // DVLA
    const dvlaRes = await fetch(
      "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles",
      {
        method: "POST",
        headers: {
          "x-api-key": DVLA_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ registrationNumber: reg })
      }
    );

    const dvla = await dvlaRes.json();
    console.log("DVLA:", dvla);

    // MOT TOKEN
    const token = await getMotToken();

    // MOT FETCH
    const motRes = await fetch(
      `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${reg}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-api-key": MOT_API_KEY,
          Accept: "application/json"
        }
      }
    );

    const motRaw = await motRes.json();
    console.log("MOT RAW:", motRaw);

    const vehicle = Array.isArray(motRaw) ? motRaw[0] : motRaw;

    const motHistory = (vehicle?.motTests || []).map(test => {
      const defects = [];

      if (test.rfrAndComments) {
        test.rfrAndComments.forEach(issue => {
          defects.push({
            text: issue.text || "Issue found",
            type: (issue.type || "ADVISORY").toUpperCase()
          });
        });
      }

      [
        "advisories",
        "minorDefects",
        "majorDefects",
        "dangerousDefects",
        "defects",
        "reasons"
      ].forEach(key => {
        if (Array.isArray(test[key])) {
          test[key].forEach(issue => {
            defects.push({
              text:
                issue.text ||
                issue.comment ||
                issue.reason ||
                issue.description ||
                "Issue found",
              type:
                (
                  issue.type ||
                  issue.severity ||
                  issue.category ||
                  key.replace("Defects", "")
                ).toUpperCase()
            });
          });
        }
      });

      return {
        completedDate: test.completedDate || null,
        result: test.testResult || "UNKNOWN",
        mileage: test.odometerValue || "Unknown",
        mileageUnit: test.odometerUnit || "mi",
        defects
      };
    });

    const responseData = {
      registration: reg,
      make: dvla.make || vehicle?.make || "Unknown",
      model: dvla.model || vehicle?.model || "Unknown",
      colour: dvla.colour || "Unknown",
      fuelType: dvla.fuelType || "Unknown",
      engineCapacity: dvla.engineCapacity || "Unknown",
      year: dvla.yearOfManufacture || "Unknown",
      taxStatus: dvla.taxStatus || "Unknown",
      motExpiryDate: dvla.motExpiryDate || null,
      motHistory
    };

    // RECENTLY VIEWED (if logged in)
    const email = req.session.userEmail;
    if (email) {
      const state = getUserState(email);
      const summary = {
        registration: responseData.registration,
        make: responseData.make,
        model: responseData.model,
        motExpiryDate: responseData.motExpiryDate,
        taxStatus: responseData.taxStatus
      };

      state.recent = state.recent || [];
      state.recent = [
        summary,
        ...state.recent.filter(v => v.registration !== summary.registration)
      ].slice(0, 10);
    }

    res.json(responseData);

  } catch (err) {
    console.log("SERVER ERROR:", err);
    res.status(500).json({
      error: err.message || "Server error"
    });
  }
});

/* =========================
   ACCOUNT PAGE ROUTE
========================= */

app.get("/account", (req, res) => {
  const filePath = path.join(__dirname, "public", "account.html");
  res.sendFile(filePath);
});

/* =========================
   START
========================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
