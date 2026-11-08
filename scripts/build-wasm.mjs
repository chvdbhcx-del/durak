// Builds the Rust engine (engine-rs/) into src/engine/durak_engine.wasm.
// Without Rust installed an existing build is kept, so the web app still builds.
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'

const out = 'src/engine/durak_engine.wasm'
const built = 'engine-rs/target/wasm32-unknown-unknown/release/durak_engine.wasm'
let cargo = true
try {
  execSync('cargo --version', { stdio: 'ignore', cwd: 'engine-rs' })
} catch {
  cargo = false
}
if (!cargo) {
  if (existsSync(out)) {
    console.warn('cargo not found: keeping the existing durak_engine.wasm')
    process.exit(0)
  }
  console.error('cargo not found and no durak_engine.wasm yet: install Rust from https://rustup.rs')
  process.exit(1)
}
execSync('cargo build --release --target wasm32-unknown-unknown', { stdio: 'inherit', cwd: 'engine-rs' })
copyFileSync(built, out)
console.log(`built ${out}`)
