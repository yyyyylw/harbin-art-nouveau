const fs = require("fs");
const path = require("path");
const PSD = require("psd");

const root = path.resolve(__dirname, "..");
const assetsDir = path.join(root, "assets");
const files = [
  ["basemap.psd", "basemap.png"],
  ["map-final.psd", "map-final.png"],
];

fs.mkdirSync(assetsDir, { recursive: true });

Promise.all(
  files.map(async ([source, target]) => {
    const psd = await PSD.open(path.join(root, source));
    await psd.image.saveAsPng(path.join(assetsDir, target));
    console.log(`exported ${target}`);
  }),
).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
