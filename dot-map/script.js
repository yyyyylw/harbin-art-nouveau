/**
 * 滚动探索地图
 *
 * basemap 盖在 map-final 之上（视觉上等价于：底图 + 蒙纱）。小人沿散点路线
 * 行走，走过的地方擦开蒙纱；每当小人到达一个散点，属于这个散点的标注
 * （圆点 + 整段文字）作为一个整体淡入 —— 文字永远不会只显示一半。
 *
 * 路线、散点、标注区域全部由 tools/analyze-annotations.js 从
 * map-final/basemap 的像素差自动生成（assets/route-data.json）。
 */

const canvas = document.querySelector("#mapScene");
const progressBar = document.querySelector("#progressBar");
const scrollMap = document.querySelector("#scrollMap");
const scrollHint = document.querySelector("#scrollHint");
const foundCount = document.querySelector("#foundCount");
const foundTotal = document.querySelector("#foundTotal");
const ctx = canvas.getContext("2d", { alpha: false });

const FADE_LEN = 0.012; // 每个标注区域的淡入时长（占总进度）

const scene = {
  dpr: 1,
  cssWidth: 0,
  cssHeight: 0,
  rect: { x: 0, y: 0, width: 0, height: 0, scale: 1 },
  progress: 0,
  needsPaint: false,
  overrideProgress: null,
  drawActors: true,
  drawRegions: true,
  facing: 1,
  ready: false,
};

const assets = { baseMap: null, art: null, mapSize: null };
let route = null; // { samples, cumulative, totalLength, dotProgress, dots }
let regions = []; // { x, y, w, h, dotIndex, sprite }

const readyPromise = loadEverything();

window.addEventListener("resize", () => {
  resizeScene();
  requestPaint();
});

window.addEventListener(
  "scroll",
  () => {
    scene.progress = getScrollProgress();
    if (scene.progress > 0.002) scrollHint.classList.add("hidden");
    requestPaint();
  },
  { passive: true },
);

