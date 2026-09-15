/** The events map: where each thing happened, and the one you are looking at.
 *
 *  No tiles and no map library. The basemap is Natural Earth land, simplified
 *  once into `basemap.svg` and inlined at build time, because the whole output
 *  is one self-contained file — a tile request per pan would break the file://
 *  fallback that `shell/head.html` exists to provide, and would make a page
 *  about your own life depend on somebody else's server staying up.
 *
 *  Everything sits in Web Mercator inside a 2048x2048 box, which is the same
 *  space `basemap.svg` was projected into, so a coordinate needs no more than
 *  the formula below to become a position.
 *
 *  Selection is the interesting part: the picked pin is always moved to the
 *  centre of the frame, which means the card never has to be positioned
 *  against a pin or kept from falling off an edge. It is simply always in the
 *  same place, and the map moves instead.
 */
const EV_W = 2048;                 // the basemap's coordinate box
const EV_VW = 1000, EV_VH = 520;   // the visible frame, in the same units
// How close a picked event is looked at when nothing is named nearby, and it is
// a budget rather than a preference. `basemap.svg` is Natural Earth 1:10m
// simplified to a quarter of a unit, so at zoom k the coastline is wrong by
// about k/4 pixels and the stored coordinates quantise to k/10. Sixteen keeps
// both under about four pixels, which is the point where a bay still reads as
// that bay. Going further does not reveal more coast, it reveals the
// simplification — the source stops at 1:10m and no zoom here can add detail
// that was never in it.
//
// `Data/places.csv` is the way past that ceiling, because a printed name is not
// a coastline and has nothing to be imprecise about. A pin with labels around
// it goes as deep as those labels claim to be readable; a pin alone in the
// Pacific still stops here.
const EV_ZOOM = 16;
// Where the land stops being evidence and starts being decoration. By the k/4
// rule above it is off by 25px at the first number and 65px at the second — a
// tenth of the frame — so it fades out across that range rather than sitting
// under the ward labels drawing a coastline it has no right to claim. Getting
// it back at those scales is a detail layer in this same projection, not a
// setting: see the note beside `ev-land` in map.css.
const EV_TRUE = 100, EV_LIE = 260;
// How far out and in the wheel may go. The floor is the whole world and there
// is nothing beyond it; the ceiling is four times the finest tier of names,
// because past that the frame holds one label and a pin, and pushing further
// only spreads out what is already fully readable.
const EV_MIN_K = 0.35, EV_CEIL = 4;
// A name a little outside the frame is still worked out, so that panning slides
// it in rather than popping it in at the edge.
const EV_PAD = 1.15;
let evPins = [], evPlaces = [], evAt = -1;
// Where the frame is now, which the wheel and the drag both read and write.
// It used to live only in the DOM as a transform string, which was fine while
// every move started from a pin and ended at another one.
let evNow = {x: EV_W / 2, y: EV_W / 2, k: 1}, evMax = EV_ZOOM * EV_CEIL;

/** Decimal degrees -> a position in the basemap's box. */
function evProject(lat, lon) {
  const c = Math.max(-85.0511, Math.min(85.0511, lat));
  const s = Math.sin(c * Math.PI / 180);
  return {x: (lon + 180) / 360 * EV_W,
          y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * EV_W};
}

/** One glyph per kind, drawn on a 16x16 grid. Hand-drawn rather than pulled
 *  from an icon set: six shapes is less code than a dependency, and nothing
 *  here needs to be licensed. */
