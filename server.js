import express from "express";
import path from "path";
import fs from "fs";
import session from "express-session";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";

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

app.use(
  session({
    secret: "biismo-secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(express.static(path.join(__dirname, "public")));

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

app.post("/api/garage/remove", (req, res) => {
  const email = req.session.userEmail;
  const reg = (req.body.reg || "").toUpperCase();

  if (!email) return res.status(401).json({ error: "Not logged in" });

  ensureFile(GARAGE_FILE);
  const lines = fs.readFileSync(GARAGE_FILE, "utf8").split("\n").filter(Boolean);

  const updated = lines.map(line => {
    const [uEmail, list] = line.split("|");
    if (uEmail === email) {
      const arr = list ? list.split(",") : [];
      const filtered = arr.filter(v => v !== reg);
      return `${email}|${filtered.join(",")}`;
    }
    return line;
  });

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
   DVLA + MOT API CHECK ROUTE
============================ */

app.post("/api/check", async (req, res) => {
  const { registrationNumber } = req.body;

  if (!registrationNumber) {
    return res.status(400).json({ error: "Registration number is required" });
  }

  try {
    /* ============================
       DVLA VEHICLE ENQUIRY API
    ============================= */

    const dvlaResponse = await fetch(
      "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles",
      {
        method: "POST",
        headers: {
          "x-api-key": process.env.DVLA_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ registrationNumber })
      }
    );

    const dvlaData = await dvlaResponse.json();

    if (!dvlaResponse.ok) {
      return res.status(400).json({
        error: dvlaData.message || "DVLA lookup failed"
      });
    }

    /* ============================
       DVSA MOT HISTORY API
    ============================= */

    // 1. Get OAuth token
    const tokenResponse = await fetch(process.env.MOT_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.MOT_CLIENT_ID}:${process.env.MOT_CLIENT_SECRET}`
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: `grant_type=client_credentials&scope=${process.env.MOT_SCOPE}`
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res
        .status(400)
        .json({ error: "Failed to authenticate with MOT API" });
    }

    const accessToken = tokenData.access_token;

    // 2. Fetch MOT history (UPDATED URL)
    const motResponse = await fetch(
      `https://check-mot.service.gov.uk/trade/vehicles/mot-tests?registration=${registrationNumber}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-api-key": process.env.MOT_API_KEY
        }
      }
    );

    const motData = await motResponse.json();

    if (!motResponse.ok) {
      return res.status(400).json({ error: "MOT lookup failed" });
    }

    /* ============================
       NORMALISE DEFECTS
    ============================= */

    const normalisedHistory = (motData || []).map(test => {
      const defects = [];

      const add = (items, type) => {
        if (Array.isArray(items)) {
          items.forEach(d =>
            defects.push({
              type,
              text: d.text || d.reason || d.comment || "Unknown defect"
            })
          );
        }
      };

      add(test.rfrAndComments, "ADVISORY");
      add(test.advisories, "ADVISORY");
      add(test.minorDefects, "MINOR");
      add(test.majorDefects, "MAJOR");
      add(test.dangerousDefects, "DANGEROUS");
      add(test.defects, "MAJOR");
      add(test.reasons, "MAJOR");

      return {
        ...test,
        defects
      };
    });

    /* ============================
       FINAL RESPONSE
    ============================= */

    res.json({
      registration: dvlaData.registrationNumber,
      make: dvlaData.make,
      model: dvlaData.model,
      colour: dvlaData.colour,
      fuelType: dvlaData.fuelType,
      engineCapacity: dvlaData.engineCapacity,
      year: dvlaData.yearOfManufacture,
      taxStatus: dvlaData.taxStatus,
      taxDueDate: dvlaData.taxDueDate,
      motExpiryDate: dvlaData.motExpiryDate,
      motHistory: normalisedHistory
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
