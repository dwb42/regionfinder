import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const allowPublicHvvArtifacts = process.env.REGIONFINDER_ALLOW_PUBLIC_HVV_ARTIFACTS === '1'
const artifactDir = join(process.cwd(), 'public/data/hvv')

if (!allowPublicHvvArtifacts) {
  const entries = await readdir(artifactDir, { withFileTypes: true }).catch(() => [])
  const generatedArtifacts = entries
    .filter((entry) => entry.isFile() && entry.name !== '.gitkeep')
    .map((entry) => entry.name)

  if (generatedArtifacts.length > 0) {
    console.error(
      [
        'Generated Legacy-HVV artifacts are present under public/data/hvv.',
        'Vite would copy them into dist. Move or remove them before production builds.',
        `Found: ${generatedArtifacts.join(', ')}`,
        'Set REGIONFINDER_ALLOW_PUBLIC_HVV_ARTIFACTS=1 only for an intentional legacy artifact build.',
      ].join('\n'),
    )
    process.exit(1)
  }
}