const EV_GLYPH = {
  trip:  'M15 2 2 7.5l5 1.5 1.5 5z',
  study: 'M2 3h4.5A1.5 1.5 0 018 4.5V14a1.5 1.5 0 00-1.5-1.5H2zm12 0H9.5A1.5 1.5 0'
         + ' 008 4.5V14a1.5 1.5 0 011.5-1.5H14z',
  meal:  'M4 2v4.5a1.5 1.5 0 003 0V2M5.5 6.5V14M11.5 2c-1.2 1.6-1.2 3.6 0 4.8V14',
  party: 'M2.5 14 6 5l5 5zM11.5 2.5v2M13.5 6h2M10.5 7.5l1.5 1',
  work:  'M2 5.5h12V14H2zM6 5.5V3h4v2.5',
  other: 'M8 2a4 4 0 014 4c0 3-4 8-4 8S4 9 4 6a4 4 0 014-4z',
};
const evGlyph = k => `<path d="${EV_GLYPH[k] || EV_GLYPH.other}"/>`;

/** The marker, drawn with its point at the origin so the group only has to be
 *  moved, never nudged to compensate for its own shape. A teardrop rather than
 *  the dot it used to be: on a street map a dot is one more round thing among
 *  roundabouts and planting, whereas a pin has a tip, and a tip says *here*
 *  rather than *hereabouts*. 18 across and 26 tall, in frame units, so it is
 *  the same size at every scale. */
const EV_PIN = 'M0 -26c-5.03 0-9.1 4.07-9.1 9.1 0 6.83 9.1 16.9 9.1 16.9'
             + 's9.1-10.07 9.1-16.9c0-5.03-4.07-9.1-9.1-9.1z';

/** A station, drawn at its own point: a chip with a train on it. Without this
 *  a station was a name hanging over nothing, which reads as a label for the
 *  whole area rather than a mark on one building. Small enough that the name
 *  under it still does the work. */
const EV_STOP = '<rect class="ev-stop-chip" x="-5.6" y="-5.6" width="11.2"'
              + ' height="11.2" rx="3.2"/>'
              + '<path class="ev-stop-mark" d="M-2.5-3.3h5v4.1a1.2 1.2 0 01-1.2'
              + ' 1.2h-2.6a1.2 1.2 0 01-1.2-1.2zM-2.5-1.1h5M-1.5 2.6-2.8 4.3'
              + 'M1.5 2.6 2.8 4.3"/>';

/** Events that carry a coordinate, gathered by that coordinate: two study
 *  sessions at the same flat are one pin holding both, not two pins stacked so
 *  the top one hides the other and the map claims twice as many places as there
 *  are. Keyed on the coordinate as written, because the same place is the same
 *  pair of numbers copied down — anything else is a different address.
 *
 *  Both the map and the list below it group through here, so the index a
 *  timeline entry carries is an index into the same array the pins came from.
 */
