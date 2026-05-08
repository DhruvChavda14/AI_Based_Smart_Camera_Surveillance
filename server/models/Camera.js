const mongoose = require('mongoose');

const cameraSchema = new mongoose.Schema({
  cameraId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  ip: { type: String, required: true },
  resolution: { type: String, default: '1080p' },
  status: { type: String, enum: ['Online', 'Offline'], default: 'Offline' },
  hasAlert: { type: Boolean, default: false },
  alertType: { type: String },
  lastCapture: { type: String, default: 'Just now' }
}, { timestamps: true });

module.exports = mongoose.model('Camera', cameraSchema);
