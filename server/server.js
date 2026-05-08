require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors    = require('cors');
const connectDB = require('./db');

connectDB();

const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:5174', 'http://127.0.0.1:5174',
    'http://localhost:5175', 'http://127.0.0.1:5175',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-model-api-key'],
}));

// Raise body-size limit to 10 MB — base64-encoded JPEG screenshots can be ~200 KB
app.use(express.json({ limit: '10mb' }));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/cameras',   require('./routes/cameras'));
app.use('/api/alerts',    require('./routes/alerts'));   // includes /ingest and /image/:fileId
app.use('/api/analytics', require('./routes/analytics'));

// ─── Debug proxy helpers (Flask model — not used by frontend) ─────────────────
const MODEL_BASE_URL = process.env.MODEL_BASE_URL || 'http://localhost:5001';

async function proxyGet(url, res, ms = 3000, fallback = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`Upstream ${r.status}`);
    res.json(await r.json());
  } catch {
    res.json(fallback);
  }
}

// Raw in-memory alerts from Flask (debug only)
app.get('/api/model/alerts', (req, res) =>
  proxyGet(`${MODEL_BASE_URL}/api/alerts`, res, 2500, { alerts: [] })
);

// JSONL history from Flask (debug only)
app.get('/api/model/alerts/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 2000);
  proxyGet(`${MODEL_BASE_URL}/api/alerts/history?limit=${limit}`, res, 3500, { alerts: [], total: 0 });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
