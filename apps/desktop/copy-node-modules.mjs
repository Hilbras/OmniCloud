// Copies the runtime dependency closure of the bundled server into
// packages/sdk/server/node_modules so the bundle can be shipped standalone
// (electron-builder picks the whole server/ dir up via extraResources).
//
// The server bundle (scripts/bundle-server.mjs) marks these packages as
// esbuild externals, so they must be resolvable at runtime. A flat copy of
// the top-level packages is not enough: transitive dependencies (fastify ->
// avvio, fastq, ...) and the generated Prisma client (.prisma, which lives
// beside @prisma/client in the pnpm virtual store) have to come along too.
// Keep EXTERNALS in sync with NPM_EXTERNALS in bundle-server.mjs.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = resolve(here, "../..");
const sdkDir = dirname(join(repoRoot, "packages/sdk/package.json"));
const databaseDir = join(repoRoot, "packages/database");
const serverDir = join(repoRoot, "packages/sdk/server");
const dest = join(serverDir, "node_modules");

const EXTERNALS = [
  "fastify",
  "@fastify/cookie",
  "@fastify/multipart",
  "@fastify/static",
  "@prisma/client",
];

function resolvePackage(name, fromDir) {
  const req = createRequire(join(fromDir, "package.json"));
  let entry;
  try {
    entry = req.resolve(name);
  } catch {
    // Some packages (the Prisma CLI) have exports but no main entry.
    entry = req.resolve(`${name}/package.json`);
  }
  // Walk up from the resolved entry file to the package dir, i.e. the
  // deepest directory ending in node_modules/<name> (the name may be
  // scoped, e.g. node_modules/@fastify/cookie).
  const suffix = join("node_modules", ...name.split("/"));
  let dir = dirname(entry);
  while (!dir.endsWith(sep + suffix)) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Cannot locate package root of ${name} (resolved to ${entry})`);
    }
    dir = parent;
  }
  const packageRoot = dir;
  if (!packageRoot.startsWith(repoRoot + sep)) {
    throw new Error(
      `${name} resolved outside the repository (${packageRoot}); refusing to copy a stray install.`,
    );
  }
  return packageRoot;
}

function dependencyNames(packageRoot) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const names = [];
  // Peer dependencies are for the consumer to install, not runtime children.
  // Following them shipped TypeScript through @prisma/client's optional peers.
  for (const key of ["dependencies", "optionalDependencies"]) {
    for (const name of Object.keys(manifest[key] ?? {})) {
      names.push(name);
    }
  }
  return names;
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

// Top-level package name -> source realpath. A second version of the same
// name is nested under the package that needs it, so both stay resolvable.
const copied = new Map();
// Source package root -> the directory it was copied to. Used to nest a
// conflicting dependency inside its consumer.
const destinationOfSource = new Map([
  [sdkDir, dest],
  [databaseDir, dest],
]);

const queue = [
  ...EXTERNALS.map((name) => ({ name, fromDir: sdkDir })),
  // The desktop applies migrations before spawning the bundled server, so the
  // Prisma CLI ships with the app. It lives beside the database package.
  { name: "prisma", fromDir: databaseDir },
];

function copyPackage(packageRoot, destination, name) {
  cpSync(packageRoot, destination, { recursive: true, dereference: true });
  destinationOfSource.set(packageRoot, destination);

  // The generated Prisma client lives in .prisma/client next to @prisma/client
  // in the pnpm virtual store; it contains the generated code and the query
  // engine binary, none of which are reachable via the package manifest.
  if (name === "@prisma/client") {
    const containingNodeModules = packageRoot.slice(0, packageRoot.length - (sep + name).length);
    const generated = join(containingNodeModules, ".prisma");
    if (existsSync(generated)) {
      cpSync(generated, join(dest, ".prisma"), { recursive: true, dereference: true });
    } else {
      throw new Error("Generated Prisma client (.prisma) not found — run `prisma generate` first.");
    }
  }

  for (const dep of dependencyNames(packageRoot)) {
    queue.push({ name: dep, fromDir: packageRoot });
  }
}

while (queue.length > 0) {
  const { name, fromDir } = queue.shift();

  let packageRoot;
  try {
    packageRoot = resolvePackage(name, fromDir);
  } catch (error) {
    if (EXTERNALS.includes(name) || name === "prisma") {
      throw new Error(`Required dependency ${name} could not be resolved: ${error.message}`);
    }
    // Optional dependency that is not installed — fine to skip.
    continue;
  }

  const existing = copied.get(name);
  if (existing !== undefined) {
    if (existing === packageRoot) continue;
    const parentDestination = destinationOfSource.get(fromDir);
    if (parentDestination === undefined || parentDestination === dest) {
      throw new Error(
        `Two top-level versions of ${name} are needed (${existing} and ${packageRoot}).`,
      );
    }
    copyPackage(packageRoot, join(parentDestination, "node_modules", name), name);
    continue;
  }

  copied.set(name, packageRoot);
  copyPackage(packageRoot, join(dest, name), name);
}

console.log(`Copied ${copied.size} runtime packages into ${dest}`);
