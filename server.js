require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: 'biismoreg-secret-key',
    resave: false,
    saveUninitialized: false
  })
);

// --- Simple HTML templating ---
function render(res, viewName, data = {}) {
  const layoutPath = path.join(__dirname, 'views', 'layout.html');
  const viewPath = path.join(__dirname, 'views', `${viewName}.html`);

  let layout = fs.readFileSync(layoutPath, 'utf8');
  let view = fs.readFileSync(viewPath, 'utf8');

  // Replace placeholders in view
  Object.keys(data).forEach((key) => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    view = view.replace(regex, data[key] ?? '');
  });

  // Auth links
  const authLinks = data.userEmail
    ? `<span class="user-email">${data.userEmail}</span> <a href="/logout">Logout</a>`
    : `<a href="/login">Login</a> <a href="/signup" class="btn-outline">Sign up</a>`;

  layout = layout.replace('{{authLinks}}', authLinks);
  layout = layout.replace('{{content}}', view);
  layout = layout.replace('{{pageTitle}}', data.pageTitle || 'BiismoReg');

  res.send(layout);
}

// --- Users "DB" (users.txt) ---
const USERS_FILE = path.join(__dirname, 'users.txt');

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '');
}

function findUserByEmail(email) {
  const lines = fs.readFileSync(USERS_FILE, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const [storedEmail, storedPassword] = line.split('|');
    if (storedEmail === email) {
      return { email: storedEmail, password: storedPassword };
    }
  }
  return null;
}

function createUser(email, password) {
  const existing = findUserByEmail(email);
  if (existing) return false;
  fs.appendFileSync(USERS_FILE, `${email}|${password}\n`);
  return true;
}

// --- DVLA helper ---
async function getVehicleFromDVLA(reg) {
  const url = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';
  const apiKey = process.env.DVLA_API_KEY;

  const response = await axios.post(
    url,
    { registrationNumber: reg },
    {
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

// --- MOT helpers (Azure AD OAuth2 + API key) ---
async function getMOTAccessToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', process.env.MOT_CLIENT_ID);
  params.append('client_secret', process.env.MOT_CLIENT_SECRET);
  params.append('scope', process.env.MOT_SCOPE); // e.g. https://tapi.dvsa.gov.uk/.default

  const response = await axios.post(process.env.MOT_TOKEN_URL, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  return response.data.access_token;
}

async function getMOTHistory(reg) {
  const token = await getMOTAccessToken();

  // New DVSA MOT History API endpoint for your credentials
  const url = `https://tapi.dvsa.gov.uk/mot-history-api/vehicles/${encodeURIComponent(
    reg
  )}/tests`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-key': process.env.MOT_API_KEY,
      Accept: 'application/json'
    }
  });

  return response.data; // array of MOT tests
}

function computeMileageStats(motTests) {
  if (!Array.isArray(motTests) || motTests.length === 0) {
    return {
      lastKnownMileage: 'N/A',
      lastTestDate: 'N/A',
      averageMileagePerYear: 'N/A',
      totalTests: 0
    };
  }

  // Sort by completedDate
  motTests.sort((a, b) => new Date(a.completedDate) - new Date(b.completedDate));

  const firstTest = motTests[0];
  const lastTest = motTests[motTests.length - 1];

  const firstMileage = parseInt(firstTest.odometerValue || '0', 10);
  const lastMileage = parseInt(lastTest.odometerValue || '0', 10);

  const firstDate = new Date(firstTest.completedDate);
  const lastDate = new Date(lastTest.completedDate);

  const diffYears =
    (lastDate - firstDate) / (1000 * 60 * 60 * 24 * 365.25) || 1;

  const avgPerYear = Math.round((lastMileage - firstMileage) / diffYears);

  return {
    lastKnownMileage: lastMileage ? lastMileage.toLocaleString('en-GB') : 'N/A',
    lastTestDate: lastTest.completedDate || 'N/A',
    averageMileagePerYear: isFinite(avgPerYear)
      ? avgPerYear.toLocaleString('en-GB')
      : 'N/A',
    totalTests: motTests.length
  };
}

