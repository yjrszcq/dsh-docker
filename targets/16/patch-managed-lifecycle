import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export const MANAGED_LIFECYCLE_MODULE = 'lib/dsh-docker-managed-lifecycle.js'
export const PROFILE_PACKAGE_STORAGE_MODULE = 'lib/dsh-docker-profile-package-storage.js'
const BIN_TARGET = 'lib/bin.js'
const BIN_IMPORT = 'import { prepareManagedInvocation } from "./dsh-docker-managed-lifecycle.js";'
const PROFILE_IMPORT = 'import { managedSigtermHandler, markManagedReady, provideManagedLifecycle } from "./dsh-docker-managed-lifecycle.js";'
const BIN_DISPATCH = 'const invocation = parseDshArgs(process.argv.slice(2), readVersion());'
const BIN_DISPATCH_PATCHED = `${BIN_DISPATCH}\nconst managedExitCode = await prepareManagedInvocation(invocation);\nif (managedExitCode !== null) process.exit(managedExitCode);`
const SIGTERM = 'process.on("SIGTERM", () => {\n\t\tinterrupt(0);\n\t});'
const SIGTERM_PATCHED = 'process.on("SIGTERM", managedSigtermHandler(interrupt));'
const HOST_PROVIDER = 'hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment);'
const HOST_PROVIDER_PATCHED = `${HOST_PROVIDER}\n\t\tprovideManagedLifecycle(hostCtx);`
const PROFILE_RETURN = '\treturn {\n\t\tctx,\n\t\tshutdown\n\t};'
const PROFILE_RETURN_PATCHED = '\tif (ctx.get("loader") !== void 0) await markManagedReady();\n' + PROFILE_RETURN

