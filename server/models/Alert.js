const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    externalId: { type: String, required: true, unique: true, index: true },

    cameraId: { type: String, default: 'CAM-AI-01', index: true },
    threatType: { type: String, required: true, index: true },
    severity: { type: String, enum: ['Critical', 'Warning', 'Info'], default: 'Warning', index: true },
    message: { type: String, required: true },

    confidence: { type: Number, min: 0, max: 1 },
    trackId: { type: Number },
    bbox: { type: [Number], default: undefined }, // [x1,y1,x2,y2]

    // Original filesystem path (kept for reference / fallback)
    screenshotPath: { type: String },

    // GridFS image reference — once set, image is self-contained in MongoDB
    imageId:       { type: mongoose.Schema.Types.ObjectId, index: true },
    imageStoredAt: { type: Date },

    modelTimestamp: { type: Date, required: true, index: true },

    status: { type: String, enum: ['Unresolved', 'Resolved'], default: 'Unresolved', index: true },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    readAt: { type: Date },
    readBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Alert', alertSchema);
