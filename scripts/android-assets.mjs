// Android app icons and splash screens (issue #84), drawn from the website's icon (app/icon.svg, #85).
// Run after changing the logo: `node scripts/android-assets.mjs`, then commit android/app/src/main/res.
//
// - Adaptive icon (Android 8+): the glyph on a transparent 108 dp foreground, inside the 66 dp safe
//   zone, over the dark background colour (values/ic_launcher_background.xml).
// - Legacy and round icons (older launchers): the full rounded-square logo, or clipped to a circle.
// - Splash screens: the logo centred on the dark background, one per density and orientation.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const RES = "android/app/src/main/res";
const BACKGROUND = "#1D1C19";
const svg = readFileSync("app/icon.svg", "utf8").replace(/<metadata>[\s\S]*?<\/metadata>/, "");
// The glyph alone: the logo without its background square.
const glyph = svg.replace(/<rect[^>]*\/>/, "");

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const png = (source, size) => sharp(Buffer.from(source), { density: 72 * (size / 120) * 4 }).resize(size, size).png();

for (const [name, scale] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${name}`);
  // Foreground 108 dp; the 120-unit logo fills the 66 dp safe zone (plus a little air).
  const canvas = Math.round(108 * scale);
  const inner = Math.round(72 * scale);
  const glyphPng = await png(glyph, inner).toBuffer();
  await sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: glyphPng, gravity: "center" }])
    .png()
    .toFile(join(dir, "ic_launcher_foreground.png"));

  const legacy = Math.round(48 * scale);
  await png(svg, legacy).toFile(join(dir, "ic_launcher.png"));
  const circle = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`);
  const square = await sharp(Buffer.from(svg.replace(/rx="28"/, 'rx="0"')), { density: 288 }).resize(legacy, legacy).png().toBuffer();
  await sharp(square).composite([{ input: circle, blend: "dest-in" }]).png().toFile(join(dir, "ic_launcher_round.png"));
}

const SPLASHES = {
  drawable: [480, 320],
  "drawable-land-mdpi": [480, 320],
  "drawable-land-hdpi": [800, 480],
  "drawable-land-xhdpi": [1280, 720],
  "drawable-land-xxhdpi": [1600, 960],
  "drawable-land-xxxhdpi": [1920, 1280],
  "drawable-port-mdpi": [320, 480],
  "drawable-port-hdpi": [480, 800],
  "drawable-port-xhdpi": [720, 1280],
  "drawable-port-xxhdpi": [960, 1600],
  "drawable-port-xxxhdpi": [1280, 1920],
};
for (const [dir, [width, height]] of Object.entries(SPLASHES)) {
  const logo = await png(glyph, Math.round(Math.min(width, height) * 0.36)).toBuffer();
  await sharp({ create: { width, height, channels: 4, background: BACKGROUND } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(join(RES, dir, "splash.png"));
}

writeFileSync(
  join(RES, "values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKGROUND}</color>\n</resources>\n`,
);
console.log("android-assets: icons and splash screens written");
