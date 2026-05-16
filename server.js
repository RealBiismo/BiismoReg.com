import express from "express";
import path from "path";
import fs from "fs";
import session from "express-session";
import bodyParser from "body-parser";
import dns from "dns";
import { fileURLToPath } from "url";

/* ============================
   FIX DNS ISSUES (IMPORTANT)
============================ */
dns.setDefaultResultOrder("ipv4first");

/* ============================
   PATH FIX FOR ES MODULES
============================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ============================
   MIDDLEWARE
============================ */
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "biismo-secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

/* ============================
   ENV VARIABLES
============================ */
const DVLA_API_KEY = process.env.DVLA_API_KEY;
const MOT_CLIENT_ID = process.env.MOT_CLIENT_ID;
const MOT_CLIENT_SECRET = process.env.MOT_CLIENT_SECRET;
const MOT_API_KEY = process.env.MOT_API_KEY;
const MOT_SCOPE = process.env.MOT_SCOPE;
const MOT_TOKEN_URL = process.env.MOT_TOKEN_URL;

/* ============================
   FILE HELPERS
============================ */
const USERS_FILE = path.join(__dirname, "users.txt");
const GARAGE_FILE = path.join(__dirname, "garage.txt");
const RECENT_FILE = path.join(__dirname, "recent.txt");

function ensureFile(file) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
}

/* ============================
   AUTH ROUTES
============================ */
app.get("/api/me", (req, res) => {
  res.json({ email: req.session.userEmail || null });
});

app.post("/api/register", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  ensureFile(USERS_FILE);
  const lines = fs.readFileSync(USERS_FILE, "utf8").split("\n").filter(Boolean);

  if (lines.some(line => line.split("|")[0] === email)) {
    return res.status(400).json({ error: "Account already exists" });
  }

  lines.push(`${email}|${password}`);
  fs.writeFileSync(USERS_FILE, lines.join("\n"));

  req.session.userEmail = email;
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  ensureFile(USERS_FILE);
  const lines = fs.readFileSync(USERS_FILE, "utf8").split("\n").filter(Boolean);

  const match = lines.find(line => {
    const [uEmail, uPass] = line.split("|");
    return uEmail === email && uPass === password;
  });

  if (!match) return res.status(400).json({ error: "Invalid credentials" });

  req.session.userEmail = email;
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/* ============================
   GARAGE ROUTES
============================ */
app.post("/api/garage/add", (req, res) => {
  const email = req.session.userEmail;
  const reg = (req.body.reg || "").toUpperCase();

  if (!email) return res.status(401).json({ error: "Not logged in" });
  if (!reg) return res.status(400).json({ error: "No reg provided" });

  ensureFile(GARAGE_FILE);
  const lines = fs.readFileSync(GARAGE_FILE, "utf8").split("\n").filter(Boolean);

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

  fs.writeFileSync(GARAGE_FILE, updated.join("\n"));
  res.json({ ok: true });
});

app.get("/api/garage", (req, res) => {
  const email = req.session.userEmail;
  if (!email) return res.json({ garage: [] });

  ensureFile(GARAGE_FILE);
  const lines = fs.readFileSync(GARAGE_FILE, "utf8").split("\n").filter(Boolean);

  for (const line of lines) {
    const [uEmail, list] = line.split("|");
    if (uEmail === email) {
      return res.json({ garage: list ? list.split(",") : [] });
    }
  }

  res.json({ garage: [] });
});

/* ============================
   RECENT SEARCHES ROUTES
============================ */
app.post("/api/recent/add", (req, res) => {
  const email = req.session.userEmail;
  const reg = (req.body.reg || "").toUpperCase();

  if (!email) return res.status(401).json({ error: "Not logged in" });

  ensureFile(RECENT_FILE);
  const lines = fs.readFileSync(RECENT_FILE, "utf8").split("\n").filter(Boolean);

  let found = false;
  const updated = lines.map(line => {
    const [uEmail, list] = line.split("|");
    if (uEmail === email) {
      found = true;
      let arr = list ? list.split(",") : [];
      arr = arr.filter(v => v !== reg);
      arr.unshift(reg);
      arr = arr.slice(0, 10);
      return `${email}|${arr.join(",")}`;
    }
    return line;
  });

  if (!found) updated.push(`${email}|${reg}`);

  fs.writeFileSync(RECENT_FILE, updated.join("\n"));
  res.json({ ok: true });
});

app.get("/api/recent", (req, res) => {
  const email = req.session.userEmail;
  if (!email) return res.json({ recent: [] });

  ensureFile(RECENT_FILE);
  const lines = fs.readFileSync(RECENT_FILE, "utf8").split("\n").filter(Boolean);

  for (const line of lines) {
    const [uEmail, list] = line.split("|");
    if (uEmail === email) {
      return res.json({ recent: list ? list.split(",") : [] });
    }
  }

  res.json({ recent: [] });
});

/* ============================
   MOT TOKEN CACHE
============================ */
let cachedToken = null;
let tokenExpiry = 0;

async function getMotToken() {
  const now = Date.now();

  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const tokenRes = await fetch(MOT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MOT_CLIENT_ID,
      client_secret: MOT_CLIENT_SECRET,
      scope: MOT_SCOPE,
      grant_type: "client_credentials",
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    throw new Error("MOT token failed");
  }

  cachedToken = tokenData.access_token;
  tokenExpiry = now + (tokenData.expires_in || 3600) * 1000;

  return cachedToken;
}

/* ============================
   DVLA + MOT CHECK ROUTE
============================ */
app.post("/api/check", async (req, res) => {
  try {
    const reg = req.body.registrationNumber
      .toUpperCase()
      .replace(/\s/g, "");

    /* ============================
       DVLA FETCH
    ============================= */
    const dvlaRes = await fetch(
      "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles",
      {
        method: "POST",
        headers: {
          "x-api-key": DVLA_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ registrationNumber: reg }),
      }
    );

    const dvla = await dvlaRes.json();

    /* ============================
       MOT TOKEN
    ============================= */
    const token = await getMotToken();

    /* ============================
       MOT FETCH (CORRECT ENDPOINT)
    ============================= */
    const motRes = await fetch(
      `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${reg}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-api-key": MOT_API_KEY,
          Accept: "application/json",
        },
      }
    );

    const motRaw = await motRes.json();

    const vehicle = Array.isArray(motRaw) ? motRaw[0] : motRaw;

    /* ============================
       NORMALISE MOT HISTORY
    ============================= */
    const motHistory = (vehicle?.motTests || []).map(test => {
      const defects = [];

      if (test.rfrAndComments) {
        test.rfrAndComments.forEach(issue => {
          defects.push({
            text: issue.text || "Issue found",
            type: (issue.type || "ADVISORY").toUpperCase(),
          });
        });
      }

      [
        "advisories",
        "minorDefects",
        "majorDefects",
        "dangerousDefects",
        "defects",
        "reasons",
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
                ).toUpperCase(),
            });
          });
        }
      });

      return {
        completedDate: test.completedDate || null,
        result: test.testResult || "UNKNOWN",
        mileage: test.odometerValue || "Unknown",
        mileageUnit: test.odometerUnit || "mi",
        defects,
      };
    });

    /* ============================
       FINAL RESPONSE
    ============================= */
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
      motHistory,
    });
  } catch (err) {
    console.log("Server error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

/* ============================
   START SERVER
============================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
