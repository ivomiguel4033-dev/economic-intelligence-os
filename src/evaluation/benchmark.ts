export interface EvaluationCase {
  id: string;
  taskType: string;
  input: string;
  expectedSignals: string[];
  forbiddenSignals?: string[];
  weight?: number;
}

export interface EvaluationResult {
  caseId: string;
  passed: boolean;
  score: number;
  reasons: string[];
}

export function evaluateText(test: EvaluationCase, output: string): EvaluationResult {
  const normalized = output.toLowerCase();
  const expected = test.expectedSignals.map((signal) => signal.toLowerCase());
  const forbidden = (test.forbiddenSignals ?? []).map((signal) => signal.toLowerCase());
  const matched = expected.filter((signal) => normalized.includes(signal));
  const violations = forbidden.filter((signal) => normalized.includes(signal));
  const coverage = expected.length ? matched.length / expected.length : 1;
  const score = Math.max(0, coverage - violations.length * 0.25);
  const reasons = [
    ...(matched.length < expected.length ? [`Missing ${expected.length - matched.length} expected signal(s)`] : []),
    ...(violations.length ? [`Found ${violations.length} forbidden signal(s)`] : []),
  ];
  return { caseId: test.id, passed: score >= 0.8 && violations.length === 0, score, reasons };
}

export function weightedSuiteScore(cases: EvaluationCase[], results: EvaluationResult[]): number {
  const byId = new Map(results.map((result) => [result.caseId, result]));
  const totalWeight = cases.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  if (!totalWeight) return 0;
  return cases.reduce((sum, item) => sum + (byId.get(item.id)?.score ?? 0) * (item.weight ?? 1), 0) / totalWeight;
}
