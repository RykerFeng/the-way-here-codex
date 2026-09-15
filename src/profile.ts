import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Authorship, ContentScope, SourcePurpose } from "./types.js";

export type ConnectionKind = "web" | "yuque" | "github" | "local";

export interface ProfileConnection {
  id: string;
  input: string;
  kind: ConnectionKind;
  purpose: SourcePurpose;
  authorship: Authorship;
  contentScope: ContentScope;
  scope: "page" | "site";
  createdAt: string;
  lastSyncedAt: string | null;
}

export interface ProfileRecord {
  version: 1;
  name: string;
  homeUrl: string | null;
  connections: ProfileConnection[];
}

export function defaultDataRoot(environment: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  const explicit = environment.THE_WAY_HERE_HOME?.trim();
  if (explicit) return path.resolve(explicit);
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "The Way Here");
  if (platform === "win32") return path.join(environment.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "The Way Here");
  return path.join(environment.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "the-way-here");
}

export function profileSpace(name = "me", root = defaultDataRoot()): string {
  const safeName = normalizeProfileName(name);
  return path.join(root, "profiles", safeName);
}

export async function ensureProfile(space: string, name = "me"): Promise<ProfileRecord> {
  await mkdir(space, { recursive: true });
  const existing = await readProfile(space);
  if (existing) return existing;
  const profile: ProfileRecord = { version: 1, name: normalizeProfileName(name), homeUrl: null, connections: [] };
  await writeProfile(space, profile);
  return profile;
}

export async function readProfile(space: string): Promise<ProfileRecord | null> {
  try {
    const raw = await readFile(path.join(space, "profile.json"), "utf8");
    const value = JSON.parse(raw) as ProfileRecord;
    if (value.version !== 1 || typeof value.name !== "string" || !Array.isArray(value.connections)) return null;
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function connectProfile(space: string, input: string, options: {
  purpose?: SourcePurpose;
  authorship?: Authorship;
  contentScope?: ContentScope;
  scope?: "page" | "site";
} = {}): Promise<{ profile: ProfileRecord; connection: ProfileConnection; created: boolean }> {
  const profile = await ensureProfile(space);
  const normalizedInput = normalizeInput(input);
  const existing = profile.connections.find((connection) => connection.input === normalizedInput);
  if (existing) return { profile, connection: existing, created: false };
  const kind = detectConnectionKind(normalizedInput);
  const personal = options.purpose === "memory" && options.authorship === "user";
  const connection: ProfileConnection = {
    id: randomUUID(),
    input: normalizedInput,
    kind,
    purpose: options.purpose ?? (kind === "local" ? "memory" : "reference"),
    authorship: options.authorship ?? (personal ? "user" : kind === "local" ? "unknown" : "other"),
    contentScope: options.contentScope ?? "unknown",
    scope: options.scope ?? (kind === "web" || kind === "yuque" ? "site" : "page"),
    createdAt: new Date().toISOString(),
    lastSyncedAt: null,
  };
  profile.connections.push(connection);
  if (!profile.homeUrl && (kind === "web" || kind === "yuque")) profile.homeUrl = normalizedInput;
  await writeProfile(space, profile);
  return { profile, connection, created: true };
}

export async function markConnectionSynced(space: string, connectionId: string, at = new Date().toISOString()): Promise<void> {
  const profile = await ensureProfile(space);
  const connection = profile.connections.find((item) => item.id === connectionId);
  if (!connection) return;
  connection.lastSyncedAt = at;
  await writeProfile(space, profile);
}

export function detectConnectionKind(input: string): ConnectionKind {
  if (!/^https?:\/\//i.test(input)) return "local";
  const host = new URL(input).hostname.toLocaleLowerCase();
  if (host === "yuque.com" || host === "www.yuque.com" || host.endsWith(".yuque.com")) return "yuque";
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  return "web";
}

function normalizeInput(input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  }
  return path.resolve(value);
}

function normalizeProfileName(name: string): string {
  const value = name.normalize("NFKC").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new Error("Profile 名称只能包含字母、数字、下划线和短横线。");
  return value;
}

async function writeProfile(space: string, profile: ProfileRecord): Promise<void> {
  const target = path.join(space, "profile.json");
  const temporary = path.join(space, `.profile-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}
