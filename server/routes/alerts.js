const express    = require('express');
const router     = express.Router();
const mongoose   = require('mongoose');
const { GridFSBucket } = require('mongodb');
const path       = require('path');
const fs         = require('fs').promises;

const Alert      = require('../models/Alert');
const { protect, authorize } = require('../middleware/auth');

const MODEL_BASE_URL = process.env.MODEL_BASE_URL || 'http://localhost:5001';
// 2000 entries so we catch all historical alerts from JSONL (metadata-only fallback).
// Real-time alerts come via POST /ingest directly and never hit this limit.
const MODEL_ALERTS_HISTORY_URL = `${MODEL_BASE_URL}/api/alerts/history?limit=2000`;
const MODEL_ALERTS_URL         = `${MODEL_BASE_URL}/api/alerts`;
const DEFAULT_CAMERA_ID        = process.env.MODEL_CAMERA_ID || 'CAM-AI-01';
const MODEL_API_KEY            = process.env.MODEL_API_KEY   || '';

// Directory where model saves screenshots (for one-time migration only)
// model/ sits one level above server/
const MODEL_ALERTS_DIR = path.join(__dirname, '..', 'model', 'alerts');

// ─── GridFS helpers ───────────────────────────────────────────────────────────

const GRIDFS_BUCKET = 'alert_images';

function getGridFSBucket() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB not connected — cannot access GridFS');
  }
  return new GridFSBucket(mongoose.connection.db, { bucketName: GRIDFS_BUCKET });
}

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

// ─── ONE-TIME MIGRATION: read existing screenshots from local disk ────────────
// Used only for migrating old alerts that were saved before the new flow.
// New alerts go directly via POST /ingest — no disk reads needed.

async function readLocalImage(screenshotPath) {
  // screenshotPath = "/alerts/filename.jpg"
  const filename = path.basename(screenshotPath); // strip directory, prevent traversal
  const localPath = path.join(MODEL_ALERTS_DIR, filename);
  return fs.readFile(localPath); // throws ENOENT if file doesn't exist
}

async function migrateLocalImages(batchSize = 30) {
  if (mongoose.connection.readyState !== 1) return { stored: 0, skipped: 0 };

  // Find alerts that reference a local path but have no imageId yet
  const pending = await Alert.find({
    screenshotPath: { $exists: true, $ne: null },
    imageId:        { $exists: false },
  })
    .select('_id screenshotPath')
    .limit(batchSize)
    .lean();

  if (!pending.length) return { stored: 0, skipped: 0 };

  let bucket;
  try { bucket = getGridFSBucket(); } catch { return { stored: 0, skipped: 0 }; }

  let stored = 0;
  let skipped = 0;

  await Promise.allSettled(pending.map(async (alert) => {
    try {
      const buf      = await readLocalImage(alert.screenshotPath);
      const filename = path.basename(alert.screenshotPath);
      const fileId   = await uploadToGridFS(bucket, buf, filename);
      await Alert.findByIdAndUpdate(alert._id, {
        imageId:        fileId,
        imageStoredAt:  new Date(),
        screenshotPath: null, // clear after successful migration
      });
      stored++;
    } catch {
      // File doesn't exist on disk — mark so we stop retrying
      await Alert.findByIdAndUpdate(alert._id, { screenshotPath: null });
      skipped++;
    }
  }));

  return { stored, skipped };
}

// ─── Alert metadata helpers ───────────────────────────────────────────────────

function severityForThreat(t = '') {
  const u = String(t).toUpperCase();
  if (u.includes('GUN') || u.includes('PISTOL') || u.includes('KNIFE') ||
      u.includes('WEAPON') || u.includes('FIRE') || u.includes('SMOKE')) return 'Critical';
  if (u.includes('SUSPICIOUS') || u.includes('FIGHT') || u.includes('VIOLENCE') ||
      u.includes('RUN')) return 'Warning';
  return 'Info';
}

