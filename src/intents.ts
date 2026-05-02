import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";

export type IntentScopeKind = "project" | "user" | "installed";

export interface IntentScope {
  kind: IntentScopeKind;
  dir: string;
}

export interface LoadedResource {
  name: string;
  body: string;
  scope?: IntentScopeKind;
}

export interface ResolvedIntent {
  name: string;
  type: string;
  description: string;
  when: string;
  body: string;
  scope: IntentScopeKind;
  agents: LoadedResource[];
  skills: LoadedResource[];
  context: LoadedResource[];
  docs: LoadedResource[];
}

interface IntentFrontmatter {
  description?: string;
  when?: string;
  type?: string;
  agents?: string[];
  skills?: string[];
}

interface IntentFile {
  name: string;
  fm: IntentFrontmatter;
  body: string;
  scope: IntentScopeKind;
}

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const v = kv[2].trim().replace(/^["']|["']$/g, "");
    if (v.startsWith("[") && v.endsWith("]")) {
      fm[key] = v
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      fm[key] = v;
    }
  }
  return { fm, body: m[2].trim() };
}

function readMarkdown(path: string): { fm: IntentFrontmatter; body: string } {
  const { fm, body } = parseFrontmatter(readFileSync(path, "utf-8"));
  return { fm: fm as IntentFrontmatter, body };
}

function listMarkdown(dir: string): Array<{ name: string; path: string }> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((e) => e.endsWith(".md"))
    .map((e) => ({ name: basename(e, ".md"), path: join(dir, e) }));
}

function discoverIntentsIn(scope: IntentScope): IntentFile[] {
  const root = join(scope.dir, "intents");
  if (!existsSync(root)) return [];
  const out: IntentFile[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isFile() && entry.endsWith(".md")) {
      out.push({ name: basename(entry, ".md"), ...readMarkdown(full), scope: scope.kind });
    } else if (st.isDirectory()) {
      const main = join(full, "intent.md");
      if (existsSync(main)) out.push({ name: entry, ...readMarkdown(main), scope: scope.kind });
    }
  }
  return out;
}

function discoverIntents(scopes: IntentScope[]): IntentFile[] {
  const seen = new Set<string>();
  const out: IntentFile[] = [];
  for (const s of scopes) {
    for (const f of discoverIntentsIn(s)) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      out.push(f);
    }
  }
  return out;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
}

const STOPWORDS = new Set([
  "user", "asks", "want", "wants", "asking", "needs", "should", "with", "that",
  "from", "this", "into", "make", "have", "when", "then", "they", "them", "your",
]);

function pickIntent(prompt: string, intents: IntentFile[]): IntentFile | null {
  if (!intents.length) return null;
  const promptLower = prompt.toLowerCase();
  let best: { i: IntentFile; s: number } | null = null;
  for (const i of intents) {
    const tokens = tokenize(i.fm.when ?? "").filter((t) => !STOPWORDS.has(t));
    let s = 0;
    for (const t of tokens) if (promptLower.includes(t)) s++;
    if (!best || s > best.s) best = { i, s };
  }
  return best && best.s > 0 ? best.i : null;
}

function loadByName(
  scopes: IntentScope[],
  kind: "agents" | "skills",
  names: string[]
): LoadedResource[] {
  const out: LoadedResource[] = [];
  for (const name of names) {
    for (const s of scopes) {
      const file = join(s.dir, kind, `${name}.md`);
      if (!existsSync(file)) continue;
      const { body } = readMarkdown(file);
      out.push({ name, body, scope: s.kind });
      break;
    }
  }
  return out;
}

function loadContext(scopes: IntentScope[]): LoadedResource[] {
  const out: LoadedResource[] = [];
  const seen = new Set<string>();
  for (const s of scopes) {
    const memoryFile = join(s.dir, "memory.md");
    if (existsSync(memoryFile)) {
      const key = `memory@${s.kind}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ name: "memory", body: readFileSync(memoryFile, "utf-8"), scope: s.kind });
      }
    }
    for (const f of listMarkdown(join(s.dir, "memory"))) {
      const key = `${f.name}@${s.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: f.name, body: readFileSync(f.path, "utf-8"), scope: s.kind });
    }
  }
  return out;
}

function loadDocs(scopes: IntentScope[]): LoadedResource[] {
  const out: LoadedResource[] = [];
  const seen = new Set<string>();
  for (const s of scopes) {
    for (const f of listMarkdown(join(s.dir, "docs"))) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      out.push({ name: f.name, body: readFileSync(f.path, "utf-8"), scope: s.kind });
    }
  }
  return out;
}

function defaultType(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
}

export function userBurrowDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "burrow");
  return join(homedir(), ".config", "burrow");
}

export function burrowCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "burrow");
  return join(homedir(), ".cache", "burrow");
}

export function installedScopes(): IntentScope[] {
  const cache = burrowCacheDir();
  if (!existsSync(cache)) return [];
  return readdirSync(cache)
    .map((entry) => join(cache, entry))
    .filter((p) => statSync(p).isDirectory())
    .map((dir) => ({ kind: "installed" as const, dir }));
}

export function defaultScopes(projectDir?: string): IntentScope[] {
  const out: IntentScope[] = [];
  if (projectDir && existsSync(projectDir)) out.push({ kind: "project", dir: projectDir });
  const u = userBurrowDir();
  if (existsSync(u)) out.push({ kind: "user", dir: u });
  out.push(...installedScopes());
  return out;
}

export function resolveIntent(
  projectDirOrScopes: string | IntentScope[] | undefined,
  prompt: string
): ResolvedIntent | null {
  const scopes = Array.isArray(projectDirOrScopes)
    ? projectDirOrScopes
    : defaultScopes(projectDirOrScopes);
  if (!scopes.length) return null;
  const intents = discoverIntents(scopes);
  const picked = pickIntent(prompt, intents);
  if (!picked) return null;
  return {
    name: picked.name,
    type: picked.fm.type ?? defaultType(picked.name),
    description: picked.fm.description ?? "",
    when: picked.fm.when ?? "",
    body: picked.body,
    scope: picked.scope,
    agents: loadByName(scopes, "agents", picked.fm.agents ?? []),
    skills: loadByName(scopes, "skills", picked.fm.skills ?? []),
    context: loadContext(scopes),
    docs: loadDocs(scopes),
  };
}

export function composeSystemPrompt(
  base: string | undefined,
  resolved: ResolvedIntent | null
): string | undefined {
  if (!resolved) return base;
  const sections: string[] = [];
  if (base) sections.push(base);
  sections.push(`# Intent: ${resolved.type} (${resolved.name})\n\n${resolved.body}`);
  for (const a of resolved.agents) sections.push(`# Agent: ${a.name}\n\n${a.body}`);
  for (const s of resolved.skills) sections.push(`# Skill: ${s.name}\n\n${s.body}`);
  for (const c of resolved.context) sections.push(`# Context: ${c.name}\n\n${c.body}`);
  for (const d of resolved.docs) sections.push(`# Docs: ${d.name}\n\n${d.body}`);
  return sections.join("\n\n---\n\n");
}
