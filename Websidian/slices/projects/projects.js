/** The active projects, for the Projects Home.
 *
 *  Read from the folders, not listed by hand. The status *is* the folder, so
 *  promoting a project is a `mv` and the card follows — a hand-kept list on
 *  this page went stale the moment one moved, and took four dead links with it.
 */
const SAK_W = 440, SAK_H = 380;      // the tree's own box; the card scales it
let sakN = 0;                        // unique ids, one haze filter per tree

/** A tiny deterministic generator, seeded from a string.
 *
 *  The shape has to be the *same* tree every time it is drawn. A tree that
 *  reshuffles on each render is decoration; one that keeps its silhouette is
 *  something you recognise across visits and can read a change in. */
function seeded(str) {
  let a = 2166136261;
  for (let i = 0; i < str.length; i++) a = Math.imul(a ^ str.charCodeAt(i), 16777619);
  return () => {                                              // mulberry32
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** One stroke of a loaded brush: a bent spine walked at a tapering half-width.
 *
 *  A stroke of even weight reads as a diagram of a tree. Real ink lands fat
 *  where the brush touches down and leaves thin where it lifts, so this is a
 *  filled outline rather than a stroked line — the width is the drawing. The
 *  per-sample wobble is the hand: without it the taper is a machined cone.
 *
 *  Returns the tip, and grows `bb` to whatever the stroke covered, so the frame
 *  can be measured off the ink instead of guessed at. */
function brush(x, y, ang, bend, len, w0, w1, rnd, bb) {
  const mx = x + Math.cos(ang + bend) * len * .5, my = y + Math.sin(ang + bend) * len * .5;
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  const L = [], R = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, u = 1 - t;
    const px = u * u * x + 2 * u * t * mx + t * t * x2;
    const py = u * u * y + 2 * u * t * my + t * t * y2;
    const tx = 2 * (u * (mx - x) + t * (x2 - mx)), ty = 2 * (u * (my - y) + t * (y2 - my));
    const h = Math.hypot(tx, ty) || 1;
    const w = (w0 + (w1 - w0) * t) * (.8 + rnd() * .4);
    L.push([px - ty / h * w, py + tx / h * w]);
    R.push([px + ty / h * w, py - tx / h * w]);
    bb[0] = Math.min(bb[0], px - w); bb[1] = Math.min(bb[1], py - w);
    bb[2] = Math.max(bb[2], px + w); bb[3] = Math.max(bb[3], py + w);
  }
  const pts = L.concat(R.reverse()).map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1));
  return {d: `M${pts.join('L')}Z`, end: [x2, y2], ang: ang + bend * .6};
}

/** The canopy, deep to pale — and deliberately *not* the recency ramp.
 *
 *  Crimson on this site means a value. A whole crown painted in it would say
 *  every leaf was a number, which is the opposite of what a canopy is for: the
 *  mass is the picture, and only the blossom is a reading. So the leaves get
 *  their own six blossom-pinks, and the ramp survives exactly where it means
 *  something — in the eye of each flower, one per milestone.
 *
 *  Kept as class names rather than literals because colour on this site lives
 *  in the token block; the JS picks a step, `projects.css` says what it is. */
const SAK_STEPS = 6;

/** A project as a sakura: the wood is the work, the blossom is what came of it.
 *
 *  **One blossom is one milestone**, not one commit. A commit is a save; a
 *  milestone is the judgement that something changed, and only the second is
 *  worth a flower. This is a standing constraint on `Data/milestones.csv` as
 *  much as a drawing decision — a row added for the sake of a fuller tree makes
 *  every other blossom mean less. The eye of each flower takes the same
 *  four-step ramp the rest of the site uses for recency, so the newest work is
 *  the fullest crimson.
 *
 *  **The shape is the count.** Every project starts as a bare trunk and earns a
 *  bough per five milestones, and about thirty petals of canopy with it. That
 *  is the reading the card is for — you should be able to tell how far a project
 *  has come from across the room, without looking at a single number under it. A
 *  finished project blooms every tip it has: the one state the count cannot
 *  reach on its own.
 *
 *  **The canopy is grown, not pasted on.** Every leaf hangs off a point sampled
 *  from a branch, which is why the crown holds the same silhouette from a bare
 *  trunk to a full head — and why the drawing order is haze, back leaves, wood,
 *  front leaves. The wood going down *between* the two leaf passes is the whole
 *  look: dark limbs surface through the pink where the front pass happens to
 *  miss them and are buried where it does not, the way they are in a painted
 *  tree rather than in a diagram of one.
 */