function messageForThreat(t = '') {
  const u = String(t).toUpperCase();
  if (u.includes('FIRE') || u.includes('SMOKE'))  return 'Fire/Smoke detected';
  if (u.includes('GUN')  || u.includes('PISTOL')) return 'Gun detected';
  if (u.includes('KNIFE'))   return 'Knife detected';
  if (u.includes('WEAPON'))  return 'Weapon detected';
  if (u.includes('VIOLENCE'))return 'Violence detected';
  if (u.includes('SUSPICIOUS')) return 'Suspicious activity detected';
  return `${t} detected`;
}

async function fetchWithTimeout(url, ms = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r;
  } catch (e) { clearTimeout(t); throw e; }
}

async function pullModelAlerts() {
  try {
    const r = await fetchWithTimeout(MODEL_ALERTS_HISTORY_URL, 4000);
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d.alerts) && d.alerts.length) return d.alerts;
    }
  } catch (_) {}
  try {
    const r = await fetchWithTimeout(MODEL_ALERTS_URL, 2000);
    if (r.ok) { const d = await r.json(); return Array.isArray(d.alerts) ? d.alerts : []; }
  } catch (_) {}
  return [];
}

function mapModelAlertToDoc(a) {
  const externalId = a.external_id ||
    `${a.timestamp}_${a.threat_type}_${a.track_id ?? 'global'}`;
  const doc = {
    externalId,
    cameraId:       a.camera_id || DEFAULT_CAMERA_ID,
    threatType:     String(a.threat_type),
    severity:       severityForThreat(a.threat_type),
    message:        a.message || messageForThreat(a.threat_type),
    confidence:     typeof a.confidence === 'number' ? a.confidence : undefined,
    trackId:        typeof a.track_id   === 'number' ? a.track_id   : undefined,
    bbox:           Array.isArray(a.bbox) ? a.bbox.map(Number) : undefined,
    modelTimestamp: new Date(a.timestamp),
    status:         'Unresolved',
  };
  // Only keep screenshotPath if it exists (used for one-time disk migration)
  if (a.screenshot || a.screenshot_path) {
    doc.screenshotPath = a.screenshot || a.screenshot_path;
  }
  return doc;
}

async function upsertAlerts(docs) {
  if (!docs.length) return { upsertedCount: 0 };
  return Alert.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { externalId: doc.externalId },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    })),
    { ordered: false }
  ).catch((err) => { if (err.result) return err.result; throw err; });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/alerts/ingest
 * Called by the AI model on every new threat detection.
 * Receives alert metadata + base64-encoded JPEG → stores in MongoDB GridFS.
 * Auth: x-model-api-key header (no JWT needed from the model process).
 */
