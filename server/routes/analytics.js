const express = require('express');
const router = express.Router();
const Alert = require('../models/Alert');

function isoHoursBack(hours) {
  const d = new Date(Date.now() - hours * 60 * 60 * 1000);
  return d;
}

// GET /api/analytics
// Derived metrics from Alerts collection (last 24h by default)
router.get('/', async (req, res) => {
  const hours = Math.min(168, Math.max(1, Number(req.query.hours || 24))); // clamp 1..168
  const since = isoHoursBack(hours);

  try {
    const [eventsByHour, incidentsByType, resolutionStatus] = await Promise.all([
      Alert.aggregate([
        { $match: { modelTimestamp: { $gte: since } } },
        {
          $group: {
            _id: {
              y: { $year: '$modelTimestamp' },
              m: { $month: '$modelTimestamp' },
              d: { $dayOfMonth: '$modelTimestamp' },
              h: { $hour: '$modelTimestamp' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.y': 1, '_id.m': 1, '_id.d': 1, '_id.h': 1 } },
      ]),

      Alert.aggregate([
        { $match: { modelTimestamp: { $gte: since } } },
        { $group: { _id: '$threatType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 12 },
      ]),

      Alert.aggregate([
        { $match: { modelTimestamp: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const statusCounts = { Resolved: 0, Unresolved: 0, Investigating: 0 };
    for (const row of resolutionStatus) {
      const k = row?._id;
      if (k && Object.prototype.hasOwnProperty.call(statusCounts, k)) statusCounts[k] = row.count;
    }

    res.json({
      success: true,
      since: since.toISOString(),
      hours,
      eventsByHour: eventsByHour.map((r) => ({
        y: r._id.y,
        m: r._id.m,
        d: r._id.d,
        h: r._id.h,
        count: r.count,
      })),
      incidentsByType: incidentsByType.map((r) => ({ type: r._id || 'UNKNOWN', count: r.count })),
      resolutionStatus: statusCounts,
      total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    });
  } catch (error) {
    // If DB is down, return empty-safe payload so UI doesn't break.
    res.json({
      success: false,
      since: since.toISOString(),
      hours,
      eventsByHour: [],
      incidentsByType: [],
      resolutionStatus: { Resolved: 0, Unresolved: 0, Investigating: 0 },
      total: 0,
      message: error.message,
    });
  }
});

module.exports = router;