function sakura(slug, done) {
  const a = (META.projects || {})[slug];
  if (!a) return `<p class="hint">No repository linked yet — add one to
    <code>REPOS</code> in <code>slices/projects/data.py</code>.</p>`;
  // Newest first, so the first tips to bloom carry the freshest milestones.
  const ms = ((META.milestones || {})[slug] || []).slice().reverse();
  const rnd = seeded(slug), r1 = n => n.toFixed(1);

  // What makes this project's tree its own. All six read off the slug, so a
  // project is the same tree every visit and no two of them come out alike —
  // which is the only reason a row of cards is worth looking at as a row.
  const lean   = (rnd() - .5) * .30;      // which way it grew out of the ground
  const flat   = .60 + rnd() * .26;       // crown aspect: wide mushroom, tall dome
  const leafAR = 1.4 + rnd() * 1.2;       // leaf stroke: round dab, long blade
  const pal0   = Math.floor(rnd() * 2);   // palette rotation: deeper, or paler

  // A bough per five milestones, plus the two it starts with, so a project with
  // a repo and nothing reached yet is a young tree rather than a post.
  const limbs = Math.max(2, Math.min(9, 2 + Math.floor(ms.length / 5)));
  // Three levels even at zero, because two drew a slingshot rather than a tree:
  // a project on day one has a shape, it just has nothing on it yet.
  const depth = Math.max(3, Math.min(6, 2 + Math.floor(ms.length / 4)));
  // About thirty petals a milestone — the number that turns a sapling into a
  // tree, and the only thing a milestone buys directly besides its own flower.
  // A finished project is given a canopy it may not have earned in rows, because
  // a bare done tree would read as abandoned rather than as complete.
  // ponytail: the 900 ceiling is a drawing budget, not a meaning — past about
  // thirty milestones the crown is solid and more ellipses only cost paint.
  const nLeaf = Math.min(900, Math.max(ms.length, done ? 8 : 0) * 30);

  // The frame is measured off the ink, never fixed in advance: a nine-bough
  // crown and a bare trunk are wildly different shapes.
  const bb = [1e9, 1e9, -1e9, -1e9];
  const hit = (x, y, r) => {
    bb[0] = Math.min(bb[0], x - r); bb[1] = Math.min(bb[1], y - r);
    bb[2] = Math.max(bb[2], x + r); bb[3] = Math.max(bb[3], y + r);
  };
  const wood = [], anchors = [], tips = [];

  // The trunk, drawn before anything branches off it: three strokes, each
  // bending against the last. It is the one part of the tree that is there on
  // day one, so it has to read as a trunk and not as the first branch — thicker
  // than anything above it, and rooted below the frame so the brush's blunt
  // landing is cropped away and the wood comes up out of ground.
  const forks = [], footX = SAK_W * .5 + lean * 90;
  let tx = footX, ty = SAK_H + 36, ta = -Math.PI / 2 + lean, tw = 19;
  for (let i = 0; i < 3; i++) {
    const s = brush(tx, ty, ta, (i % 2 ? -1 : 1) * (.14 + rnd() * .26),
                    62 * (1 - i * .14), tw, tw * .80, rnd, bb);
    wood.push(`<path d="${s.d}"/>`);
    forks.push([s.end[0], s.end[1], tw]);
    tx = s.end[0]; ty = s.end[1]; ta = s.ang + (rnd() - .5) * .20; tw *= .80;
  }
  // The root flare: three short splayed strokes at the foot. It is what makes a
  // trunk look planted rather than inserted, and it costs three strokes.
  for (let i = -1; i <= 1; i++) {
    const s = brush(footX, SAK_H + 4, -Math.PI / 2 + i * 1.15, i * .5, 30, 10, 3.5, rnd, bb);
    wood.push(`<path d="${s.d}"/>`);
  }

  function grow(x, y, ang, len, w, d) {
    // The trunk kinks; the twigs only waver. An old plum is drawn by its elbows,
    // and a bend that stayed constant down the tree read as a fern.
    const bend = (rnd() - .5) * (d > depth - 2 ? .7 : .4);
    const s = brush(x, y, ang, bend, len, w, w * .6, rnd, bb);
    wood.push(`<path d="${s.d}"/>`);
    // Anchors are what the canopy hangs on: three points down each outer branch,
    // weighted by how far out it is. Only the outer half of the tree carries
    // foliage — leaves growing off the trunk is the tell that a canopy was
    // pasted over a drawing rather than grown from it.
    if (d <= depth - 1) for (let k = 1; k <= 3; k++) {
      const t = k / 3;
      anchors.push([x + (s.end[0] - x) * t, y + (s.end[1] - y) * t, .55 + (depth - d) * .18]);
    }
    // ponytail: 380 strokes is the drawing budget, enforced depth-first. `depth`
    // above is what keeps a tree from reaching it; this is only the backstop.
    if (d <= 1 || wood.length > 380) return tips.push(s.end);
    // A leader that carries on, plus one or two that break away — not a fork in
    // two even halves. The asymmetry is what makes it a tree and not a delta.
    const kids = 1 + (rnd() < .85 ? 1 : 0) + (d > depth - 3 && rnd() < .4 ? 1 : 0);
    for (let i = 0; i < kids; i++) {
      let ca = s.ang + (i ? (i % 2 ? 1 : -1) * (.5 + rnd() * .75) : (rnd() - .5) * .42);
      // Past the trunk, every angle is pulled towards the horizontal. A crown
      // that grows evenly in all directions fills a circle, and the card is a
      // wide hole — this is the same tree, flattened into a scroll's proportion.
      if (d < depth - 1) ca = Math.atan2(Math.sin(ca) * flat, Math.cos(ca));
      // A branch aimed steeply back down crosses its own parent, and a stroke
      // laid over the one it grew from reads as a mistake rather than a bough.
      if (Math.sin(ca) > .28) ca = -ca;
      grow(s.end[0], s.end[1], ca,
           len * (i ? .68 : .84) * (.9 + rnd() * .2), w * (i ? .55 : .72), d - 1);
    }
  }

  // The boughs fan symmetrically about the vertical and the fan widens with
  // their number, so two milestones' worth of tree is a pair of shoots carrying
  // on upward and fifty is a crown reaching out level on both sides. They leave
  // the trunk top-down, so a young tree branches high and an old one all the
  // way up.
  const spread = Math.min(1.45, .55 + limbs * .10);
  for (let i = 0; i < limbs; i++) {
    const [fx, fy, fw] = forks[forks.length - 1 - (i % forks.length)];
    grow(fx, fy, -Math.PI / 2 + ((i + .5) / limbs - .5) * 2 * spread + (rnd() - .5) * .24,
         62 * (.85 + rnd() * .4), fw * .62, depth);
  }
  if (!anchors.length) anchors.push([forks[2][0], forks[2][1], 1]);

  // The haze: one soft blob per anchor, blurred, under everything. It is what
  // makes the crown one mass instead of a swarm — without it the leaves read as
  // confetti however many are drawn. Deliberately smaller than the leaf scatter
  // so the leaves overhang it; a haze that reached past them read as a lit halo
  // rather than as depth.
  const haze = [], back = [], front = [];
  anchors.forEach(([ax, ay, sc]) => {
    if (!nLeaf || rnd() > .5) return;
    const r = (10 + rnd() * 11) * Math.min(1.5, sc);
    haze.push(`<ellipse cx="${r1(ax)}" cy="${r1(ay)}" rx="${r1(r * 1.2)}"
      ry="${r1(r * .78)}" class="k${1 + ((rnd() * 3) | 0)}"
      fill-opacity="${(.16 + rnd() * .14).toFixed(2)}"/>`);
  });
  for (let i = 0; i < nLeaf; i++) {
    const [ax, ay, sc] = anchors[Math.floor(rnd() * anchors.length)];
    // Three draws averaged, so a cluster has a soft edge instead of a disc rim.
    const rad = (rnd() + rnd() + rnd()) / 3 * 17 * Math.min(1.6, sc);
    const th = rnd() * 6.283;
    const x = ax + Math.cos(th) * rad * 1.4, y = ay + Math.sin(th) * rad * .9;
    const rx = (4.2 + rnd() * 3.6) * Math.min(1.3, sc), ry = rx / leafAR;
    const isBack = rnd() < .45;
    // Back leaves run deeper, front leaves paler: depth in a painted canopy is
    // value, not blur. The rotation is per leaf because a bed of ellipses all
    // lying the same way is the tell that a picture was computed.
    const step = pal0 + (isBack ? (rnd() * 3) | 0 : 2 + ((rnd() * 4) | 0));
    hit(x, y, rx);
    (isBack ? back : front).push(`<ellipse cx="${r1(x)}" cy="${r1(y)}"
      rx="${r1(rx)}" ry="${r1(ry)}" class="k${Math.min(SAK_STEPS, step)}"
      fill-opacity="${(isBack ? .72 + rnd() * .28 : .78 + rnd() * .22).toFixed(2)}"
      transform="rotate(${(rnd() * 180) | 0} ${r1(x)} ${r1(y)})"/>`);
  }

  // Which tips bloom: shuffled, so a half-grown tree flowers all over rather
  // than filling up one branch at a time.
  const order = tips.map(p => [rnd(), p]).sort((u, v) => u[0] - v[0]).map(u => u[1]);
  const open = done ? tips.length : Math.min(ms.length, tips.length);
  const now = Date.now();
  const petals = order.slice(0, open).map(([x, y], i) => {
    const m = ms[i];
    const age = m ? (now - Date.parse(m.date + 'T00:00:00Z')) / 864e5 : 999;
    const step = age < 14 ? 4 : age < 45 ? 3 : age < 120 ? 2 : 1;
    // Five white lobes and a coloured eye, not a dot: at this size it is the
    // difference between a cherry blossom and a berry, and it costs six circles.
    // White is what lifts it clear of the pink it sits on — the canopy is the
    // picture, and this is the one mark on it that is a reading.
    const r = 5.4 + rnd() * 1.8, a0 = rnd() * 6.28;
    const lobes = [0, 1, 2, 3, 4].map(k => {
      const th = a0 + k * 1.2566;
      return `<circle cx="${r1(x + Math.cos(th) * r * .6)}"
        cy="${r1(y + Math.sin(th) * r * .6)}" r="${r1(r * .46)}"/>`;
    }).join('');
    hit(x, y, r);
    // The blossom is the milestone, so hovering one says which.
    const t = m ? `<title>${esc(m.date)} · ${esc(m.title)}</title>` : '';
    return `<g class="l${step}">${t}${lobes}
      <circle class="core" cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * .42)}"/>
      <circle class="pip" cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * .19)}"/></g>`;
  }).join('');

  // The bud. A project with an open draft — work that changed something real but
  // has not yet earned a row — carries **one**, on the next tip that would have
  // flowered. One, never more, however much has accumulated: a count here would
  // be a second scale competing with the blossom, and the whole worth of this
  // drawing is that one mark means one thing. It is ink rather than pigment
  // because it has not opened, and it disappears the day the milestone lands.
  const draft = (META.drafts || {})[slug];
  const budTip = draft && !done && order[open];
  const bud = budTip ? (() => {
    const [x, y] = budTip, r = 4.4, c = draft.counts || {};
    hit(x, y, r * 1.9);
    const has = [[c.dropped, 'dropped decision'], [c.code, 'snippet'],
                 [c.refs, 'source']].filter(([n]) => n)
      .map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`).join(', ');
    return `<g class="sak-bud"><title>Not yet a milestone${
      draft.since ? ` · open since ${esc(draft.since)}` : ''}${
      has ? ` · ${esc(has)}` : ''}</title>
      <path d="M${r1(x)} ${r1(y + r * 1.5)}C${r1(x - r)} ${r1(y + r * .4)} ${
        r1(x - r * .8)} ${r1(y - r)} ${r1(x)} ${r1(y - r * 1.2)}C${
        r1(x + r * .8)} ${r1(y - r)} ${r1(x + r)} ${r1(y + r * .4)} ${
        r1(x)} ${r1(y + r * 1.5)}Z"/></g>`;
  })() : '';

  // The frame, fitted to the ink but only within one aspect and one floor. A box
  // cut exactly to the drawing gave every card a different height and blew a
  // bare trunk up to the size of a full crown — which is the one reading this
  // picture exists to give. So: the bottom pinned to the ground, the width never
  // below a floor, and the frame grown from there until the crown fits. A young
  // tree is then genuinely small in its card, and a grown one fills it.
  //
  // The foot of the trunk is cut off by the frame rather than fitted inside it.
  // A stroke that ends where the brush was still down leaves a blunt stump; run
  // it off the bottom edge and it reads as a tree standing in ground.
  // The aspect is the card's, not the tree's. A project card is a wide hole and
  // a squarish tree floated in the middle of one with white on both sides; the
  // crown is flattened to match rather than the box being cropped to the crown.
  const AR = 1.62, FLOOR = 340;
  const y1 = Math.min(bb[3], SAK_H) + 4;
  let bw = Math.max(bb[2] - bb[0] + 20, FLOOR), bh = bw / AR;
  const y0 = Math.min(y1 - bh, bb[1] - 10);   // grow upward if the crown is taller
  bh = y1 - y0; bw = Math.max(bw, bh * AR);   // and back out if that made it tall
  const cx = (bb[0] + bb[2]) / 2;
  const box = [cx - bw / 2, y0, bw, bh].map(r1).join(' ');

  // Petals on the way down. They are the one part of the drawing that means
  // nothing, and they are placed after the frame is measured for exactly that
  // reason: a petal is not part of the tree, and letting one drag the box open
  // would shrink every tree it happened to fall from.
  const fall = nLeaf ? Array.from({length: 7}, () => {
    const x = cx - bw / 2 + rnd() * bw, y = y0 + rnd() * bh * .95;
    const r = 3 + rnd() * 2.4;
    return `<path class="k${3 + ((rnd() * 3) | 0)}" fill-opacity=".8"
      transform="rotate(${(rnd() * 360) | 0} ${r1(x)} ${r1(y)})"
      d="M${r1(x)} ${r1(y - r)}C${r1(x + r)} ${r1(y - r * .4)} ${r1(x + r * .7)} ${
        r1(y + r * .8)} ${r1(x)} ${r1(y + r)}C${r1(x - r * .7)} ${r1(y + r * .8)} ${
        r1(x - r)} ${r1(y - r * .4)} ${r1(x)} ${r1(y - r)}Z"/>`;
  }).join('') : '';

  const id = `sak${++sakN}`;
  return `<svg class="sak" viewBox="${box}" aria-hidden="true"><defs>
    <filter id="${id}" x="-15%" y="-15%" width="130%" height="130%">
      <feGaussianBlur stdDeviation="6.5"/></filter></defs>
    <ellipse class="sak-ground" cx="${r1(footX)}" cy="${r1(y1 - 8)}" rx="78" ry="9"/>
    <g class="sak-leaf" filter="url(#${id})">${haze.join('')}</g>
    <g class="sak-leaf">${back.join('')}</g>
    <g class="sak-wood">${wood.join('')}</g>
    <g class="sak-leaf">${front.join('')}</g>
    <g class="sak-bloom">${petals}</g>${bud}
    <g class="sak-leaf">${fall}</g></svg>`;
}