// --- Auth routes ---
app.get('/login', (req, res) => {
  const userEmail = req.session.user ? req.session.user.email : '';
  render(res, 'login', {
    pageTitle: 'Login - BiismoReg',
    userEmail,
    error: ''
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = findUserByEmail(email);

  if (!user || user.password !== password) {
    return render(res, 'login', {
      pageTitle: 'Login - BiismoReg',
      userEmail: '',
      error: '<div class="error">Invalid email or password</div>'
    });
  }

  req.session.user = { email };
  res.redirect('/');
});

app.get('/signup', (req, res) => {
  const userEmail = req.session.user ? req.session.user.email : '';
  render(res, 'signup', {
    pageTitle: 'Sign Up - BiismoReg',
    userEmail,
    error: ''
  });
});

app.post('/signup', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return render(res, 'signup', {
      pageTitle: 'Sign Up - BiismoReg',
      userEmail: '',
      error: '<div class="error">Email and password are required</div>'
    });
  }

  const created = createUser(email, password);
  if (!created) {
    return render(res, 'signup', {
      pageTitle: 'Sign Up - BiismoReg',
      userEmail: '',
      error: '<div class="error">User already exists</div>'
    });
  }

  req.session.user = { email };
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// --- Main pages ---
app.get('/', (req, res) => {
  const userEmail = req.session.user ? req.session.user.email : '';
  render(res, 'index', {
    pageTitle: 'BiismoReg - UK Reg Check',
    userEmail,
    error: ''
  });
});

app.post('/check-reg', async (req, res) => {
  const reg = (req.body.registration || '').toUpperCase().replace(/\s+/g, '');
  const userEmail = req.session.user ? req.session.user.email : '';

  if (!reg) {
    return render(res, 'index', {
      pageTitle: 'BiismoReg - UK Reg Check',
      userEmail,
      error: '<div class="error">Please enter a registration number</div>'
    });
  }

  try {
    const [dvlaData, motTests] = await Promise.all([
      getVehicleFromDVLA(reg),
      getMOTHistory(reg)
    ]);

    const mileageStats = computeMileageStats(motTests);

    const vehicle = dvlaData || {};
    const rawMOT = motTests || [];

    const resultHtml = `
      <h2>Results for ${reg}</h2>
      <div class="result-grid">
        <div class="card">
          <h3>Vehicle details</h3>
          <p><strong>Make:</strong> ${vehicle.make || 'N/A'}</p>
          <p><strong>Model:</strong> ${vehicle.model || 'N/A'}</p>
          <p><strong>Colour:</strong> ${vehicle.colour || 'N/A'}</p>
          <p><strong>Fuel type:</strong> ${vehicle.fuelType || 'N/A'}</p>
          <p><strong>Engine capacity:</strong> ${
            vehicle.engineCapacity || 'N/A'
          } cc</p>
          <p><strong>Year of manufacture:</strong> ${
            vehicle.yearOfManufacture || 'N/A'
          }</p>
        </div>

        <div class="card">
          <h3>Tax & MOT</h3>
          <p><strong>Tax status:</strong> ${vehicle.taxStatus || 'N/A'}</p>
          <p><strong>Tax due date:</strong> ${
            vehicle.taxDueDate || 'N/A'
          }</p>
          <p><strong>MOT status:</strong> ${vehicle.motStatus || 'N/A'}</p>
          <p><strong>MOT expiry date:</strong> ${
            vehicle.motExpiryDate || 'N/A'
          }</p>
        </div>

        <div class="card">
          <h3>Mileage stats</h3>
          <p><strong>Last known mileage:</strong> ${
            mileageStats.lastKnownMileage
          } miles</p>
          <p><strong>Last MOT test date:</strong> ${
            mileageStats.lastTestDate
          }</p>
          <p><strong>Average mileage per year:</strong> ${
            mileageStats.averageMileagePerYear
          } miles</p>
          <p><strong>Total MOT tests:</strong> ${
            mileageStats.totalTests
          }</p>
        </div>

        <div class="card">
          <h3>Raw MOT data</h3>
          <pre>${JSON.stringify(rawMOT, null, 2)}</pre>
        </div>
      </div>
    `;

    render(res, 'result', {
      pageTitle: `BiismoReg - ${reg}`,
      userEmail,
      result: resultHtml
    });
  } catch (err) {
    console.error('DVLA/MOT error:', err.response?.data || err.message);
    render(res, 'index', {
      pageTitle: 'BiismoReg - UK Reg Check',
      userEmail,
      error:
        '<div class="error">Unable to fetch data for that registration. Check the reg and your API credentials, then try again.</div>'
    });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`BiismoReg running at http://localhost:${PORT}`);
});