router.post('/ingest', async (req, res) => {
  // Validate shared secret
  const key = req.headers['x-model-api-key'];
  if (!MODEL_API_KEY || key !== MODEL_API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, error: 'Database not connected' });
  }

  const { alert: alertData, image_b64 } = req.body || {};
  if (!alertData || !alertData.threat_type || !alertData.timestamp) {
    return res.status(400).json({ success: false, error: 'Missing alert data' });
  }

  try {
    // 1. Store image in GridFS
    let imageId = null;
    if (image_b64) {
      try {
        const buf      = Buffer.from(image_b64, 'base64');
        const bucket   = getGridFSBucket();
        const filename = (alertData.filename ||
          `${alertData.timestamp}_${alertData.threat_type}.jpg`).replace(/[:/]/g, '_');
        imageId = await uploadToGridFS(bucket, buf, filename);
      } catch (e) {
        console.error('[GridFS] Image upload failed during ingest:', e.message);
      }
    }

    // 2. Build alert document
    const doc = mapModelAlertToDoc(alertData);
    delete doc.screenshotPath; // never store local paths for real-time alerts
    if (imageId) {
      doc.imageId       = imageId;
      doc.imageStoredAt = new Date();
    }

    // 3. Upsert — IMPORTANT: use $set for imageId so it always wins even if
    //    the JSONL metadata sync already created the doc without an imageId.
    const updateOp = {
      $setOnInsert: { ...doc, imageId: undefined, imageStoredAt: undefined },
    };
    if (imageId) {
      // Always overwrite imageId regardless of who created the doc first
      updateOp.$set = { imageId, imageStoredAt: new Date() };
      delete updateOp.$setOnInsert.imageId;
      delete updateOp.$setOnInsert.imageStoredAt;
    }

    const saved = await Alert.findOneAndUpdate(
      { externalId: doc.externalId },
      updateOp,
      { upsert: true, new: true, lean: true }
    );

    res.json({
      success: true,
      alertId: saved._id,
      imageId:  imageId ? imageId.toString() : null,
    });
  } catch (err) {
    console.error('[Ingest] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/alerts/image/:fileId
 * Stream an alert screenshot directly from MongoDB GridFS.
 * No auth required (ObjectId entropy ≈ 96-bit randomness).
 * 7-day immutable browser cache.
 */
router.get('/image/:fileId', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.fileId)) {
    return res.status(400).json({ error: 'Invalid file ID' });
  }
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database not connected' });
  }

  try {
    const oid    = new mongoose.Types.ObjectId(req.params.fileId);
    const bucket = getGridFSBucket();

    const fileMeta = await mongoose.connection.db
      .collection(`${GRIDFS_BUCKET}.files`)
      .findOne({ _id: oid });

    if (!fileMeta) return res.status(404).json({ error: 'Image not found' });

    res.set('Content-Type',   fileMeta.contentType || 'image/jpeg');
    res.set('Cache-Control',  'public, max-age=604800, immutable');
    res.set('Content-Length', fileMeta.length);
    bucket.openDownloadStream(oid).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/alerts
 * Returns all DB alerts. If Flask is running, syncs any new metadata from JSONL.
 * Also kicks off one-time disk→GridFS migration for old alerts.
 */
router.get('/', protect, async (req, res) => {
  try {
    // Try to pull any new alerts from the Flask JSONL (metadata only)
    let modelAlerts = [];
    try { modelAlerts = await pullModelAlerts(); } catch (_) {}

    if (mongoose.connection.readyState !== 1) {
      const fallback = modelAlerts
        .filter((a) => a && a.threat_type && a.timestamp)
        .map(mapModelAlertToDoc)
        .filter((d) => !Number.isNaN(d.modelTimestamp.getTime()))
        .sort((a, b) => b.modelTimestamp - a.modelTimestamp)
        .slice(0, 100);
      return res.json({ success: true, alerts: fallback, source: 'model' });
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

    // Background: migrate old disk screenshots → GridFS (one-time pass)
    setImmediate(() => migrateLocalImages(15).catch(() => {}));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/alerts/sync
 * Manual trigger: pulls JSONL metadata + migrates remaining disk images to GridFS.
 */
router.post('/sync', protect, authorize('admin', 'operator'), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'Database not connected' });
  }
  try {
    const modelAlerts = await pullModelAlerts();
    const docs = modelAlerts
      .filter((a) => a && a.threat_type && a.timestamp)
      .map(mapModelAlertToDoc)
      .filter((d) => !Number.isNaN(d.modelTimestamp.getTime()));

    let inserted = 0;
    if (docs.length) {
      const r = await upsertAlerts(docs);
      inserted = r.upsertedCount || 0;
    }

    // Migrate any remaining old disk screenshots
    const migration = await migrateLocalImages(50);

    res.json({
      success: true,
      synced:  docs.length,
      inserted,
      imagesStored: migration.stored,
      imagesSkipped: migration.skipped,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
      alert.status     = 'Resolved';
      alert.resolvedAt = new Date();
      alert.resolvedBy = req.user._id;
      await alert.save();
    }
    res.json({ success: true, alert });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
