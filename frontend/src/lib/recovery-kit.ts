import { encryptJsonWithPassphrase } from "@/lib/crypto";

interface RecoverySnapshot {
  company: unknown;
  currentUser: unknown;
  dashboard: unknown;
  projects: unknown;
  tasks: unknown;
  users: unknown;
}

interface SecureRecoveryDownloadOptions {
  companyName: string;
  adminUsername: string;
  adminPassword: string;
  encryptionKey: string;
  kdfAlgorithm: "pbkdf2-sha256";
  kdfIterations: number;
  companyKdfSalt: string;
  snapshot: RecoverySnapshot;
}

function sanitizeFileNameSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";
}

function triggerDownload(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadSecureRecoveryKit(options: SecureRecoveryDownloadOptions) {
  const exportedAt = new Date().toISOString();
  const safeName = sanitizeFileNameSegment(options.companyName);
  const encryptedBackup = await encryptJsonWithPassphrase(
    {
      version: 1,
      exportedAt,
      companyName: options.companyName,
      adminUsername: options.adminUsername,
      security: {
        mode: "secure",
        companyKdfAlgorithm: options.kdfAlgorithm,
        companyKdfIterations: options.kdfIterations,
        companyKdfSalt: options.companyKdfSalt
      },
      snapshot: options.snapshot
    },
    options.encryptionKey,
    options.kdfIterations
  );

  triggerDownload(
    `${safeName}-jtzt-secure-recovery.json`,
    JSON.stringify(
      {
        version: 1,
        exportedAt,
        type: "jtzt-secure-recovery-package",
        company: {
          name: options.companyName,
          loginPath: "/login",
          mode: "secure"
        },
        adminCredentials: {
          username: options.adminUsername,
          password: options.adminPassword
        },
        encryption: {
          key: options.encryptionKey,
          companyKdfAlgorithm: options.kdfAlgorithm,
          companyKdfIterations: options.kdfIterations,
          companyKdfSalt: options.companyKdfSalt
        },
        companyName: options.companyName,
        encryptedBackup,
        guidance: [
          "Jtzt does not store this encryption key on the server.",
          "Without this encryption key, secure-mode access cannot be recovered.",
          "Store this file offline in a password manager or encrypted vault."
        ]
      },
      null,
      2
    ),
    "application/json;charset=utf-8"
  );
}
