const fs = require('fs')
const path = require('path')

const outDir = path.join(__dirname, '../src/renderer/public/wasm')
fs.mkdirSync(outDir, { recursive: true })

const srcDir = path.join(__dirname, '../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist')
const files = fs.readdirSync(srcDir)

for (const file of files) {
  if (file.startsWith('ort-wasm-simd-threaded')) {
    fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file))
  }
}

console.log('Copied WASM files successfully.')
