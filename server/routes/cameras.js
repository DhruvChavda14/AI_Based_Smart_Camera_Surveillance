const express = require('express');
const router = express.Router();
const Camera = require('../models/Camera');

// Get all cameras
router.get('/', async (req, res) => {
  try {
    const cameras = await Camera.find({});
    res.json(cameras);
  } catch (error) {
    console.error('Error fetching cameras:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
