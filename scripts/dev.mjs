import { spawn } from 'node:child_process'

// One command runs both the Vite client and the authoritative local room server.
const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) child.kill('SIGTERM')
}
function launch(args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit' })
  children.push(child)
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', (code, signal) => { if (!stopping) stop(signal ? 1 : code ?? 1) })
}
launch(['--experimental-strip-types', 'server/dev.ts'])
launch(['node_modules/vite/bin/vite.js', ...process.argv.slice(2)])
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
