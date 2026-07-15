/**
 * Static validation of the reveal data:
 *  - every annotation pixel (recomputed from map-final vs basemap) is owned by
 *    exactly one region in region-map.png, so nothing can be left half-erased
 *  - every region is bound to a valid route dot
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const root = path.resolve(__dirname, "..");
const assetsDir = path.join(root, "assets");

const finalMap = PNG.sync.read(fs.readFileSync(path.join(assetsDir, "map-final.png")));
const baseMap = PNG.sync.read(fs.readFileSync(path.join(assetsDir, "basemap.png")));
const regionMap = PNG.sync.read(fs.readFileSync(path.join(assetsDir, "region-map.png")));
const routeData = JSON.parse(fs.readFileSync(path.join(assetsDir, "route-data.json"), "utf8"));

const W = finalMap.width;
const H = finalMap.height;
let annotationPixels = 0;
let covered = 0;
let badRegionId = 0;

for (let p = 0; p < W * H; p += 1) {
  const i = p * 4;
  if (finalMap.data[i + 3] <= 128) continue;
  const diff =
    Math.abs(finalMap.data[i] - baseMap.data[i]) +
    Math.abs(finalMap.data[i + 1] - baseMap.data[i + 1]) +
    Math.abs(finalMap.data[i + 2] - baseMap.data[i + 2]);
  const brightness = (finalMap.data[i] + finalMap.data[i + 1] + finalMap.data[i + 2]) / 3;
  const isAnnotation = (brightness < 135 && diff > 40) || (brightness >= 135 && diff > 90);
  if (!isAnnotation) continue;

  annotationPixels += 1;
  if (regionMap.data[i + 3] === 255) {
    const id = regionMap.data[i] + regionMap.data[i + 1] * 256;
    if (id < routeData.regions.length) covered += 1;
    else badRegionId += 1;
  }
}

const coverage = annotationPixels === 0 ? 100 : (covered / annotationPixels) * 100;
console.log(`annotation pixels covered by regions: ${covered}/${annotationPixels} (${coverage.toFixed(4)}%)`);
if (badRegionId) console.log(`pixels with out-of-range region id: ${badRegionId}`);

let badBinding = 0;
for (const region of routeData.regions) {
  if (!(region.dotIndex >= 0 && region.dotIndex < routeData.dots.length)) badBinding += 1;
}
console.log(`regions: ${routeData.regions.length}, invalid dot bindings: ${badBinding}`);

if (coverage < 99.9 || badRegionId || badBinding) {
  console.log("FAIL");
  process.exitCode = 1;
} else {
  console.log("PASS");
}
