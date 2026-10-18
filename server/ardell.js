// Ardell City: the guide to its five boroughs and their notable spots, from NUUVI's own lore
// ("where's that at?¿"). Ardell City is NUUVI's New York, so each borough sits on a real one:
//   Northridge = the Bronx · Kingsward = Brooklyn · East Hollow Island = Queens
//   Montclair Harbor = Manhattan · Cresswell = Staten Island
// Pins are real spots in those places that suit each venue. Everything here is added to a site once
// (see seedArdell); after that it's ordinary data that writers and admins can change.

export const ARDELL_INTRO = {
  title: "where's that at ?¿",
  tagline: 'can\'t keep saying "they met somewhere downtown." be serious.',
  body: "welcome, this is your guide to **ARDELL CITY**. compiled of the five well known boroughs, ardell city finds itself lacking nothing but more hours in the day for its people and visitors to *wander* throughout. make sure you REALLY love it here, because there's always a cost to living in the city that never sleeps, whether that be your WALLETS or your mental taking a dent to pay up!\n\nif you're wondering where an episode should happen, chances are you'll find the answer here.",
  note: "got a location your muse owns? add it here, pin it on the map, and it's part of the city.",
};

export const BOROUGHS = [
  {
    name: 'East Hollow Island',
    lat: 40.7282,
    lng: -73.7949,
    blurb:
      "a little ways off kingsward and home to justin kent ardell (jka) airport, another middle class borough for people to call home. common to be the area many transplants and newly wed people looking to start a family to settle down in. it's prime with job opportunities and a few good school systems, presenting itself as a potential for peoples' future.",
  },
  {
    name: 'Montclair Harbor',
    lat: 40.7831,
    lng: -73.9712,
    blurb:
      "down by the water, it's nothing but the moon reflecting off the water and the livelihood of an active nightlife to surround yourself with. from delectable cuisine, to brownstone-lined neighborhoods, it's an area bound to the motto of 'living life to the fullest.'",
  },
  {
    name: 'Kingsward',
    lat: 40.6782,
    lng: -73.9442,
    blurb:
      'across the bridge and never quite asleep, kingsward is where the city goes to make things. brownstone rows and converted warehouses, studios rented by the hour, markets on the weekend and a café on every corner. the rent climbs every year, but so do the people chasing their big break here.',
  },
  {
    name: 'Cresswell',
    lat: 40.5795,
    lng: -74.1502,
    blurb:
      "entirely bound to the southern part of the city, a little ways off from the water, cresswell sure knows how to entice the people to dream. rich in not only opportunity but financial resources, the people who've made it and want the world to know it reside here, settling down in this borough's well kempt neighborhoods to showcase their affluence. can you afford to take even a drive through this daydream of an area?",
  },
  {
    name: 'Northridge',
    lat: 40.8448,
    lng: -73.8648,
    blurb:
      "positioned to the north of it all, northridge's opportunity might not display in its neighborhoods, but the community which tightens the bond here is what brings it all together. thriving with culture and community, there is also a darkness lurking in the shadows. as to be expected from an area a little less fortunate in resources, but all you need to do is keep your head on a swivel.",
  },
];

// [name, borough, lot type, hours, price, year, description, lat, lng]
const P = (name, borough, venue, hours, price, since, description, lat, lng) => ({
  name,
  borough,
  venue,
  hours,
  price,
  since,
  description,
  lat,
  lng,
});