/** How far along, as one bar: start date on the left, target date on the right,
 *  milestones as ticks where they fell.
 *
 *  Start is the repository's first commit — read, not declared, so it cannot go
 *  stale. The end is `due` from `Data/projects.csv`, and only that end makes a
 *  percentage mean anything. Without it the rail is drawn but left unfilled:
 *  time elapsed is not progress, and a bar painted to the end because nobody
 *  set a deadline would read as finished.
 */
/** Over: the target date has arrived, or the row says so in as many words.
 *  The only thing that blooms a tree past the commits it actually has. */
function projectDone(slug) {
  const m = (META.projectmeta || {})[slug] || {};
  return /\b(done|complete|completed|shipped|finished)\b/i.test(m.status || '')
    || (!!m.due && Date.parse(m.due + 'T00:00:00Z') <= Date.now());
}

function projectProgress(slug) {
  const a = (META.projects || {})[slug] || {};
  const due = ((META.projectmeta || {})[slug] || {}).due;
  if (!a.first) return '';
  const day = 864e5, t0 = Date.parse(a.first + 'T00:00:00Z'), now = Date.now();
  const span = Math.max((due ? Date.parse(due + 'T00:00:00Z') : now) - t0, day);
  const at = t => Math.max(Math.min((Date.parse(t + 'T00:00:00Z') - t0) / span, 1), 0) * 100;
  const pct = Math.round(Math.min((now - t0) / span, 1) * 100);
  const ms = (META.milestones || {})[slug] || [];
  const days = Math.round((now - t0) / day);
  return `<div class="prog${due ? '' : ' open'}"
    title="${esc(a.first)} → ${due ? esc(due) : 'no target date'}">
    ${due ? `<div class="prog-fill" style="width:${pct}%"></div>` : ''}
    ${ms.map(m => `<i style="left:${at(m.date).toFixed(1)}%"
      title="${esc(m.date)} · ${esc(m.title)}"></i>`).join('')}</div>
    <div class="hint">${esc(a.first)} · ${days}d
      · ${due ? `${pct}% to ${esc(due)}` : 'no target'}
      · ${ms.length} milestone${ms.length === 1 ? '' : 's'} · ${a.total} commits</div>`;
}

