/**
 * Analyze map-final vs basemap:
 *  - extract annotation pixels (dots + labels)
 *  - cluster them into reveal regions (connected components on dilated mask)
 *  - detect scatter dot centers (solid discs + hollow rings)
 *  - order dots into a smooth walking route (nearest neighbour + 2-opt)
 *  - bind every region to the nearest route dot
 *
 * Outputs:
 *  - assets/annotation-art.png  (map-final pixels only where annotations are, transparent elsewhere)
 *  - assets/region-map.png      (region id encoded in R + G*256, alpha 255 on annotation pixels)
 *  - assets/route-data.json     ({ mapSize, dots, regions })
 *  - assets/debug-route.png     (visual overlay for manual inspection)
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const root = path.resolve(__dirname, "..");
const assetsDir = path.join(root, "assets");

const finalMap = PNG.sync.read(fs.readFileSync(path.join(assetsDir, "map-final.png")));
const baseMap = PNG.sync.read(fs.readFileSync(path.join(assetsDir, "basemap.png")));
const W = finalMap.width;
const H = finalMap.height;
const N = W * H;

if (baseMap.width !== W || baseMap.height !== H) {
  throw new Error("basemap and map-final sizes differ");
}

// ---------------------------------------------------------------- diff masks
// mask: every pixel that belongs to an annotation (dark ink, bright halo/ring fill)
// darkMask: dark ink only (used for dot detection)
const mask = new Uint8Array(N);
const darkMask = new Uint8Array(N);
let diffStats = [0, 0, 0];

for (let p = 0; p < N; p += 1) {
  const i = p * 4;
  const a = finalMap.data[i + 3];
  if (a <= 128) continue;
  const r = finalMap.data[i];
  const g = finalMap.data[i + 1];
  const b = finalMap.data[i + 2];
  const diff =
    Math.abs(r - baseMap.data[i]) +
    Math.abs(g - baseMap.data[i + 1]) +
    Math.abs(b - baseMap.data[i + 2]);
  const brightness = (r + g + b) / 3;

  if (diff > 40) diffStats[0] += 1;
  if (diff > 90) diffStats[1] += 1;

  const dark = brightness < 135 && diff > 40;
  const bright = brightness >= 135 && diff > 90;
  if (dark) darkMask[p] = 1;
  if (dark || bright) {
    mask[p] = 1;
    diffStats[2] += 1;
  }
}

console.log(
  `diff>40: ${diffStats[0]}  diff>90: ${diffStats[1]}  annotation pixels: ${diffStats[2]} (${((diffStats[2] / N) * 100).toFixed(2)}%)`,
);

// grow mask by 2px so anti-aliased edges are included
const grownMask = dilate(mask, 2);

// -------------------------------------------------------------- dot centers
// solid dots: erosion by a disc of radius 5 keeps only thick blobs (text strokes vanish)
const discOffsets5 = discOffsets(5);
const core = new Uint8Array(N);
for (let y = 5; y < H - 5; y += 1) {
  outer: for (let x = 5; x < W - 5; x += 1) {
    const p = y * W + x;
    if (!darkMask[p]) continue;
    for (const [dx, dy] of discOffsets5) {
      if (!darkMask[p + dy * W + dx]) continue outer;
    }
    core[p] = 1;
  }
}

const solidDots = componentCentroids(core).map((c) => ({ x: c.cx, y: c.cy, kind: "solid", size: c.count }));

// hollow rings: scan for pixels surrounded by a closed circle of dark ink,
// tolerant of rings that touch neighbouring label text
const ringCandidates = [];
const nearInk = dilate(darkMask, 12);
const discOffsets4 = discOffsets(4);
const bins = 24;
const binAngles = Array.from({ length: bins }, (_, k) => {
  const angle = (k / bins) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
});

for (let y = 18; y < H - 18; y += 2) {
  candidate: for (let x = 18; x < W - 18; x += 2) {
    const p = y * W + x;
    if (!nearInk[p] || darkMask[p]) continue;

    // interior must be clean
    let interiorInk = 0;
    for (const [dx, dy] of discOffsets4) {
      if (darkMask[p + dy * W + dx]) interiorInk += 1;
    }
    if (interiorInk > discOffsets4.length * 0.05) continue;

    // closed ring of ink at some radius in every direction
    let ringRadius = 0;
    for (let r = 8; r <= 12 && !ringRadius; r += 1) {
      let ok = true;
      for (let k = 0; k < bins && ok; k += 1) {
        let hit = false;
        for (let rr = r - 2; rr <= r + 2 && !hit; rr += 1) {
          const sx = x + Math.round(binAngles[k][0] * rr);
          const sy = y + Math.round(binAngles[k][1] * rr);
          if (darkMask[sy * W + sx]) hit = true;
        }
        if (!hit) ok = false;
      }
      if (ok) ringRadius = r;
    }
    if (!ringRadius) continue;

    // hollow map markers are filled white inside; enclosed glyph boxes show
    // the grey basemap instead
    let brightnessSum = 0;
    for (const [dx, dy] of discOffsets4) {
      const i = (p + dy * W + dx) * 4;
      brightnessSum += (finalMap.data[i] + finalMap.data[i + 1] + finalMap.data[i + 2]) / 3;
    }
    if (brightnessSum / discOffsets4.length < 225) continue;

    ringCandidates.push({ x, y });
  }
}

// cluster candidate centers
const ringDots = [];
for (const c of ringCandidates) {
  const existing = ringDots.find((d) => Math.hypot(d.sumX / d.n - c.x, d.sumY / d.n - c.y) < 10);
  if (existing) {
    existing.sumX += c.x;
    existing.sumY += c.y;
    existing.n += 1;
  } else {
    ringDots.push({ sumX: c.x, sumY: c.y, n: 1 });
  }
}
for (let i = 0; i < ringDots.length; i += 1) {
  const d = ringDots[i];
  ringDots[i] = { x: d.sumX / d.n, y: d.sumY / d.n, kind: "ring", size: d.n };
}

// merge duplicates (ring detector may double-report near solid dots)
const dots = [];
for (const dot of [...solidDots, ...ringDots]) {
  if (dots.some((d) => Math.hypot(d.x - dot.x, d.y - dot.y) < 16)) continue;
  dots.push(dot);
}
console.log(`solid dots: ${solidDots.length}  rings: ${ringDots.length}  total dots: ${dots.length}`);

// -------------------------------------------------------------- reveal regions
// cluster annotation pixels: connected components on a dilated mask so the
// characters of one label (and its dot) fuse into a single region
const clusterMask = dilate(grownMask, 4);
const clusterLabels = labelComponents(clusterMask);
const regionsById = new Map();

for (let p = 0; p < N; p += 1) {
  if (!grownMask[p]) continue;
  const id = clusterLabels.labels[p];
  let region = regionsById.get(id);
  if (!region) {
    region = { minX: W, minY: H, maxX: 0, maxY: 0, count: 0 };
    regionsById.set(id, region);
  }
  const x = p % W;
  const y = (p / W) | 0;
  if (x < region.minX) region.minX = x;
  if (x > region.maxX) region.maxX = x;
  if (y < region.minY) region.minY = y;
  if (y > region.maxY) region.maxY = y;
  region.count += 1;
}

const regions = [...regionsById.entries()]
  .map(([id, r]) => ({
    clusterId: id,
    x: r.minX,
    y: r.minY,
    w: r.maxX - r.minX + 1,
    h: r.maxY - r.minY + 1,
    count: r.count,
  }))
  .filter((r) => r.count >= 6) // drop stray specks
  .sort((a, b) => a.y - b.y || a.x - b.x);

console.log(`reveal regions: ${regions.length}`);

// -------------------------------------------------------------- route order
// 从上到下的扫掠路线：向上走要付出额外代价，避免曲折回头
const UP_PENALTY = 6;
const start = dots.reduce((best, d) => (d.y < best.y ? d : best), dots[0]);
const end = dots.reduce((best, d) => (d.y > best.y ? d : best), dots[0]);
let order = nearestNeighbourRoute(dots, start, end);
order = improveRoute(order);
const routeDots = order.map((d) => [Math.round(d.x), Math.round(d.y)]);
const backtrack = order.reduce((acc, d, i) => (i ? acc + Math.max(0, order[i - 1].y - d.y) : 0), 0);
console.log(
  `route length: ${Math.round(pathLength(order))} px over ${order.length} dots, upward backtrack: ${Math.round(backtrack)} px`,
);

// bind each region to a route dot. A region may touch several dots (dense
// label clusters); reveal it when the walker reaches the EARLIEST of them so
// the walker never stands on a still-hidden dot.
for (const region of regions) {
  let nearestIndex = 0;
  let nearestDist = Infinity;
  let earliestTouching = Infinity;
  for (let i = 0; i < order.length; i += 1) {
    const dx = Math.max(region.x - order[i].x, 0, order[i].x - (region.x + region.w));
    const dy = Math.max(region.y - order[i].y, 0, order[i].y - (region.y + region.h));
    const d = Math.hypot(dx, dy);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIndex = i;
    }
    if (d < 30 && i < earliestTouching) earliestTouching = i;
  }
  region.dotIndex = earliestTouching !== Infinity ? earliestTouching : nearestIndex;
}

// -------------------------------------------------------------- outputs
// annotation-art: map-final pixels on annotation mask
const art = new PNG({ width: W, height: H });
// region-map: region id encoded in R/G
const regionMap = new PNG({ width: W, height: H });
const regionIndexByCluster = new Map(regions.map((r, i) => [r.clusterId, i]));
let orphanPixels = 0;

for (let p = 0; p < N; p += 1) {
  if (!grownMask[p]) continue;
  const i = p * 4;
  art.data[i] = finalMap.data[i];
  art.data[i + 1] = finalMap.data[i + 1];
  art.data[i + 2] = finalMap.data[i + 2];
  art.data[i + 3] = finalMap.data[i + 3];

  const regionIndex = regionIndexByCluster.get(clusterLabels.labels[p]);
  if (regionIndex === undefined) {
    orphanPixels += 1;
    art.data[i + 3] = 0; // dropped speck: keep it out of the art too
    continue;
  }
  regionMap.data[i] = regionIndex & 255;
  regionMap.data[i + 1] = (regionIndex >> 8) & 255;
  regionMap.data[i + 3] = 255;
}
console.log(`orphan (dropped speck) pixels: ${orphanPixels}`);

fs.writeFileSync(path.join(assetsDir, "annotation-art.png"), PNG.sync.write(art));
fs.writeFileSync(path.join(assetsDir, "region-map.png"), PNG.sync.write(regionMap));

const routeData = {
  mapSize: { width: W, height: H },
  dots: routeDots,
  regions: regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, dotIndex: r.dotIndex })),
};
fs.writeFileSync(path.join(assetsDir, "route-data.json"), JSON.stringify(routeData));
console.log("wrote annotation-art.png, region-map.png, route-data.json");

// debug overlay
const debug = new PNG({ width: W, height: H });
finalMap.data.copy(debug.data);
for (let i = 1; i < order.length; i += 1) {
  drawLine(debug, order[i - 1], order[i], [214, 84, 33]);
}
order.forEach((d, index) => {
  drawDisc(debug, d.x, d.y, 7, index === 0 ? [0, 140, 255] : [214, 84, 33]);
});
fs.writeFileSync(path.join(assetsDir, "debug-route.png"), PNG.sync.write(debug));
console.log("wrote debug-route.png");

// ---------------------------------------------------------------- helpers
function dilate(src, radius) {
  // separable square dilation
  let current = src;
  const tmp = new Uint8Array(N);
  const out = new Uint8Array(N);
  // horizontal
  for (let y = 0; y < H; y += 1) {
    const row = y * W;
    for (let x = 0; x < W; x += 1) {
      let v = 0;
      const from = Math.max(0, x - radius);
      const to = Math.min(W - 1, x + radius);
      for (let xx = from; xx <= to; xx += 1) {
        if (current[row + xx]) {
          v = 1;
          break;
        }
      }
      tmp[row + x] = v;
    }
  }
  // vertical
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      let v = 0;
      const from = Math.max(0, y - radius);
      const to = Math.min(H - 1, y + radius);
      for (let yy = from; yy <= to; yy += 1) {
        if (tmp[yy * W + x]) {
          v = 1;
          break;
        }
      }
      out[y * W + x] = v;
    }
  }
  return out;
}

function labelComponents(src) {
  const labels = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  let next = 0;
  for (let p = 0; p < N; p += 1) {
    if (!src[p] || labels[p] !== -1) continue;
    const id = next;
    next += 1;
    let top = 0;
    stack[top] = p;
    top += 1;
    labels[p] = id;
    while (top > 0) {
      top -= 1;
      const q = stack[top];
      const x = q % W;
      if (x > 0 && src[q - 1] && labels[q - 1] === -1) {
        labels[q - 1] = id;
        stack[top] = q - 1;
        top += 1;
      }
      if (x < W - 1 && src[q + 1] && labels[q + 1] === -1) {
        labels[q + 1] = id;
        stack[top] = q + 1;
        top += 1;
      }
      if (q >= W && src[q - W] && labels[q - W] === -1) {
        labels[q - W] = id;
        stack[top] = q - W;
        top += 1;
      }
      if (q < N - W && src[q + W] && labels[q + W] === -1) {
        labels[q + W] = id;
        stack[top] = q + W;
        top += 1;
      }
    }
  }
  return { labels, count: next };
}

function components(src) {
  const { labels, count } = labelComponents(src);
  const list = Array.from({ length: count }, () => ({
    minX: W,
    minY: H,
    maxX: 0,
    maxY: 0,
    count: 0,
    sumX: 0,
    sumY: 0,
  }));
  for (let p = 0; p < N; p += 1) {
    const id = labels[p];
    if (id === -1) continue;
    const c = list[id];
    const x = p % W;
    const y = (p / W) | 0;
    if (x < c.minX) c.minX = x;
    if (x > c.maxX) c.maxX = x;
    if (y < c.minY) c.minY = y;
    if (y > c.maxY) c.maxY = y;
    c.count += 1;
    c.sumX += x;
    c.sumY += y;
  }
  return list;
}

function componentCentroids(src) {
  return components(src)
    .filter((c) => c.count > 0)
    .map((c) => ({ cx: c.sumX / c.count, cy: c.sumY / c.count, count: c.count }));
}

function discOffsets(radius) {
  const offsets = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
    }
  }
  return offsets;
}

// 步进代价：距离 + 向上回头的额外惩罚（不对称，鼓励整体自上而下）
function stepCost(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) + UP_PENALTY * Math.max(0, a.y - b.y);
}

function routeCost(route) {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) total += stepCost(route[i - 1], route[i]);
  return total;
}

function nearestNeighbourRoute(allDots, first, last) {
  const remaining = allDots.filter((d) => d !== first && d !== last);
  const route = [first];
  let current = first;
  while (remaining.length) {
    let bestIndex = 0;
    let bestCost = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const c = stepCost(current, remaining[i]);
      if (c < bestCost) {
        bestCost = c;
        bestIndex = i;
      }
    }
    current = remaining.splice(bestIndex, 1)[0];
    route.push(current);
  }
  route.push(last);
  return route;
}

function pathLength(route) {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    total += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
  }
  return total;
}

// 段反转（2-opt）+ 单点搬移（or-opt），代价不对称所以整条路线重新求值
function improveRoute(route) {
  let points = route.slice();
  let best = routeCost(points);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < points.length - 1; i += 1) {
      for (let k = i + 1; k < points.length - 1; k += 1) {
        const candidate = points
          .slice(0, i)
          .concat(points.slice(i, k + 1).reverse(), points.slice(k + 1));
        const cost = routeCost(candidate);
        if (cost + 1e-9 < best) {
          points = candidate;
          best = cost;
          improved = true;
        }
      }
    }
    for (let i = 1; i < points.length - 1; i += 1) {
      for (let j = 1; j < points.length - 1; j += 1) {
        if (j === i || j === i - 1) continue;
        const candidate = points.slice();
        const [moved] = candidate.splice(i, 1);
        candidate.splice(j < i ? j + 1 : j, 0, moved);
        const cost = routeCost(candidate);
        if (cost + 1e-9 < best) {
          points = candidate;
          best = cost;
          improved = true;
        }
      }
    }
  }
  return points;
}

function drawDisc(png, cx, cy, radius, [r, g, b]) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
}

function drawLine(png, from, to, color) {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y));
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    drawDisc(png, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 2, color);
  }
}
