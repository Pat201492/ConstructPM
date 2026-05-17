/**
 * Location Model
 * 
 * Locations are job sites. One location can have multiple projects.
 * Local union is tied to geography (manually entered per location).
 * Miles from HQ auto-calculated via Google Maps Distance Matrix API when:
 *   - A location is created with an address
 *   - A location's address is updated
 *   - Requires: GOOGLE_MAPS_API_KEY env var + home_location_address global variable
 *   - If API key missing or call fails, user enters miles manually
 */

const db = require('../config/database');

const Location = {
  async findAll({ search, local_union, active, limit = 100, offset = 0 } = {}) {
    const query = db('locations')
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset);

    if (active !== undefined) query.where('active', active);
    if (local_union) query.where('local_union', local_union);
    if (search) query.where(function () {
      this.where('name', 'ilike', `%${search}%`)
        .orWhere('display_address', 'ilike', `%${search}%`)
        .orWhere('town', 'ilike', `%${search}%`);
    });

    const locations = await query;
    const [{ count }] = await db('locations').count('* as count');
    return { locations, total: parseInt(count, 10) };
  },

  async findById(id) {
    return db('locations').where({ id }).first();
  },

  async create(data) {
    // Auto-generate display address
    data.display_address = this._buildDisplayAddress(data);

    // Auto-calculate miles from HQ via Google Maps
    if (data.street || data.town) {
      const miles = await this._calculateMilesFromHQ(data);
      if (miles !== null) {
        data.miles_from_hq = miles;
      }
    }

    const [location] = await db('locations').insert(data).returning('*');
    return location;
  },

  async update(id, data) {
    if (data.street || data.town || data.state) {
      const existing = await this.findById(id);
      const merged = { ...existing, ...data };
      data.display_address = this._buildDisplayAddress(merged);

      // Recalculate miles if address changed
      const addressChanged = (data.street && data.street !== existing.street)
        || (data.town && data.town !== existing.town)
        || (data.state && data.state !== existing.state);

      if (addressChanged) {
        const miles = await this._calculateMilesFromHQ(merged);
        if (miles !== null) {
          data.miles_from_hq = miles;
        }
      }
    }

    const [location] = await db('locations')
      .where({ id })
      .update({ ...data, updated_at: db.fn.now() })
      .returning('*');
    return location;
  },

  async getUnionLocals() {
    const rows = await db('locations')
      .distinct('local_union')
      .whereNotNull('local_union')
      .orderBy('local_union');
    return rows.map(r => r.local_union);
  },

  _buildDisplayAddress({ street, town, state, zip }) {
    // Include zip — Pat asked for the project detail pop-up's address to
    // surface the zip. display_address is the canonical "human-readable
    // location string" used everywhere a location is shown, so the change
    // propagates: projects list Address column, project detail header,
    // project edit pop-up, calendar tooltips, etc.
    const cityStateZip = [town, state].filter(Boolean).join(', ');
    const tail = [cityStateZip, zip].filter(Boolean).join(' ');
    return [street, tail].filter(Boolean).join(', ');
  },

  /**
   * Calculate driving distance in miles from company HQ to the location.
   * Uses Google Maps Distance Matrix API.
   * 
   * Requires:
   *   - GOOGLE_MAPS_API_KEY env var
   *   - home_location_address global variable (set in Admin → Global Variables)
   * 
   * Returns miles (number) or null if cannot calculate.
   */
  async _calculateMilesFromHQ(locationData) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.log('[Location] GOOGLE_MAPS_API_KEY not set — skipping miles calculation');
      return null;
    }

    // Get HQ address from global variables
    const GlobalVariable = require('./GlobalVariable');
    const homeAddress = await GlobalVariable.get('home_location_address');
    if (!homeAddress) {
      console.log('[Location] home_location_address not set in global variables — skipping miles calculation');
      return null;
    }

    // Build destination address
    const destAddress = this._buildDisplayAddress(locationData);
    if (!destAddress || destAddress.length < 3) {
      console.log('[Location] Destination address too short — skipping miles calculation');
      return null;
    }

    try {
      // Google Routes API (new — replaces legacy Distance Matrix)
      const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: { address: homeAddress },
          destination: { address: destAddress },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          units: 'IMPERIAL',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[Location] Routes API HTTP ${response.status}: ${errText.substring(0, 200)}`);
        return null;
      }

      const data = await response.json();

      if (!data.routes || data.routes.length === 0) {
        console.error('[Location] Routes API: no route found');
        return null;
      }

      const meters = data.routes[0].distanceMeters;
      const miles = Math.round(meters / 1609.344 * 10) / 10;

      console.log(`[Location] Distance: ${homeAddress} → ${destAddress} = ${miles} miles`);
      return miles;
    } catch (err) {
      console.error('[Location] Google Maps API error:', err.message);
      return null;
    }
  },

  /**
   * Manually trigger miles recalculation for a location.
   * Called from the API if user wants to refresh the distance.
   */
  async recalculateMiles(id) {
    const location = await this.findById(id);
    if (!location) return null;

    const miles = await this._calculateMilesFromHQ(location);
    if (miles !== null) {
      const [updated] = await db('locations').where({ id })
        .update({ miles_from_hq: miles, updated_at: db.fn.now() })
        .returning('*');
      return updated;
    }
    return location;
  },
};

module.exports = Location;