async function loadEverything() {
  const [baseMap, art, regionMapImg, routeData] = await Promise.all([
    loadImage("assets/basemap.png"),
    loadImage("assets/annotation-art.png"),
    loadImage("assets/region-map.png"),
    Promise.resolve({"mapSize":{"width":2209,"height":2185},"dots":[[1249,224],[972,426],[333,526],[235,622],[686,622],[454,650],[461,682],[437,700],[385,739],[331,786],[461,829],[471,872],[729,752],[901,805],[865,833],[780,860],[814,872],[822,896],[769,932],[699,947],[541,976],[562,984],[941,1276],[1305,1231],[1473,1246],[1190,1298],[1076,1330],[1009,1340],[1074,1374],[1157,1454],[1305,1453],[1357,1471],[1244,1487],[1334,1495],[1332,1539],[1154,1547],[1082,1547],[1070,1561],[907,1602],[1457,1601],[1705,1588],[1320,1639],[1392,1693],[1238,1745],[1089,1725],[894,1732],[1008,1791],[1104,1799],[1169,1810],[1031,1829],[1096,1847],[1160,1891],[1029,1880],[944,1898],[1054,1977],[1782,2136]],"regions":[{"x":1237,"y":212,"w":190,"h":25,"dotIndex":0},{"x":1368,"y":380,"w":14,"h":8,"dotIndex":0},{"x":960,"y":414,"w":142,"h":42,"dotIndex":1},{"x":156,"y":496,"w":190,"h":43,"dotIndex":2},{"x":1150,"y":540,"w":13,"h":12,"dotIndex":1},{"x":1783,"y":543,"w":6,"h":9,"dotIndex":0},{"x":1760,"y":549,"w":6,"h":13,"dotIndex":0},{"x":438,"y":577,"w":215,"h":25,"dotIndex":4},{"x":662,"y":577,"w":117,"h":22,"dotIndex":4},{"x":73,"y":610,"w":174,"h":45,"dotIndex":3},{"x":674,"y":610,"w":185,"h":25,"dotIndex":4},{"x":271,"y":618,"w":308,"h":96,"dotIndex":5},{"x":926,"y":701,"w":6,"h":5,"dotIndex":13},{"x":373,"y":727,"w":152,"h":46,"dotIndex":7},{"x":717,"y":737,"w":216,"h":28,"dotIndex":12},{"x":179,"y":774,"w":295,"h":68,"dotIndex":9},{"x":852,"y":785,"w":180,"h":61,"dotIndex":13},{"x":590,"y":824,"w":215,"h":49,"dotIndex":15},{"x":590,"y":856,"w":99,"h":22,"dotIndex":19},{"x":802,"y":858,"w":269,"h":61,"dotIndex":14},{"x":742,"y":859,"w":7,"h":7,"dotIndex":15},{"x":258,"y":860,"w":226,"h":25,"dotIndex":11},{"x":1770,"y":886,"w":10,"h":12,"dotIndex":24},{"x":751,"y":887,"w":13,"h":7,"dotIndex":15},{"x":562,"y":914,"w":150,"h":46,"dotIndex":19},{"x":757,"y":920,"w":129,"h":60,"dotIndex":17},{"x":935,"y":948,"w":12,"h":13,"dotIndex":17},{"x":385,"y":961,"w":280,"h":59,"dotIndex":20},{"x":1546,"y":1159,"w":23,"h":35,"dotIndex":24},{"x":1157,"y":1200,"w":204,"h":45,"dotIndex":23},{"x":1461,"y":1226,"w":246,"h":33,"dotIndex":24},{"x":1231,"y":1242,"w":9,"h":9,"dotIndex":25},{"x":819,"y":1245,"w":138,"h":44,"dotIndex":22},{"x":1178,"y":1282,"w":224,"h":31,"dotIndex":25},{"x":954,"y":1318,"w":331,"h":89,"dotIndex":25},{"x":896,"y":1328,"w":127,"h":32,"dotIndex":27},{"x":1413,"y":1340,"w":12,"h":16,"dotIndex":24},{"x":1298,"y":1345,"w":12,"h":12,"dotIndex":30},{"x":1453,"y":1353,"w":15,"h":12,"dotIndex":24},{"x":1434,"y":1374,"w":16,"h":13,"dotIndex":31},{"x":1439,"y":1410,"w":7,"h":7,"dotIndex":31},{"x":1194,"y":1411,"w":215,"h":55,"dotIndex":30},{"x":990,"y":1437,"w":180,"h":34,"dotIndex":29},{"x":338,"y":1451,"w":9,"h":8,"dotIndex":20},{"x":1322,"y":1459,"w":244,"h":49,"dotIndex":30},{"x":1134,"y":1475,"w":123,"h":34,"dotIndex":29},{"x":906,"y":1520,"w":190,"h":55,"dotIndex":36},{"x":1320,"y":1526,"w":246,"h":27,"dotIndex":34},{"x":1575,"y":1531,"w":117,"h":22,"dotIndex":40},{"x":1111,"y":1534,"w":176,"h":46,"dotIndex":35},{"x":1318,"y":1566,"w":215,"h":48,"dotIndex":34},{"x":1542,"y":1568,"w":106,"h":22,"dotIndex":40},{"x":1655,"y":1576,"w":195,"h":51,"dotIndex":40},{"x":759,"y":1590,"w":161,"h":25,"dotIndex":38},{"x":1093,"y":1591,"w":240,"h":89,"dotIndex":41},{"x":1112,"y":1591,"w":41,"h":22,"dotIndex":35},{"x":1369,"y":1681,"w":148,"h":45,"dotIndex":42},{"x":1294,"y":1683,"w":13,"h":14,"dotIndex":41},{"x":937,"y":1694,"w":176,"h":44,"dotIndex":44},{"x":1527,"y":1704,"w":82,"h":22,"dotIndex":39},{"x":881,"y":1720,"w":25,"h":25,"dotIndex":45},{"x":732,"y":1722,"w":137,"h":22,"dotIndex":45},{"x":1093,"y":1732,"w":372,"h":92,"dotIndex":43},{"x":1474,"y":1748,"w":106,"h":22,"dotIndex":42},{"x":831,"y":1779,"w":191,"h":27,"dotIndex":46},{"x":924,"y":1817,"w":120,"h":29,"dotIndex":46},{"x":700,"y":1824,"w":215,"h":22,"dotIndex":53},{"x":1085,"y":1833,"w":238,"h":28,"dotIndex":48},{"x":1332,"y":1833,"w":136,"h":22,"dotIndex":43},{"x":760,"y":1868,"w":282,"h":55,"dotIndex":52},{"x":1797,"y":1873,"w":5,"h":14,"dotIndex":55},{"x":1147,"y":1879,"w":26,"h":26,"dotIndex":51},{"x":1181,"y":1891,"w":215,"h":22,"dotIndex":51},{"x":1405,"y":1891,"w":68,"h":22,"dotIndex":42},{"x":1182,"y":1924,"w":52,"h":22,"dotIndex":51},{"x":1042,"y":1965,"w":221,"h":36,"dotIndex":54},{"x":1768,"y":2117,"w":245,"h":55,"dotIndex":55},{"x":2022,"y":2117,"w":48,"h":22,"dotIndex":55}]}),
  ]);

  assets.baseMap = baseMap;
  assets.art = art;
  assets.mapSize = routeData.mapSize;

  route = buildRoute(routeData.dots, 20);
  regions = buildRegionSprites(routeData.regions, art, regionMapImg, routeData.mapSize);

  foundTotal.textContent = String(routeData.dots.length);
  scene.ready = true;
  resizeScene();
  requestPaint();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 把 annotation-art 按 region-map 中的编号切成每个区域一张透明贴片 */
function buildRegionSprites(regionList, artImg, regionMapImg, mapSize) {
  const { width, height } = mapSize;
  const reader = document.createElement("canvas");
  reader.width = width;
  reader.height = height;
  const readerCtx = reader.getContext("2d", { willReadFrequently: true });

  readerCtx.drawImage(artImg, 0, 0);
  const artData = readerCtx.getImageData(0, 0, width, height).data;
  readerCtx.clearRect(0, 0, width, height);
  readerCtx.drawImage(regionMapImg, 0, 0);
  const idData = readerCtx.getImageData(0, 0, width, height).data;

  return regionList.map((region, index) => {
    const sprite = document.createElement("canvas");
    sprite.width = region.w;
    sprite.height = region.h;
    const spriteCtx = sprite.getContext("2d");
    const imageData = spriteCtx.createImageData(region.w, region.h);

    for (let y = 0; y < region.h; y += 1) {
      const srcRow = (region.y + y) * width;
      for (let x = 0; x < region.w; x += 1) {
        const src = (srcRow + region.x + x) * 4;
        if (idData[src + 3] !== 255) continue;
        if (idData[src] + idData[src + 1] * 256 !== index) continue;
        const dst = (y * region.w + x) * 4;
        imageData.data[dst] = artData[src];
        imageData.data[dst + 1] = artData[src + 1];
        imageData.data[dst + 2] = artData[src + 2];
        imageData.data[dst + 3] = artData[src + 3];
      }
    }

    spriteCtx.putImageData(imageData, 0, 0);
    return { ...region, sprite };
  });
}

/** Catmull-Rom 平滑路线；dotProgress[i] = 第 i 个散点处的弧长进度 */
function buildRoute(dots, stepsPerSegment) {
  const samples = [];
  const dotSampleIndex = [];

  for (let i = 0; i < dots.length - 1; i += 1) {
    const p0 = dots[Math.max(0, i - 1)];
    const p1 = dots[i];
    const p2 = dots[i + 1];
    const p3 = dots[Math.min(dots.length - 1, i + 2)];
    dotSampleIndex.push(samples.length);
    for (let step = 0; step < stepsPerSegment; step += 1) {
      samples.push(catmullRom(p0, p1, p2, p3, step / stepsPerSegment));
    }
  }
  dotSampleIndex.push(samples.length);
  samples.push([dots[dots.length - 1][0], dots[dots.length - 1][1]]);

  const cumulative = [0];
  let totalLength = 0;
  for (let i = 1; i < samples.length; i += 1) {
    totalLength += Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]);
    cumulative.push(totalLength);
  }

  const dotProgress = dotSampleIndex.map((index) => cumulative[index] / totalLength);
  return { samples, cumulative, totalLength, dotProgress, dots };
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 *
      (2 * p1[0] +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 *
      (2 * p1[1] +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

function resizeScene() {
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));

  scene.dpr = dpr;
  scene.cssWidth = width;
  scene.cssHeight = height;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  if (!assets.mapSize) return;
  const scale = Math.min(width / assets.mapSize.width, height / assets.mapSize.height);
  const imageWidth = assets.mapSize.width * scale;
  const imageHeight = assets.mapSize.height * scale;
  // 地图原点对齐到物理像素，保证标注贴片与底图逐像素对齐
  scene.rect = {
    x: Math.round(((width - imageWidth) / 2) * dpr) / dpr,
    y: Math.round(((height - imageHeight) / 2) * dpr) / dpr,
    width: imageWidth,
    height: imageHeight,
    scale,
  };
  scene.progress = getScrollProgress();
  buildScaledSprites();
}