/** The four things worth knowing about a project at a glance, as cards on its
 *  own page. Reads `Data/projects.csv` by the page's slug — a blank cell shows
 *  a dash, because an invented urgency is worse than an admitted gap. */
function projectMeta(n) {
  const m = (META.projectmeta || {})[n.slug] || {};
  const card = (label, key, note) => `<div class="box s3"><h3>${label}</h3>
    <div class="big${m[key] ? '' : ' none'}">${esc(m[key] || '—')}</div>
    ${note ? `<div class="hint">${note}</div>` : ''}</div>`;
  const a = (META.projects || {})[n.slug];
  return `<div class="bento">
    ${card('Current status', 'status')}
    ${card('Urgency', 'urgency')}
    ${card('Time spent', 'time_spent', a ? `${a.total} commits in the last year` : '')}
    ${card('Est. completion', 'due')}
  </div>${Object.keys(m).length ? '' :
    `<p class="hint">No row for this page in <code>Data/projects.csv</code>.</p>`}`;
}

/** The milestones a project has actually reached, oldest first, so the line
 *  reads downward as the thing grew. A project that was never active has no
 *  timeline at all rather than an empty one; one with a repo but no milestones
 *  yet is told where to add them. */
function milestonesBlock(n) {
  const rows = (META.milestones || {})[n.slug] || [];
  if (!rows.length) {
    return (META.projects || {})[n.slug]
      ? `<p class="hint">No milestones yet — add rows to
         <code>Data/milestones.csv</code>.</p>` : '';
  }
  // How long the project sat between milestones, on the right of each entry.
  // Same-day entries say nothing — the number would be a row of zeroes — and
  // close up instead, so a day's worth of work reads as one cluster of separate
  // things rather than as four days of steady progress.
  // The days that did not earn a milestone, folded in between the ones that
  // did. They used to be `#websidian` rows in `work-log.csv`, which put a
  // project's homework on the Work page; they belong on the project, and the
  // spine already had the right shape for them.
  //
  // The gap pill is left to the milestones alone. It answers "how long did this
  // project sit still", and a quiet day is the opposite of sitting still — it
  // would read as progress toward the next milestone, which is a claim the log
  // does not make.
  const log = (META.projectlog || {})[n.slug] || {};
  const quiet = Object.entries(log).map(([date, bullets]) => {
    const n_ = k => bullets.filter(b => b.kind === k).length;
    const part = [[n_('did'), 'changed'], [n_('learned'), 'learned'],
                  [bullets.filter(b => b.kind === 'open' && !b.closed).length, 'open']]
      .filter(([c]) => c).map(([c, w]) => `${c} ${w}`).join(' · ');
    return {when: date, quiet: true, bullets,
            title: part || `${bullets.length} logged`};
  });

  const all = rows.map((m, i) => {
    const since = i ? apartDays(rows[i - 1].date, m.date) : 0;
    const next = rows[i + 1];
    return {when: m.date, title: m.title, note: m.note,
            parts: m.parts, counts: m.counts,
            tight: next && next.date === m.date,
            now: i === rows.length - 1,
            gap: since ? gapLabel(since) : '',
            gapTitle: since ? `${since} day${since === 1 ? '' : 's'} after the one before` : ''};
  }).concat(quiet)
    // A quiet day sorts after the milestones it shares a date with: the
    // milestone is what the day is remembered for, and the log is the detail
    // underneath it.
    .sort((a, b) => a.when.localeCompare(b.when) || (a.quiet ? 1 : -1));

  const logged = Object.values(log).reduce((s, b) => s + b.length, 0);
  return `<div class="foot"><h2>Progress</h2>
    ${timeline(all)}
    <div class="hint">${rows.length} milestones · latest ${esc(rows[rows.length - 1].date)}
      · the pill on the right is the wait since the one above${logged
        ? ` · ${logged} logged bullet${logged === 1 ? '' : 's'} across ${
            quiet.length} working day${quiet.length === 1 ? '' : 's'}, folded` : ''}</div>
  </div>`;
}

