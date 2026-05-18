/**
 * Seed: Test data for development and demo purposes.
 * 
 * Creates realistic construction industry data:
 *   - 4 users (PM, accounting, shop, field)
 *   - 6 customers with contacts
 *   - 8 locations across NJ/NY/PA
 *   - Rate sheet for 3 union locals
 *   - 10 bids (mix of draft, submitted, won, lost)
 *   - 4 active projects with financials
 *   - Equipment inventory (15 items)
 *   - Timesheets, invoices, POs
 * 
 * Run: npx knex seed:run --specific=002_test_data.js
 * Safe to run multiple times — checks for existing data.
 */

const bcrypt = require('bcryptjs');

exports.seed = async function (knex) {
  // Skip if test data already exists
  const existingCustomers = await knex('customers').count('* as cnt').first();
  if (parseInt(existingCustomers.cnt) > 0) {
    console.log('Test data already exists, skipping.');
    return;
  }

  console.log('Seeding test data...');
  const pw = await bcrypt.hash('ChangeMe123!', 12);

  // ═══════════════════════════════════════════════════════════
  // USERS
  // ═══════════════════════════════════════════════════════════
  const admin = await knex('users').where('email', 'admin@company.com').first();
  const adminId = admin?.id;

  const [pmMike] = await knex('users').insert({
    email: 'mike.torres@company.com', password_hash: pw,
    first_name: 'Mike', last_name: 'Torres', initials: 'MT', pm_code: 'M',
    role: 'project_manager', active: true, default_markup_pct: 18,
  }).returning('*');

  const [pmSarah] = await knex('users').insert({
    email: 'sarah.chen@company.com', password_hash: pw,
    first_name: 'Sarah', last_name: 'Chen', initials: 'SC', pm_code: 'S',
    role: 'project_manager', active: true, default_markup_pct: 15,
  }).returning('*');

  const [estimatorAlex] = await knex('users').insert({
    email: 'alex.kim@company.com', password_hash: pw,
    first_name: 'Alex', last_name: 'Kim', initials: 'AK',
    role: 'estimator', active: true, default_markup_pct: 18,
  }).returning('*');

  const [acctJen] = await knex('users').insert({
    email: 'jennifer.russo@company.com', password_hash: pw,
    first_name: 'Jennifer', last_name: 'Russo', initials: 'JR',
    role: 'accounting', active: true,
  }).returning('*');

  const [shopRay] = await knex('users').insert({
    email: 'ray.jackson@company.com', password_hash: pw,
    first_name: 'Ray', last_name: 'Jackson', initials: 'RJ',
    role: 'shop_staff', active: true,
  }).returning('*');

  const [fieldCarlos] = await knex('users').insert({
    email: 'carlos.mendez@company.com', password_hash: pw,
    first_name: 'Carlos', last_name: 'Mendez', initials: 'CM',
    role: 'field_staff', active: true,
  }).returning('*');

  const [fieldDanny] = await knex('users').insert({
    email: 'danny.oconnor@company.com', password_hash: pw,
    first_name: 'Danny', last_name: "O'Connor", initials: 'DO',
    role: 'field_staff', active: true,
  }).returning('*');

  const [fieldTyrell] = await knex('users').insert({
    email: 'tyrell.brooks@company.com', password_hash: pw,
    first_name: 'Tyrell', last_name: 'Brooks', initials: 'TB',
    role: 'field_staff', active: true, on_schedule: true,
  }).returning('*');

  // Five more field staff so the scheduler grid has enough bodies to
  // demonstrate row layout, multi-project assignments, and the
  // simplified/extended toggle. All are on_schedule by default per the
  // role config (field_staff defaults true), but set explicitly here so
  // the seed isn't load-bearing on the migration order.
  const [fieldRamon] = await knex('users').insert({
    email: 'ramon.alvarez@company.com', password_hash: pw,
    first_name: 'Ramon', last_name: 'Alvarez', initials: 'RA',
    role: 'field_staff', active: true, on_schedule: true,
  }).returning('*');

  const [fieldAnthony] = await knex('users').insert({
    email: 'anthony.demarco@company.com', password_hash: pw,
    first_name: 'Anthony', last_name: 'DeMarco', initials: 'AD',
    role: 'field_staff', active: true, on_schedule: true,
  }).returning('*');

  const [fieldMarcus] = await knex('users').insert({
    email: 'marcus.washington@company.com', password_hash: pw,
    first_name: 'Marcus', last_name: 'Washington', initials: 'MW',
    role: 'field_staff', active: true, on_schedule: true,
  }).returning('*');

  const [fieldKevin] = await knex('users').insert({
    email: 'kevin.flaherty@company.com', password_hash: pw,
    first_name: 'Kevin', last_name: 'Flaherty', initials: 'KF',
    role: 'field_staff', active: true, on_schedule: true,
  }).returning('*');

  const [fieldJamal] = await knex('users').insert({
    email: 'jamal.thompson@company.com', password_hash: pw,
    first_name: 'Jamal', last_name: 'Thompson', initials: 'JT',
    role: 'field_staff', active: true, on_schedule: true,
  }).returning('*');

  // Pat wanted to see the scheduler with a real crew loaded — 80 extra
  // field staff so the By-Worker grid scrolls and the sort/extend modes
  // earn their keep. Names pulled from two fixed pools so the same seed
  // run always produces the same emails (no surprise duplicates if it
  // re-runs against a stale DB).
  const bulkFirst = [
    'Aaron','Adrian','Alberto','Andre','Antonio','Arturo','Benji','Brandon','Brian','Caleb',
    'Carlos','Charlie','Chris','Damian','Daniel','Darius','Derek','Diego','Dimitri','Eddie',
    'Eduardo','Eli','Emanuel','Enrique','Eric','Ernesto','Felix','Francisco','Frank','Gabriel',
    'Gerald','Gilbert','Gus','Hank','Hector','Henry','Hugo','Isaac','Jaden','Javier',
    'Jermaine','Jesus','Joaquin','Joel','Jonas','Jorge','Jose','Julian','Kareem','Keenan',
    'Kendrick','Khalid','Lamar','Leon','Leroy','Lewis','Luis','Malik','Manuel','Marco',
    'Mario','Martin','Matthew','Mauricio','Miguel','Nelson','Nicolas','Omar','Orlando','Pablo',
    'Pedro','Quincy','Rafael','Ramiro','Raul','Reggie','Ricardo','Roberto','Salvador','Terrence',
  ];
  const bulkLast = [
    'Adams','Aguilar','Alvarez','Bailey','Barker','Barrera','Bishop','Blackburn','Bowen','Bryant',
    'Burgess','Cabrera','Calderon','Campos','Cardenas','Casey','Castaneda','Castillo','Cervantes','Chen',
    'Cisneros','Conway','Cortez','Crawford','Cuevas','Daniels','Davis','Delgado','Diaz','Donovan',
    'Dyer','Eaton','Elder','Espinoza','Estrada','Farley','Fernandez','Figueroa','Flores','Fowler',
    'Franco','Galindo','Galvan','Garcia','Gibson','Gomez','Gonzalez','Graves','Guerrero','Gutierrez',
    'Hammond','Hardin','Harvey','Hayes','Hernandez','Herrera','Howell','Ibarra','Jensen','Johnston',
    'Kane','Keller','Kelley','Lara','Leon','Levy','Lopez','Lozano','Macias','Madison',
    'Maldonado','Marshall','Martinez','Medina','Mejia','Mendoza','Molina','Montano','Morales','Munoz',
  ];
  const bulkRows = [];
  for (let i = 0; i < 80; i++) {
    const fn = bulkFirst[i % bulkFirst.length];
    const ln = bulkLast[(i * 7) % bulkLast.length];
    const slug = `${fn}.${ln}.${i+1}`.toLowerCase();
    bulkRows.push({
      email: `${slug}@company.com`,
      password_hash: pw,
      first_name: fn,
      last_name: ln,
      initials: (fn[0] + ln[0]).toUpperCase(),
      role: 'field_staff',
      active: true,
      on_schedule: true,
    });
  }
  await knex('users').insert(bulkRows);

  console.log(`  ✅ ${13 + bulkRows.length} users created (all password: ChangeMe123!)`);

  // ═══════════════════════════════════════════════════════════
  // CUSTOMERS
  // ═══════════════════════════════════════════════════════════
  const customers = await knex('customers').insert([
    { name: 'Turner Construction', billing_street: '375 Hudson St', billing_town: 'New York', billing_state: 'NY', billing_zip: '10014' },
    { name: 'Skanska USA', billing_street: '1 World Trade Center, 72nd Floor', billing_town: 'New York', billing_state: 'NY', billing_zip: '10007' },
    { name: 'Gilbane Building Company', billing_street: '7 Jackson Walkway', billing_town: 'Providence', billing_state: 'RI', billing_zip: '02903' },
    { name: 'Toll Brothers', billing_street: '1140 Virginia Dr', billing_town: 'Fort Washington', billing_state: 'PA', billing_zip: '19034' },
    { name: 'Plaza Construction', billing_street: '460 W 34th St', billing_town: 'New York', billing_state: 'NY', billing_zip: '10001' },
    { name: 'Torcon Inc', billing_street: '328 Newman Springs Rd', billing_town: 'Red Bank', billing_state: 'NJ', billing_zip: '07701' },
  ]).returning('*');
  console.log('  ✅ 6 customers');

  // ═══════════════════════════════════════════════════════════
  // CONTACTS
  // ═══════════════════════════════════════════════════════════
  await knex('contacts').insert([
    { customer_id: customers[0].id, name: 'Dave Morrison', email: 'dmorrison@turner.com', phone: '212-555-0101', company: 'Turner Construction' },
    { customer_id: customers[0].id, name: 'Lisa Park', email: 'lpark@turner.com', phone: '212-555-0102', company: 'Turner Construction' },
    { customer_id: customers[1].id, name: 'Erik Johansson', email: 'ejohansson@skanska.com', phone: '212-555-0201', company: 'Skanska USA' },
    { customer_id: customers[2].id, name: 'Megan Gilbane', email: 'mgilbane@gilbane.com', phone: '401-555-0301', company: 'Gilbane Building' },
    { customer_id: customers[3].id, name: 'Robert Toll', email: 'rtoll@tollbros.com', phone: '215-555-0401', company: 'Toll Brothers' },
    { customer_id: customers[4].id, name: 'Anthony Plaza', email: 'aplaza@plazaconstruction.com', phone: '212-555-0501', company: 'Plaza Construction' },
    { customer_id: customers[5].id, name: 'Frank Torcon', email: 'ftorcon@torcon.com', phone: '732-555-0601', company: 'Torcon Inc' },
  ]);
  console.log('  ✅ 7 contacts');

  // ═══════════════════════════════════════════════════════════
  // LOCATIONS
  // ═══════════════════════════════════════════════════════════
  const locations = await knex('locations').insert([
    { name: 'Newark Office Complex', location_code: '1308', street: '1 Gateway Center', town: 'Newark', state: 'NJ', zip: '07102', local_union: 'Local 164', miles_from_hq: 12.5 },
    { name: 'Jersey City Waterfront', location_code: '1342', street: '30 Hudson St', town: 'Jersey City', state: 'NJ', zip: '07302', local_union: 'Local 164', miles_from_hq: 18.3 },
    { name: 'Manhattan Midtown', location_code: '0301', street: '350 5th Ave', town: 'New York', state: 'NY', zip: '10118', local_union: 'Local 3', miles_from_hq: 25.0 },
    { name: 'Brooklyn Navy Yard', location_code: '0312', street: '63 Flushing Ave', town: 'Brooklyn', state: 'NY', zip: '11205', local_union: 'Local 3', miles_from_hq: 30.2 },
    { name: 'Trenton State Complex', location_code: '2691', street: '225 W State St', town: 'Trenton', state: 'NJ', zip: '08608', local_union: 'Local 269', miles_from_hq: 55.0 },
    { name: 'Edison Warehouse District', location_code: '1420', street: '100 Raritan Center Pkwy', town: 'Edison', state: 'NJ', zip: '08837', local_union: 'Local 164', miles_from_hq: 22.0 },
    { name: 'Hoboken Terminal', location_code: '1330', street: '1 Hudson Pl', town: 'Hoboken', state: 'NJ', zip: '07030', local_union: 'Local 164', miles_from_hq: 15.8 },
    { name: 'Philadelphia Center City', location_code: '0985', street: '1500 Market St', town: 'Philadelphia', state: 'PA', zip: '19102', local_union: 'Local 98', miles_from_hq: 85.0 },
  ]).returning('*');
  console.log('  ✅ 8 locations (with location_codes)');

  // ═══════════════════════════════════════════════════════════
  // RATE SHEET
  // ═══════════════════════════════════════════════════════════
  await knex('rate_sheet').insert([
    // Local 164 (NJ)
    { local_union: 'Local 164', classification: 'Foreman', st_rate: 95.50, ot_rate: 143.25, dt_rate: 191.00 },
    { local_union: 'Local 164', classification: 'Journeyman', st_rate: 82.00, ot_rate: 123.00, dt_rate: 164.00 },
    { local_union: 'Local 164', classification: 'Apprentice 5th Year', st_rate: 68.75, ot_rate: 103.13, dt_rate: 137.50 },
    { local_union: 'Local 164', classification: 'Apprentice 3rd Year', st_rate: 55.00, ot_rate: 82.50, dt_rate: 110.00 },
    // Local 3 (NYC)
    { local_union: 'Local 3', classification: 'Foreman', st_rate: 115.00, ot_rate: 172.50, dt_rate: 230.00 },
    { local_union: 'Local 3', classification: 'Journeyman', st_rate: 98.50, ot_rate: 147.75, dt_rate: 197.00 },
    { local_union: 'Local 3', classification: 'Apprentice 5th Year', st_rate: 78.00, ot_rate: 117.00, dt_rate: 156.00 },
    // Local 269 (Central NJ)
    { local_union: 'Local 269', classification: 'Foreman', st_rate: 88.00, ot_rate: 132.00, dt_rate: 176.00 },
    { local_union: 'Local 269', classification: 'Journeyman', st_rate: 76.50, ot_rate: 114.75, dt_rate: 153.00 },
    { local_union: 'Local 269', classification: 'Apprentice 5th Year', st_rate: 62.00, ot_rate: 93.00, dt_rate: 124.00 },
    // Local 98 (Philly)
    { local_union: 'Local 98', classification: 'Foreman', st_rate: 92.00, ot_rate: 138.00, dt_rate: 184.00 },
    { local_union: 'Local 98', classification: 'Journeyman', st_rate: 79.50, ot_rate: 119.25, dt_rate: 159.00 },
  ]);
  console.log('  ✅ 12 rate sheet entries (4 locals)');

  // ═══════════════════════════════════════════════════════════
  // BIDS (10 — mix of statuses)
  // ═══════════════════════════════════════════════════════════
  const bids = await knex('bids').insert([
    // Won bids (will create projects)
    { bid_number: '26-MT-001', customer_id: customers[0].id, location_id: locations[0].id, estimator_id: pmMike.id,
      project_scope: 'Office Renovation — 3rd Floor Electrical', status: 'won', local_union: 'Local 164', miles_from_hq: 12.5,
      markup_pct: 18, project_length_days: 45, total_labor_cost: 185000, total_mileage_cost: 4200, subtotal: 189200, bid_amount: 223256,
      bid_date: '2026-01-15', won_date: '2026-02-01' },
    { bid_number: '26-MT-002', customer_id: customers[1].id, location_id: locations[2].id, estimator_id: pmMike.id,
      project_scope: 'Data Center Power Distribution', status: 'won', local_union: 'Local 3', miles_from_hq: 25.0,
      markup_pct: 15, project_length_days: 90, total_labor_cost: 420000, total_mileage_cost: 15800, subtotal: 435800, bid_amount: 501170,
      bid_date: '2026-01-22', won_date: '2026-02-15' },
    { bid_number: '26-SC-001', customer_id: customers[5].id, location_id: locations[1].id, estimator_id: pmSarah.id,
      project_scope: 'Waterfront Condo Fire Alarm System', status: 'won', local_union: 'Local 164', miles_from_hq: 18.3,
      markup_pct: 15, project_length_days: 60, total_labor_cost: 142000, total_mileage_cost: 5500, subtotal: 147500, bid_amount: 169625,
      bid_date: '2026-02-05', won_date: '2026-02-20' },
    { bid_number: '26-SC-002', customer_id: customers[2].id, location_id: locations[4].id, estimator_id: pmSarah.id,
      project_scope: 'State Building Emergency Generator', status: 'won', local_union: 'Local 269', miles_from_hq: 55.0,
      markup_pct: 20, project_length_days: 30, total_labor_cost: 68000, total_mileage_cost: 6600, subtotal: 74600, bid_amount: 89520,
      bid_date: '2026-02-10', won_date: '2026-03-01' },
    // Draft bids
    { bid_number: '26-MT-003', customer_id: customers[3].id, location_id: locations[5].id, estimator_id: pmMike.id,
      project_scope: 'Warehouse LED Lighting Retrofit', status: 'draft', local_union: 'Local 164', miles_from_hq: 22.0,
      markup_pct: 18, project_length_days: 20, bid_date: '2026-03-10' },
    { bid_number: '26-SC-003', customer_id: customers[4].id, location_id: locations[6].id, estimator_id: pmSarah.id,
      project_scope: 'Transit Hub Electrical Upgrade', status: 'draft', local_union: 'Local 164', miles_from_hq: 15.8,
      markup_pct: 15, project_length_days: 75, bid_date: '2026-03-15' },
    // Submitted
    { bid_number: '26-MT-004', customer_id: customers[0].id, location_id: locations[3].id, estimator_id: pmMike.id,
      project_scope: 'Navy Yard Building 77 Renovation', status: 'submitted', local_union: 'Local 3', miles_from_hq: 30.2,
      markup_pct: 15, project_length_days: 120, total_labor_cost: 580000, total_mileage_cost: 28900, subtotal: 608900, bid_amount: 700235,
      bid_date: '2026-03-01' },
    { bid_number: '26-SC-004', customer_id: customers[3].id, location_id: locations[7].id, estimator_id: pmSarah.id,
      project_scope: 'Luxury Townhome Electrical Package', status: 'submitted', local_union: 'Local 98', miles_from_hq: 85.0,
      markup_pct: 20, project_length_days: 40, total_labor_cost: 95000, total_mileage_cost: 13600, subtotal: 108600, bid_amount: 130320,
      bid_date: '2026-03-05' },
    // Lost
    { bid_number: '26-MT-005', customer_id: customers[4].id, location_id: locations[2].id, estimator_id: pmMike.id,
      project_scope: 'High-Rise HVAC Controls', status: 'lost', local_union: 'Local 3', miles_from_hq: 25.0,
      markup_pct: 15, bid_date: '2026-01-10' },
    // Archived
    { bid_number: '26-SC-005', customer_id: customers[5].id, location_id: locations[0].id, estimator_id: pmSarah.id,
      project_scope: 'Parking Garage Lighting', status: 'archived', local_union: 'Local 164', miles_from_hq: 12.5,
      markup_pct: 15, bid_date: '2025-11-01', archived_date: '2025-12-15' },
  ]).returning('*');
  console.log('  ✅ 10 bids');

  // ═══════════════════════════════════════════════════════════
  // QUOTE LINES (for won + submitted bids)
  // ═══════════════════════════════════════════════════════════
  const quoteBids = bids.filter(b => ['won', 'submitted'].includes(b.status));
  for (const bid of quoteBids) {
    await knex('bid_quote_lines').insert([
      { bid_id: bid.id, classification: 'Foreman', personnel: 1, st_hours: 8, ot_hours: 2, dt_hours: 0, total_st_hours: 8, total_ot_hours: 2, total_dt_hours: 0,
        st_rate: 95.50, ot_rate: 143.25, dt_rate: 191.00 },
      { bid_id: bid.id, classification: 'Journeyman', personnel: 3, st_hours: 8, ot_hours: 2, dt_hours: 0, total_st_hours: 24, total_ot_hours: 6, total_dt_hours: 0,
        st_rate: 82.00, ot_rate: 123.00, dt_rate: 164.00 },
      { bid_id: bid.id, classification: 'Apprentice 5th Year', personnel: 2, st_hours: 8, ot_hours: 0, dt_hours: 0, total_st_hours: 16, total_ot_hours: 0, total_dt_hours: 0,
        st_rate: 68.75, ot_rate: 103.13, dt_rate: 137.50 },
    ]);
  }
  console.log('  ✅ Quote lines for ' + quoteBids.length + ' bids');

  // ═══════════════════════════════════════════════════════════
  // PROJECTS (from won bids)
  // ═══════════════════════════════════════════════════════════
  const wonBids = bids.filter(b => b.status === 'won');
  const projects = [];
  // Track per-PM-per-location-per-year counters for the new structured format
  const structuredCounters = {}; // key: `${pmCode}|${locCode}|${year}` → count
  for (const bid of wonBids) {
    const cust = customers.find(c => c.id === bid.customer_id);
    const loc = locations.find(l => l.id === bid.location_id);
    const pm = [pmMike, pmSarah].find(u => u.id === bid.estimator_id);
    const [proj] = await knex('projects').insert({
      name: bid.project_scope.substring(0, 60),
      year: 2026,
      customer_id: bid.customer_id,
      location_id: bid.location_id,
      pm_id: bid.estimator_id,
      bid_id: bid.id,
      status: 'active',
      contract_value: bid.bid_amount,
      contract_type: bid === wonBids[0] ? 'contract' : 't_and_m',
      payment_terms: 'Net 30',
      local_union: bid.local_union,
      miles_from_hq: bid.miles_from_hq,
      address: loc?.street + ', ' + loc?.town + ', ' + loc?.state,
    }).returning('*');
    projects.push(proj);

    // PRIMARY project number — structured format (J26-1308.8)
    // This is the foreman-facing number and the one displayed everywhere.
    if (pm.pm_code && loc?.location_code) {
      const yearShort = String(proj.year).slice(-2);
      const counterKey = `${pm.pm_code}|${loc.location_code}|${yearShort}`;
      structuredCounters[counterKey] = (structuredCounters[counterKey] || 0) + 1;
      const seq = structuredCounters[counterKey];
      const structuredNumber = `${pm.pm_code}${yearShort}-${loc.location_code}.${seq}`;
      await knex('project_numbers').insert({
        project_id: proj.id,
        number: structuredNumber,
        label: 'Primary',
      });
    }

    // Supplement Project Number (SPN) — legacy internal accounting number,
    // kept as a secondary identifier for projects that crossed over from older
    // systems. New projects don't necessarily need SPNs.
    await knex('project_numbers').insert({
      project_id: proj.id,
      number: `2026-${pm.initials}-${String(projects.length).padStart(3, '0')}`,
      label: 'SPN',
    });
  }
  console.log('  ✅ ' + projects.length + ' projects (with structured numbers e.g. M26-1308.1)');

  // ═══════════════════════════════════════════════════════════
  // SCHEDULED PROJECTS — for the Schedule + Scheduler tabs
  // ═══════════════════════════════════════════════════════════
  // Two extra projects with explicit start_date + project_length_days set
  // so the calendar populates immediately on a fresh seed. Not tied to
  // bids — direct inserts. PMs split between Mike and Sarah so each can
  // see at least one project on their dashboard.

  const [proj511] = await knex('projects').insert({
    name: 'Substation Switchgear Upgrade — Phase 1',
    year: 2026,
    customer_id: customers[0].id,
    location_id: locations[0].id,
    pm_id: pmMike.id,
    status: 'active',
    contract_value: 184500,
    contract_type: 'contract',
    payment_terms: 'Net 30',
    local_union: locations[0].local_union,
    miles_from_hq: locations[0].miles_from_hq || 18,
    address: locations[0].street + ', ' + locations[0].town + ', ' + locations[0].state,
    description: 'Replace 480V switchgear lineup, including breakers and bus bar.',
    start_date: '2026-05-11',
    project_length_days: 4,   // working days — Mon-Thu of week 1
    manpower: 5,
    fully_staffed: false,
  }).returning('*');
  await knex('project_numbers').insert([
    { project_id: proj511.id, number: `M26-${locations[0].location_code || '1308'}.99`, label: 'Primary' },
    { project_id: proj511.id, number: '2026-MT-098', label: 'SPN' },
  ]);

  const [proj512] = await knex('projects').insert({
    name: 'Hospital Wing C — Lighting + Receptacle Rough',
    year: 2026,
    customer_id: customers[customers.length > 1 ? 1 : 0].id,
    location_id: locations[locations.length > 1 ? 1 : 0].id,
    pm_id: pmSarah.id,
    status: 'active',
    contract_value: 412000,
    contract_type: 't_and_m',
    payment_terms: 'Net 45',
    local_union: locations[locations.length > 1 ? 1 : 0].local_union,
    miles_from_hq: locations[locations.length > 1 ? 1 : 0].miles_from_hq || 32,
    address: locations[locations.length > 1 ? 1 : 0].street + ', ' + locations[locations.length > 1 ? 1 : 0].town + ', ' + locations[locations.length > 1 ? 1 : 0].state,
    description: 'Rough-in lighting and receptacles for new hospital wing C.',
    start_date: '2026-05-12',
    project_length_days: 12,  // working days — ~2.5 weeks M-F
    manpower: 8,
    fully_staffed: false,
  }).returning('*');
  await knex('project_numbers').insert([
    { project_id: proj512.id, number: `S26-${(locations[locations.length > 1 ? 1 : 0].location_code) || '2204'}.99`, label: 'Primary' },
    { project_id: proj512.id, number: '2026-SC-099', label: 'SPN' },
  ]);

  // Push them into the projects array so any later code that iterates
  // (timesheets, equipment, field notes) can reference them if needed.
  projects.push(proj511, proj512);
  console.log('  ✅ 2 scheduled projects added (start 5/11 × 4d, 5/12 × 12d)');

  // ═══════════════════════════════════════════════════════════
  // TIMESHEETS (realistic daily entries)
  // ═══════════════════════════════════════════════════════════
  const workers = ['Joe Martino', 'Phil DeLuca', 'Anthony Rizzo', 'Marcus Williams', 'Danny Kim', 'Steve Novak'];
  const classifications = ['Foreman', 'Journeyman', 'Journeyman', 'Journeyman', 'Apprentice 5th Year', 'Apprentice 5th Year'];
  const rates = {
    'Foreman':             { st: 95.50, ot: 143.25, dt: 191.00 },
    'Journeyman':          { st: 82.00, ot: 123.00, dt: 164.00 },
    'Apprentice 5th Year': { st: 68.75, ot: 103.13, dt: 137.50 },
  };

  for (const proj of projects) {
    const miles = parseFloat(proj.miles_from_hq) || 0;
    const dailyMilesRT = miles * 2;
    const perDiemRate = miles > 50 ? 75.00 : 0; // Per diem if job is 50+ miles away

    // 3 weekly timesheets per project, week-ending dates anchored to
    // March 2026 so they're predictable in seeded data. The Active Projects
    // page lets users select which week to view, so static dates are fine.
    for (let week = 0; week < 3; week++) {
      const weekEnding = new Date(2026, 2, 6 + week * 7); // March 6, 13, 20
      const weekEndStr = weekEnding.toISOString().split('T')[0];
      const days = ['Mon','Tue','Wed','Thu','Fri'];

      // 4 workers per week
      for (let w = 0; w < 4; w++) {
        const cls = classifications[w];
        const r = rates[cls];

        // Build daily breakdown
        const daily = days.map((day, di) => {
          const hrs = 8;
          const ot = (week < 2 && di < 4 && Math.random() > 0.5) ? 2 : 0;
          return { day, hours: hrs, ot, miles: dailyMilesRT };
        });

        const stHrs = daily.reduce((s, d) => s + d.hours, 0);
        const otHrs = daily.reduce((s, d) => s + d.ot, 0);
        const daysWorked = daily.length;
        const weeklyMiles = daily.reduce((s, d) => s + d.miles, 0);
        const mileageCost = weeklyMiles * 0.67;
        const revenue = (stHrs * r.st) + (otHrs * r.ot);
        const perDiemTotal = perDiemRate * daysWorked;

        await knex('timesheets').insert({
          project_id: proj.id,
          worker_name: workers[w],
          classification: cls,
          local_union: proj.local_union,
          work_date: weekEndStr,
          week_ending: weekEndStr,
          days_worked: daysWorked,
          st_hours: stHrs,
          ot_hours: otHrs,
          dt_hours: 0,
          billing_rate_st: r.st,
          billing_rate_ot: r.ot,
          billing_rate_dt: r.dt,
          potential_revenue: revenue,
          miles_driven: weeklyMiles,
          mileage_cost: mileageCost,
          daily_details: JSON.stringify(daily),
          per_diem_rate: perDiemRate,
          per_diem_total: perDiemTotal,
          source: 'web',
          approved: true,
        });
      }
    }
  }
  console.log('  ✅ Timesheets (3 weeks × 4 workers × ' + projects.length + ' projects = ' + (3 * 4 * projects.length) + ' weekly entries)');

  // ═══════════════════════════════════════════════════════════
  // INVOICES
  // ═══════════════════════════════════════════════════════════
  for (const proj of projects) {
    const projNum = await knex('project_numbers').where('project_id', proj.id).first();
    const numPrefix = projNum ? projNum.number : proj.name.substring(0, 10);
    const cust = customers.find(c => c.id === proj.customer_id);

    for (let inv = 1; inv <= 2; inv++) {
      const invoiceDate = new Date(2026, 2, inv * 14); // March 14 and 28
      const dueDate = new Date(invoiceDate); dueDate.setDate(dueDate.getDate() + 30);
      const amount = 25000 + Math.floor(Math.random() * 30000);

      const [invoice] = await knex('invoices').insert({
        project_id: proj.id,
        invoice_number: `INV-${numPrefix}-${String(inv).padStart(3, '0')}`,
        customer: cust?.name || proj.name,
        amount: amount,
        invoice_date: invoiceDate.toISOString().split('T')[0],
        payment_due_date: dueDate.toISOString().split('T')[0],
        status: inv === 1 ? 'paid' : 'approved',
        payment_received_date: inv === 1 ? new Date(2026, 3, 5).toISOString().split('T')[0] : null,
        payment_received_amount: inv === 1 ? amount : null,
        notes: `Invoice for ${proj.name} — period ${inv}`,
      }).returning('*');

      await knex('invoice_line_items').insert([
        { invoice_id: invoice.id, description: 'Foreman — 1 worker: 120 ST hrs', quantity: 1, unit_price: 11460, total: 11460, sort_order: 1 },
        { invoice_id: invoice.id, description: 'Journeyman — 2 workers: 240 ST hrs', quantity: 1, unit_price: 19680, total: 19680, sort_order: 2 },
        { invoice_id: invoice.id, description: 'Markup (18%)', quantity: 1, unit_price: amount * 0.18 / 1.18, total: amount * 0.18 / 1.18, sort_order: 3 },
      ]);
    }
  }
  console.log('  ✅ ' + (projects.length * 2) + ' invoices with line items');

  // ═══════════════════════════════════════════════════════════
  // PURCHASE ORDERS
  // ═══════════════════════════════════════════════════════════
  const vendors = ['Graybar Electric', 'WESCO Distribution', 'Rexel USA', 'City Electric Supply', 'Crescent Electric'];
  const materials = [
    ['MC Cable 12/2 (1000ft)', 850], ['4" EMT Conduit (100ft bundle)', 420], ['200A Panel Board', 2800],
    ['LED Troffer 2x4 (case of 10)', 1650], ['Wire Nuts Assorted (box)', 45], ['3/4" PVC Conduit (100ft)', 180],
    ['Fire Alarm Pull Station', 125], ['Disconnect Switch 60A', 340], ['Ground Rod 8ft Copper', 28],
  ];

  for (const proj of projects) {
    for (let po = 0; po < 2; po++) {
      const vendor = vendors[Math.floor(Math.random() * vendors.length)];
      const orderDate = new Date(2026, 2, 5 + po * 10);

      const items = [];
      const numItems = 2 + Math.floor(Math.random() * 3);
      let poTotal = 0;
      for (let i = 0; i < numItems; i++) {
        const mat = materials[Math.floor(Math.random() * materials.length)];
        const qty = 1 + Math.floor(Math.random() * 5);
        const total = mat[1] * qty;
        poTotal += total;
        items.push({ description: mat[0], quantity: qty, unit_price: mat[1], total });
      }

      const [purchaseOrder] = await knex('purchase_orders').insert({
        project_id: proj.id,
        po_number: `PO-${proj.year}-${String(po + 1 + projects.indexOf(proj) * 2).padStart(4, '0')}`,
        vendor,
        order_date: orderDate.toISOString().split('T')[0],
        total: poTotal,
        status: po === 0 ? 'received' : 'submitted',
        notes: `Materials for ${proj.name}`,
      }).returning('*');

      for (let i = 0; i < items.length; i++) {
        await knex('po_line_items').insert({
          po_id: purchaseOrder.id,
          description: items[i].description,
          quantity: items[i].quantity,
          unit_price: items[i].unit_price,
          total: items[i].total,
          sort_order: i + 1,
        });
      }
    }
  }
  console.log('  ✅ ' + (projects.length * 2) + ' purchase orders with line items');

  // ═══════════════════════════════════════════════════════════
  // EQUIPMENT
  // ═══════════════════════════════════════════════════════════
  const equipmentItems = [
    { barcode_id: 'EQ-001', equipment_name: 'Hilti TE 60-ATC Rotary Hammer', manufacturer: 'Hilti', equipment_type: 'Power Tools', status: 'available' },
    { barcode_id: 'EQ-002', equipment_name: 'Milwaukee M18 Band Saw', manufacturer: 'Milwaukee', equipment_type: 'Power Tools', status: 'available' },
    { barcode_id: 'EQ-003', equipment_name: 'Greenlee 855GX Conduit Bender', manufacturer: 'Greenlee', equipment_type: 'Bending Equipment', status: 'checked_out', current_project_id: projects[0].id, current_location: projects[0].name },
    { barcode_id: 'EQ-004', equipment_name: 'Ideal PowerBlade Cable Cutter', manufacturer: 'Ideal', equipment_type: 'Power Tools', status: 'available' },
    { barcode_id: 'EQ-005', equipment_name: 'Fluke 1587 Insulation Tester', manufacturer: 'Fluke', equipment_type: 'Testing', status: 'available', certification_date: '2026-08-15' },
    { barcode_id: 'EQ-006', equipment_name: 'Megger MIT485/2 Insulation Tester', manufacturer: 'Megger', equipment_type: 'Testing', status: 'checked_out', current_project_id: projects[1].id, current_location: projects[1].name, certification_date: '2026-06-01' },
    { barcode_id: 'EQ-007', equipment_name: 'Fluke Ti450 Thermal Imager', manufacturer: 'Fluke', equipment_type: 'Testing', status: 'available', certification_date: '2026-12-31' },
    { barcode_id: 'EQ-008', equipment_name: 'Genie GS-1930 Scissor Lift', manufacturer: 'Genie', equipment_type: 'Lifts', status: 'checked_out', current_project_id: projects[0].id, current_location: projects[0].name },
    { barcode_id: 'EQ-009', equipment_name: 'JLG 450AJ Boom Lift', manufacturer: 'JLG', equipment_type: 'Lifts', status: 'available' },
    { barcode_id: 'EQ-010', equipment_name: 'Klein CL800 Digital Clamp Meter', manufacturer: 'Klein Tools', equipment_type: 'Testing', status: 'available' },
    { barcode_id: 'EQ-011', equipment_name: 'Greenlee 6001 Cable Puller', manufacturer: 'Greenlee', equipment_type: 'Cable Pulling', status: 'checked_out', current_project_id: projects[1].id, current_location: projects[1].name },
    { barcode_id: 'EQ-012', equipment_name: 'Ridgid 300 Compact Threader', manufacturer: 'Ridgid', equipment_type: 'Threading', status: 'maintenance_required' },
    { barcode_id: 'EQ-013', equipment_name: 'Milwaukee MX FUEL Breaker', manufacturer: 'Milwaukee', equipment_type: 'Demolition', status: 'available' },
    { barcode_id: 'EQ-014', equipment_name: 'Amprobe AT-6030 Wire Tracer', manufacturer: 'Amprobe', equipment_type: 'Testing', status: 'available' },
    { barcode_id: 'EQ-015', equipment_name: 'Enerpac Hydraulic Knockout Set', manufacturer: 'Enerpac', equipment_type: 'Knockout Tools', status: 'available' },
  ];
  await knex('equipment').insert(equipmentItems);
  console.log('  ✅ 15 equipment items');

  // ═══════════════════════════════════════════════════════════
  // PM DELEGATES
  // ═══════════════════════════════════════════════════════════
  if (adminId) {
    await knex('pm_notification_delegates').insert([
      { pm_user_id: pmMike.id, delegate_user_id: adminId },
      { pm_user_id: pmSarah.id, delegate_user_id: adminId },
    ]);
    console.log('  ✅ PM delegates (both PMs → admin)');
  }

  // ═══════════════════════════════════════════════════════════
  // PROJECT ASSIGNMENTS (for field staff)
  // ═══════════════════════════════════════════════════════════
  await knex('project_assignments').insert([
    { project_id: projects[0].id, user_id: fieldCarlos.id },
    { project_id: projects[1].id, user_id: fieldCarlos.id },
    { project_id: projects[2].id, user_id: fieldDanny.id },
    { project_id: projects[3].id, user_id: fieldDanny.id },
    { project_id: projects[0].id, user_id: fieldTyrell.id },
    { project_id: projects[3].id, user_id: fieldTyrell.id },
  ]);
  console.log('  ✅ Foremen assigned to projects (Carlos: 1+2, Danny: 3+4, Tyrell: 1+4)');

  // ═══════════════════════════════════════════════════════════
  // VENDOR COMPANIES — after the vendors->customers merge, vendor
  // companies are seeded as customer rows with their contact info as
  // customer_contacts. PO.vendor_id points at the customers table.
  // ═══════════════════════════════════════════════════════════
  const vendorSeed = [
    { name: 'Grainger Industrial Supply', contact_name: 'Jim Hawkins',  email: 'orders@grainger.example', phone: '555-0100', street: '100 Grainger Pkwy', town: 'Lake Forest', state: 'IL', zip: '60045' },
    { name: 'Graybar Electric',           contact_name: 'Maria Lopez',  email: 'sales@graybar.example',   phone: '555-0200', street: '200 Industrial Way', town: 'Newark', state: 'NJ', zip: '07102' },
    { name: 'Home Depot Pro',             contact_name: 'Steve Park',   email: 'pro@hdpro.example',       phone: '555-0300', street: '2455 Paces Ferry Rd', town: 'Atlanta', state: 'GA', zip: '30339' },
    { name: 'Local Electrical Supply Co', contact_name: 'Tom Bryant',   email: 'tom@localesco.example',   phone: '555-0400', street: '88 Main St', town: 'Edison', state: 'NJ', zip: '08837' },
    { name: 'Northeast Conduit',          contact_name: 'Sarah Liu',    email: 'orders@neconduit.example', phone: '555-0500', street: '450 Industrial Dr', town: 'Bayonne', state: 'NJ', zip: '07002' },
  ];
  const vendorCompanies = await knex('customers').insert(vendorSeed.map(v => ({
    name: v.name,
    billing_street: v.street,
    billing_town: v.town,
    billing_state: v.state,
    billing_zip: v.zip,
  }))).returning('*');
  await knex('contacts').insert(vendorCompanies.map((c, i) => ({
    customer_id: c.id,
    name: vendorSeed[i].contact_name,
    email: vendorSeed[i].email,
    phone: vendorSeed[i].phone,
    company: c.name,
  })));
  console.log(`  ✅ ${vendorCompanies.length} vendor companies seeded into customers`);

  // ═══════════════════════════════════════════════════════════
  // INVENTORY — consumable stock
  // ═══════════════════════════════════════════════════════════
  await knex('inventory').insert([
    { item_name: '6-32 x 1" Machine Screws', category: 'fasteners', unit: 'box', quantity: 24, min_stock: 5, unit_cost: 8.99 },
    { item_name: '12-gauge THHN wire (white, 500ft spool)', category: 'wire', unit: 'spool', quantity: 8, min_stock: 2, unit_cost: 220.00 },
    { item_name: '12-gauge THHN wire (black, 500ft spool)', category: 'wire', unit: 'spool', quantity: 3, min_stock: 2, unit_cost: 220.00 },
    { item_name: 'Square D 20A breaker QO120', category: 'breakers', unit: 'each', quantity: 45, min_stock: 10, unit_cost: 7.85 },
    { item_name: '1/2" EMT conduit (10ft length)', category: 'conduit', unit: 'each', quantity: 1, min_stock: 20, unit_cost: 4.50 }, // intentionally low to demo low-stock alert
    { item_name: 'Wire nuts (Wing-Nut, red, 100ct)', category: 'fasteners', unit: 'box', quantity: 12, min_stock: 3, unit_cost: 11.50 },
  ]);
  console.log('  ✅ 6 inventory items (1 low-stock for alert demo)');

  // ═══════════════════════════════════════════════════════════
  // EQUIPMENT REQUESTS — open + filled examples
  // ═══════════════════════════════════════════════════════════
  const [openReq] = await knex('equipment_requests').insert({
    project_id: projects[0].id,
    requested_by: pmMike.id,
    personnel_name: 'Carlos Mendez',
    status: 'open',
    source: 'typed',
  }).returning('*');
  await knex('equipment_request_lines').insert([
    { request_id: openReq.id, item_description: 'Hilti Rotary Hammer Drill', quantity: 1 },
    { request_id: openReq.id, item_description: 'Extension cords (50ft, 12-gauge)', quantity: 4 },
    { request_id: openReq.id, item_description: 'Step ladder (8 ft)', quantity: 2 },
  ]);

  const [filledReq] = await knex('equipment_requests').insert({
    project_id: projects[1].id,
    requested_by: pmSarah.id,
    personnel_name: 'Danny O\'Connor',
    status: 'filled',
    source: 'typed',
  }).returning('*');
  await knex('equipment_request_lines').insert([
    { request_id: filledReq.id, item_description: 'Wire pulling fish tape (100ft)', quantity: 2, assigned_by: shopRay.id, assigned_at: knex.fn.now() },
    { request_id: filledReq.id, item_description: 'Knockout punch set', quantity: 1, assigned_by: shopRay.id, assigned_at: knex.fn.now() },
  ]);
  console.log('  ✅ 2 equipment requests (1 open, 1 filled)');

  // ═══════════════════════════════════════════════════════════
  // EQUIPMENT CHECKOUT LOG — show some equipment is currently out
  // ═══════════════════════════════════════════════════════════
  const equipmentList = await knex('equipment').select('*');
  if (equipmentList.length >= 4) {
    const checkedOutItems = equipmentList.slice(0, 3); // first 3 items
    const checkoutTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    for (const eq of checkedOutItems) {
      await knex('equipment').where({ id: eq.id }).update({
        status: 'checked_out',
        current_project_id: projects[0].id,
        current_location: `Project: ${projects[0].name}`,
      });
      await knex('equipment_checkout_log').insert({
        equipment_id: eq.id,
        project_id: projects[0].id,
        checked_out_by: pmMike.id,
        checked_out_at: checkoutTime,
        notes: 'Initial checkout for project kickoff',
      });
    }
    console.log(`  ✅ ${checkedOutItems.length} equipment items checked out (7 days ago)`);
  }

  // ═══════════════════════════════════════════════════════════
  // INBOX ACCESS — Jen handles invoices, Ray handles equipment requests
  // ═══════════════════════════════════════════════════════════
  await knex('inbox_access').insert([
    { user_id: acctJen.id, inbox_type: 'invoices' },
    { user_id: shopRay.id, inbox_type: 'equipment_requests' },
  ]);
  console.log('  ✅ Inbox access (Jen → invoices, Ray → equipment requests)');

  // ═══════════════════════════════════════════════════════════
  // FIELD NOTES — sample foreman entries
  // ═══════════════════════════════════════════════════════════
  await knex('field_notes').insert([
    { project_id: projects[0].id, foreman_id: fieldCarlos.id, note_text: 'Pulled 250ft 12AWG to panel B. Need additional fish tape — sent equipment request.', note_date: knex.raw("CURRENT_DATE - 2"), author_timezone: 'America/New_York' },
    { project_id: projects[0].id, foreman_id: fieldCarlos.id, note_text: 'Inspector visit at 2pm, flagged grounding lug on subpanel — fixed. PM notified.', note_date: knex.raw("CURRENT_DATE - 1"), author_timezone: 'America/New_York' },
    { project_id: projects[1].id, foreman_id: fieldDanny.id, note_text: 'Day 1 of conduit run. Crew of 3, made it through east hallway. About 35% complete.', note_date: knex.raw("CURRENT_DATE - 3"), author_timezone: 'America/New_York' },
  ]);
  console.log('  ✅ 3 field notes (Carlos, Danny)');

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  TEST DATA SEEDED SUCCESSFULLY');
  console.log('═══════════════════════════════════════');
  console.log('');
  console.log('  Users (all password: ChangeMe123!):');
  console.log('    admin@company.com (Admin)');
  console.log('    mike.torres@company.com (PM)');
  console.log('    sarah.chen@company.com (PM)');
  console.log('    alex.kim@company.com (Estimator)');
  console.log('    jennifer.russo@company.com (Accounting)');
  console.log('    ray.jackson@company.com (Shop Staff)');
  console.log('    carlos.mendez@company.com (Field Staff)');
  console.log('    danny.oconnor@company.com (Field Staff)');
  console.log('    tyrell.brooks@company.com (Field Staff)');
  console.log('    ramon.alvarez@company.com (Field Staff)');
  console.log('    anthony.demarco@company.com (Field Staff)');
  console.log('    marcus.washington@company.com (Field Staff)');
  console.log('    kevin.flaherty@company.com (Field Staff)');
  console.log('    jamal.thompson@company.com (Field Staff)');
  console.log('');
};
