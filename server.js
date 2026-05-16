import express from "express";

const app = express();

app.use(express.json());
app.use(express.static("public"));

/* =========================
   ENV
========================= */

const DVLA_API_KEY =
  process.env.DVLA_API_KEY;

const MOT_CLIENT_ID =
  process.env.MOT_CLIENT_ID;

const MOT_CLIENT_SECRET =
  process.env.MOT_CLIENT_SECRET;

const MOT_API_KEY =
  process.env.MOT_API_KEY;

const MOT_SCOPE =
  process.env.MOT_SCOPE;

const MOT_TOKEN_URL =
  process.env.MOT_TOKEN_URL;

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

  if (
    cachedToken &&
    now < tokenExpiry
  ) {
    return cachedToken;
  }

  const tokenRes = await fetch(

    MOT_TOKEN_URL,

    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },

      body: new URLSearchParams({

        client_id:
          MOT_CLIENT_ID,

        client_secret:
          MOT_CLIENT_SECRET,

        scope:
          MOT_SCOPE,

        grant_type:
          "client_credentials"

      })

    }
  );

  const tokenData =
    await tokenRes.json();

  console.log("TOKEN:", tokenData);

  if (!tokenData.access_token) {

    throw new Error(
      "MOT token failed"
    );
  }

  cachedToken =
    tokenData.access_token;

  tokenExpiry =
    now +
    ((tokenData.expires_in || 3600) * 1000);

  return cachedToken;
}

/* =========================
   MAIN API
========================= */

app.post("/api/check", async (req, res) => {

  try {

    const reg =
      req.body.registrationNumber
        .toUpperCase()
        .replace(/\s/g, "");

    /* =========================
       DVLA
    ========================= */

    const dvlaRes = await fetch(

      "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles",

      {
        method: "POST",

        headers: {

          "x-api-key":
            DVLA_API_KEY,

          "Content-Type":
            "application/json"

        },

        body: JSON.stringify({
          registrationNumber: reg
        })

      }
    );

    const dvla =
      await dvlaRes.json();

    console.log("DVLA:", dvla);

    /* =========================
       MOT TOKEN
    ========================= */

    const token =
      await getMotToken();

    /* =========================
       MOT FETCH
    ========================= */

    const motRes = await fetch(

      `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${reg}`,

      {
        headers: {

          Authorization:
            `Bearer ${token}`,

          "x-api-key":
            MOT_API_KEY,

          Accept:
            "application/json"

        }
      }
    );

    const motRaw =
      await motRes.json();

    console.log(
      "FULL MOT RAW:",
      JSON.stringify(motRaw, null, 2)
    );

    /* =========================
       ARRAY FIX
    ========================= */

    const vehicle =
      Array.isArray(motRaw)
        ? motRaw[0]
        : motRaw;

    /* =========================
       MOT HISTORY FIX
    ========================= */

    const motHistory =
      (vehicle?.motTests || []).map(test => {

        /* =========================
           COLLECT ALL DEFECT TYPES
        ========================= */

        const defects = [];

        /* OLD FORMAT */
        if (test.rfrAndComments) {

          test.rfrAndComments.forEach(issue => {

            defects.push({

              text:
                issue.text ||
                "Issue found",

              type:
                (
                  issue.type ||
                  "ADVISORY"
                ).toUpperCase()

            });

          });

        }

        /* NEWER FORMAT FALLBACKS */

        [
          "advisories",
          "minorDefects",
          "majorDefects",
          "dangerousDefects",
          "defects",
          "reasons"
        ].forEach(key => {

          if (
            Array.isArray(test[key])
          ) {

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
                    key.replace(
                      "Defects",
                      ""
                    ) ||
                    "ADVISORY"
                  ).toUpperCase()

              });

            });

          }

        });

        return {

          completedDate:
            test.completedDate || null,

          result:
            test.testResult ||
            "UNKNOWN",

          mileage:
            test.odometerValue ||
            "Unknown",

          mileageUnit:
            test.odometerUnit ||
            "mi",

          defects

        };

      });

    /* =========================
       RESPONSE
    ========================= */

res.json({

  // Basic identity
  registration: reg,
  make: dvla.make || vehicle?.make || "Unknown",
  model: dvla.model || vehicle?.model || "Unknown",
  colour: dvla.colour || "Unknown",
  fuelType: dvla.fuelType || "Unknown",
  engineCapacity: dvla.engineCapacity || "Unknown",
  year: dvla.yearOfManufacture || "Unknown",
  monthOfFirstRegistration: dvla.monthOfFirstRegistration || "Unknown",

  // Tax & MOT
  taxStatus: dvla.taxStatus || "Unknown",
  taxDueDate: dvla.taxDueDate || null,
  motExpiryDate: dvla.motExpiryDate || null,

  // Environmental
  co2Emissions: dvla.co2Emissions || null,
  euroStatus: dvla.euroStatus || "Unknown",
  realDrivingEmissions: dvla.realDrivingEmissions || "Unknown",

  // Technical
  typeApproval: dvla.typeApproval || "Unknown",
  wheelplan: dvla.wheelplan || "Unknown",
  revenueWeight: dvla.revenueWeight || "Unknown",

  // V5C / Export
  exportMarker: dvla.exportMarker || false,
  dateOfLastV5CIssued: dvla.dateOfLastV5CIssued || null,

  // MOT history
  motHistory

});

  } catch (err) {

    console.log(err);

    res.status(500).json({

      error:
        err.message ||
        "Server error"

    });

  }

});

/* =========================
   START
========================= */

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `Server running on ${PORT}`
  );

});