/** What is known to be wrong with a project, worst first.
 *
 *  Severity here is not a priority score, it is a statement about how the fault
 *  presents — which is the only ranking this vault has ever used. `silent` is
 *  top because a wrong number that renders as an ordinary page is the fault
 *  nobody ever gets round to noticing, and `open` is bottom because an
 *  undecided question has not gone wrong yet.
 *
 *  The dialog is `timeline.js`'s, reached by emitting its markup rather than by
 *  calling `timeline()` — these are not a dated list and drawing them on a
 *  spine would claim a chronology they do not have. Its click handler is
 *  delegated at the document, so a `[data-tl-open]` anywhere on the page opens
 *  the matching `<dialog>` with no rebinding and no second copy of the code.
 */
const CH_SEVERITY = {
  silent:   ['Silent', 'wrong, and looks right'],
  blocking: ['Blocking', 'something cannot be done at all'],
  visible:  ['Visible', 'wrong, and obvious'],
  open:     ['Open', 'undecided, not yet a defect'],
};

function challengesBlock(n) {
  const rows = (META.challenges || {})[n.slug] || [];
  if (!rows.length) {
    return (META.projects || {})[n.slug]
      ? `<p class="hint">Nothing recorded — add rows to
         <code>Data/challenges.csv</code>.</p>` : '';
  }
  const counts = {};
  rows.forEach(c => (counts[c.severity] = (counts[c.severity] || 0) + 1));

  return `<div class="foot"><h2>Known problems</h2>
    <div class="row ch-key">${Object.keys(CH_SEVERITY)
      .filter(s => counts[s]).map(s => `<button type="button" class="badge ch-${s}"
        data-ch-filter="${s}" aria-pressed="false"
        title="${esc(CH_SEVERITY[s][1])} — click to see only these"
        >${esc(CH_SEVERITY[s][0])}<b>${counts[s]}</b></button>`).join('')}</div>
    <div class="ch-list">${rows.map(c => {
      const id = `tlx${++tlSeq}`;
      const head = `<span class="badge ch-${esc(c.severity)}"
          title="${esc((CH_SEVERITY[c.severity] || ['', ''])[1])}"
          >${esc((CH_SEVERITY[c.severity] || [c.severity])[0])}</span>
        <b>${esc(c.title)}</b>
        <p>${esc(c.note)}</p>`;
      // No write-up yet is a flat row rather than a dead button — a control
      // that opens an empty dialog is worse than no control.
      if (!c.detail) return `<div class="ch" data-sev="${esc(c.severity)}">${head}</div>`;
      return `<div class="ch" data-sev="${esc(c.severity)}">
        <button type="button" class="ch-hit" data-tl-open="${id}">${head}
          <span class="ch-more">Read →</span></button>
        <dialog id="${id}" class="tl-modal">
          <form method="dialog"><button class="tl-close" aria-label="Close">✕</button></form>
          <div class="tl-when">${esc(c.severity)}${
            c.noticed ? ' · noticed ' + esc(c.noticed) : ''}</div>
          <h3>${esc(c.title)}</h3>
          <div class="tl-part tl-account">${c.detail}</div>
        </dialog>
      </div>`;
    }).join('')}</div>
    <div class="hint">${rows.length} recorded · click a severity to see only
      those · every one of these is diagnosed and deliberately unfixed — the
      account says why</div>
  </div>`;
}