/**
 * 用 <img> 高质量缩放路径把 annotation-art 一次性缩放到显示尺寸，再按每个
 * 区域自己的像素掩膜裁出贴片。这样标注与底图走同一条缩放管线，逐像素一致，
 * 且区域包围盒重叠也不会让别的区域提前露出。
 */
function buildScaledSprites() {
  if (!scene.ready) return;
  const r = scene.rect;
  const dpr = scene.dpr;
  // 目标尺寸保留小数，与主画布上底图的缩放几何完全一致（画布本身取上整）
  const exactW = r.width * dpr;
  const exactH = r.height * dpr;
  const scaledW = Math.max(1, Math.ceil(exactW));
  const scaledH = Math.max(1, Math.ceil(exactH));

  const scaledArt = document.createElement("canvas");
  scaledArt.width = scaledW;
  scaledArt.height = scaledH;
  const artCtx = scaledArt.getContext("2d");
  artCtx.imageSmoothingEnabled = true;
  artCtx.imageSmoothingQuality = "high";
  artCtx.drawImage(assets.art, 0, 0, exactW, exactH);

  for (const region of regions) {
    const sx = Math.max(0, Math.floor(region.x * r.scale * dpr) - 1);
    const sy = Math.max(0, Math.floor(region.y * r.scale * dpr) - 1);
    const sw = Math.min(scaledW - sx, Math.ceil((region.x + region.w) * r.scale * dpr) - sx + 2);
    const sh = Math.min(scaledH - sy, Math.ceil((region.y + region.h) * r.scale * dpr) - sy + 2);

    const scaled = document.createElement("canvas");
    scaled.width = Math.max(1, sw);
    scaled.height = Math.max(1, sh);
    const sctx = scaled.getContext("2d");
    sctx.drawImage(scaledArt, sx, sy, sw, sh, 0, 0, sw, sh);
    // 只保留本区域自己的像素
    sctx.globalCompositeOperation = "destination-in";
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(
      region.sprite,
      region.x * r.scale * dpr - sx,
      region.y * r.scale * dpr - sy,
      region.w * r.scale * dpr,
      region.h * r.scale * dpr,
    );
    region.scaled = { canvas: scaled, sx, sy };
  }
}

