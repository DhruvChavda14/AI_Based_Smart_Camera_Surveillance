import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 6000,
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── API endpoints ────────────────────────────────────────────────────────────

export const login           = (credentials) => api.post('/auth/login', credentials);
export const register        = (userData)    => api.post('/auth/register', userData);
export const getCameras      = ()            => api.get('/cameras');
export const getAnalytics    = (params = '') => api.get(`/analytics${params}`);
export const getAlerts       = ()            => api.get('/alerts');
export const resolveAlert    = (alertId)     => api.put(`/alerts/${alertId}/resolve`);
export const markAllAlertsRead = ()          => api.put('/alerts/mark-all-read');
export const syncAlerts      = ()            => api.post('/alerts/sync');

// ─── Image URL helper ─────────────────────────────────────────────────────────

/**
 * Build the URL to display an alert screenshot.
 *
 * Priority:
 *  1. imageId  → served from MongoDB GridFS  (/api/alerts/image/:id)
 *               ✅ No dependency on Flask / local filesystem
 *  2. screenshotPath → fallback proxy through Node.js to Flask
 *               ⚠️  Requires Flask model server to be running
 *
 * @param {string|null}  imageId        GridFS ObjectId (from Alert.imageId)
 * @param {string|null}  screenshotPath Original local path (Alert.screenshotPath)
 * @returns {string|null}
 */
export function screenshotUrl(imageId, screenshotPath) {
  // Prefer MongoDB GridFS — fully self-contained, no external dependency
  if (imageId) {
    return `/api/alerts/image/${imageId}`;
  }

  // Fallback: proxy through Node → Flask for alerts not yet migrated
  if (screenshotPath) {
    const clean = String(screenshotPath).startsWith('/') ? screenshotPath : `/${screenshotPath}`;
    return `/api/model/screenshot?path=${encodeURIComponent(clean)}`;
  }

  return null;
}

export default api;
