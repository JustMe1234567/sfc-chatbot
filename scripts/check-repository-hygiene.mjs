import { execFileSync } from "node:child_process";

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
  windowsHide: true,
})
  .split(/\r?\n/u)
  .filter(Boolean);

const blockedFiles = [
  {
    category: "database",
    matches: (path) => /(?:^|\/)[^/]+\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?$/iu.test(path),
  },
  {
    category: "secret",
    matches: (path) =>
      (/(?:^|\/)\.env(?:\..+)?$/u.test(path) && path !== ".env.example") ||
      /(?:^|\/)(?:credentials|service-account(?:-[^/]*)?)\.json$/iu.test(path) ||
      /(?:^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/iu.test(path) ||
      /\.(?:key|pem|p12|pfx)$/iu.test(path),
  },
  {
    category: "log",
    matches: (path) => /(?:^|\/)[^/]+\.log$/iu.test(path),
  },
  {
    category: "worktree",
    matches: (path) => /(?:^|\/)(?:\.worktrees|worktrees)\//iu.test(path),
  },
  {
    category: "temporary skill installation",
    matches: (path) =>
      /^\.agents\/skills\/(?:design-taste-frontend|ui-ux-pro-max)\//u.test(path) ||
      /(?:^|\/)\.codex\/skills\//u.test(path),
  },
];

const violations = trackedFiles.flatMap((path) =>
  blockedFiles
    .filter(({ matches }) => matches(path))
    .map(({ category }) => ({ category, path })),
);

if (violations.length > 0) {
  console.error("Repository hygiene check failed. Remove these files from Git:");
  for (const { category, path } of violations) {
    console.error(`- [${category}] ${path}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Repository hygiene check passed (${trackedFiles.length} tracked files scanned).`);
}
