import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const candidates = [process.env.ERPL_PYTHON, 'python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3'].filter(Boolean)
let python = ''
for (const candidate of candidates) {
  const check = spawnSync(candidate, ['-c', 'import sys; raise SystemExit(sys.version_info < (3, 11))'])
  if (check.status === 0) { python = candidate; break }
}
if (!python) {
  const message = 'NASA CEA needs Python 3.11 or newer; skipping the local solver install.'
  if (process.env.RENDER) throw new Error(message)
  console.warn(message)
  process.exit(0)
}
const install = spawnSync(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir',
  '--upgrade', '--target', resolve(root, '.python'), '--requirement', resolve(root, 'requirements.txt')],
{ stdio: 'inherit' })
if (install.status !== 0) process.exit(install.status || 1)
