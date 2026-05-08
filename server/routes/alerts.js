const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Alert = require('../models/Alert');
const { protect, authorize } = require('../middleware/auth');

const MODEL_BASE_URL = process.env.MODEL_BASE_URL || 'http://localhost:5001';
const MODEL_ALERTS_HISTORY_URL = `${MODEL_BASE_URL}/api/alerts/history?limit=500`;
const MODEL_ALERTS_URL = `${MODEL_BASE_URL}/api/alerts`;
const DEFAULT_CAMERA_ID = process.env.MODEL_CAMERA_ID || 'CAM-AI-01';

// ─── GridFS helpers ───────────────────────────────────────────────────────────

const GRIDFS_BUCKET = 'alert_images';

function getGridFSBucket() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB not connected — cannot access GridFS');
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: GRIDFS_BUCKET,
  });
}

/**
 * Upload a Buffer to GridFS.
 * Returns the new file's ObjectId.
 */
function uploadToGridFS(bucket, buffer, filename) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: 'image/jpeg',
    });
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.on('error', reject);
    uploadStream.end(buffer);
  });
}

/**
 * Fetch one screenshot from the Flask model server.
 * Returns a Buffer or throws.
 */
async function fetchImageBuffer(screenshotPath, timeoutMs = 5000) {
  const clean = String(screenshotPath).startsWith('/') ? screenshotPath : `/${screenshotPath}`;
  const url = `${MODEL_BASE_URL}${clean}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/**
 * For alerts in MongoDB that have a screenshotPath but no imageId:
 * download from Flask → store in GridFS → update Alert.imageId.
 * Processes at most `batchSize` at a time to avoid hammering Flask.
 */
async function syncImagesToGridFS(batchSize = 25) {
  if (mongoose.connection.readyState !== 1) return { stored: 0, failed: 0 };

  const pending = await Alert.find({
    screenshotPath: { $exists: true, $ne: null },
    imageId: { $exists: false },
  })
    .select('_id screenshotPath externalId')
    .limit(batchSize)
    .lean();

  if (!pending.length) return { stored: 0, failed: 0 };

  let bucket;
  try {
    bucket = getGridFSBucket();
  } catch {
    return { stored: 0, failed: 0 };
  }

  let stored = 0;
  let failed = 0;

  await Promise.allSettled(
    pending.map(async (alert) => {
      try {
        const buf = await fetchImageBuffer(alert.screenshotPath);
        // Derive a stable filename from the path
        const filename = String(alert.screenshotPath).split('/').pop() || `${alert._id}.jpg`;
        const fileId = await uploadToGridFS(bucket, buf, filename);
        await Alert.findByIdAndUpdate(alert._id, {
          imageId: fileId,
          imageStoredAt: new Date(),
        });
        stored++;
      } catch {
        failed++;
      }
    })
  );

  return { stored, failed };
}

// ─── Model data helpers ───────────────────────────────────────────────────────

function severityForThreat(threatType = '') {
  const t = String(threatType).toUpperCase();
  if (
    t.includes('GUN') || t.includes('PISTOL') || t.includes('KNIFE') ||
    t.includes('WEAPON') || t.includes('FIRE') || t.includes('SMOKE')
  ) return 'Critical';
  if (t.includes('SUSPICIOUS') || t.includes('FIGHT') || t.includes('VIOLENCE') || t.includes('RUN'))
    return 'Warning';
  return 'Info';
}

function messageForThreat(threatType = '') {
  const t = String(threatType).toUpperCase();
  if (t.includes('FIRE') || t.includes('SMOKE')) return 'Fire/Smoke detected';
  if (t.includes('GUN') || t.includes('PISTOL')) return 'Gun detected';
  if (t.includes('KNIFE')) return 'Knife detected';
  if (t.includes('WEAPON')) return 'Weapon detected';
  if (t.includes('VIOLENCE')) return 'Violence detected';
  if (t.includes('SUSPICIOUS')) return 'Suspicious activity detected';
  return `${threatType} detected`;
}

async function fetchWithTimeout(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function pullModelAlerts() {
  try {
    const res = await fetchWithTimeout(MODEL_ALERTS_HISTORY_URL, 4000);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.alerts) && data.alerts.length > 0) return data.alerts;
    }
  } catch (_) {}

  try {
    const res = await fetchWithTimeout(MODEL_ALERTS_URL, 2000);
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.alerts) ? data.alerts : [];
    }
  } catch (_) {}

  return [];
}

function mapModelAlertToDoc(a) {
  const externalId = a.external_id || `${a.timestamp}_${a.threat_type}_${a.track_id ?? 'global'}`;
  return {
    externalId,
    cameraId: a.camera_id || DEFAULT_CAMERA_ID,
    threatType: String(a.threat_type),
    severity: severityForThreat(a.threat_type),
    message: a.message || messageForThreat(a.threat_type),
    confidence: typeof a.confidence === 'number' ? a.confidence : undefined,
    trackId: typeof a.track_id === 'number' ? a.track_id : undefined,
    bbox: Array.isArray(a.bbox) ? a.bbox.map(Number) : undefined,
    screenshotPath: a.screenshot || a.screenshot_path || undefined,
    modelTimestamp: new Date(a.timestamp),
    status: 'Unresolved',
  };
}

async function upsertAlerts(docs) {
  if (!docs.length) return { upsertedCount: 0 };
  const result = await Alert.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { externalId: doc.externalId },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    })),
    { ordered: false }
  ).catch((err) => {
    // Ignore duplicate-key / partial-write errors
    if (err.result) return err.result;
    throw err;
  });
  return result;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/alerts/image/:fileId
 * Stream an alert screenshot directly from MongoDB GridFS.
 * No auth required — ObjectId entropy makes brute-force impractical.
 * Images are cached by the browser for 7 days.
 */
router.get('/image/:fileId', async (req, res) => {
  const { fileId } = req.params;

  // Validate ObjectId format before hitting the DB
  if (!mongoose.Types.ObjectId.isValid(fileId)) {
    return res.status(400).json({ error: 'Invalid file ID' });
  }

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database not connected' });
  }

  try {
    const bucket = getGridFSBucket();
    const oid = new mongoose.Types.ObjectId(fileId);

    // Check the file exists first (avoids an ugly 500 on missing files)
    const files = await mongoose.connection.db
      .collection(`${GRIDFS_BUCKET}.files`)
      .findOne({ _id: oid });

    if (!files) {
      return res.status(404).json({ error: 'Image not found in storage' });
    }

    res.set('Content-Type', files.contentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=604800, immutable'); // 7-day browser cache
    res.set('Content-Length', files.length);

    bucket.openDownloadStream(oid).pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * GET /api/alerts
 * Pull latest model alerts (from JSONL history), upsert into DB,
 * then return all DB alerts. Also triggers async image sync.
 */
router.get('/', protect, async (req, res) => {
  try {
    let modelAlerts = [];
    try { modelAlerts = await pullModelAlerts(); } catch (_) {}

    if (mongoose.connection.readyState !== 1) {
      // DB down — return model-only data (no images available)
      const alerts = modelAlerts
        .filter((a) => a && a.threat_type && a.timestamp)
        .map(mapModelAlertToDoc)
        .filter((d) => !Number.isNaN(d.modelTimestamp.getTime()))
        .sort((a, b) => b.modelTimestamp - a.modelTimestamp)
        .slice(0, 100);
      return res.json({ success: true, alerts, source: 'model' });
    }

    if (modelAlerts.length) {
      const docs = modelAlerts
        .filter((a) => a && a.threat_type && a.timestamp)
        .map(mapModelAlertToDoc)
        .filter((d) => !Number.isNaN(d.modelTimestamp.getTime()));
      if (docs.length) await upsertAlerts(docs);
    }

    const alerts = await Alert.find({})
      .sort({ modelTimestamp: -1 })
      .limit(200)
      .lean();

    res.json({ success: true, alerts });

    // Kick off image sync in the background (non-blocking)
    setImmediate(() => syncImagesToGridFS(20).catch(() => {}));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/alerts/sync
 * Full sync: pull all JSONL alerts → upsert → download + store images in GridFS.
 * Returns counts of synced alerts and stored images.
 */
router.post('/sync', protect, authorize('admin', 'operator'), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'Database not connected' });
  }

  try {
    // 1. Upsert alert metadata
    const modelAlerts = await pullModelAlerts();
    const docs = modelAlerts
      .filter((a) => a && a.threat_type && a.timestamp)
      .map(mapModelAlertToDoc)
      .filter((d) => !Number.isNaN(d.modelTimestamp.getTime()));

    let inserted = 0;
    if (docs.length) {
      const result = await upsertAlerts(docs);
      inserted = result.upsertedCount || 0;
    }

    // 2. Store images in GridFS (up to 50 per sync call)
    const imgResult = await syncImagesToGridFS(50);

    res.json({
      success: true,
      synced: docs.length,
      inserted,
      imagesStored: imgResult.stored,
      imagesFailed: imgResult.failed,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/alerts/:id/resolve
 */
router.put('/:id/resolve', protect, authorize('admin', 'operator'), async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });

    if (alert.status !== 'Resolved') {
      alert.status = 'Resolved';
      alert.resolvedAt = new Date();
      alert.resolvedBy = req.user._id;
      await alert.save();
    }

    res.json({ success: true, alert });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/alerts/mark-all-read
 */
router.put('/mark-all-read', protect, async (req, res) => {
  try {
    await Alert.updateMany(
      { $or: [{ readAt: { $exists: false } }, { readAt: null }] },
      { $set: { readAt: new Date(), readBy: req.user._id } }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
