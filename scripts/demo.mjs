import { spawn } from 'node:child_process'

const run = (command) => spawn(command, { shell: true, stdio: 'inherit' })

const processes = [run('node scripts/local-backend.mjs'), run('npx vite --port 5173')]

console.log(`
Open http://localhost:5173

  Admin    admin / admin12345
  Teacher  ozodbek / support123
  Student  aziza / student123
`)

process.on('SIGINT', () => {
  for (const child of processes) child.kill()
  process.exit()
})
