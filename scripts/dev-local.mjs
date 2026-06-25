import { spawn } from 'node:child_process'
import { join } from 'node:path'

const isWindows = process.platform === 'win32'
const defaultDatabaseUrl = 'postgres://regionfinder:regionfinder@localhost:55432/regionfinder'
const apiHost = process.env.REGIONFINDER_API_HOST ?? '127.0.0.1'
const apiPort = process.env.REGIONFINDER_API_PORT ?? '4001'
const frontendPort = process.env.REGIONFINDER_FRONTEND_PORT ?? '5176'
const frontendHost = process.env.REGIONFINDER_FRONTEND_HOST ?? '127.0.0.1'
const apiBaseUrl = process.env.VITE_REGIONFINDER_API_BASE_URL ?? `http://${apiHost}:${apiPort}`

const viteArgs = withDefaultViteArgs(process.argv.slice(2))
const children = []
let shuttingDown = false

const apiEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  REGIONFINDER_API_HOST: apiHost,
  REGIONFINDER_API_PORT: apiPort,
}

const frontendEnv = {
  ...process.env,
  VITE_REGIONFINDER_API_BASE_URL: apiBaseUrl,
}

console.log(`Starting Regionfinder API on http://${apiHost}:${apiPort}`)
console.log(`Starting Vite frontend with API base ${apiBaseUrl}`)

start('api', bin('tsx'), ['server/index.ts'], apiEnv)
start('frontend', bin('vite'), viteArgs, frontendEnv)

process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

function withDefaultViteArgs(args) {
  const nextArgs = [...args]

  if (!hasOption(nextArgs, '--host')) {
    nextArgs.push('--host', frontendHost)
  }

  if (!hasOption(nextArgs, '--port')) {
    nextArgs.push('--port', frontendPort)
  }

  return nextArgs
}

function hasOption(args, option) {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`))
}

function bin(name) {
  return join(process.cwd(), 'node_modules', '.bin', isWindows ? `${name}.cmd` : name)
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    detached: !isWindows,
    env,
    stdio: 'inherit',
  })

  children.push(child)

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return
    }

    const exitCode = code ?? 1
    console.error(`${name} exited${signal ? ` with signal ${signal}` : ` with code ${exitCode}`}`)
    shutdown(exitCode)
  })
}

function shutdown(code) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const child of children) {
    killChild(child, 'SIGTERM')
  }

  setTimeout(() => {
    for (const child of children) {
      killChild(child, 'SIGKILL')
    }

    process.exit(code)
  }, 1500).unref()
}

function killChild(child, signal) {
  if (child.killed) {
    return
  }

  try {
    if (isWindows) {
      child.kill(signal)
      return
    }

    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}