function evGroup(rows) {
  const by = new Map();
  rows.forEach((e, i) => {
    if (e.lat === null || e.lon === null) return;
    const k = `${e.lat},${e.lon}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({...e, row: i});
  });
  return [...by.values()];
}

/** The transform that puts world point (x,y) at the centre of the frame.
 *
 *  Only the basemap rides this. Everything else is placed by evAt2 below, for
 *  a reason worth writing down: this transform's offset is `k * x`, and x is
 *  around 1819 for Tokyo. The browser rasterises the composed matrix in single
 *  precision, so by scale 19000 that product passes 2^25, where the float's
 *  own step is wider than the pixel being asked for. The subtraction that
 *  brings a road back to the middle of the frame then loses its low bits and
 *  the map draws itself sixteen million pixels off screen — silently, and only
 *  past a zoom nothing used to reach. The basemap is long faded out by then,
 *  so it can keep the simple form.
 */
const evView = (x, y, k) =>
  `translate(${EV_VW / 2 - k * x} ${EV_VH / 2 - k * y}) scale(${k})`;

/** Where a world point sits in the frame, worked out in JavaScript's own
 *  doubles and handed over as a number the renderer can hold exactly. */
const evAt2 = (px, py, x, y, k) =>
  [EV_VW / 2 + k * (px - x), EV_VH / 2 + k * (py - y)];

/** How deep this point is worth going: as far as the names around it can carry.
 *
 *  A label counts only if it would actually be on screen once you arrived — half
 *  a frame at its own zoom is the reach, so a ward name 200 km away is a
 *  coincidence rather than context. The deepest label that passes wins, which
 *  makes the answer independent of the order the file is written in.
 */
function evCap(p) {
  return evPlaces.reduce((k, q) => q.zoom > k
    && Math.hypot(q.x - p.x, q.y - p.y) < EV_VW / 2 / q.zoom ? q.zoom : k, EV_ZOOM);
}

/** The frame that holds these pins, with room around them.
 *
 *  The room is in frame units and the extent is in world units, so the two only
 *  meet after the division — subtract the margin from the frame, then ask what
 *  scale fits the extent in what is left. Adding them before dividing is what
 *  this used to do, and it does not mean anything: 40 world units is 2000 km,
 *  so any two pins in one country were "about 40 apart" and the fit answered
 *  with roughly the same continental scale whichever two they were.
 *
 *  An axis with no extent — one pin, or two events at one address — divides by
 *  zero, which is Infinity, which loses the Math.min to the cap. That is the
 *  right answer and needs no case of its own: a lone pin has nothing to fit to,
 *  so it goes as deep as the names around it allow.
 */
const EV_FIT = 70;
function evFit(pins) {
  if (!pins.length) return {x: EV_W / 2, y: EV_W / 2, k: 0.5};
  const xs = pins.map(p => p.x), ys = pins.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = Math.min((EV_VW - 2 * EV_FIT) / (x1 - x0), (EV_VH - 2 * EV_FIT) / (y1 - y0),
                     Math.max(...pins.map(evCap)));
  return {x: (x0 + x1) / 2, y: (y0 + y1) / 2, k};
}

// How far apart two pins can be and still be the same place, in world units.
// `EV_W` spans the world, so a unit is about 20 km at the equator and about
// 16 km at Tokyo's latitude — five of them is roughly 80 km. That is the gap
// that puts Kanazawa (300 km) and Seoul (1,160 km) in answers of their own
// while keeping everywhere you actually go in Tokyo inside one, and it is a
// distance rather than a name because the map has no idea what a city is: it
// only knows that these events happened near each other and those did not.
const EV_NEAR = 5;

/** Pins gathered into places, by nothing but how close together they are.
 *
 *  Single-link, so a chain of pins 80 km apart joins into one region — which is
 *  the behaviour worth having along a coast or a rail line, and the reason this
 *  is not a fixed radius around the busiest pin.
 *
 *  ponytail: O(n²) flood fill. There are dozens of pins and it runs once per
 *  render; a grid index if this ever holds thousands.
 */
function evRegions(pins) {
  const seen = pins.map(() => false), out = [];
  pins.forEach((p, i) => {
    if (seen[i]) return;
    seen[i] = true;
    const group = [p];
    for (let n = 0; n < group.length; n++) {
      pins.forEach((q, j) => {
        if (seen[j] || Math.hypot(q.x - group[n].x, q.y - group[n].y) > EV_NEAR) return;
        seen[j] = true;
        group.push(q);
      });
    }
    out.push(group);
  });
  return out;
}

/** Which region the map should open on: the one the most events happened in.
 *
 *  **Events, not pins.** Ten study sessions at one flat is where the last month
 *  went; three pins scattered across a city you passed through once is not, and
 *  counting places would rank them the other way round.
 *
 *  Ties break on the most recent event, because two regions with four events
 *  each are separated by which one you are still going to.
 */
function evBusiest(pins) {
  const count = g => g.reduce((s, p) => s + p.events.length, 0);
  const latest = g => g.reduce((d, p) =>
    p.events.reduce((x, e) => (e.end || e.start) > x ? (e.end || e.start) : x, d), '');
  return evRegions(pins).sort((a, b) =>
    count(b) - count(a) || latest(b).localeCompare(latest(a)))[0] || [];
}

// What the opening frame settled on, for the line under the map to report. A
// default that silently disagrees with the pins you can see is the one failure
// mode here, so it says what it chose and out of how much.
let evOpened = {events: 0, of: 0, place: ''};

/** Where to sit when nothing is picked: the busiest region, not the whole map.
 *
 *  Fitting every pin was the first version and it is wrong for the question the
 *  map is actually asked. One conference in Kanazawa pulls the frame out to the
 *  whole of Japan, and the eleven things that happened in Tokyo — the reason
 *  you opened the page — arrive as a cluster of overlapping dots 300 km from
 *  the one pin that made the frame that wide. `Show all` is still there for the
 *  times the whole picture is the point.
 */
function evHome() {
  const region = evBusiest(evPins);
  const home = evFit(region);
  // The coarsest name within reach of the frame — "Tokyo" rather than "Ginza",
  // and nothing at all somewhere `places.csv` has never heard of, which is the
  // honest answer for a week spent where this vault has no map yet.
  const near = evPlaces.filter(evSeen(home.x, home.y, home.k))
    .sort((a, b) => a.zoom - b.zoom)[0];
  evOpened = {events: region.reduce((s, p) => s + p.events.length, 0),
              of: evPins.reduce((s, p) => s + p.events.length, 0),
              place: near ? near.name : ''};
  return home;
}

/** Is this name coarse enough to have arrived, and near enough to be on screen?
 *
 *  The second half is what makes 600 station names cost nothing. They are all
 *  in the document at every scale, but only the handful actually inside the
 *  frame are ever positioned or shown — which is also the honest answer, since
 *  a name off the edge is not telling you anything.
 */
function evSeen(x, y, k) {
  const w = EV_VW / 2 / k * EV_PAD, h = EV_VH / 2 / k * EV_PAD;
  return q => k >= q.zoom && Math.abs(q.x - x) < w && Math.abs(q.y - y) < h;
}

/** Which names to print at (x,y,k): the finest tier with anything on screen.
 *
 *  Tiers rather than a test per label, because "Tokyo" and "Chiyoda" are the
 *  same claim at two resolutions and printing both is printing one of them
 *  twice. Scoped to what is actually in frame, so sitting over Tokyo at a
 *  prefecture scale is not silenced by a ward label somewhere off the edge.
 */
function evTier(x, y, k) {
  return Math.max(0, ...evPlaces.filter(evSeen(x, y, k)).map(q => q.zoom));
}

/** Which pin names can be printed at (x,y,k).
 *
 *  A name over a pin is only worth printing if nothing else is standing where
 *  it would go: two pins 1.4 km apart are the same dot at country scale, and
 *  their names land on top of each other as one unreadable smear that is worse
 *  than no name at all. So a name waits until the zoom has pulled its pin clear.
 *
 *  The picked pin is the exception, and it is silent: it sits at the centre of
 *  the frame, and the card in the corner is wide enough to reach the centre, so
 *  a name centred there is a name half behind a box. The card leads with that
 *  same place name in full, which is the better place to read it anyway.
 *
 *  Nor is a name printed that the map is already printing: an event at
 *  "Kanazawa" sitting under the Kanazawa label is the same word twice, thirty
 *  units apart, with a pin between them looking like a mistake.
 *
 *  The box is a name's size, not a pin's — roughly 140 frame units of hotel
 *  name, so half of it either side. The height is the 31 the name hangs above
 *  its own pin, because that is the distance at which the lower of two names
 *  stops clearing the upper pin and the pair stops saying which is which.
 */
const EV_NAME_W = 70, EV_NAME_H = 30;
function evNamed(x, y, k) {
  const pos = evPins.map(p => evAt2(p.x, p.y, x, y, k));
  const seen = evSeen(x, y, k), tier = evTier(x, y, k);
  const said = new Set(evPlaces.filter(q => q.zoom === tier && seen(q)).map(q => q.name));
  // ponytail: every pin against every other, which is nothing at tens of them.
  // If this file ever holds hundreds, filter to the ones in frame first.
  return pos.map(([px, py], i) => i !== evAt && !said.has(evPins[i].place)
    && pos.every(([qx, qy], j) =>
      j === i || Math.abs(qx - px) > EV_NAME_W || Math.abs(qy - py) > EV_NAME_H));
}

/** How much of the coastline is still evidence at scale k, and so how much of
 *  it to show. See EV_TRUE / EV_LIE. */
const evLandAt = k => Math.max(0, Math.min(1, (EV_LIE - k) / (EV_LIE - EV_TRUE)));

/** The same question asked of a detail layer, in the only unit that travels
 *  between layers: multiples of its own tier.
 *
 *  A layer is built to be about two pixels honest at the scale it was made for,
 *  so at four times that it is eight pixels out and still describing the place,
 *  and at thirty times it is a drawing of somewhere approximately similar. It
 *  fades across that span rather than switching off, because the last thing it
 *  is good for — which side of the river, how far to the water — outlives the
 *  point where you would trust its exact line.
 */
const EV_SOFT = 4, EV_GONE = 30;
const evLayerAt = (k, zoom) => k < zoom ? 0
  : Math.max(0, Math.min(1, (EV_GONE - k / zoom) / (EV_GONE - EV_SOFT)));

/** Move the frame, and keep the pins and the names the size they were.
 *  Both live inside the transformed group, so without the counter-scale they
 *  would grow with the zoom until one marker covered the country it is in. */
function evGo(x, y, k) {
  const map = document.getElementById('ev-map');
  if (!map) return;
  evNow = {x, y, k};
  const view = map.querySelector('#ev-view');
  view.setAttribute('transform', evView(x, y, k));
  const place = el => {
    const [sx, sy] = evAt2(+el.dataset.x, +el.dataset.y, x, y, k);
    return [sx, sy];
  };
  const named = evNamed(x, y, k);
  map.querySelectorAll('.ev-pin').forEach(g => {
    const [sx, sy] = place(g);
    g.setAttribute('transform', `translate(${sx} ${sy})`);
    g.classList.toggle('named', named[+g.dataset.evPin]);
  });
  const seen = evSeen(x, y, k), tier = evTier(x, y, k);
  map.querySelectorAll('.ev-label').forEach(t => {
    const q = evPlaces[+t.dataset.evLabel];
    const on = q.zoom === tier && seen(q);
    // Only a name that is about to be read is worth positioning. This runs on
    // every wheel tick, and the file holds every station in the 23 wards.
    if (on) {
      const [sx, sy] = evAt2(q.x, q.y, x, y, k);
      t.setAttribute('transform', `translate(${sx} ${sy})`);
    }
    t.classList.toggle('on', on);
  });
  // A layer arrives at its own tier and thins out from there, rather than
  // switching off at the next one — see evLayerAt. It carries its own scale
  // because its paths are written around an origin of their own.
  map.querySelectorAll('.ev-layer').forEach(g => {
    const [sx, sy] = place(g);
    g.setAttribute('transform', `translate(${sx} ${sy}) scale(${k})`);
    g.style.opacity = evLayerAt(k, +g.dataset.zoom);
  });
  const land = view.querySelector('.ev-land-fade');
  if (land) land.style.opacity = evLandAt(k);
}

/** Where the SVG sits on screen, remembered for the length of a gesture.
 *
 *  `getBoundingClientRect` forces the browser to settle layout before it can
 *  answer, and evGo has just moved several hundred elements above four
 *  thousand paths. Asking once per wheel tick made a burst of them lock the
 *  renderer for tens of seconds. Nothing can move the frame mid-gesture — the
 *  wheel handler eats the scroll it would have taken — so one answer does for
 *  the whole burst, and anything that could invalidate it drops the cache.
 */
let evRect = null;
const evFrame = svg => (evRect = evRect || svg.getBoundingClientRect());
addEventListener('resize', () => { evRect = null; });
addEventListener('scroll', () => { evRect = null; }, true);

/** Suppress the half-second ease while a gesture is running. The ease is what
 *  makes jumping between two pins read as travel; under a wheel it would make
 *  the map lag half a second behind the fingers doing it. */
let evEaseOff = 0;
function evLive() {
  const map = document.getElementById('ev-map');
  if (!map) return;
  map.classList.add('live');
  clearTimeout(evEaseOff);
  evEaseOff = setTimeout(() => { map.classList.remove('live'); evRect = null; }, 180);
}

/** Scale by `f` about a point on screen, keeping whatever is under that point
 *  under it. The frame centre has to move by exactly the part of the gap the
 *  new scale no longer covers, which is the `1/k0 - 1/k1` below. */
function evZoomAt(f, clientX, clientY) {
  const svg = document.querySelector('#ev-map .ev-svg');
  if (!svg) return;
  const r = evFrame(svg);
  const k = Math.max(EV_MIN_K, Math.min(evMax, evNow.k * f));
  const d = 1 / evNow.k - 1 / k;
  evLive();
  evGo(evNow.x + ((clientX - r.left) / r.width * EV_VW - EV_VW / 2) * d,
       evNow.y + ((clientY - r.top) / r.height * EV_VH - EV_VH / 2) * d, k);
}

/** Pick an event: centre it, light its pin, and show its card. Picking the one
 *  already picked lets go — the same button that opened it closes it, which is
 *  what a second click on a thing that is already selected should do. */
/** Let go of whatever is picked, and move nowhere.
 *
 *  Separate from `evPick` because the two reset buttons need the letting-go
 *  without the going-home that used to come welded to it: `Show all` on a
 *  picked pin deselected and flew to the *opening* frame, so the button did
 *  something other than what it said and only obeyed on the second click.
 */
function evDrop() {
  const map = document.getElementById('ev-map');
  if (!map) return;
  evAt = -1;
  map.querySelectorAll('.ev-pin').forEach(g => g.classList.remove('on'));
  document.querySelectorAll('[data-tl-pick]').forEach(b => b.classList.remove('picked'));
  const card = document.getElementById('ev-card');
  if (card) card.hidden = true;
}

function evPick(i) {
  const map = document.getElementById('ev-map');
  if (!map) return;
  if (evAt === i) {
    evDrop();
    const h = evHome();
    return evGo(h.x, h.y, h.k);
  }
  evAt = i;
  map.querySelectorAll('.ev-pin').forEach(g =>
    g.classList.toggle('on', +g.dataset.evPin === evAt));
  document.querySelectorAll('[data-tl-pick]').forEach(b =>
    b.classList.toggle('picked', +b.dataset.tlPick === evAt));
  const card = document.getElementById('ev-card');
  const p = evPins[evAt];
  card.hidden = false;
  // The place is said once, at the top, and then each thing that happened
  // there. The old card printed the place inside the subtitle of its one
  // event, which was fine while a pin could only ever hold one.
  card.innerHTML = `<div class="ev-card-place">${esc(p.place)}</div>`
    + p.events.map(e => `<div class="ev-card-ev">
      <div class="ev-card-top">
        <svg class="ev-ico" viewBox="0 0 16 16">${evGlyph(e.kind)}</svg>
        <div><b>${esc(e.title)}</b>
          <div class="ev-card-sub">${esc(e.kind)} · ${esc(e.when)}</div></div>
      </div>
      ${e.people.length ? `<div class="row">${e.people.map(n =>
        `<span class="pill">${esc(n)}</span>`).join('')}</div>`
        : '<div class="ev-card-sub">No one recorded</div>'}</div>`).join('');
  evGo(p.x, p.y, evCap(p));
}

/** The map, or the reason there isn't one. `pins` are events that carry both
 *  halves of a coordinate; the rest stay in the timeline below untouched. */
function eventsMap(rows) {
  // A pin is a place, not an event: one coordinate, the name to print over it,
  // and everything that happened there. `place` is free text and may be blank,
  // in which case the event's own title is the best name the row has.
  evPins = evGroup(rows).map(es => ({...evProject(es[0].lat, es[0].lon),
    place: es[0].place || es[0].title, events: es}));
  evPlaces = (META.places || []).map(q => ({...q, ...evProject(q.lat, q.lon)}));
  evMax = Math.max(EV_ZOOM, ...evPlaces.map(q => q.zoom)) * EV_CEIL;
  evAt = -1;
  // Cleared here rather than in evHome, because the early return below skips
  // evHome entirely: a window whose events carry no coordinates would otherwise
  // leave the last window's answer standing, and the line under the map would
  // report opening on a place while showing no map at all.
  evOpened = {events: 0, of: 0, place: ''};
  if (!evPins.length) {
    return `<p class="hint">No event carries a <code>lat</code> and <code>lon</code> yet,
      so there is nothing to place. Add them to <code>Data/events.csv</code> — decimal
      degrees, both columns, and rows without them keep their place in the list.</p>`;
  }
  // Nothing calls evGo on mount, so the opening frame has to be drawn in the
  // state evGo would have put it in — same tier, same fade, or the first paint
  // would be a bare map that only corrects itself once you clicked something.
  const h = evHome();
  evNow = h;
  const seen = evSeen(h.x, h.y, h.k), tier = evTier(h.x, h.y, h.k);
  const named = evNamed(h.x, h.y, h.k);
  return `<div class="ev-map" id="ev-map">
    <svg class="ev-svg" viewBox="0 0 ${EV_VW} ${EV_VH}" role="img"
         aria-label="Where these events happened">
      <g id="ev-view" transform="${evView(h.x, h.y, h.k)}">
        <g class="ev-land-fade" style="opacity:${evLandAt(h.k)}">${META.basemap || ''}</g>
      </g>
      ${(META.layers || []).map(L => `<g class="ev-layer" data-zoom="${L.zoom}"
         data-x="${L.ox}" data-y="${L.oy}" style="opacity:${evLayerAt(h.k, L.zoom)}"
         transform="translate(${evAt2(L.ox, L.oy, h.x, h.y, h.k)
           .join(' ')}) scale(${h.k})">${L.paths}</g>`).join('')}
      ${evPlaces.map((q, i) => `<g class="ev-label${
           q.zoom === tier && seen(q) ? ' on' : ''}" data-ev-label="${i}"
         transform="translate(${evAt2(q.x, q.y, h.x, h.y, h.k).join(' ')})"
         >${q.kind === 'station' ? EV_STOP : ''}<text dy="${
           q.kind ? 16 : 5}">${esc(q.name)}</text></g>`).join('')}
      ${evPins.map((p, i) => `<g class="ev-pin${named[i] ? ' named' : ''}" data-ev-pin="${i}"
         data-x="${p.x}" data-y="${p.y}"
         transform="translate(${evAt2(p.x, p.y, h.x, h.y, h.k).join(' ')})">
        <ellipse class="ev-pin-cast" rx="4.4" ry="1.7"/>
        <g class="ev-pin-in"><path class="ev-pin-body" d="${EV_PIN}"/>
        <circle class="ev-pin-eye" cy="-16.9" r="3.4"/></g>
        <text class="ev-pin-name" y="-31">${esc(p.place)}</text>
      </g>`).join('')}
    </svg>
    <div class="ev-card" id="ev-card" hidden></div>
    <div class="ev-tools">
      <button type="button" data-ev-zoom="1" aria-label="Zoom in">+</button>
      <button type="button" data-ev-zoom="-1" aria-label="Zoom out">−</button>
      <button type="button" class="ev-reset" data-ev-reset="home">Recentre</button>
      <button type="button" class="ev-reset" data-ev-reset="all">Show all</button>
    </div>
  </div>`;
}

// One listener for every way in: a pin, an entry in the list below it, and the
// buttons. `evDragged` is how a pan that ends on a pin avoids also picking it.
document.addEventListener('click', e => {
  const step = e.target.closest('[data-ev-zoom]');
  if (step) {
    const r = evFrame(document.querySelector('#ev-map .ev-svg'));
    return evZoomAt(+step.dataset.evZoom > 0 ? 1.8 : 1 / 1.8,
                    r.left + r.width / 2, r.top + r.height / 2);
  }
  if (evDragged) return (evDragged = false);
  const pin = e.target.closest('[data-ev-pin]');
  if (pin) return evPick(+pin.dataset.evPin);
  const row = e.target.closest('[data-tl-pick]');
  if (row) return evPick(+row.dataset.tlPick);
  // Two frames worth returning to and neither derives the other: `Recentre` is
  // the opening view — where most of these events happened — and `Show all` is
  // every pin, which is now a place you go rather than a place you start.
  const reset = e.target.closest('[data-ev-reset]');
  if (reset) {
    evDrop();
    const h = reset.dataset.evReset === 'all' ? evFit(evPins) : evHome();
    evLive();
    evGo(h.x, h.y, h.k);
  }
});

// The wheel over the map is the map's, not the page's — which is the trade for
// driving it without a modifier.
//
// **`ctrlKey` is what separates a pinch from a swipe**, and it is the only
// signal the platform gives: a trackpad pinch is delivered as a wheel event
// with `ctrlKey` set, whether or not a key is held. So a two-finger swipe pans
// and a pinch zooms, which is what both gestures do everywhere else on the
// machine — the map used to zoom on either, and panning a map by dragging it a
// screen at a time is the part that made it feel like a diagram rather than a
// map.
//
// A mouse wheel is indistinguishable from a two-finger swipe here and will
// therefore pan. That is deliberate: telling them apart needs a heuristic on
// delta size or integer-ness that breaks on someone's hardware, and the `+`
// and `−` buttons are already on the map for exactly this.
document.addEventListener('wheel', e => {
  const map = e.target.closest('.ev-map');
  if (!map) return;
  e.preventDefault();
  if (e.ctrlKey) {
    return evZoomAt(Math.exp(-e.deltaY * 0.012), e.clientX, e.clientY);
  }
  // A wheel reporting in lines rather than pixels would otherwise pan three
  // units and read as broken.
  const px = e.deltaMode === 1 ? 16 : 1;
  const u = EV_VW / evFrame(map.querySelector('.ev-svg')).width;
  evLive();
  // Added, where the drag subtracts: dragging grabs the content and carries it
  // with the finger, scrolling moves the frame over it. Same gesture, opposite
  // sign, and getting it wrong is the one that feels immediately wrong.
  evGo(evNow.x + e.deltaX * px * u / evNow.k,
       evNow.y + e.deltaY * px * u / evNow.k, evNow.k);
}, {passive: false});

let evDrag = null, evDragged = false;
document.addEventListener('pointerdown', e => {
  const map = e.target.closest('.ev-map');
  if (!map || e.button !== 0 || e.target.closest('button')) return;
  const svg = map.querySelector('.ev-svg');
  // Viewport units per CSS pixel. The SVG keeps its aspect ratio, so one
  // number does for both axes.
  evDrag = {cx: e.clientX, cy: e.clientY, x: evNow.x, y: evNow.y,
            u: EV_VW / evFrame(svg).width};
  evDragged = false;
  svg.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', e => {
  if (!evDrag) return;
  const dx = e.clientX - evDrag.cx, dy = e.clientY - evDrag.cy;
  // A few pixels of slop, so a click with an unsteady hand is still a click.
  if (!evDragged && Math.hypot(dx, dy) < 4) return;
  evDragged = true;
  evLive();
  evGo(evDrag.x - dx * evDrag.u / evNow.k,
       evDrag.y - dy * evDrag.u / evNow.k, evNow.k);
});
document.addEventListener('pointerup', () => { evDrag = null; });
