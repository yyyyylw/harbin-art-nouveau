const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const root = path.resolve(__dirname, "..");
const assetsDir = path.join(root, "assets");
const finalMap = PNG.sync.read(fs.readFileSync(path.join(assetsDir, "map-final.png")));
const baseMap = PNG.sync.read(fs.readFileSync(path.join(assetsDir, "basemap.png")));
const mask = new PNG({ width: finalMap.width, height: finalMap.height });
const source = new Uint8Array(finalMap.width * finalMap.height);

for (let y = 0; y < finalMap.height; y += 1) {
  for (let x = 0; x < finalMap.width; x += 1) {
    const i = (y * finalMap.width + x) * 4;
    const r = finalMap.data[i];
    const g = finalMap.data[i + 1];
    const b = finalMap.data[i + 2];
    const a = finalMap.data[i + 3];
    const br = baseMap.data[i];
    const bg = baseMap.data[i + 1];
    const bb = baseMap.data[i + 2];
    const dark = (r + g + b) / 3 < 135;
    const diff = Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb);

    if (a > 128 && dark && diff > 40) {
      source[y * finalMap.width + x] = 1;
    }
  }
}

for (let y = 0; y < finalMap.height; y += 1) {
  for (let x = 0; x < finalMap.width; x += 1) {
    let covered = false;

    for (let dy = -2; dy <= 2 && !covered; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= finalMap.height) continue;

      for (let dx = -2; dx <= 2; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= finalMap.width) continue;
        if (dx * dx + dy * dy <= 4 && source[yy * finalMap.width + xx]) {
          covered = true;
          break;
        }
      }
    }

    const i = (y * finalMap.width + x) * 4;
    mask.data[i] = 0;
    mask.data[i + 1] = 0;
    mask.data[i + 2] = 0;
    mask.data[i + 3] = covered ? 255 : 0;
  }
}

fs.writeFileSync(path.join(assetsDir, "annotation-mask.png"), PNG.sync.write(mask));
console.log("built annotation-mask.png");