export const PLACES = [
  // ---- East Hollow Island (Queens) ----
  P(
    'HARLSTON SQUARE PARK',
    'East Hollow Island',
    'public park',
    '6:00 am – 1:00 am',
    '$0',
    'est. 1912 (restored 2003)',
    'tree-lined pathways and historic monuments. quiet, reflective, sometimes used for solitary scenes.',
    40.74,
    -73.8407,
  ),
  P(
    'THE ATLAS',
    'East Hollow Island',
    'auditorium / performance venue',
    'event-based (box office 10:00 am – 6:00 pm)',
    '$20 – $85',
    'est. 1912 (restored 2003)',
    'a gilded old theatre with velvet seats and a stage that has outlived three owners. touring shows, recitals and the odd sold-out comeback night.',
    40.7196,
    -73.848,
  ),
  P(
    'EASTPOINT FLEA MARKET',
    'East Hollow Island',
    'outdoor market',
    'saturdays 9:00 am – 4:00 pm',
    '$5 – $50',
    'est. 2012',
    'vintage clothing, handmade jewelry, small food vendors. good for casual encounters.',
    40.744,
    -73.9485,
  ),
  P(
    'LARKSPUR CEMETERY',
    'East Hollow Island',
    'cemetery / memorial grounds',
    '7:00 am – 6:00 pm',
    '$0',
    'est. 1879',
    'tree-lined pathways and historic monuments. quiet, reflective, sometimes used for solitary scenes.',
    40.729,
    -73.929,
  ),
  P(
    'ASHFORD COLLEGE',
    'East Hollow Island',
    'public college campus',
    'campus 24/7 (buildings 7:00 am – 10:00 pm)',
    'tuition ~$8–15k',
    'est. 1937',
    'brick halls, a crowded quad and a library that never has enough outlets. first-generation students, night classes and everyone working two jobs to get through.',
    40.7365,
    -73.8203,
  ),
  P(
    'JUSTIN KENT ARDELL (JKA) AIRPORT',
    'East Hollow Island',
    'international airport',
    '24/7',
    '$15 – $90 (lounges, dining, parking)',
    'est. 1948',
    'arrivals, departures and every goodbye in between. paparazzi camp out at the private terminal when someone famous is flying out.',
    40.6413,
    -73.7781,
  ),
  // ---- Montclair Harbor (Manhattan) ----
  P(
    'HARBORLINE BEACH',
    'Montclair Harbor',
    'public waterfront / beachfront',
    '6:00 am – 9:00 pm',
    '$0 – $25',
    'est. 1954 (renovated 2018)',
    "a small but popular stretch of shoreline along the city's eastern edge. food trucks during summer. bonfires unofficially happen after dark.",
    40.7098,
    -73.9862,
  ),
  P(
    'THE MARLOWE',
    'Montclair Harbor',
    'boutique hotel',
    '24/7',
    '$50 – $90 (bar, dining, day use)',
    'est. 2014',
    'minimalist luxury. rooftop bar with skyline view. a frequent neutral ground for meetings.',
    40.7406,
    -74.0078,
  ),
  P(
    'THE MERIDIAN',
    'Montclair Harbor',
    'museum',
    '10:00 am – 6:00 pm',
    '$15 – $30',
    'est. 1933',
    'modern and contemporary art exhibitions. hosts private galas and fashion events.',
    40.7794,
    -73.9632,
  ),
  P(
    'NOVA',
    'Montclair Harbor',
    'nightclub',
    '9:00 pm – 3:00 am',
    '$30 – $90',
    'est. 2021',
    'led-heavy lighting, vip tables, rotating djs. often tagged on social media by rising personalities.',
    40.7209,
    -73.9877,
  ),
  P(
    'PLATFORM 27',
    'Montclair Harbor',
    'live music venue',
    'event-based (6:00 pm – 1:00 am)',
    '$20 – $70',
    'est. 2011',
    'mid-sized venue for touring artists and local bands.',
    40.7506,
    -73.9935,
  ),
  P(
    'WICK & STEEL',
    'Montclair Harbor',
    'tattoo & piercing studio',
    '1:00 pm – 9:00 pm',
    '$40 – $90',
    'opened 2007',
    'clean, minimalist interior. known for fine-line tattoos popular with models and creatives.',
    40.7336,
    -74.0027,
  ),
  P(
    'THE BACKLINE',
    'Montclair Harbor',
    'after-hours industry bar',
    '11:00 pm – 4:00 am',
    '$20 – $65',
    'opened 2018',
    'unmarked entrance. no sign. djs, assistants, junior execs. the place people go after official parties end.',
    40.7638,
    -73.9918,
  ),
  // ---- Kingsward (Brooklyn) ----
  P(
    'VANTA',
    'Kingsward',
    'members-only lounge',
    '6:00 pm – 2:00 am',
    '$25 – $90',
    'est. 2017',
    'low lighting, velvet seating, curated dj sets. industry people frequent this spot. access requires referral or membership. known for quiet deals and very visible social media posts.',
    40.7033,
    -73.9881,
  ),
  P(
    'CROSSLIGHTS STUDIOS',
    'Kingsward',
    'photography & creative studio complex',
    '8:00 am – 10:00 pm',
    '$20 – $75',
    'est. 2016',
    'rental soundstages, rehearsal rooms, editing suites. influencers and small production crews frequent this space.',
    40.7003,
    -73.971,
  ),
  P(
    'GRACI DISTRICT',
    'Kingsward',
    'arts & nightlife district',
    'public access (venues vary)',
    '$10 – $60',
    'est. 1990s',
    'murals on every wall, converted warehouses, pop-up galleries and rooftop parties. the neighborhood artists move to right before it gets too expensive for them.',
    40.6944,
    -73.9213,
  ),
  P(
    'GRAYSON ROW',
    'Kingsward',
    'mixed-use brownstone district',
    'public access',
    '$10 – $50',
    'est. 1904',
    'a charming street of renovated brownstones with boutique shops, wine bars, and upstairs apartments. includes: blue hour café, paper moon archive, bloom haus, and sometimes houses the eastpoint flea market.',
    40.672,
    -73.979,
  ),
  P(
    'BLUE HOUR CAFÉ',
    'Kingsward',
    'independent café',
    '7:00 am – 7:00 pm',
    '$5 – $18',
    'est. 2009',
    'warm lighting, communal tables, poetry nights twice a month. students, freelancers, and quiet first dates.',
    40.6735,
    -73.977,
  ),
  P(
    'PAPER MOON ARCHIVE',
    'Kingsward',
    'rare book & zine shop',
    '12:00 pm – 8:00 pm',
    '$10 – $60',
    'opened 1996',
    'independent publications, art books, underground magazines. quiet. intimate.',
    40.6705,
    -73.9805,
  ),
  P(
    'BLOOM HAUS',
    'Kingsward',
    'flower shop & event studio',
    '8:00 am – 7:00 pm',
    '$15 – $90',
    'opened 2013',
    'the grayson row storefront: buckets of fresh cut flowers on the sidewalk, a workroom full of wedding orders in the back. somehow always busier than a flower shop should be.',
    40.6728,
    -73.9783,
  ),
  P(
    'NORTHLIGHT',
    'Kingsward',
    'fashion show warehouse',
    'event-based',
    '$30 – $90',
    'opened 2017',
    'temporary runway builds for independent designers. raw concrete floors.',
    40.721,
    -73.9615,
  ),
  P(
    'KINGSWARD TERMINAL',
    'Kingsward',
    'ferry & transit terminal',
    '5:00 am – 1:00 am',
    '$3 – $15',
    'est. 1919',
    'ferries across the harbor, delayed trains and a waiting hall with terrible coffee. people leave the city from here, and some of them come back.',
    40.6455,
    -74.0255,
  ),
  // ---- Cresswell (Staten Island) ----
  P(
    'THE RIVERGATE',
    'Cresswell',
    'residential high-rise',
    '24/7 residential access',
    '$25 – $70 (avg. daily living spend)',
    'est. 2018',
    'luxury waterfront apartments with floor-to-ceiling windows. popular among young professionals and mid-tier influencers.',
    40.6435,
    -74.076,
  ),
  P(
    'STRIDE',
    'Cresswell',
    'private gym',
    '5:00 am – 11:00 pm',
    '$15 – $60',
    'est. 2020',
    'sleek, mirrored, influencer-friendly. offers boxing, spin, and personal training sessions. often frequented by models and performers.',
    40.628,
    -74.077,
  ),
  P(
    'WESTBRIDGE UNIVERSITY',
    'Cresswell',
    'private university campus',
    'campus 24/7 (buildings 7:00 am – 10:00 pm)',
    'tuition ~$70–95k',
    'est. 1888',
    'a prestigious liberal arts and business university with ivy-covered academic halls and a modern glass innovation center. students often cross paths with local creatives and interns tied to major companies.',
    40.6153,
    -74.0938,
  ),
  P(
    'CINDER & ELM',
    'Cresswell',
    'upscale restaurant',
    '5:00 pm – 11:30 pm',
    '$40 – $90',
    'est. 2015',
    'industrial-modern interior, open kitchen, candlelit tables. known for business dinners and quiet romantic tension. reservations recommended.',
    40.641,
    -74.079,
  ),
  P(
    'LOW TIDE',
    'Cresswell',
    'private wellness spa',
    '9:00 am – 10:00 pm',
    '$35 – $90',
    'opened 2019',
    'infrared rooms, cold plunge pools. influencer-heavy but discreet.',
    40.598,
    -74.108,
  ),
  P(
    'LANTERN GARDEN',
    'Cresswell',
    'private event greenhouse',
    'by booking',
    '$50 – $90',
    'opened 2015',
    'glass greenhouse on top of a commercial building. proposal spot. secret meetings. small launch events.',
    40.644,
    -74.102,
  ),
  // ---- Northridge (the Bronx) ----
  P(
    '5TH STREET',
    'Northridge',
    'multi-family apartments',
    '24/7',
    'rent $1000 – $1400 / month',
    'est. 1943',
    'multi-family turned into many apartments. sometimes the electricity goes out, sometimes your neighbor forgets you live here too, but the price is good!',
    40.8085,
    -73.923,
  ),
  P(
    'HOLLOW LANTERN',
    'Northridge',
    'dive bar',
    '4:00 pm – 3:00 am',
    '$8 – $35',
    'est. 1981',
    'neon beer signs, scratched wood tables, open mic nights. industry assistants and off-duty staff gather here.',
    40.8615,
    -73.8905,
  ),
  P(
    'TENEMENT 9',
    'Northridge',
    'underground apartment venue',
    'event-based (8:00 pm – 2:00 am)',
    '$5 – $25',
    'operating since 2021',
    'invite-only house shows. spoken word. diy concerts. no official license.',
    40.816,
    -73.886,
  ),
  P(
    'THE GRAMOPHONE',
    'Northridge',
    '24-hour diner',
    '24/7',
    '$5 – $25',
    'opened 1984',
    'late-night comfort food. post-club decompression. arguments and reconciliations happen here.',
    40.8296,
    -73.923,
  ),
  P(
    'UNDERGROUND ROW',
    'Northridge',
    'nightlife venue',
    '11:00 pm – 5:00 am',
    "$10 – $25 (unless you're betting…)",
    'est. 2009',
    'home to many, prison to all. an underground floor for betting on fights, a club floor where more happens under the table than fair, and a decent rooftop lounge for the ones trying to escape the chaos.',
    40.802,
    -73.912,
  ),
];

