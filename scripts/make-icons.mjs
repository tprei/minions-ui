import sharp from 'sharp'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const svgPath = resolve(root, 'public/favicon.svg')
const svgBuffer = readFileSync(svgPath)

const maskableSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0f172a"/>
  <g transform="translate(96, 96) scale(5)">
    <rect width="64" height="64" rx="14" fill="#4f46e5"/>
    <circle cx="22" cy="28" r="6" fill="white"/>
    <circle cx="42" cy="28" r="6" fill="white"/>
    <rect x="20" y="40" width="24" height="6" rx="3" fill="white"/>
    <circle cx="22" cy="28" r="2.5" fill="#4f46e5"/>
    <circle cx="42" cy="28" r="2.5" fill="#4f46e5"/>
  </g>
</svg>
`)

await sharp(svgBuffer).resize(192, 192).png().toFile(resolve(root, 'public/icons/192.png'))
await sharp(svgBuffer).resize(512, 512).png().toFile(resolve(root, 'public/icons/512.png'))
await sharp(maskableSvg).resize(512, 512).png().toFile(resolve(root, 'public/icons/maskable.png'))

console.log('Icons generated: 192.png, 512.png, maskable.png')
