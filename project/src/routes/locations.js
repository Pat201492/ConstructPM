/**
 * Location Routes
 * 
 * Locations are job sites with addresses, local union, and miles from HQ.
 * Auto-saved when PM types a new location during bid creation.
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const Location = require('../models/Location');

const router = express.Router();
router.use(authenticate);

// GET /api/locations — list all locations
router.get('/', authorize('bids:read'), async (req, res, next) => {
  try {
    const { search, local_union, active, limit, offset } = req.query;
    const result = await Location.findAll({
      search, local_union,
      active: active !== undefined ? active === 'true' : undefined,
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/locations/unions — distinct local union list (for dropdowns)
router.get('/unions', authorize('bids:read'), async (req, res, next) => {
  try {
    const unions = await Location.getUnionLocals();
    res.json({ unions });
  } catch (err) { next(err); }
});

// GET /api/locations/:id — get by ID
router.get('/:id', authorize('bids:read'), async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id);
    if (!location) return res.status(404).json({ error: 'Location not found' });
    res.json(location);
  } catch (err) { next(err); }
});

// POST /api/locations — create (also used by auto-save during bid creation)
router.post('/',
  authorize('bids:create'),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
  ],
  async (req, res, next) => {
    try {
      const { name, street, town, state, zip, local_union, miles_from_hq, latitude, longitude, location_code } = req.body;
      const location = await Location.create({
        name, street, town, state, zip, local_union,
        location_code: location_code || null,
        miles_from_hq: miles_from_hq || null,
        latitude: latitude || null,
        longitude: longitude || null,
      });
      res.status(201).json(location);
    } catch (err) { next(err); }
  }
);

// PATCH /api/locations/:id — update
router.patch('/:id', authorize('bids:create'), async (req, res, next) => {
  try {
    const allowed = ['name', 'street', 'town', 'state', 'zip', 'local_union', 'location_code', 'miles_from_hq', 'latitude', 'longitude', 'active'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const location = await Location.update(req.params.id, data);
    if (!location) return res.status(404).json({ error: 'Location not found' });
    res.json(location);
  } catch (err) { next(err); }
});

// POST /api/locations/:id/recalculate-miles — re-fetch distance from Google Maps
router.post('/:id/recalculate-miles', authorize('bids:create'), async (req, res, next) => {
  try {
    const location = await Location.recalculateMiles(req.params.id);
    if (!location) return res.status(404).json({ error: 'Location not found' });
    res.json({ location, miles_from_hq: location.miles_from_hq });
  } catch (err) { next(err); }
});

module.exports = router;
