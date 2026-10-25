// lib/auth/server-action-guard-coverage.test.ts — static sweep (security fix 25 ต.ค. 69).
//
// Every exported function of every "use server" file is a public HTTP endpoint
// (a POST with a `Next-Action` header) — NOT just the ones a page imports.
// The extension-gate bypass proved the first layer (middleware matcher) can
// fail, so each action needs a guard of its own. This test reads the source
// and fails when:
//   - an exported action has no guard before its first data access, and
//   - it is not on the explicit PUBLIC_ON_PURPOSE list below (with a reason).
// Adding a new action without a guard = red here, not a production incident.
//
// It is a text scan, not a proof: it can't tell that a guard is *correct*, only
// that one exists before any data access. The behavioural proof for the member
// guard lives in lib/actions/member-guard.test.ts.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

// A guard = something that rejects an outsider before data is touched.
//   member / owner / role-deny helpers, the job-office guard(), and the
//   `=== "staff"` early-deny used by crm/tiktok-dashboard. `getEffectiveRole()`
//   on its own is NOT a guard (dashboard.ts only uses it to hide money fields).
//   `requireSessionIfGateOn(` is deliberately NOT here: a session alone isn't
//   approval (/register creates sessions for anyone). requireWriteAccess() is
//   fine — it adds the owner/admin role check on top of the session.
const GUARD =
  /(denyIfNotMember\(|requireMemberIfGateOn\(|requireOwnerAdmin\(|requireOwnerSession\(|requireWriteAccess\(|\bguard\(\)|getEffectiveRole\(\)\)\s*===\s*"staff")/;
const DATA = /(getServiceClient\(|getUserClient\(|getPublicClient\(|\.rpc\(|\.from\(|\bsupabase\b|callOffice\(|\bdb\(\)|\bfetch\()/;

/** file (posix, repo-relative) -> exports (or "*" = whole file) that are public/self-authenticating on purpose */
const PUBLIC_ON_PURPOSE: Record<string, { names: string[] | "*"; why: string }> = {
  "app/(auth)/login/actions.ts": { names: "*", why: "login — has to work without a session" },
  "app/(auth)/register/actions.ts": { names: "*", why: "register — creates the pending session; approval is the owner's job" },
  "lib/actions/auth.ts": { names: "*", why: "signOut — harmless without a session" },
  "lib/actions/job-worker.ts": {
    names: "*",
    why: "/w/<token> + /w/s/<token>: workers scan a QR; proof of identity is token + PIN checked in the DB RPCs. Must NOT take a member guard (workers have no account)",
  },
  "lib/actions/hero-stock.ts": {
    names: ["getHeroStock", "getProductPickerOptions"],
    why: "/stock/hero is a public wall-display screen by owner decision (auth-hardening memory); its writes (addHeroWatch/removeHeroWatch) ARE guarded",
  },
  "lib/actions/content-pieces.ts": {
    names: ["postPieceNoUrl"],
    why: "one-line delegate to advancePiece(), which is owner/admin-guarded",
  },
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
}

function useServerFiles(): string[] {
  const all: string[] = [];
  for (const d of ["app", "lib", "components"]) walk(join(ROOT, d), all);
  return all.filter((f) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(readFileSync(f, "utf8").replace(/\r\n/g, "\n")));
}

/** normalize CRLF and drop whole-line comments, so a comment that mentions a guard can't count as a call */
function stripCommentLines(src: string): string {
  return src
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

interface Exp {
  file: string;
  name: string;
  line: number;
  guarded: boolean;
}

function scan(file: string): Exp[] {
  const rel = relative(ROOT, file).split("\\").join("/");
  const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
  const starts: { name: string; idx: number }[] = [];
  lines.forEach((l, i) => {
    const m = /^export\s+(?:async\s+)?function\s+(\w+)/.exec(l) ?? /^export\s+(?:const|let|var)\s+(\w+)/.exec(l);
    if (m) starts.push({ name: m[1], idx: i });
  });
  return starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].idx : lines.length;
    let stop = end;
    for (let j = s.idx + 1; j < end; j++) {
      if (lines[j] === "}") {
        stop = j + 1;
        break;
      }
    }
    let g = -1;
    let d = -1;
    lines.slice(s.idx, stop).forEach((l, j) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      if (g < 0 && GUARD.test(l)) g = j;
      if (d < 0 && DATA.test(l)) d = j;
    });
    return { file: rel, name: s.name, line: s.idx + 1, guarded: g >= 0 && (d < 0 || g <= d) };
  });
}

const FILES = useServerFiles();
const EXPORTS = FILES.flatMap(scan);

describe("server action guard coverage", () => {
  it("finds the use-server files (sanity — an empty scan would pass vacuously)", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(40);
    expect(EXPORTS.length).toBeGreaterThanOrEqual(300);
  });

  it("every exported action has a guard before its first data access, unless listed PUBLIC_ON_PURPOSE", () => {
    const offenders = EXPORTS.filter((e) => {
      if (e.guarded) return false;
      const allow = PUBLIC_ON_PURPOSE[e.file];
      return !(allow && (allow.names === "*" || allow.names.includes(e.name)));
    }).map((e) => `${e.file}:${e.line} ${e.name}`);
    expect(offenders, `unguarded server actions (add denyIfNotMember()/requireMemberIfGateOn() as the FIRST statement):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("PUBLIC_ON_PURPOSE has no stale entries (file or export removed/now guarded -> delete the exemption)", () => {
    const stale: string[] = [];
    for (const [file, allow] of Object.entries(PUBLIC_ON_PURPOSE)) {
      const inFile = EXPORTS.filter((e) => e.file === file);
      if (inFile.length === 0) {
        stale.push(`${file} (no exports found)`);
        continue;
      }
      if (allow.names === "*") continue;
      for (const n of allow.names) {
        const e = inFile.find((x) => x.name === n);
        if (!e) stale.push(`${file} ${n} (export missing)`);
        else if (e.guarded) stale.push(`${file} ${n} (now guarded — remove from the list)`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("every denyIfNotMember() call is checked: `const X = await denyIfNotMember(); if (X) return X;` (a dropped check = guard that guards nothing)", () => {
    const offenders: string[] = [];
    let totalCalls = 0;
    for (const f of FILES) {
      const code = stripCommentLines(readFileSync(f, "utf8"));
      const calls = (code.match(/denyIfNotMember\(\)/g) ?? []).length;
      const checked = (code.match(/const (\w+) = await denyIfNotMember\(\);\n\s*if \(\1\) return \1;/g) ?? []).length;
      totalCalls += calls;
      if (calls !== checked) offenders.push(`${relative(ROOT, f).split("\\").join("/")}: ${calls} calls, ${checked} checked`);
    }
    expect(totalCalls, "sanity — an empty scan would pass vacuously").toBeGreaterThanOrEqual(30);
    expect(offenders).toEqual([]);
  });

  it('no "use server" file uses `export {`, `export default` or `export *` (the export scanner cannot see those forms)', () => {
    const offenders = FILES.filter((f) => /^export\s*(\{|\*|default\b)/m.test(stripCommentLines(readFileSync(f, "utf8")))).map((f) =>
      relative(ROOT, f).split("\\").join("/"),
    );
    expect(offenders).toEqual([]);
  });

  it("the public worker actions stay free of the member guard (workers have no account)", () => {
    const src = readFileSync(join(ROOT, "lib/actions/job-worker.ts"), "utf8");
    expect(src).not.toMatch(/denyIfNotMember|requireMemberIfGateOn|requireSessionIfGateOn|requireOwner/);
  });

  it("the public hero reads stay free of the member guard (/stock/hero is a public screen)", () => {
    const src = readFileSync(join(ROOT, "lib/actions/hero-stock.ts"), "utf8").replace(/\r\n/g, "\n");
    for (const fn of ["getHeroStock", "getProductPickerOptions"]) {
      const start = src.indexOf(`export async function ${fn}`);
      const body = src.slice(start, src.indexOf("\n}\n", start));
      expect(body, fn).not.toMatch(/denyIfNotMember|requireMemberIfGateOn/);
    }
  });
});
