import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 8000,
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

export const login             = (credentials) => api.post('/auth/login', credentials);
export const register          = (userData)    => api.post('/auth/register', userData);
export const getCameras        = ()            => api.get('/cameras');
export const getAnalytics      = (params = '') => api.get(`/analytics${params}`);
export const getAlerts         = ()            => api.get('/alerts');
export const resolveAlert      = (alertId)     => api.put(`/alerts/${alertId}/resolve`);
export const markAllAlertsRead = ()            => api.put('/alerts/mark-all-read');
export const syncAlerts        = ()            => api.post('/alerts/sync');

// ─── Image URL helper ─────────────────────────────────────────────────────────

/**
 * Returns the URL to display an alert screenshot.
 *
 * Images are always served from MongoDB GridFS via:
 *   GET /api/alerts/image/:imageId
 *
 * If the alert has no imageId yet (not synced), returns null so the UI
 * can show a "no image" placeholder — no Flask / local filesystem dependency.
 *
 * @param {string|object|null} imageId  GridFS ObjectId from Alert.imageId
 * @returns {string|null}
 */
export function screenshotUrl(imageId) {
  if (!imageId) return null;
  // imageId may arrive as a Mongoose ObjectId serialized to object { $oid: '...' }
  // or as a plain string
  const id = typeof imageId === 'object' ? (imageId.$oid || imageId.toString()) : String(imageId);
  return `/api/alerts/image/${id}`;
}

export default api;
