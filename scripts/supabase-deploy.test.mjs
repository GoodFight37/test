import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkTarget, migrationPlan, PROJECT } from './supabase-deploy.mjs';
const old = { name: '0046_reset.sql', version: '0046', hash: 'known', sql: 'select 1;' };
const next = { name: '0047_fix.sql', version: '0047', hash: 'new', sql: '-- creatordeck-deploy: automatic\nselect 1;' };
const baseline = { [old.name]: old.hash };
test('aucune migration en attente : aucun plan', () => assert.deepEqual(migrationPlan([old], baseline, ['0046']), []));
test('nouvelle migration automatique uniquement', () => assert.deepEqual(migrationPlan([old, next], baseline, ['0046']), [next]));
test('migration déjà enregistrée jamais rejouée', () => assert.deepEqual(migrationPlan([old, next], baseline, ['0046', '0047']), []));
test('historique manuel absent : arrêt avant tout reset', () => assert.throws(() => migrationPlan([old, next], baseline, []), /Historique Supabase incomplet/));
test('ancien fichier modifié : nouvelle migration obligatoire', () => assert.throws(() => migrationPlan([{ ...old, hash: 'changed' }], baseline, ['0046']), /historique modifiée/));
test('migration locale supprimée : arrêt', () => assert.throws(() => migrationPlan([], baseline, ['0046']), /manquante/));
test('numéro dupliqué : arrêt', () => assert.throws(() => migrationPlan([old, next, next], baseline, ['0046']), /dupliqué/));
test('version distante inconnue : arrêt', () => assert.throws(() => migrationPlan([old], baseline, ['0046', '0099']), /absente/));
test('ancienne migration hors baseline ne peut pas être appliquée', () => assert.throws(() => migrationPlan([old, { ...next, version: '0045' }], baseline, ['0046']), /historique ne peut/));
test('mode absent refuse le déploiement', () => assert.throws(() => migrationPlan([old, { ...next, sql: 'select 1;' }], baseline, ['0046']), /Mode/));
test('mode manual bloque le chemin automatique mais accepte une validation explicite', () => {
  const manual = { ...next, sql: '-- creatordeck-deploy: manual\nselect 1;' };
  assert.throws(() => migrationPlan([old, manual], baseline, ['0046']), /Validation manuelle/);
  assert.deepEqual(migrationPlan([old, manual], baseline, ['0046'], true), [manual]);
});
test('connexion directe et pooler ciblent CreatorDeck avec TLS vérifié', () => {
  for (const u of [`postgresql://postgres:fake@db.${PROJECT}.supabase.co:5432/postgres`, `postgresql://postgres.${PROJECT}:fake@aws-0-eu-west-3.pooler.supabase.com:6543/postgres`]) {
    assert.equal(checkTarget(u).searchParams.get('sslmode'), 'verify-full');
  }
});
test('mauvais projet, hôte, utilisateur, base ou mot de passe absent : arrêt', () => {
  for (const u of ['invalid', `postgresql://postgres:fake@db.other.supabase.co/postgres`, `postgresql://postgres.other:fake@aws-0-eu.pooler.supabase.com/postgres`, `postgresql://postgres.${PROJECT}:fake@evil.example/postgres`, `postgresql://postgres:fake@db.${PROJECT}.supabase.co/other`, `postgresql://postgres@db.${PROJECT}.supabase.co/postgres`]) assert.throws(() => checkTarget(u));
});
test('le workflow attend une CI complète, main et utilise la révision vérifiée', async () => {
  const yaml = await readFile('.github/workflows/supabase-deploy.yml', 'utf8');
  assert.match(yaml, /workflow_run:/);
  assert.match(yaml, /conclusion == 'success'/);
  assert.match(yaml, /head_repository.full_name == github.repository/);
  assert.match(yaml, /workflow_run.event == 'push'/);
  assert.match(yaml, /sha !== current.data.commit.sha/);
  assert.match(yaml, /ref: \$\{\{ steps.revision.outputs.sha \}\}/);
  assert.match(yaml, /cancel-in-progress: false/);
  assert.doesNotMatch(yaml, /migration repair|--include-all/);
});