function getScrollProgress() {
  const start = scrollMap.offsetTop;
  const end = start + scrollMap.offsetHeight - window.innerHeight;
  if (end <= start) return 1;
  return clamp((window.scrollY - start) / (end - start), 0, 1);
}

function requestPaint() {
  if (scene.needsPaint) return;
  scene.needsPaint = true;
  requestAnimationFrame(() => {
    scene.needsPaint = false;
    paint();
  });
}

function paint() {
  if (!scene.ready) return;
  const progress = scene.overrideProgress ?? scene.progress;
  progressBar.style.transform = `scaleX(${progress})`;

  const r = scene.rect;
  ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // 1. 底图
  ctx.fillStyle = "#cfd6d1";
  ctx.fillRect(0, 0, scene.cssWidth, scene.cssHeight);
  ctx.drawImage(assets.baseMap, r.x, r.y, r.width, r.height);

  // 每个区域当前的淡入进度
  const alphas = regions.map((region) => {
    const dp = route.dotProgress[region.dotIndex];
    const fadeEnd = Math.max(dp, 0.004);
    const fadeStart = Math.max(fadeEnd - FADE_LEN, 0);
    return smoothstep((progress - fadeStart) / (fadeEnd - fadeStart));
  });

  const trail = getTrailPoints(progress);

  // 2. 标注区域：整块淡入（到达对应散点时必然完成）。
  //    贴片已按显示尺寸预缩放，这里 1:1 贴到物理像素网格上。
  let found = 0;
  if (scene.drawRegions) {
    for (let i = 0; i < regions.length; i += 1) {
      const region = regions[i];
      if (alphas[i] <= 0 || !region.scaled) continue;
      ctx.save();
      ctx.globalAlpha = alphas[i];
      ctx.drawImage(
        region.scaled.canvas,
        r.x + region.scaled.sx / scene.dpr,
        r.y + region.scaled.sy / scene.dpr,
        region.scaled.canvas.width / scene.dpr,
        region.scaled.canvas.height / scene.dpr,
      );
      ctx.restore();
    }
  }
  for (const dp of route.dotProgress) {
    if (progress >= Math.max(dp, 0.004) - 1e-9) found += 1;
  }
  foundCount.textContent = String(Math.min(found, route.dots.length));

  if (scene.drawActors) {
    drawTrailLine(trail);
    drawWalker(trail, progress);
  }
}

