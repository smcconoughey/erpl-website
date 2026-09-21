import { spawn } from 'node:child_process'
import { delimiter, join } from 'node:path'

const TIMEOUT_MS = 15_000
const OUTPUT_LIMIT = 512 * 1024

function problem(message, status = 422) {
  return Object.assign(new Error(message), { status })
}

function boundedNumber(value, name, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw problem(`${name} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

export function validateCeaRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem('Provide NASA CEA inputs as JSON.')
  if (!['ipa', 'ethanol'].includes(body.fuel)) throw problem('NASA CEA currently supports IPA or ethanol fuel.')
  if (!['equilibrium', 'frozen'].includes(body.mode)) throw problem('CEA mode must be equilibrium or frozen.')
  const request = {
    fuel: body.fuel,
    mode: body.mode,
    chamberPressurePsi: boundedNumber(body.chamberPressurePsi, 'Chamber pressure', 1, 10_000),
    ofRatio: boundedNumber(body.ofRatio, 'O/F ratio', 0.05, 50),
    expansionRatio: boundedNumber(body.expansionRatio, 'Expansion ratio', 1.0001, 1_000),
    ambientPressurePsi: boundedNumber(body.ambientPressurePsi, 'Ambient pressure', 0.001, 100),
    fuelTemperatureK: boundedNumber(body.fuelTemperatureK, 'Fuel temperature', 185, 500),
    oxidizerTemperatureK: boundedNumber(body.oxidizerTemperatureK, 'Oxidizer temperature', 54, 155),
  }
  if (request.chamberPressurePsi <= request.ambientPressurePsi) {
    throw problem('Chamber pressure must be greater than ambient pressure.')
  }
  return request
}

export function createCeaSolver({ root, pythonPath = process.env.ERPL_PYTHON || 'python3',
  runnerPath = join(root, 'server', 'cea_runner.py') }) {
  const pythonEnv = join(root, '.python')
  return (body) => new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(pythonPath, [runnerPath], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: [pythonEnv, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(problem('NASA CEA timed out. Try a narrower operating point.', 503))
    }, TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > OUTPUT_LIMIT) child.kill('SIGKILL')
    })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', () => finish(problem('NASA CEA is not available on the server.', 503)))
    child.on('close', (code) => {
      if (settled) return
      let parsed
      try { parsed = JSON.parse(stdout) } catch { parsed = null }
      if (code !== 0 || !parsed?.result) {
        const detail = parsed?.error || stderr.trim().split('\n').at(-1)
        return finish(problem(detail || 'NASA CEA could not solve this operating point.', 422))
      }
      finish(null, parsed.result)
    })
    child.stdin.end(JSON.stringify(validateCeaRequest(body)))
  })
}