const PROFILE_PACKAGE_STORAGE_SOURCE = String.raw`import {
	closeSync, cpSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync,
	statSync, unlinkSync, writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";

const MODULES_BACKUP = ".dsh-platform-node_modules.previous";
const WORKSPACE_BACKUP = ".dsh-platform-pnpm-workspace.previous";
const MIGRATION_COMMIT = ".dsh-platform-profile-migration.committed";
const PNPM_TIMEOUT_MS = 3e5;

function profileDirectory(profile) {
	if (typeof profile !== "string" || profile === "" || profile === "." || profile === ".."
		|| profile === "node_modules" || profile.includes("/") || profile.includes("\\")) {
		throw new Error("invalid managed DSH Profile name");
	}
	const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
	return { dshHome, profileDir: join(dshHome, "profiles", profile) };
}

function installedStore(profileDir) {
	const modulesState = join(profileDir, "node_modules", ".modules.yaml");
	if (!existsSync(modulesState)) return null;
	let value;
	try {
		value = JSON.parse(readFileSync(modulesState, "utf8"));
	} catch {
		throw new Error("Web Profile package metadata is not valid pnpm state");
	}
	if (typeof value?.storeDir !== "string" || !isAbsolute(value.storeDir)) {
		throw new Error("Web Profile package metadata has no absolute pnpm store");
	}
	return normalize(value.storeDir);
}

function withStoreDirectory(source, storeRoot) {
	const line = "storeDir: " + JSON.stringify(storeRoot) + "\n";
	const matches = source.match(/^storeDir:[^\r\n]*(?:\r?\n|$)/gm) ?? [];
	if (matches.length > 1) throw new Error("Web Profile pnpm workspace has multiple storeDir entries");
	if (matches.length === 1) return source.replace(/^storeDir:[^\r\n]*(?:\r?\n|$)/m, line);
	return source.replace(/(?:\r?\n)?$/, "\n\n" + line);
}

function replaceFile(path, content) {
	const temporary = path + ".dsh-platform-" + String(process.pid) + "-" + String(Date.now()) + ".tmp";
	try {
		writeFileSync(temporary, content, { flag: "wx", mode: statSync(path).mode & 0o777 });
		renameSync(temporary, path);
	} finally {
		try { unlinkSync(temporary); } catch {}
	}
}

function durableBackup(path, content, mode) {
	const handle = openSync(path, "wx", mode);
	try {
		writeFileSync(handle, content);
		fsyncSync(handle);
	} finally {
		closeSync(handle);
	}
}

function restoreWorkspace(workspacePath, backupPath) {
	if (!existsSync(backupPath)) return;
	if (existsSync(workspacePath)) unlinkSync(workspacePath);
	renameSync(backupPath, workspacePath);
}

function recoverInterruptedMigration(profileDir, workspacePath) {
	const modulesPath = join(profileDir, "node_modules");
	const modulesBackup = join(profileDir, MODULES_BACKUP);
	const workspaceBackup = join(profileDir, WORKSPACE_BACKUP);
	const commitMarker = join(profileDir, MIGRATION_COMMIT);
	if (!existsSync(modulesBackup) && !existsSync(workspaceBackup) && !existsSync(commitMarker)) return;
	if (existsSync(commitMarker)) {
		rmSync(workspaceBackup, { force: true });
		rmSync(modulesBackup, { recursive: true, force: true });
		rmSync(commitMarker, { force: true });
		return;
	}
	if (!existsSync(modulesBackup)) {
		restoreWorkspace(workspacePath, workspaceBackup);
		return;
	}
	if (existsSync(modulesPath)) rmSync(modulesPath, { recursive: true, force: true });
	if (existsSync(modulesBackup)) renameSync(modulesBackup, modulesPath);
	restoreWorkspace(workspacePath, workspaceBackup);
}

function pnpmInstall(profileDir, offline) {
	const arguments_ = ["install"];
	if (offline) arguments_.push("--offline");
	arguments_.push("--frozen-lockfile", "--reporter=append-only");
	return spawnSync("pnpm", arguments_, {
		cwd: profileDir,
		encoding: "utf8",
		env: process.env,
		timeout: PNPM_TIMEOUT_MS,
		maxBuffer: 8 * 1024 * 1024
	});
}

function failureDetail(result) {
	if (result.error !== void 0) return result.error.message;
	const output = [result.stdout, result.stderr].filter((value) => typeof value === "string" && value.trim() !== "").join("\n");
	return output.trim().slice(-4096) || "pnpm exited with status " + String(result.status);
}

function migrateProfile(profileDir, workspacePath, originalWorkspace, currentStore, storeRoot) {
	const modulesPath = join(profileDir, "node_modules");
	const modulesBackup = join(profileDir, MODULES_BACKUP);
	const workspaceBackup = join(profileDir, WORKSPACE_BACKUP);
	const commitMarker = join(profileDir, MIGRATION_COMMIT);
	const targetStore = join(storeRoot, basename(currentStore));
	let copiedStore = false;
	let migratedStore;
	try {
		if (existsSync(currentStore) && statSync(currentStore).isDirectory()) {
			try {
				mkdirSync(targetStore, { recursive: true });
				cpSync(currentStore, targetStore, { recursive: true, force: false, errorOnExist: false });
				copiedStore = true;
			} catch {}
		}
		durableBackup(workspaceBackup, originalWorkspace, statSync(workspacePath).mode & 0o777);
		replaceFile(workspacePath, withStoreDirectory(originalWorkspace, storeRoot));
		renameSync(modulesPath, modulesBackup);
		let result = pnpmInstall(profileDir, copiedStore);
		if (result.status !== 0 && copiedStore) {
			rmSync(modulesPath, { recursive: true, force: true });
			result = pnpmInstall(profileDir, false);
		}
		if (result.status !== 0) throw new Error(failureDetail(result));
		migratedStore = installedStore(profileDir);
		if (migratedStore === null || dirname(migratedStore) !== normalize(storeRoot)) {
			throw new Error("pnpm rebuilt the Profile with an unexpected store");
		}
		durableBackup(commitMarker, "committed\n", 384);
	} catch (error) {
		if (existsSync(modulesPath)) rmSync(modulesPath, { recursive: true, force: true });
		if (existsSync(modulesBackup)) renameSync(modulesBackup, modulesPath);
		restoreWorkspace(workspacePath, workspaceBackup);
		rmSync(commitMarker, { force: true });
		throw new Error("failed to migrate Profile package storage: " + String(error?.message ?? error));
	}
	// The new layout is committed after verification. Cleanup is recoverable:
	// removing the workspace backup first ensures any surviving modules backup
	// is recognized as a committed migration on the next launch.
	rmSync(workspaceBackup, { force: true });
	rmSync(modulesBackup, { recursive: true, force: true });
	rmSync(commitMarker, { force: true });
	return migratedStore;
}

export function prepareProfilePackageStorage(profile) {
	const { dshHome, profileDir } = profileDirectory(profile);
	const manifestPath = join(profileDir, "package.json");
	const workspacePath = join(profileDir, "pnpm-workspace.yaml");
	if (!existsSync(manifestPath) || !existsSync(workspacePath)) return Object.freeze({ status: "absent" });
	const storeRoot = join(dshHome, ".pnpm-store");
	recoverInterruptedMigration(profileDir, workspacePath);
	const currentStore = installedStore(profileDir);
	if (currentStore !== null && dirname(currentStore) !== normalize(storeRoot)) {
		const migratedStore = migrateProfile(
			profileDir, workspacePath, readFileSync(workspacePath, "utf8"), currentStore, storeRoot
		);
		console.log("dsh: migrated Profile package storage from " + currentStore + " to " + migratedStore);
		return Object.freeze({ status: "migrated", currentStore: migratedStore, storeRoot });
	}
	const original = readFileSync(workspacePath, "utf8");
	const updated = withStoreDirectory(original, storeRoot);
	if (updated !== original) replaceFile(workspacePath, updated);
	return Object.freeze({ status: "ready", currentStore, storeRoot });
}
`;

