#!/usr/bin/env node
/**
 * Lance le wrapper Gradle du projet Android de façon portable.
 *
 *   node scripts/android-gradle.mjs assembleDebug
 *   node scripts/android-gradle.mjs assembleRelease --stacktrace
 *
 * Pourquoi un script : dans les scripts npm, `./gradlew` échoue sous Windows
 * (cmd.exe) et `gradlew` seul échoue sous macOS/Linux. On choisit ici le bon
 * exécutable et on vérifie que `npx cap sync android` a bien été joué avant.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(root, "android");
const isWindows = process.platform === "win32";
const wrapper = path.join(androidDir, isWindows ? "gradlew.bat" : "gradlew");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage : node scripts/android-gradle.mjs <tâche Gradle> [options]");
  process.exit(2);
}

if (!existsSync(wrapper)) {
  console.error(`Wrapper Gradle introuvable : ${wrapper}`);
  process.exit(1);
}

// Ces fichiers sont générés par `npx cap sync android` (et ignorés par Git).
const generated = [
  path.join(androidDir, "capacitor-cordova-android-plugins", "build.gradle"),
  path.join(androidDir, "app", "capacitor.build.gradle"),
  path.join(androidDir, "app", "src", "main", "assets", "public", "index.html"),
];
const missing = generated.filter((file) => !existsSync(file));
if (missing.length > 0) {
  console.error(
    "Le projet Android n'est pas synchronisé. Lance d'abord `npm run android:sync` " +
      "(= next build + npx cap sync android). Fichiers manquants :\n  - " +
      missing.map((file) => path.relative(root, file)).join("\n  - "),
  );
  process.exit(1);
}

const result = spawnSync(wrapper, args, {
  cwd: androidDir,
  stdio: "inherit",
  shell: isWindows,
});

if (result.error) {
  console.error(`Impossible de lancer Gradle : ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