/** 走过的路线（画布坐标） */
function getTrailPoints(progress) {
  const target = route.totalLength * clamp(progress, 0, 1);
  const points = [];
  for (let i = 0; i < route.samples.length; i += 1) {
    if (route.cumulative[i] >= target) {
      if (i > 0) {
        const span = route.cumulative[i] - route.cumulative[i - 1];
        const t = span === 0 ? 0 : (target - route.cumulative[i - 1]) / span;
        points.push(lerpPoint(route.samples[i - 1], route.samples[i], t));
      } else {
        points.push(route.samples[0]);
      }
      break;
    }
    points.push(route.samples[i]);
  }
  return points.map(toCanvasPoint);
}

function toCanvasPoint(point) {
  const r = scene.rect;
  return [r.x + point[0] * r.scale, r.y + point[1] * r.scale];
}

function drawTrailLine(trail) {
  if (trail.length < 2) return;
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = "#b3672a";
  ctx.lineWidth = clamp(scene.rect.scale * 4.5, 1.4, 3);
  ctx.lineCap = "round";
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.moveTo(trail[0][0], trail[0][1]);
  for (let i = 1; i < trail.length; i += 1) ctx.lineTo(trail[i][0], trail[i][1]);
  ctx.stroke();
  ctx.restore();
}

/**
 * 小人：简约旅行者。始终保持直立（头永远朝上），只按行进方向左右翻转；
 * 步伐相位由已走过的路程驱动，滚动停止时自然站定。
 */