/** The severity chips filter the list they head.
 *
 *  Delegated at the document, the same call `timeline.js` makes: this block is
 *  redrawn by any route change, and a handler bound to the buttons would have
 *  to be re-bound by whatever redrew them.
 *
 *  Filtering is `hidden` on the cards rather than a re-render, because a card
 *  holds a `<dialog>` — rebuilding the list would destroy an open write-up and
 *  mint a second set of ids for the ones that survived.
 */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ch-filter]');
  if (!b) return;
  const key = b.closest('.ch-key');
  const list = key.parentElement.querySelector('.ch-list');
  // Clicking the active one again clears it, so the filter needs no All chip —
  // the control that turned it on is the control that turns it off.
  const only = list.dataset.only === b.dataset.chFilter ? '' : b.dataset.chFilter;
  list.dataset.only = only;
  list.querySelectorAll('.ch').forEach(c =>
    (c.hidden = !!only && c.dataset.sev !== only));
  key.querySelectorAll('[data-ch-filter]').forEach(x =>
    x.setAttribute('aria-pressed', String(x.dataset.chFilter === only)));
});

// `size=full` in projects.csv is the one thing here that is not read off
// git or the page itself — a project spanning what it will hold, rather than
// what it holds today, is a judgement only the person building it can make.
const bigProject = n => ((META.projectmeta || {})[n.slug] || {}).size === 'full';

function projectsBlock() {
  // `!n.parent` matters: a sub-page sits in the same status folder as its
  // parent, so it inherits `group` — Specifications would list itself here as
  // a project of its own.
  const active = NOTES.filter(n => n.category === 'personal-projects'
                                   && n.group === 'active' && !n.parent);
  if (!active.length) return '<p class="hint">Nothing in <code>active/</code> yet.</p>';
  // A full-size project leads the page, at the width its own tree needs to
  // read as more than one branch; everything else stays side by side below
  // it, which is still the point for two ordinary active projects.
  const sorted = [...active].sort((a, b) => (bigProject(b) ? 1 : 0) - (bigProject(a) ? 1 : 0));
  return `<div class="bento">${sorted.map(n => `<div class="box ${
      bigProject(n) ? 's12' : 's6'} proj">
    <h3><a href="#/n/${encodeURIComponent(n.slug)}">${esc(n.title)} →</a></h3>
    ${sakura(n.slug, projectDone(n.slug))}
    ${projectProgress(n.slug)}</div>`).join('')}</div>`;
}