// Pictures for the spots, sent in one location at a time (stored in public/places).
export const PLACE_PHOTOS = {
  'HARLSTON SQUARE PARK': [1, 2, 3, 4].map((n) => `/places/harlston-square-park-${n}.webp`),
  'THE ATLAS': [1, 2, 3].map((n) => `/places/the-atlas-${n}.webp`),
};

// Gives each spot its pictures, once per spot (added after any pictures it already has).
export function seedPlacePhotos(db) {
  for (const [name, photos] of Object.entries(PLACE_PHOTOS)) {
    const key = `ardell_photos:${name}`;
    if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key)) continue;
    const place = db.prepare('SELECT * FROM locations WHERE name = ? COLLATE NOCASE').get(name);
    if (!place) continue; // not added yet: try again later
    let had = [];
    try {
      had = JSON.parse(place.gallery || '[]');
    } catch {
      /* none */
    }
    if (!had.length && place.picture) had = [place.picture];
    const gallery = [...had, ...photos.filter((p) => !had.includes(p))].slice(0, 12);
    db.prepare('UPDATE locations SET gallery = ?, picture = ? WHERE id = ?').run(
      JSON.stringify(gallery),
      gallery[0] ?? null,
      place.id,
    );
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, '1');
  }
}

// Adds the boroughs and spots to a site, once, as the site owner's (the first admin's). A place that's
// already there by name is left as it is (and given its details and pin if it has none). Waits until
// the site has an admin.
export function seedArdell(db) {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'ardell_v1'").get()) return;
  const owner = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();
  if (!owner) return;
  const addBorough = db.prepare(`INSERT INTO boroughs (name, blurb, lat, lng, position) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO NOTHING`);
  BOROUGHS.forEach((b, i) => addBorough.run(b.name, b.blurb, b.lat, b.lng, i));
  const find = db.prepare('SELECT * FROM locations WHERE name = ? COLLATE NOCASE');
  const add = db.prepare(`INSERT INTO locations (user_id, name, borough, venue, hours, price, since, description, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const fill = db.prepare(`UPDATE locations SET borough = CASE WHEN borough = '' THEN ? ELSE borough END,
    venue = CASE WHEN venue = '' THEN ? ELSE venue END, hours = CASE WHEN hours = '' THEN ? ELSE hours END,
    price = CASE WHEN price = '' THEN ? ELSE price END, since = CASE WHEN since = '' THEN ? ELSE since END,
    description = CASE WHEN description = '' THEN ? ELSE description END,
    lat = COALESCE(lat, ?), lng = COALESCE(lng, ?) WHERE id = ?`);
  for (const p of PLACES) {
    const had = find.get(p.name);
    if (had) fill.run(p.borough, p.venue, p.hours, p.price, p.since, p.description, p.lat, p.lng, had.id);
    else add.run(owner.id, p.name, p.borough, p.venue, p.hours, p.price, p.since, p.description, p.lat, p.lng);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('ardell_v1', '1')").run();
}
