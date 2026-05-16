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
   Format: email|password
========================= */

const USERS_FILE = path.join(__dirname, "users.txt");

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "");
}

function getAllUsers() {
  const raw = fs.readFileSync(USERS_FILE, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  return lines.map(line => {
    const [email, password] = line.split("|");
    return { email, password };
  });
}

function findUser(email) {
  return getAllUsers().find(u => u.email === email) || null;
}

function addUser(email, password) {
  const users = getAllUsers();
  if (users.find(u => u.email === email)) {
    return false;
  }
  const line = `${email}|${password}\n`;
  fs.appendFileSync(USERS_FILE, line);
  return true;
}

/* =========================
   TOKEN CACHE
========================= */

let cachedToken = null;
let tokenExpiry = 0;

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

app.post("/api/register", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();

  if (!email || !email.includes("@") || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const ok = addUser(email, password);
  if (!ok) {
    return res.status(400).json({ error: "Account already exists" });
  }

  req.session.userEmail = email;
  return res.json({ ok: true, email });
});

app.post("/api/login", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const user = findUser(email);
  if (!user || user.password !== password) {
    return res.status(400).json({ error: "Invalid email or password" });
  }

  req.session.userEmail = email;
  return res.json({ ok: true, email });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  const email = req.session.userEmail || null;
  res.json({ email });
});

app.post("/api/garage/add", (req, res) => {
  const email = req.session.userEmail;
  const reg = (req.body.reg || "").toUpperCase();

  if (!email) return res.status(401).json({ error: "Not logged in" });
  if (!reg) return res.status(400).json({ error: "No reg provided" });

  const file = path.join(__dirname, "garage.txt");
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");

  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);

  let found = false;
  const updated = lines.map(line => {
    const [uEmail, list] = line.split("|");
    if (uEmail === email) {
      found = true;
      const arr = list ? list.split(",") : [];
      if (!arr.includes(reg)) arr.push(reg);
      return `${email}|${arr.join(",")}`;
    }
    return line;
  });

  if (!found) updated.push(`${email}|${reg}`);

  fs.writeFileSync(file, updated.join("\n"));
  res.json({ ok: true });
});

app.post("/api/garage/remove", (req, res) => {
  const email = req.session.userEmail;
  const reg = (req.body.reg || "").toUpperCase();

  if (!email) return res.status(401).json({ error: "Not logged in" });

  const file = path.join(__dirname, "garage.txt");
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");

  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);

  const updated = lines.map(line => {
    const [uEmail, list] = line.split("|");
    if (uEmail === email) {
      const arr = list ? list.split(",") : [];
      const filtered = arr.filter(v => v !== reg);
      return `${email}|${filtered.join(",")}`;
    }
    return line;
  });

  fs.writeFileSync(file, updated.join("\n"));
  res.json({ ok: true });
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

    res.json({
      registration: reg,
      make: dvla.make || vehicle?.make || "Unknown",
      model: dvla.model || vehicle?.model || "Unknown",
      colour: dvla.colour || "Unknown",
      fuelType: dvla.fuelType || "Unknown",
      engineCapacity: dvla.engineCapacity || "Unknown",
      year: dvla.yearOfManufacture || "Unknown",
      taxStatus: dvla.taxStatus || "Unknown",
      taxDueDate: dvla.taxDueDate || null,
      motExpiryDate: dvla.motExpiryDate || null,
      motHistory
    });

  } catch (err) {
    console.log("SERVER ERROR:", err);
    res.status(500).json({
      error: err.message || "Server error"
    });
  }
});

/* =========================
   START
========================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
