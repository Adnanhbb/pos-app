#!/usr/bin/env node

/*
 * Local-only shared-hosting readiness verifier.
 *
 * It inspects source and deployment-package/ without contacting or uploading
 * to a hosting provider. Placeholder production values are reported as
 * remaining operator inputs rather than accepted as upload-ready values.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const packageRoot = resolve(root, "deployment-package");
const rehearsalMode = process.argv.includes("--rehearsal");

const requiredPackageFiles = [
  "frontend/index.html",
  "frontend/.htaccess",
  "api/.htaccess",
  "api/config/.htaccess",
  "api/config/runtime.php",
  "api/config/private.example.php",
  "api/lib/.htaccess",
  "api/sql/.htaccess",
  "api/health.php",
  "api/login.php",
  "api/logout.php",
  "api/session.php",
  "api/sql/schema.sql",
  ".env.production.example",
  "deployment-manifest.json",
  "docs/production-deployment-checklist.md",
  "docs/backup-and-restore-audit.md",
  "docs/local-production-rehearsal-laragon.md",
  "docs/shared-hosting-deployment-preparation.md",
];

const requiredReplayEndpoints = [
  "sale.php",
  "purchase.php",
  "customer-return.php",
  "supplier-return.php",
  "customer-payment.php",
  "supplier-payment.php",
  "item-opening-stock.php",
  "item-opening-stock-adjustment.php",
];

const requiredSchemaTables = [
  "schema_migrations",
  "users",
  "api_auth_tokens",
  "transaction_idempotency",
  "sync_transactions",
  "transaction_replay_audit",
  "sales",
  "sale_items",
  "customer_payments",
  "supplier_payments",
  "item_batches",
  "cylinders",
  "cylinder_customers",
];

const requiredEnvVariables = [
  "VITE_API_BASE_URL",
  "VITE_BASE_PATH",
  "APP_ENV",
  "CRUD_AUTH_ENFORCEMENT",
  "REPLAY_WORKER_TOKEN",
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
  "DB_PASS",
  "FRONTEND_ORIGIN",
  "CORS_ALLOW_LOCAL",
  "VITE_ENABLE_DEV_BACKDOOR",
  "VITE_ALLOW_OFFLINE_LOGIN",
];

const hostingProfile = {
  domain: String(process.env.HOSTING_DOMAIN ?? "").trim().toLowerCase(),
  phpVersion: String(process.env.HOSTING_PHP_VERSION ?? "").trim(),
  webRoot: String(process.env.HOSTING_WEB_ROOT ?? "").trim(),
  sslEnabled: /^(1|true|yes|on)$/i.test(String(process.env.HOSTING_SSL_ENABLED ?? "")),
  dbHostProvided: Boolean(String(process.env.HOSTING_DB_HOST ?? "").trim()),
  dbNameProvided: Boolean(String(process.env.HOSTING_DB_NAME ?? "").trim()),
  dbUserProvided: Boolean(String(process.env.HOSTING_DB_USER ?? "").trim()),
};

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function walk(path) {
  if (!existsSync(path)) return [];
  const files = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(relative(packageRoot, full).replaceAll("\\", "/"));
  }
  return files;
}

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return values;
}

function result(name, ok, details = {}) {
  return { name, ok, ...details };
}

const missingPackageFiles = requiredPackageFiles.filter(
  (path) => !existsSync(join(packageRoot, path))
);
const missingReplayEndpoints = requiredReplayEndpoints.filter(
  (name) => !existsSync(join(packageRoot, "api", "replay", name))
);

const schema = existsSync(join(packageRoot, "api", "sql", "schema.sql"))
  ? readFileSync(join(packageRoot, "api", "sql", "schema.sql"), "utf8")
  : "";
const missingSchemaTables = requiredSchemaTables.filter(
  (table) => !new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+\`?${table}\`?`, "i").test(schema)
);

const envSource = existsSync(join(packageRoot, ".env.production.example"))
  ? readFileSync(join(packageRoot, ".env.production.example"), "utf8")
  : "";
const env = parseEnv(envSource);
const missingEnvVariables = requiredEnvVariables.filter((name) => !(name in env));

const manifest = existsSync(join(packageRoot, "deployment-manifest.json"))
  ? JSON.parse(readFileSync(join(packageRoot, "deployment-manifest.json"), "utf8"))
  : null;
const packageFiles = walk(packageRoot);
const forbiddenPackageFiles = packageFiles.filter((path) =>
  /(^|\/)(node_modules|backups|releases|\.git|logs)(\/|$)/i.test(path) ||
  /(^|\/)\.env($|\.)/i.test(path) && path !== ".env.production.example" ||
  /\.log$/i.test(path) ||
  /tsconfig\.tsbuildinfo$/i.test(path) ||
  /\.map$/i.test(path)
);

const startupSources = ["src/App.tsx", "src/main.tsx", "src/Login.tsx"]
  .filter((path) => existsSync(resolve(root, path)))
  .map(read)
  .join("\n");
const corsSource = read("api/config/cors.php");
const databaseSource = read("api/config/database.php");
const runtimeConfigSource = read("api/config/runtime.php");
const authSource = read("api/lib/auth.php");
const privateExampleSource = read("api/config/private.example.php");
const frontendHtaccess = existsSync(join(packageRoot, "frontend", ".htaccess"))
  ? readFileSync(join(packageRoot, "frontend", ".htaccess"), "utf8")
  : "";
const apiHtaccess = existsSync(join(packageRoot, "api", ".htaccess"))
  ? readFileSync(join(packageRoot, "api", ".htaccess"), "utf8")
  : "";
const configHtaccess = existsSync(join(packageRoot, "api", "config", ".htaccess"))
  ? readFileSync(join(packageRoot, "api", "config", ".htaccess"), "utf8")
  : "";
const gitignoreSource = readFileSync(resolve(root, ".gitignore"), "utf8");
const trackedFilesResult = spawnSync("git", ["ls-files"], {
  cwd: root,
  encoding: "utf8",
  shell: false,
});
const trackedSensitiveFiles = (trackedFilesResult.stdout ?? "")
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((path) =>
    (/(^|\/)\.env($|\.)/i.test(path) &&
      !/(^|\/)\.env(\.production)?\.example$/i.test(path)) ||
    /\.(pem|key|p12|pfx)$/i.test(path) ||
    /(^|\/)(credentials|secrets)(\/|$)/i.test(path)
  );
const privateConfigPath = "api/config/private.php";
const privateConfigTracked = (trackedFilesResult.stdout ?? "")
  .split(/\r?\n/)
  .includes(privateConfigPath);
const privateConfigIgnoredResult = spawnSync("git", ["check-ignore", "-q", privateConfigPath], {
  cwd: root,
  encoding: "utf8",
  shell: false,
});
const privateConfigIgnored = privateConfigIgnoredResult.status === 0;
const privateConfigPackaged = existsSync(join(packageRoot, "api", "config", "private.php"));
const privateExamplePackaged = existsSync(join(packageRoot, "api", "config", "private.example.php"));
const privateExampleSecretsArePlaceholders =
  /['"]DB_PASS['"]\s*=>\s*['"][^'"]*(replace|example|placeholder)/i.test(privateExampleSource) &&
  /['"]REPLAY_WORKER_TOKEN['"]\s*=>\s*['"][^'"]*(replace|example|placeholder)/i.test(privateExampleSource);
const envExampleSecretsArePlaceholders =
  /DB_PASS=(replace|example|placeholder)/i.test(envSource) &&
  /REPLAY_WORKER_TOKEN=(replace|example|placeholder)/i.test(envSource);
const environmentLookupIndex = runtimeConfigSource.indexOf("getenv($key)");
const privateLookupIndex = runtimeConfigSource.lastIndexOf("app_private_config()");
const configLoadingOrderIsSafe =
  environmentLookupIndex >= 0 &&
  privateLookupIndex >= 0 &&
  environmentLookupIndex < privateLookupIndex;

const buildApiUrl = String(manifest?.build?.VITE_API_BASE_URL ?? "");
const isLocalApiUrl = /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/i.test(buildApiUrl);
const placeholderApiUrl = /example\.com|<|replace[_-]?with/i.test(buildApiUrl);
const placeholderOrigin = /example\.com|<|replace[_-]?with/i.test(env.FRONTEND_ORIGIN ?? "");
const placeholderCredentials = ["DB_NAME", "DB_USER", "DB_PASS", "REPLAY_WORKER_TOKEN"]
  .filter((name) => /replace|example|change|placeholder/i.test(env[name] ?? ""));
const parsedPhpVersion = Number.parseFloat(hostingProfile.phpVersion);
const buildUrl = (() => {
  try {
    return new URL(buildApiUrl);
  } catch {
    return null;
  }
})();
const profileSupplied = Boolean(
  hostingProfile.domain ||
  hostingProfile.phpVersion ||
  hostingProfile.webRoot ||
  hostingProfile.dbHostProvided ||
  hostingProfile.dbNameProvided ||
  hostingProfile.dbUserProvided
);

const checks = [
  result("deployment package exists", existsSync(packageRoot)),
  result("required package files exist", missingPackageFiles.length === 0, { missingPackageFiles }),
  result("all manual replay endpoints are packaged", missingReplayEndpoints.length === 0, { missingReplayEndpoints }),
  result("schema contains required auth/replay/payment tables", missingSchemaTables.length === 0, { missingSchemaTables }),
  result("schema uses shared-hosting-compatible InnoDB utf8mb4 DDL", /ENGINE=InnoDB/i.test(schema) && /CHARSET=utf8mb4/i.test(schema) && !/\bCREATE\s+DATABASE\b|\bUSE\s+[`'"]/i.test(schema)),
  result("production env template contains required variables", missingEnvVariables.length === 0, { missingEnvVariables }),
  result("frontend developer backdoor is disabled", env.VITE_ENABLE_DEV_BACKDOOR === "false" && manifest?.build?.VITE_ENABLE_DEV_BACKDOOR === "false"),
  result("offline login defaults disabled", env.VITE_ALLOW_OFFLINE_LOGIN === "false" && manifest?.build?.VITE_ALLOW_OFFLINE_LOGIN === "false"),
  result("local CORS origins default disabled", env.CORS_ALLOW_LOCAL === "false"),
  result("runtime config loads environment before private fallback", configLoadingOrderIsSafe),
  result("database, CORS, and replay auth use the shared runtime config", databaseSource.includes("app_config_value(") && corsSource.includes("app_config_value(") && authSource.includes("app_config_value(")),
  result("production database configuration fails closed when incomplete", env.APP_ENV === "production" && databaseSource.includes("$appEnv === 'production'") && databaseSource.includes("Production database configuration is incomplete")),
  result("private config example is packaged with placeholder secrets only", privateExamplePackaged && privateExampleSecretsArePlaceholders && envExampleSecretsArePlaceholders),
  result("actual private config is ignored, untracked, and excluded from package", privateConfigIgnored && !privateConfigTracked && !privateConfigPackaged, {
    privateConfigIgnored,
    privateConfigTracked,
    privateConfigPackaged,
  }),
  result("config directory blocks direct web access", configHtaccess.includes("Require all denied") || configHtaccess.includes("Deny from all")),
  result("production package does not target localhost", rehearsalMode || !isLocalApiUrl, { buildApiUrl: isLocalApiUrl ? "[local rehearsal URL]" : buildApiUrl }),
  result("frontend htaccess preserves files/api and provides safe fallback", frontendHtaccess.includes("REQUEST_FILENAME") && frontendHtaccess.includes("index.html")),
  result("api htaccess forwards bearer authorization", apiHtaccess.includes("HTTP_AUTHORIZATION") && apiHtaccess.includes("Authorization")),
  result("package excludes secrets and generated/dev artifacts", forbiddenPackageFiles.length === 0, { forbiddenPackageFiles }),
  result("manifest confirms no deployment/upload/auto-sync", manifest?.deploymentPerformed === false && manifest?.uploadPerformed === false && manifest?.autoSyncEnabled === false),
  result("startup files contain no replay invocation or timers", !/processPending\s*\(|setInterval\s*\(|new\s+Worker\s*\(|serviceWorker\.register/i.test(startupSources)),
  result("real env files are ignored", gitignoreSource.includes(".env") && gitignoreSource.includes(".env.*")),
  result("no credential-like files are tracked", trackedSensitiveFiles.length === 0, { trackedSensitiveFileCount: trackedSensitiveFiles.length }),
  ...(profileSupplied
    ? [
        result("hosting profile uses supported PHP version", Number.isFinite(parsedPhpVersion) && parsedPhpVersion >= 8.1, { phpVersion: hostingProfile.phpVersion }),
        result("hosting profile uses public_html web root", hostingProfile.webRoot === "public_html", { webRoot: hostingProfile.webRoot }),
        result("hosting profile confirms SSL", hostingProfile.sslEnabled),
        result("packaged API URL matches hosting domain", buildUrl?.protocol === "https:" && buildUrl.hostname === hostingProfile.domain, { domain: hostingProfile.domain }),
        result("hosting database coordinates supplied without password requirement", hostingProfile.dbHostProvided && hostingProfile.dbNameProvided && hostingProfile.dbUserProvided, {
          dbHostProvided: hostingProfile.dbHostProvided,
          dbNameProvided: hostingProfile.dbNameProvided,
          dbUserProvided: hostingProfile.dbUserProvided,
          dbPasswordRequiredByVerifier: false,
        }),
      ]
    : []),
];

const operatorInputs = [
  ...(placeholderApiUrl ? ["Set the final HTTPS VITE_API_BASE_URL and rebuild the package."] : []),
  ...(placeholderOrigin ? ["Set the final HTTPS FRONTEND_ORIGIN on the server."] : []),
  ...(placeholderCredentials.length && !hostingProfile.dbNameProvided
    ? [`Configure ${placeholderCredentials.join(", ")} in hosting-managed server settings; do not edit them into source control.`]
    : []),
  ...(!profileSupplied
    ? ["Confirm the final domain/subdomain, public_html path, PHP version/extensions, MySQL version, SSL status, and rollback owner."]
    : ["Configure the real DB password and replay token privately in Hostinger, then confirm PDO MySQL, MySQL/MariaDB version, backups, and rollback owner."]),
];

const report = {
  ok: checks.every((check) => check.ok),
  localVerificationOnly: true,
  rehearsalMode,
  generatedAt: new Date().toISOString(),
  packagePath: packageRoot,
  hostingProfile: {
    domain: hostingProfile.domain || null,
    phpVersion: hostingProfile.phpVersion || null,
    webRoot: hostingProfile.webRoot || null,
    sslEnabled: hostingProfile.sslEnabled,
    dbHostProvided: hostingProfile.dbHostProvided,
    dbNameProvided: hostingProfile.dbNameProvided,
    dbUserProvided: hostingProfile.dbUserProvided,
    dbPasswordRequiredByVerifier: false,
  },
  structurallyReady: checks.every((check) => check.ok),
  readyForUpload: checks.every((check) => check.ok) && operatorInputs.length === 1,
  deploymentPerformed: false,
  uploadPerformed: false,
  credentialsPrinted: false,
  autoSyncEnabled: false,
  checks,
  operatorInputs,
  warnings: [
    "This verifier never contacts a hosting provider.",
    "Placeholder values are safe for package preparation but must be replaced through hosting/build environment configuration before upload.",
  ],
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