const ADAPTER_SOURCE = String.raw`import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareProfilePackageStorage } from "./dsh-docker-profile-package-storage.js";

const API_PREFIX = "/_dsh_platform/api/v1/";
const REQUEST_TIMEOUT_MS = 3e3;
const RESTART_FALLBACK_MS = 10e3;
let managedSessionId = null;

function packageManifest(root, packageName) {
	if (packageName.includes("\\")) return null;
	const parts = packageName.split("/");
	const validShape = packageName.startsWith("@") ? parts.length === 2 : parts.length === 1;
	if (!validShape || parts.some((part) => part === "" || part === "." || part === "..")) {
		return null;
	}
	return join(root, "node_modules", ...parts, "package.json");
}

function packageExists(root, packageName) {
	const manifest = packageManifest(root, packageName);
	return manifest !== null && existsSync(manifest);
}

function repairOrphanedProfileBundles() {
	const profileDir = join(process.env.DSH_HOME || join(homedir(), ".dsh"), "profiles", "web");
	const manifestPath = join(profileDir, "package.json");
	if (!existsSync(manifestPath)) return;
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const bundles = manifest?.dsh?.profile?.bundles;
	if (!Array.isArray(bundles)) return;
	const dependencies = new Set(Object.keys(manifest.dependencies ?? {}));
	const dshRoot = dirname(dirname(fileURLToPath(import.meta.url)));
	const kept = [];
	const removed = [];
	for (const packageName of bundles) {
		if (typeof packageName !== "string"
			|| dependencies.has(packageName)
			|| packageExists(profileDir, packageName)
			|| packageExists(dshRoot, packageName)) {
			kept.push(packageName);
		} else {
			removed.push(packageName);
		}
	}
	if (removed.length === 0) return;
	manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles: kept } };
	const temporary = manifestPath + ".dsh-platform-" + String(process.pid) + "-" + String(Date.now()) + ".tmp";
	try {
		writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", {
			flag: "wx",
			mode: statSync(manifestPath).mode & 0o777
		});
		renameSync(temporary, manifestPath);
	} finally {
		try { unlinkSync(temporary); } catch {}
	}
	console.log("dsh: removed orphaned profile bundle(s): " + removed.join(", "));
}

function socketPath(name) {
	return process.env.DSH_PLATFORM_RUN + "/" + name;
}

function requestJson(socket, method, path, body) {
	return new Promise((resolveRequest, reject) => {
		const bytes = body === void 0 ? void 0 : Buffer.from(JSON.stringify(body));
		const req = request({
			socketPath: socket,
			method,
			path,
			headers: bytes === void 0 ? {} : {
				"content-type": "application/json",
				"content-length": bytes.byteLength
			}
		}, (response) => {
			const chunks = [];
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("end", () => {
				let value = {};
				try {
					value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				} catch {}
				if ((response.statusCode ?? 500) >= 400) {
					const error = new Error(value.error ?? "local API request failed");
					error.statusCode = response.statusCode;
					reject(error);
				} else resolveRequest(value);
			});
		});
		req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("local API request timed out")));
		req.once("error", reject);
		req.end(bytes);
	});
}

function managedWeb(invocation) {
	return process.env.DSH_PLATFORM_MANAGED === "1"
		&& invocation?.mode === "profile"
		&& invocation.profile === "web";
}

async function management(method, path) {
	return requestJson(socketPath("management.sock"), method, API_PREFIX + path);
}

export async function prepareManagedInvocation(invocation) {
	if (process.env.DSH_PLATFORM_MANAGED === "1" && invocation?.mode === "plugin") {
		try {
			prepareProfilePackageStorage(invocation.profile);
		} catch (error) {
			console.error("dsh: failed to prepare Profile package storage: " + String(error?.message ?? error));
			return 1;
		}
		return null;
	}
	if (!managedWeb(invocation)) return null;
	if (typeof process.env.DSH_PLATFORM_RUN !== "string" || process.env.DSH_PLATFORM_RUN === "") {
		console.error("dsh: managed lifecycle runtime directory is unavailable");
		return 1;
	}
	let claimed;
	try {
		claimed = await requestJson(socketPath("dsh-lifecycle.sock"), "POST", "/v1/runtime/claim", {
			launchToken: process.env.DSH_PLATFORM_LAUNCH_TOKEN ?? ""
		});
	} catch (error) {
		if (error?.statusCode !== 409) {
			console.error("dsh: managed lifecycle broker is unavailable; refusing an unsupervised Web instance");
			return 1;
		}
	}
	if (claimed !== void 0) {
		if (typeof claimed.sessionId !== "string" || claimed.sessionId === "") {
			console.error("dsh: managed lifecycle broker returned an invalid launch session");
			return 1;
		}
		managedSessionId = claimed.sessionId;
		delete process.env.DSH_PLATFORM_LAUNCH_TOKEN;
		try {
			prepareProfilePackageStorage("web");
		} catch (error) {
			console.error("dsh: Web Profile package storage repair failed; plugin changes may be unavailable: " + String(error?.message ?? error));
		}
		try {
			repairOrphanedProfileBundles();
		} catch (error) {
			console.error("dsh: failed to repair orphaned Web Profile bundles: " + String(error?.message ?? error));
			return 1;
		}
		return null;
	}

	let status;
	try {
		status = await management("GET", "status");
	} catch {
		console.error("dsh: DSH is managed by the container platform, but its Control Plane is unavailable");
		console.error("dsh: open /_dsh_platform/console/ after the Control Plane recovers");
		return 1;
	}
	const state = status?.dshLifecycle?.state;
	if (state === "stopped") {
		try {
			const task = await management("POST", "start-dsh");
			console.log("dsh: requested managed DSH start (task " + String(task.taskId) + ")");
			return 0;
		} catch (error) {
			console.error("dsh: managed DSH start was rejected: " + String(error?.message ?? error));
			return 1;
		}
	}
	if (state === "failed" || status?.recoveryMode != null) {
		console.error("dsh: managed DSH is in recovery mode; open /_dsh_platform/console/");
		return 1;
	}
	if (["running", "starting", "stopping", "restarting", "recovering"].includes(state)) {
		console.log("dsh: managed DSH is " + state + "; no second Web instance was started");
		return 0;
	}
	console.error("dsh: managed DSH state is unavailable; open /_dsh_platform/console/");
	return 1;
}

export function managedSigtermHandler(interrupt) {
	if (managedSessionId === null) return () => interrupt(0);
	let count = 0;
	let fallback;
	let abandoned = false;
	return () => {
		count += 1;
		if (count > 1) {
			abandoned = true;
			if (fallback !== void 0) clearTimeout(fallback);
			interrupt(0);
			return;
		}
		void requestJson(socketPath("dsh-lifecycle.sock"), "POST", "/v1/runtime/signal", {
			sessionId: managedSessionId,
			signal: "SIGTERM"
		}).then(async ({ disposition }) => {
			if (abandoned) return;
			if (disposition === "terminate") {
				interrupt(0);
				return;
			}
			if (disposition !== "request-restart") throw new Error("invalid lifecycle signal response");
			const task = await management("POST", "restart-dsh");
			console.log("dsh: requested managed DSH restart (task " + String(task.taskId) + ")");
			fallback = setTimeout(() => interrupt(0), RESTART_FALLBACK_MS);
			fallback.unref?.();
		}).catch(() => interrupt(0));
	};
}

export async function markManagedReady() {
	if (managedSessionId === null) return;
	await requestJson(socketPath("dsh-lifecycle.sock"), "POST", "/v1/runtime/ready", {
		sessionId: managedSessionId
	});
}

export function provideManagedLifecycle(hostCtx) {
	if (managedSessionId === null) return;
	hostCtx.provide("dshPlatformLifecycle", Object.freeze({
		restart: () => management("POST", "restart-dsh")
	}));
}
`