function drawWalker(trail, progress) {
  const point = trail[trail.length - 1] || toCanvasPoint(route.samples[0]);
  const prev = trail[trail.length - 2];
  if (prev) {
    const dx = point[0] - prev[0];
    if (Math.abs(dx) > 0.05) scene.facing = dx >= 0 ? 1 : -1;
  }

  const S = clamp(scene.rect.scale * 120, 38, 52);
  const traveledCss = route.totalLength * progress * scene.rect.scale;
  const phase = traveledCss * 0.17;
  const swing = Math.sin(phase);
  const lift = Math.abs(Math.cos(phase));
  const bob = -Math.abs(swing) * S * 0.025;

  const x = clamp(point[0], S * 0.4, scene.cssWidth - S * 0.4);
  const y = clamp(point[1], S * 0.55, scene.cssHeight - S * 0.55);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scene.facing, 1);
  ctx.translate(0, bob);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const ink = "#202623";
  const amber = "#c06a2c";
  const line = Math.max(2.6, S * 0.075);

  const hipY = S * 0.12;
  const legLen = S * 0.32;
  const backFootX = -swing * S * 0.14;
  const frontFootX = swing * S * 0.14;
  const backFootY = hipY + legLen - (swing < 0 ? lift : 0) * S * 0.05;
  const frontFootY = hipY + legLen - (swing > 0 ? lift : 0) * S * 0.05;

  // 白色描边让小人在地图上更清晰；后臂画在身体后面
  strokeLimbs(ctx, "rgba(255,255,255,0.85)", line + 3, hipY, backFootX, backFootY, frontFootX, frontFootY, S, swing);
  strokeLimbs(ctx, ink, line, hipY, backFootX, backFootY, frontFootX, frontFootY, S, swing);

  // 身体
  ctx.fillStyle = amber;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  roundedCapsule(ctx, -S * 0.105, -S * 0.2, S * 0.21, S * 0.36, S * 0.105);
  ctx.stroke();
  roundedCapsule(ctx, -S * 0.105, -S * 0.2, S * 0.21, S * 0.36, S * 0.105);
  ctx.fill();

  // 小背包
  ctx.fillStyle = "#8a4f22";
  roundedCapsule(ctx, -S * 0.21, -S * 0.16, S * 0.11, S * 0.2, S * 0.05);
  ctx.fill();


  // 头（永远在正上方）
  ctx.fillStyle = ink;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -S * 0.31, S * 0.125, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -S * 0.31, S * 0.125, 0, Math.PI * 2);
  ctx.fill();

  // 朝向行进方向的眼睛
  ctx.fillStyle = "#f4f2ec";
  ctx.beginPath();
  ctx.arc(S * 0.055, -S * 0.325, S * 0.028, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function strokeLimbs(target, style, width, hipY, backFootX, backFootY, frontFootX, frontFootY, S, swing) {
  target.strokeStyle = style;
  target.lineWidth = width;
  target.beginPath();
  // 腿
  target.moveTo(0, hipY);
  target.quadraticCurveTo(backFootX * 0.35, hipY + S * 0.16, backFootX, backFootY);
  target.moveTo(0, hipY);
  target.quadraticCurveTo(frontFootX * 0.35, hipY + S * 0.16, frontFootX, frontFootY);
  // 双臂（与腿反相摆动，手伸出身体两侧才看得见）
  target.moveTo(S * 0.05, -S * 0.1);
  target.quadraticCurveTo(S * 0.1, -S * 0.02, S * 0.09 + Math.max(0, -swing) * S * 0.09, S * 0.08);
  target.moveTo(-S * 0.05, -S * 0.1);
  target.quadraticCurveTo(-S * 0.1, -S * 0.02, -S * 0.09 - Math.max(0, swing) * S * 0.09, S * 0.08);
  target.stroke();
}

function roundedCapsule(target, x, y, w, h, r) {
  target.beginPath();
  if (typeof target.roundRect === "function") {
    target.roundRect(x, y, w, h, r);
  } else {
    target.rect(x, y, w, h);
  }
}

function smoothstep(t) {
  const v = clamp(t, 0, 1);
  return v * v * (3 - 2 * v);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerpPoint(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// ---------------------------------------------------------------- 测试钩子
window.__reveal = {
  ready: readyPromise,
  get scene() {
    return scene;
  },
  get route() {
    return route;
  },
  get regions() {
    return regions;
  },
  get assets() {
    return assets;
  },
  /** 强制以指定进度绘制一帧（可关闭小人/轨迹和蒙纱，用于像素校验） */
  paintAt(progress, { actors = true, regions: drawRegions = true } = {}) {
    scene.overrideProgress = clamp(progress, 0, 1);
    scene.drawActors = actors;
    scene.drawRegions = drawRegions;
    paint();
    const state = {
      progress: scene.overrideProgress,
      rect: { ...scene.rect },
      dpr: scene.dpr,
      dotProgress: route.dotProgress.slice(),
    };
    return state;
  },
  reset() {
    scene.overrideProgress = null;
    scene.drawActors = true;
    scene.drawRegions = true;
    requestPaint();
  },
};
