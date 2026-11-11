export interface InjectionAssessment {
  suspicious: boolean;
  score: number;
  signals: string[];
}

const signals: Array<[RegExp, string, number]> = [
  [/ignore (all|any|the|your) previous/i, "instruction override", 0.35],
  [/reveal (the )?(system|developer|hidden) prompt/i, "prompt exfiltration", 0.45],
  [/show (me )?(your )?(secret|api key|token|password)/i, "secret exfiltration", 0.5],
  [/act as if (you have|there are) no (rules|restrictions)/i, "policy bypass", 0.35],
];

export function assessPromptInjection(input: string): InjectionAssessment {
  const matched = signals.filter(([pattern]) => pattern.test(input));
  const score = Math.min(1, matched.reduce((sum, [, , weight]) => sum + weight, 0));
  return { suspicious: score >= 0.35, score, signals: matched.map(([, name]) => name) };
}

function escapeUntrustedContent(content: string): string {
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function isolateUntrustedContent(content: string): string {
  return `<untrusted-content encoding="xml-escaped">\n${escapeUntrustedContent(content)}\n</untrusted-content>`;
}
