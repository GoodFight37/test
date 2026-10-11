/** Déploiement via le CLI officiel, uniquement après contrôle du plan. */
import { readFile, readdir, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const PROJECT = "yzxchpybqrfegvecihxf";
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
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    host: url.hostname, port: Number(url.port || 5432), database: 'postgres',
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
  });
  let pending;
  try {
    await client.connect();
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
  const run = spawnSync('supabase', ['db', 'push', '--db-url', url.toString(), '--yes'], { encoding: 'utf8', timeout: 300000 });
  const redact = text => String(text || '').split(url.toString()).join('[connexion masquée]').split(process.env.SUPABASE_DB_URL).join('[connexion masquée]').split(decodeURIComponent(url.password)).join('[mot de passe masqué]');
  process.stdout.write(redact(run.stdout));
  process.stderr.write(redact(run.stderr));
  if (run.error || run.status !== 0) throw new Error('CLI Supabase en échec. Consulter la sortie masquée ; aucune réparation automatique.');
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
