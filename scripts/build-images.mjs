/**
 * Renders the SVG sources in docs/images to PNG.
 *
 * The SVGs are the source of truth: they diff cleanly in review, and the PNGs
 * are build output that happens to be committed because GitHub cannot render
 * an SVG as a social preview.
 *
 * Run with: npm run images
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'

const DIR = path.join(process.cwd(), 'docs', 'images')

/** Page background, used to flatten transparency. */
const BACKDROP = '#15171c'

const TARGETS = [
  {
    source: 'preview.svg',
    output: 'preview.png',
    // 2x for crisp rendering on high-density displays. GitHub scales it down
    // in the README, so the extra pixels cost nothing but file size.
    scale: 2,
  },
  {
    source: 'social-preview.svg',
    output: 'social-preview.png',
    // Exactly GitHub's recommended social card size. Do not change: the
    // uploader rejects anything under 640x320 and crops to 2:1.
    width: 1280,
    height: 640,
    jpeg: 'social-preview.jpg',
  },
]

for (const target of TARGETS) {
  const svg = readFileSync(path.join(DIR, target.source))

  const render = () => {
    const pipeline = sharp(svg, { density: 72 * (target.scale ?? 1) })
    return target.width
      ? pipeline.resize(target.width, target.height, { fit: 'fill' })
      : pipeline
  }

  // A JPEG alternative for the social card. GitHub accepts both, and having
  // one on hand avoids a round trip if the PNG upload ever misbehaves.
  if (target.jpeg) {
    await render()
      .flatten({ background: BACKDROP })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      .toFile(path.join(DIR, target.jpeg))
  }

  await render()
    // GitHub's social-preview uploader is unreliable with RGBA input, and a
    // transparent card renders unpredictably against light and dark chrome.
    // Flattening to opaque RGB removes both problems.
    .flatten({ background: BACKDROP })
    .png({ compressionLevel: 9, palette: false })
    .toFile(path.join(DIR, target.output))

  const { width, height, channels, hasAlpha } = await sharp(
    path.join(DIR, target.output),
  ).metadata()
  const kb = Math.round(statSync(path.join(DIR, target.output)).size / 1024)

  process.stdout.write(
    `${target.output.padEnd(22)} ${width}x${height}  ${channels} channels  alpha=${hasAlpha}  ${kb} KB\n`,
  )
}
