#!/usr/bin/env node
/**
 * Flags destructive statements in SQL migrations (issue #101): DROP (anything), ALTER … RENAME,
 * ALTER … DROP, TRUNCATE, and DELETE / UPDATE without WHERE. CI makes such a migration wait for the
 * owner's approval before it runs on the hosted database. DROP NOT NULL / DROP DEFAULT only relax a
 * column (no data is lost) and do not count.
 *
 * Usage: node scripts/destructive-sql.mjs <file.sql>...  → prints the findings (GitHub annotations
 * when GITHUB_ACTIONS is set) and `destructive=true|false` to $GITHUB_OUTPUT; exit code 0 either way.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

/** The SQL with comments and string literals blanked (same length, so offsets map to lines). */
export function maskSql(sql) {
  let out = "";
  let i = 0;
  const blank = (text) => text.replace(/[^\n]/g, " ");
  while (i < sql.length) {
    const rest = sql.slice(i);
    let m;
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      const stop = end < 0 ? sql.length : end;
      out += blank(sql.slice(i, stop));
      i = stop;
    } else if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      out += blank(sql.slice(i, stop));
      i = stop;
    } else if (rest[0] === "'") {
      // '' is an escaped quote inside a literal.
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += blank(sql.slice(i, j + 1));
      i = j + 1;
    } else if ((m = rest.match(/^\$[A-Za-z_]*\$/))) {
      // Dollar-quoted body (functions): kept, its statements count too.
      out += m[0];
      i += m[0].length;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

/** Not destructive: DROP NOT NULL, DROP DEFAULT. */
const RELAX = String.raw`(?!not\s+null\b|default\b)`;

// Most specific first: a statement is reported once, under the first rule that matches it.
const RULES = [
  { name: "ALTER … RENAME", re: new RegExp(String.raw`\balter\s+\w+[^;]*?\brename\b`, "gi") },
  { name: "ALTER … DROP", re: new RegExp(String.raw`\balter\s+\w+[^;]*?\bdrop\s+${RELAX}\w+`, "gi") },
  { name: "DROP", re: new RegExp(String.raw`\bdrop\s+${RELAX}\w+`, "gi") },
  // Only as a statement: « revoke truncate, … on … » is a privilege, not a TRUNCATE.
  { name: "TRUNCATE", re: /(?<=^|;)\s*truncate\b/gi },
  { name: "DELETE without WHERE", re: new RegExp(String.raw`\bdelete\s+from\s+[^;]*?(?=;|$)`, "gi"), unlessWhere: true },
  { name: "UPDATE without WHERE", re: new RegExp(String.raw`\bupdate\s+[\w."]+\s+set\b[^;]*?(?=;|$)`, "gi"), unlessWhere: true },
];

/** Destructive statements of one migration: rule, 1-based line and the statement's first words. */
export function findDestructive(sql) {
  const masked = maskSql(sql);
  const findings = [];
  const reported = new Set();
  for (const rule of RULES) {
    for (const m of masked.matchAll(rule.re)) {
      if (rule.unlessWhere && /\bwhere\b/i.test(m[0])) continue;
      const statement = masked.lastIndexOf(";", m.index);
      if (reported.has(statement)) continue;
      reported.add(statement);
      const line = masked.slice(0, m.index).split("\n").length;
      findings.push({ rule: rule.name, line, text: sql.slice(m.index, m.index + 80).split("\n")[0].trim() });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

function main(files) {
  const annotate = !!process.env.GITHUB_ACTIONS;
  let destructive = false;
  for (const file of files) {
    const findings = findDestructive(readFileSync(file, "utf8"));
    if (findings.length === 0) {
      console.log(`${basename(file)}: no destructive statement`);
      continue;
    }
    destructive = true;
    for (const f of findings) {
      const message = `${f.rule}: ${f.text}`;
      console.log(annotate ? `::warning file=${file},line=${f.line}::Destructive migration (${message})` : `${basename(file)}:${f.line} ${message}`);
    }
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `destructive=${destructive}\n`);
  console.log(`destructive=${destructive}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
