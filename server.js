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

  Object.keys(data).forEach((key) => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    view = view.replace(regex, data[key] ?? '');
  });

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

  const response = await axios.post(
    url,
    { registrationNumber: reg },
    {
      headers: {
        'x-api-key': process.env.DVLA_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

// --- MOT helpers (Azure AD OAuth2 + public MOT endpoint) ---
async function getMOTAccessToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', process.env.MOT_CLIENT_ID);
  params.append('client_secret', process.env.MOT_CLIENT_SECRET);
  params.append('scope', process.env.MOT_SCOPE);

  const response = await axios.post(process.env.MOT_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  return response.data.access_token;
}

async function getMOTHistory(reg) {
  const token = await getMOTAccessToken();

  const url = `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${reg}`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-key': process.env.MOT_API_KEY,
      Accept: 'application/json'
    }
  });

  return response.data;
}

function computeMileageStats(vehicle) {
  const tests = vehicle?.motTests || [];

  if (!tests.length) {
    return {
      lastKnownMileage: 'N/A',
      lastTestDate: 'N/A',
      averageMileagePerYear: 'N/A',
      totalTests: 0
    };
  }

  tests.sort((a, b) => new Date(a.completedDate) - new Date(b.completedDate));

  const first = tests[0];
  const last = tests[tests.length - 1];

  const firstMileage = parseInt(first.odometerValue || '0', 10);
  const lastMileage = parseInt(last.odometerValue || '0', 10);

  const firstDate = new Date(first.completedDate);
  const lastDate = new Date(last.completedDate);

  const diffYears = (lastDate - firstDate) / (1000 * 60 * 60 * 24 * 365.25) || 1;

  const avg = Math.round((lastMileage - firstMileage) / diffYears);

  return {
    lastKnownMileage: lastMileage.toLocaleString('en-GB'),
    lastTestDate: last.completedDate,
    averageMileagePerYear: avg.toLocaleString('en-GB'),
    totalTests: tests.length
  };
}

// --- Auth routes ---
app.get('/login', (req, res) => {
  render(res, 'login', {
    pageTitle: 'Login - BiismoReg',
    userEmail: req.session.user?.email || '',
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
  render(res, 'signup', {
    pageTitle: 'Sign Up - BiismoReg',
    userEmail: req.session.user?.email || '',
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
  req.session.destroy(() => res.redirect('/'));
});

// --- Main pages ---
app.get('/', (req, res) => {
  render(res, 'index', {
    pageTitle: 'BiismoReg - UK Reg Check',
    userEmail: req.session.user?.email || '',
    error: ''
  });
});

app.post('/check-reg', async (req, res) => {
  const reg = (req.body.registration || '').toUpperCase().replace(/\s+/g, '');
  const userEmail = req.session.user?.email || '';

  if (!reg) {
    return render(res, 'index', {
      pageTitle: 'BiismoReg - UK Reg Check',
      userEmail,
      error: '<div class="error">Please enter a registration number</div>'
    });
  }

  try {
    const [dvlaData, motData] = await Promise.all([
      getVehicleFromDVLA(reg),
      getMOTHistory(reg)
    ]);

    const vehicle = Array.isArray(motData) ? motData[0] : motData;
    const mileageStats = computeMileageStats(vehicle);

    const resultHtml = `
      <h2>Results for ${reg}</h2>
      <div class="result-grid">
        <div class="card">
          <h3>Vehicle details</h3>
          <p><strong>Make:</strong> ${dvlaData.make}</p>
          <p><strong>Model:</strong> ${dvlaData.model}</p>
          <p><strong>Colour:</strong> ${dvlaData.colour}</p>
          <p><strong>Fuel type:</strong> ${dvlaData.fuelType}</p>
          <p><strong>Engine capacity:</strong> ${dvlaData.engineCapacity} cc</p>
          <p><strong>Year of manufacture:</strong> ${dvlaData.yearOfManufacture}</p>
        </div>

        <div class="card">
          <h3>Tax & MOT</h3>
          <p><strong>Tax status:</strong> ${dvlaData.taxStatus}</p>
          <p><strong>Tax due date:</strong> ${dvlaData.taxDueDate}</p>
          <p><strong>MOT expiry date:</strong> ${dvlaData.motExpiryDate}</p>
        </div>

        <div class="card">
          <h3>Mileage stats</h3>
          <p><strong>Last known mileage:</strong> ${mileageStats.lastKnownMileage}</p>
          <p><strong>Last MOT test date:</strong> ${mileageStats.lastTestDate}</p>
          <p><strong>Average mileage per year:</strong> ${mileageStats.averageMileagePerYear}</p>
          <p><strong>Total MOT tests:</strong> ${mileageStats.totalTests}</p>
        </div>

        <div class="card">
          <h3>Raw MOT data</h3>
          <pre>${JSON.stringify(vehicle, null, 2)}</pre>
        </div>
      </div>
    `;

    render(res, 'result', {
      pageTitle: `BiismoReg - ${reg}`,
      userEmail,
      result: resultHtml
    });
  } catch (err) {
    console.log("FULL ERROR:", err.response?.data || err.message);
    render(res, 'index', {
      pageTitle: 'BiismoReg - UK Reg Check',
      userEmail,
      error: '<div class="error">Unable to fetch data. Check your API credentials.</div>'
    });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`BiismoReg running on port ${PORT}`);
});