function exactlyOnce(source, pattern, name, path) {
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} in ${path}, found ${String(matches.length)}. The upstream package may have changed; review this patch before building.`)
  }
  return matches[0]
}

function replaceOnce(source, before, after, name, path) {
  const count = source.split(before).length - 1
  if (count !== 1) {
    throw new Error(`Expected exactly one ${name} in ${path}, found ${String(count)}. The upstream package may have changed; review this patch before building.`)
  }
  return source.replace(before, after)
}

function profileImplementation(dshRoot, binSource) {
  const binMatch = exactlyOnce(
    binSource,
    /const \{ runProfile \} = await import\("(\.\/profile-boot-[A-Za-z0-9_-]+\.js)"\);/g,
    'dynamic Web Profile import',
    join(dshRoot, BIN_TARGET),
  )
  const wrapperPath = join(dshRoot, 'lib', basename(binMatch[1]))
  const wrapper = readFileSync(wrapperPath, 'utf8')
  if (wrapper.includes(SIGTERM) && wrapper.includes(HOST_PROVIDER)) return wrapperPath
  const implementation = exactlyOnce(
    wrapper,
    /import \{[^\n;]*\brunProfile\b[^\n;]*\} from "(\.\/profile-boot-[A-Za-z0-9_-]+\.js)";/g,
    'Profile implementation import',
    wrapperPath,
  )
  return join(dshRoot, 'lib', basename(implementation[1]))
}

export function applyPatch(dshRoot) {
  const root = resolve(dshRoot)
  const binPath = join(root, BIN_TARGET)
  const bin = readFileSync(binPath, 'utf8')
  const profilePath = profileImplementation(root, bin)
  let profile = readFileSync(profilePath, 'utf8')
  if (readFileSync(binPath, 'utf8').includes(BIN_IMPORT)) throw new Error('Managed lifecycle Patch is already applied')
  if (existsSync(join(root, MANAGED_LIFECYCLE_MODULE))) throw new Error('Managed lifecycle adapter path already exists')
  if (existsSync(join(root, PROFILE_PACKAGE_STORAGE_MODULE))) throw new Error('Profile package storage adapter path already exists')
  exactlyOnce(bin, /^#!\/usr\/bin\/env node$/gm, 'DSH bin shebang', binPath)
  let patchedBin = bin.replace(/^#!\/usr\/bin\/env node$/m, `#!/usr/bin/env node\n${BIN_IMPORT}`)
  patchedBin = replaceOnce(patchedBin, BIN_DISPATCH, BIN_DISPATCH_PATCHED, 'DSH invocation dispatch', binPath)
  profile = `${PROFILE_IMPORT}\n${profile}`
  profile = replaceOnce(profile, SIGTERM, SIGTERM_PATCHED, 'Web Profile SIGTERM handler', profilePath)
  profile = replaceOnce(profile, HOST_PROVIDER, HOST_PROVIDER_PATCHED, 'Web Profile host provider', profilePath)
  profile = replaceOnce(profile, PROFILE_RETURN, PROFILE_RETURN_PATCHED, 'Web Profile settled return', profilePath)
  writeFileSync(join(root, MANAGED_LIFECYCLE_MODULE), ADAPTER_SOURCE)
  writeFileSync(join(root, PROFILE_PACKAGE_STORAGE_MODULE), PROFILE_PACKAGE_STORAGE_SOURCE)
  writeFileSync(profilePath, profile)
  writeFileSync(binPath, patchedBin)
}

