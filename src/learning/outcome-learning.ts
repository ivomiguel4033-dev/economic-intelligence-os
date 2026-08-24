export interface DecisionOutcome {
  decisionId: string;
  organizationId: string;
  metric: string;
  expectedValue?: number;
  realizedValue?: number;
  unit?: string;
  observedAt?: string;
}

export interface OutcomeScore {
  absoluteError?: number;
  relativeError?: number;
  directionCorrect?: boolean;
}

export function scoreOutcome(outcome: DecisionOutcome): OutcomeScore {
  if (outcome.expectedValue === undefined || outcome.realizedValue === undefined) return {};
  const absoluteError = Math.abs(outcome.realizedValue - outcome.expectedValue);
  const relativeError = outcome.expectedValue === 0 ? undefined : absoluteError / Math.abs(outcome.expectedValue);
  const directionCorrect = Math.sign(outcome.realizedValue) === Math.sign(outcome.expectedValue);
  return { absoluteError, relativeError, directionCorrect };
}
