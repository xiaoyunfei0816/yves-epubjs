import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REQUIRED_CITIC_BRANCH = "feature/ebook-reader-v2-pretext-epubjs"
const DEFAULT_CITIC_REPO = "C:\\xyfProject\\citicpub-enterprise-rn"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const corePackageDir = path.join(repoRoot, "packages", "core")
const coreDistDir = path.join(corePackageDir, "dist")
const corePackageJsonPath = path.join(corePackageDir, "package.json")
const citicRepo = path.resolve(process.env.CITIC_REPO ?? DEFAULT_CITIC_REPO)
const targetPackageDir = path.join(
  citicRepo,
  "modules",
  "pretext-epub-core"
)
const targetDistDir = path.join(targetPackageDir, "dist")
const targetPackageJsonPath = path.join(targetPackageDir, "package.json")

main()

function main() {
  assertDirectory(coreDistDir, "Core dist directory is missing. Run pnpm run build first.")
  assertFile(path.join(coreDistDir, "index.js"), "Core ESM build is missing.")
  assertFile(path.join(coreDistDir, "index.cjs"), "Core CJS build is missing.")
  assertFile(path.join(coreDistDir, "index.d.ts"), "Core type build is missing.")
  assertFile(corePackageJsonPath, "Core package.json is missing.")
  assertDirectory(citicRepo, "citicpub-enterprise-rn repository is missing.")

  const branch = getGitBranch(citicRepo)
  if (branch !== REQUIRED_CITIC_BRANCH) {
    fail(
      [
        `citicpub-enterprise-rn must be on ${REQUIRED_CITIC_BRANCH}.`,
        `Current branch: ${branch || "(detached or unknown)"}`
      ].join("\n")
    )
  }

  fs.mkdirSync(targetPackageDir, { recursive: true })
  assertPathInside(targetDistDir, targetPackageDir)
  assertPathInside(targetPackageJsonPath, targetPackageDir)

  fs.rmSync(targetDistDir, { recursive: true, force: true })
  fs.cpSync(coreDistDir, targetDistDir, { recursive: true })
  fs.writeFileSync(
    targetPackageJsonPath,
    `${JSON.stringify(createPortablePackageJson(), null, 2)}\n`,
    "utf8"
  )

  console.log("Synced @pretext-epub/core to citicpub-enterprise-rn.")
  console.log(`Source dist: ${coreDistDir}`)
  console.log(`Target dist: ${targetDistDir}`)
  console.log(`Target package.json: ${targetPackageJsonPath}`)
}

function createPortablePackageJson() {
  const packageJson = JSON.parse(fs.readFileSync(corePackageJsonPath, "utf8"))
  const portablePackageJson = { ...packageJson }
  delete portablePackageJson.scripts
  return portablePackageJson
}

function getGitBranch(workdir) {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd: workdir,
      encoding: "utf8"
    }).trim()
  } catch (error) {
    fail(`Failed to read git branch for ${workdir}.\n${formatError(error)}`)
  }
}

function assertDirectory(directoryPath, message) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    fail(`${message}\nPath: ${directoryPath}`)
  }
}

function assertFile(filePath, message) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`${message}\nPath: ${filePath}`)
  }
}

function assertPathInside(candidatePath, parentPath) {
  const resolvedCandidate = path.resolve(candidatePath)
  const resolvedParent = path.resolve(parentPath)
  const relativePath = path.relative(resolvedParent, resolvedCandidate)
  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    relativePath === ""
  ) {
    fail(`Refusing to write outside target package directory: ${resolvedCandidate}`)
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