export function verifyPatch(dshRoot) {
  const root = resolve(dshRoot)
  const binPath = join(root, BIN_TARGET)
  const bin = readFileSync(binPath, 'utf8')
  const profilePath = profileImplementation(root, bin)
  const profile = readFileSync(profilePath, 'utf8')
  const adapter = readFileSync(join(root, MANAGED_LIFECYCLE_MODULE), 'utf8')
  const packageStorage = readFileSync(join(root, PROFILE_PACKAGE_STORAGE_MODULE), 'utf8')
  if (bin.split(BIN_IMPORT).length - 1 !== 1 || bin.split(BIN_DISPATCH_PATCHED).length - 1 !== 1) {
    throw new Error(`Managed lifecycle bin Patch verification failed for ${binPath}`)
  }
  if (profile.split(PROFILE_IMPORT).length - 1 !== 1
    || profile.split(SIGTERM_PATCHED).length - 1 !== 1
    || profile.split(HOST_PROVIDER_PATCHED).length - 1 !== 1
    || profile.split(PROFILE_RETURN_PATCHED).length - 1 !== 1
    || profile.includes(SIGTERM)) {
    throw new Error(`Managed lifecycle Profile Patch verification failed for ${profilePath}`)
  }
  for (const marker of ['prepareManagedInvocation', 'managedSigtermHandler', 'markManagedReady', 'provideManagedLifecycle']) {
    if (!adapter.includes(`export function ${marker}`) && !adapter.includes(`export async function ${marker}`)) {
      throw new Error(`Managed lifecycle adapter is missing ${marker}`)
    }
  }
  if (!adapter.includes('function repairOrphanedProfileBundles()')) {
    throw new Error('Managed lifecycle adapter is missing repairOrphanedProfileBundles')
  }
  for (const marker of ['prepareProfilePackageStorage', 'migrateProfile', '.pnpm-store']) {
    if (!packageStorage.includes(marker)) throw new Error(`Managed lifecycle Profile package storage is missing ${marker}`)
  }
}
