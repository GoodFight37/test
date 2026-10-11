/** Déploiement via le CLI officiel, uniquement après contrôle du plan. */
import { readFile, readdir, appendFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash, X509Certificate } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const PROJECT = "yzxchpybqrfegvecihxf";
export function postgresTls(certificate) {
  if (!certificate?.trim()) return { rejectUnauthorized: true };
  try {
    if (!new X509Certificate(certificate).ca) throw new Error('not-ca');
  } catch { throw new Error('SUPABASE_DB_CA_CERT doit contenir le certificat CA PEM téléchargé depuis Supabase, en entier.'); }
  return { rejectUnauthorized: true, ca: certificate };
}

/** Le CLI reçoit la même autorité que le contrôle Node, sans relâcher TLS. */
export async function withCertificateUrl(url, certificate, action) {
  if (!certificate) return action(url);
  const directory = await mkdtemp(join(tmpdir(), 'creatordeck-db-ca-'));
  try {
    const path = join(directory, 'root.crt');
    await writeFile(path, certificate, { mode: 0o600 });
    const secured = new URL(url);
    secured.searchParams.set('sslrootcert', path);
    return await action(secured);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
/** Messages fixes : ne jamais journaliser les paramètres du pilote PostgreSQL. */
export function connectionFailure(error) {
  const reasons = {
    '28P01': 'Mot de passe PostgreSQL refusé (28P01). Vérifier le mot de passe de base enregistré dans SUPABASE_DB_URL.',
    '28000': 'Authentification PostgreSQL refusée (28000). Vérifier l’utilisateur et le projet dans la connexion Supabase.',
    ENOTFOUND: 'Hôte PostgreSQL introuvable (ENOTFOUND). Vérifier l’adresse copiée depuis Connect → Session pooler.',
    EAI_AGAIN: 'Résolution DNS temporairement indisponible (EAI_AGAIN).',
    ECONNREFUSED: 'Connexion TCP refusée (ECONNREFUSED). Vérifier le pooler, son port et l’état du projet.',
    ENETUNREACH: 'Réseau PostgreSQL inaccessible (ENETUNREACH). Avec une connexion directe IPv6, utiliser le Session pooler IPv4.',
    EHOSTUNREACH: 'Serveur PostgreSQL inaccessible (EHOSTUNREACH). Vérifier les restrictions réseau du projet.',
    ETIMEDOUT: 'Connexion PostgreSQL expirée (ETIMEDOUT). Vérifier les restrictions réseau du projet et l’état du pooler.',
    ECONNRESET: 'Connexion interrompue par le serveur (ECONNRESET).',
    SELF_SIGNED_CERT_IN_CHAIN: 'Certificat TLS non reconnu (SELF_SIGNED_CERT_IN_CHAIN). Vérifier la chaîne de certificats Supabase ; ne pas désactiver TLS.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Certificat TLS autosigné (DEPTH_ZERO_SELF_SIGNED_CERT). Vérifier le certificat de la base ; ne pas désactiver TLS.',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Chaîne de certificats TLS incomplète (UNABLE_TO_VERIFY_LEAF_SIGNATURE).',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'Autorité du certificat TLS absente (UNABLE_TO_GET_ISSUER_CERT_LOCALLY).',
    CERT_HAS_EXPIRED: 'Certificat TLS expiré (CERT_HAS_EXPIRED).',
    ERR_TLS_CERT_ALTNAME_INVALID: 'Certificat TLS incompatible avec l’hôte (ERR_TLS_CERT_ALTNAME_INVALID).',
    '53300': 'Nombre maximal de connexions PostgreSQL atteint (53300).',
    '57P03': 'PostgreSQL temporairement indisponible (57P03).',
  };
  if (Object.hasOwn(reasons, error?.code)) return reasons[error.code];
  // Le pooler peut émettre ce refus sans code SQLSTATE exploitable.
  if (/tenant or user not found/i.test(String(error?.message ?? ''))) {
    return 'Pooler Supabase : projet ou utilisateur introuvable. Recopier l’hôte et l’utilisateur depuis Connect → Session pooler du projet CreatorDeck.';
  }
  if (/timeout|timed out/i.test(String(error?.message ?? ''))) {
    return 'Délai de connexion PostgreSQL dépassé. Vérifier les restrictions réseau du projet et l’état du pooler.';
  }
  if (Array.isArray(error?.errors) && error.errors.length) {
    return [...new Set(error.errors.map(connectionFailure))].join(' ');
  }
  return 'Connexion PostgreSQL impossible : cause non reconnue. Aucun paramètre de connexion affiché.';
}
export function checkTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("SUPABASE_DB_URL doit être une URL PostgreSQL."); }
  const user = decodeURIComponent(url.username);
  const direct = url.hostname === `db.${PROJECT}.supabase.co` && user === "postgres";
  const pooler = /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(url.hostname) && user === `postgres.${PROJECT}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler) || url.pathname !== '/postgres' || !url.password || !['', '5432', '6543'].includes(url.port)) {
    throw new Error("Connexion refusée : utiliser la connexion PostgreSQL du projet CreatorDeck attendu.");
  }
  // Le certificat serveur doit être vérifié ; aucun contournement TLS.
  url.search = '';
  url.searchParams.set('sslmode', 'verify-full');
  return url;
}
export function migrationPlan(files, baseline, applied, approveManual = false) {
  const versions = new Set(files.map(f => f.version));
  if (versions.size !== files.length) throw new Error("Numéro de migration dupliqué.");
  for (const [name, hash] of Object.entries(baseline)) {
    if (!files.some(f => f.name === name && f.hash === hash)) throw new Error(`Migration historique modifiée/manquante : ${name}. Ajouter une nouvelle migration.`);
  }
  const missingHistory = files.filter(f => baseline[f.name] && !applied.includes(f.version));
  if (missingHistory.length) throw new Error("Historique Supabase incomplet : migrations anciennes appliquées à la main. Vérifier leur état avant de réconcilier l'historique ; aucun SQL exécuté.");
  if (applied.some(v => !versions.has(v))) throw new Error("La base possède une migration absente de cette révision. Déploiement arrêté.");
  const pending = files.filter(f => !applied.includes(f.version));
  for (const f of pending) {
    if (Number(f.version) <= 46) throw new Error("Une migration historique ne peut jamais être rejouée automatiquement.");
    const mode = f.sql.match(/^-- creatordeck-deploy: (automatic|manual)\r?$/m)?.[1];
    if (!mode) throw new Error(`Mode de déploiement manquant : ${f.name}.`);
    if (mode === 'manual' && !approveManual) throw new Error(`Validation manuelle requise : ${f.name}.`);
  }
  return pending;
}
async function filesOnDisk() {
  const names = (await readdir('supabase/migrations')).filter(n => /^\d+_.+\.sql$/.test(n)).sort();
  return Promise.all(names.map(async name => {
    const sql = await readFile(`supabase/migrations/${name}`, 'utf8');
    return { name, sql, version: name.split('_')[0], hash: createHash('sha256').update(sql).digest('hex') };
  }));
}
async function main() {
  const files = await filesOnDisk();
  const baseline = JSON.parse(await readFile('supabase/deploy-baseline.json', 'utf8'));
  // Vérifier les fichiers même quand il n'y a rien à déployer.
  const baselineVersions = files.filter(f => baseline[f.name]).map(f => f.version);
  migrationPlan(files, baseline, baselineVersions, process.argv.includes('--check') || process.argv.includes('--dry-run') || process.argv.includes('--approve-manual'));
  if (process.argv.includes('--check')) {
    console.log('Politique des migrations valide. Aucun accès réseau.');
    return;
  }
  if (!files.some(f => !baseline[f.name]) && !process.argv.includes('--dry-run')) {
    console.log('Aucune nouvelle migration : aucun accès à la base, aucun SQL exécuté.');
    return;
  }
  if (!process.env.SUPABASE_DB_URL) throw new Error('Configurer le secret GitHub SUPABASE_DB_URL pour activer les migrations.');
  const url = checkTarget(process.env.SUPABASE_DB_URL);
  const ssl = postgresTls(process.env.SUPABASE_DB_CA_CERT);
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    host: url.hostname, port: Number(url.port || 5432), database: 'postgres',
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl, connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
  });
  let pending;
  try {
    try { await client.connect(); }
    catch (error) { throw new Error(connectionFailure(error)); }
    // Lecture seule : aucun repair/baseline automatique.
    const tables = await client.query("select to_regclass('supabase_migrations.schema_migrations') history, to_regclass('public.onboarding_state') tutorial, to_regclass('public.return_gifts') gift");
    if (!tables.rows[0].history || !tables.rows[0].tutorial || !tables.rows[0].gift) throw new Error('Schéma cible incomplet : aucune migration exécutée.');
    const result = await client.query('select version from supabase_migrations.schema_migrations order by version');
    pending = migrationPlan(files, baseline, result.rows.map(r => r.version), process.argv.includes('--dry-run') || process.argv.includes('--approve-manual'));
  } finally { await client.end(); }
  console.log('Connexion TLS, projet CreatorDeck et historique vérifiés.');
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, 'Connexion TLS au projet CreatorDeck et historique vérifiés.\n');
  if (!pending.length) { console.log('La base est déjà à jour. Aucun SQL de migration exécuté.'); return; }
  console.log(`Migrations validées : ${pending.map(f => f.name).join(', ')}`);
  if (process.argv.includes('--dry-run')) { console.log('Lecture seule : aucun SQL exécuté.'); return; }
  await withCertificateUrl(url, ssl.ca, async (secured) => {
    const run = spawnSync('supabase', ['db', 'push', '--db-url', secured.toString(), '--yes'], { encoding: 'utf8', timeout: 300000 });
    const redact = text => String(text || '').split(secured.toString()).join('[connexion masquée]').split(url.toString()).join('[connexion masquée]').split(process.env.SUPABASE_DB_URL).join('[connexion masquée]').split(decodeURIComponent(url.password)).join('[mot de passe masqué]');
    process.stdout.write(redact(run.stdout));
    process.stderr.write(redact(run.stderr));
    if (run.error || run.status !== 0) throw new Error('CLI Supabase en échec. Consulter la sortie masquée ; aucune réparation automatique.');
  });
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Migrations appliquées sur CreatorDeck : ${pending.map(f => f.name).join(', ')}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Les erreurs du pilote peuvent contenir des paramètres de connexion.
    const safe = error.code ? 'Connexion PostgreSQL impossible ; vérifier le secret et l’accès réseau du runner.' : error.message;
    console.error(safe);
    process.exitCode = 1;
  });
}
