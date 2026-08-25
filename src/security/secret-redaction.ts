const SECRET_PATTERNS: RegExp[] = [
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(Bearer\s+[A-Za-z0-9._~+\/-]+=*)\b/gi,
  /\b(api[_-]?key|password|secret|token)\s*[:=]\s*([^\s,;]+)/gi,
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((output, pattern) => output.replace(pattern, (_match, ...groups) => {
    const label = typeof groups[0] === "string" && /api|password|secret|token/i.test(groups[0]) ? `${groups[0]}=` : "";
    return `${label}[REDACTED]`;
  }), value);
}
