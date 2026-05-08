require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./db');

// Connect to database
connectDB();

const app = express();

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:5174', 'http://127.0.0.1:5174',
    'http://localhost:5175', 'http://127.0.0.1:5175',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/cameras',   require('./routes/cameras'));
app.use('/api/alerts',    require('./routes/alerts'));   // includes /image/:fileId
app.use('/api/analytics', require('./routes/analytics'));

// ─── Model server proxy helpers (used only during sync; frontend never calls these) ───

const MODEL_BASE_URL = process.env.MODEL_BASE_URL || 'http://localhost:5001';

async function proxyGet(url, res, timeoutMs = 3000, fallback = {}) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch {
    res.json(fallback);
  }
}

// Raw in-memory alerts from Flask (for debugging)
app.get('/api/model/alerts', (req, res) =>
  proxyGet(`${MODEL_BASE_URL}/api/alerts`, res, 2500, { alerts: [] })
);

// JSONL history from Flask (for debugging)
app.get('/api/model/alerts/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 2000);
  proxyGet(`${MODEL_BASE_URL}/api/alerts/history?limit=${limit}`, res, 3500, { alerts: [], total: 0 });
});

// Latest capture metadata from Flask (for debugging)
app.get('/api/model/captures/latest', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '12', 10), 50);
  proxyGet(`${MODEL_BASE_URL}/api/captures/latest?limit=${limit}`, res, 2500, { captures: [] });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
