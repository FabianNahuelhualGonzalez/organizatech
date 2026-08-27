import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  renderEmailTemplate,
  type OrganizatechEmailTemplateKind,
} from "../supabase/functions/_shared/email-onboarding/templates";

interface PreviewDefinition {
  kind: OrganizatechEmailTemplateKind;
  basename: string;
  actionUrl: string;
}

const previews: readonly PreviewDefinition[] = [
  {
    kind: "confirmation_user",
    basename: "confirmacion-usuario",
    actionUrl: "https://organizatech.cl/login?flow=signup-confirmation&portal=usuario",
  },
  {
    kind: "confirmation_coach",
    basename: "confirmacion-coach",
    actionUrl: "https://organizatech.cl/login?flow=signup-confirmation&portal=coach",
  },
  {
    kind: "welcome_user",
    basename: "bienvenida-usuario",
    actionUrl: "https://organizatech.cl/login?portal=usuario",
  },
  {
    kind: "welcome_coach",
    basename: "bienvenida-coach",
    actionUrl: "https://organizatech.cl/login?portal=coach",
  },
];

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const outputDirectory = join(
  repositoryRoot,
  "docs/product/email-onboarding/previews",
);

function deterministicArtifacts() {
  const artifacts = new Map<string, string>();
  for (const preview of previews) {
    const rendered = renderEmailTemplate({
      kind: preview.kind,
      firstName: "Alex",
      lastName: "Ejemplo",
      actionUrl: preview.actionUrl,
    });
    artifacts.set(`${preview.basename}.html`, `${rendered.htmlContent.trim()}\n`);
    artifacts.set(`${preview.basename}.txt`, `${rendered.textContent.trim()}\n`);
  }
  return artifacts;
}

function writeArtifacts(artifacts: ReadonlyMap<string, string>) {
  mkdirSync(outputDirectory, { recursive: true });
  for (const [filename, contents] of artifacts) {
    writeFileSync(join(outputDirectory, filename), contents, "utf8");
  }
  console.log(`EMAIL-ONBOARDING-01 previews escritos: ${artifacts.size}`);
}

function checkArtifacts(artifacts: ReadonlyMap<string, string>) {
  const expectedFilenames = [...artifacts.keys()].sort();
  const actualFilenames = existsSync(outputDirectory)
    ? readdirSync(outputDirectory).sort()
    : [];
  const expectedFilenameSet = new Set(expectedFilenames);
  const actualFilenameSet = new Set(actualFilenames);
  const missing = expectedFilenames.filter((filename) => !actualFilenameSet.has(filename));
  const obsolete = actualFilenames.filter((filename) => !expectedFilenameSet.has(filename));
  const drift: string[] = [];
  for (const [filename, expected] of artifacts) {
    const path = join(outputDirectory, filename);
    if (!existsSync(path) || readFileSync(path, "utf8") !== expected) drift.push(filename);
  }
  if (missing.length > 0 || obsolete.length > 0 || drift.length > 0) {
    const details = [
      missing.length > 0 ? `faltantes: ${missing.join(", ")}` : "",
      obsolete.length > 0 ? `obsoletos: ${obsolete.join(", ")}` : "",
      drift.length > 0 ? `contenido: ${drift.join(", ")}` : "",
    ].filter(Boolean);
    throw new Error(`EMAIL-ONBOARDING-01 previews desactualizados (${details.join("; ")})`);
  }
  console.log(`EMAIL-ONBOARDING-01 previews verificados: ${artifacts.size}`);
}

const writeMode = process.argv.includes("--write");
const checkMode = process.argv.includes("--check");
if (writeMode === checkMode) {
  throw new Error("Usa exactamente uno de los flags --check o --write.");
}

const artifacts = deterministicArtifacts();
if (writeMode) writeArtifacts(artifacts);
else checkArtifacts(artifacts);
