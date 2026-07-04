import test from "node:test";
import assert from "node:assert/strict";

import {
  ObservableArtifactKind,
  PoisoningCondition,
  validateMultiRoundCoverage,
  validatePoisoningEvaluationSamples,
  type ObservableBehaviorSample,
} from "../src/evaluation/observableEvaluation.ts";

function sample(condition: ObservableBehaviorSample["condition"]): ObservableBehaviorSample {
  return {
    evaluationCaseId: "poison-zh-mixed-1",
    condition,
    snapshotKey: "snapshot-1",
    modelConfigKey: "model-1",
    probeKey: "rank-options",
    sampleNo: 1,
    roundNo: 1,
    artifactKind: ObservableArtifactKind.PublicOutput,
    publicText: "公开回答",
    embedding: [0.1, 0.2],
    selectedOptionId: condition === PoisoningCondition.Poisoned ? "attacker-target" : "clean-target",
  };
}

test("poisoning evaluation requires matched clean, poisoned, and purged observable outcomes", () => {
  assert.deepEqual(validatePoisoningEvaluationSamples([
    sample(PoisoningCondition.Clean),
    sample(PoisoningCondition.Poisoned),
    sample(PoisoningCondition.Purged),
  ]), []);

  const missingPurged = validatePoisoningEvaluationSamples([
    sample(PoisoningCondition.Clean),
    sample(PoisoningCondition.Poisoned),
  ]).join("\n");
  assert.match(missingPurged, /missing purged/);
});

test("embedding-only poisoning claims are rejected without hidden CoT", () => {
  const embeddingOnly = Object.values(PoisoningCondition).map((condition) => ({
    ...sample(condition),
    selectedOptionId: undefined,
  })) as unknown as ObservableBehaviorSample[];
  const errors = validatePoisoningEvaluationSamples(embeddingOnly).join("\n");
  assert.match(errors, /cannot use embedding as the only poisoning signal/);
  assert.equal("chainOfThought" in sample(PoisoningCondition.Clean), false);
});

test("multi-round persistence evaluation cannot collapse to a single turn", () => {
  const firstRound = Object.values(PoisoningCondition).map(sample);
  assert.match(validateMultiRoundCoverage(firstRound).join("\n"), /at least 2 rounds/);
  const secondRound = firstRound.map((item) => ({ ...item, roundNo: 2 }));
  assert.deepEqual(validateMultiRoundCoverage([...firstRound, ...secondRound]), []);
  assert.deepEqual(validatePoisoningEvaluationSamples([...firstRound, ...secondRound]), []);
});
