import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateBoardOpinion,
  validateBoardSynthesis,
  validateBoardVerdict,
} from "../src/security/ai-output-validation.ts";

const boardSource = await readFile(new URL("../src/ai/ai-board.ts", import.meta.url), "utf8");

const opinion = validateBoardOpinion({
  role: "attacker",
  recommendation: "  proceed carefully  ",
  reasoning: "  evidence is sufficient  ",
  risks: [" execution risk "],
  confidence: 0.75,
  decisionId: "must-not-leak",
}, "risk");

assert.deepEqual(opinion, {
  role: "risk",
  recommendation: "proceed carefully",
  reasoning: "evidence is sufficient",
  risks: ["execution risk"],
  confidence: 0.75,
}, "expected application role must override any model-supplied role and unknown fields must be dropped");

for (const invalid of [
  { recommendation: "", reasoning: "ok", risks: [], confidence: 0.5 },
  { recommendation: "ok", reasoning: 42, risks: [], confidence: 0.5 },
  { recommendation: "ok", reasoning: "ok", risks: ["ok", 42], confidence: 0.5 },
  { recommendation: "ok", reasoning: "ok", risks: [], confidence: -0.1 },
  { recommendation: "ok", reasoning: "ok", risks: [], confidence: 1.1 },
  { recommendation: "ok", reasoning: "ok", risks: [], confidence: Number.NaN },
]) {
  assert.throws(
    () => validateBoardOpinion(invalid, "critic"),
    /Invalid AI Board/,
    "malformed model opinions must fail closed",
  );
}

assert.throws(
  () => validateBoardOpinion({
    recommendation: "x".repeat(16_001),
    reasoning: "ok",
    risks: [],
    confidence: 0.5,
  }, "strategist"),
  /Invalid AI Board recommendation/,
  "model recommendation must remain bounded",
);

assert.throws(
  () => validateBoardOpinion({
    recommendation: "ok",
    reasoning: "ok",
    risks: Array.from({ length: 65 }, () => "risk"),
    confidence: 0.5,
  }, "finance"),
  /Invalid AI Board risks/,
  "model risk arrays must remain bounded",
);

const synthesis = validateBoardSynthesis({
  synthesis: "  controlled result  ",
  dissent: [" minority view "],
  confidence: 0.8,
  decisionId: "attacker-controlled",
  opinions: [{ role: "attacker" }],
});
assert.deepEqual(synthesis, {
  synthesis: "controlled result",
  dissent: ["minority view"],
  confidence: 0.8,
}, "chair output must be projected onto an explicit allowlist");

assert.throws(
  () => validateBoardSynthesis({
    synthesis: "ok",
    dissent: [42],
    confidence: 0.8,
  }),
  /Invalid AI Board dissent/,
  "chair dissent must be a bounded string array",
);

const verdict = validateBoardVerdict({
  decisionId: "decision-1",
  opinions: [
    { role: "strategist", recommendation: "a", reasoning: "a", risks: [], confidence: 0.5 },
    { role: "risk", recommendation: "b", reasoning: "b", risks: [], confidence: 0.5 },
  ],
  synthesis: "summary",
  dissent: [],
  confidence: 0.5,
  generatedAt: new Date().toISOString(),
  organizationId: "must-not-leak",
});
assert.equal(verdict.decisionId, "decision-1");
assert.equal("organizationId" in verdict, false, "verdict must drop unknown model-controlled fields");

assert.throws(
  () => validateBoardVerdict({
    decisionId: "decision-1",
    opinions: [
      { role: "risk", recommendation: "a", reasoning: "a", risks: [], confidence: 0.5 },
      { role: "risk", recommendation: "b", reasoning: "b", risks: [], confidence: 0.5 },
    ],
    synthesis: "summary",
    dissent: [],
    confidence: 0.5,
    generatedAt: new Date().toISOString(),
  }),
  /Invalid AI Board roles/,
  "duplicate model roles must fail closed",
);

assert.match(
  boardSource,
  /validateBoardOpinion\(JSON\.parse\(response\.content\) as unknown, role\)/,
  "AI Board must validate and project each model opinion before use",
);
assert.match(
  boardSource,
  /validateBoardSynthesis\(JSON\.parse\(synthesisResponse\.content\) as unknown\)/,
  "AI Board must validate and project chair output before use",
);
assert.match(
  boardSource,
  /return validateBoardVerdict\(\{/,
  "AI Board must validate the final verdict before returning it",
);
assert.doesNotMatch(
  boardSource,
  /return \{ role, \.\.\.parsed \}|opinions, \.\.\.synthesis/,
  "AI Board must not allow untrusted model spreads to overwrite trusted fields",
);

console.log("AI Board output validation regression checks passed.");
