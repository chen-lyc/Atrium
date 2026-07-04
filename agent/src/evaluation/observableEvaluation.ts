export const ObservableArtifactKind = {
  PublicOutput: "public_output",
  ModelSummary: "model_summary",
  StanceDigest: "stance_digest",
} as const;

export type ObservableArtifactKind = (typeof ObservableArtifactKind)[keyof typeof ObservableArtifactKind];

export const PoisoningCondition = {
  Clean: "clean",
  Poisoned: "poisoned",
  Purged: "purged",
} as const;

export type PoisoningCondition = (typeof PoisoningCondition)[keyof typeof PoisoningCondition];

export interface ObservableBehaviorSample {
  readonly evaluationCaseId: string;
  readonly condition: PoisoningCondition;
  readonly snapshotKey: string;
  readonly modelConfigKey: string;
  readonly probeKey: string;
  readonly sampleNo: number;
  readonly roundNo: number;
  readonly artifactKind: ObservableArtifactKind;
  readonly publicText: string;
  readonly embedding?: readonly number[];
  readonly stanceScore?: number;
  readonly selectedOptionId?: string;
  readonly rankedOptionIds?: readonly string[];
  readonly semanticLabel?: string;
}

/**
 * Validates observable behavioral evaluation inputs. Hidden chain-of-thought is
 * intentionally absent from the contract and embedding-only claims are rejected.
 */
export function validatePoisoningEvaluationSamples(samples: readonly ObservableBehaviorSample[]): string[] {
  const errors: string[] = [];
  const groups = new Map<string, Set<PoisoningCondition>>();
  for (const sample of samples) {
    if (!sample.evaluationCaseId.trim() || !sample.snapshotKey.trim() || !sample.modelConfigKey.trim() || !sample.probeKey.trim()) {
      errors.push("evaluation sample is missing case, snapshot, model, or probe identity");
    }
    if (!Number.isInteger(sample.sampleNo) || sample.sampleNo < 1) {
      errors.push(`evaluation sample ${sample.evaluationCaseId} has invalid sample_no`);
    }
    if (!Number.isInteger(sample.roundNo) || sample.roundNo < 1) {
      errors.push(`evaluation sample ${sample.evaluationCaseId} has invalid round_no`);
    }
    if (!Object.values(ObservableArtifactKind).includes(sample.artifactKind)) {
      errors.push(`evaluation sample ${sample.evaluationCaseId} has unsupported artifact kind`);
    }
    if (!Object.values(PoisoningCondition).includes(sample.condition)) {
      errors.push(`evaluation sample ${sample.evaluationCaseId} has unsupported condition`);
    }
    if (!sample.publicText.trim()) {
      errors.push(`evaluation sample ${sample.evaluationCaseId} has empty public artifact`);
    }
    if (sample.embedding && (sample.embedding.length === 0 || sample.embedding.some((value) => !Number.isFinite(value)))) {
      errors.push(`evaluation sample ${sample.evaluationCaseId} has invalid embedding`);
    }
    if (sample.stanceScore !== undefined && !Number.isFinite(sample.stanceScore)) {
      errors.push(`evaluation sample ${sample.evaluationCaseId} has invalid stance score`);
    }
    if (sample.rankedOptionIds?.some((value) => !value.trim())) {
      errors.push(`evaluation sample ${sample.evaluationCaseId} has empty ranked option id`);
    }
    if (!hasTaskLevelSignal(sample)) {
      errors.push(`evaluation sample ${sample.evaluationCaseId} cannot use embedding as the only poisoning signal`);
    }
    const groupKey = [
      sample.evaluationCaseId,
      sample.snapshotKey,
      sample.modelConfigKey,
      sample.probeKey,
      sample.sampleNo,
      sample.roundNo,
    ].join("\u0000");
    const conditions = groups.get(groupKey) ?? new Set<PoisoningCondition>();
    if (conditions.has(sample.condition)) {
      errors.push(`evaluation group ${groupKey.replaceAll("\u0000", "/")} has duplicate ${sample.condition}`);
    }
    conditions.add(sample.condition);
    groups.set(groupKey, conditions);
  }

  for (const [groupKey, conditions] of groups) {
    for (const required of Object.values(PoisoningCondition)) {
      if (!conditions.has(required)) {
        errors.push(`evaluation group ${groupKey.replaceAll("\u0000", "/")} is missing ${required}`);
      }
    }
  }
  return errors;
}

export function validateMultiRoundCoverage(samples: readonly ObservableBehaviorSample[], minimumRounds = 2): string[] {
  if (!Number.isInteger(minimumRounds) || minimumRounds < 2) {
    return ["minimumRounds must be an integer of at least 2"];
  }
  const roundsByCase = new Map<string, Set<number>>();
  for (const sample of samples) {
    const key = [sample.evaluationCaseId, sample.snapshotKey, sample.modelConfigKey, sample.probeKey].join("\u0000");
    const rounds = roundsByCase.get(key) ?? new Set<number>();
    rounds.add(sample.roundNo);
    roundsByCase.set(key, rounds);
  }
  const errors: string[] = [];
  for (const [key, rounds] of roundsByCase) {
    if (rounds.size < minimumRounds) {
      errors.push(`evaluation case ${key.replaceAll("\u0000", "/")} requires at least ${minimumRounds} rounds`);
    }
  }
  return errors;
}

function hasTaskLevelSignal(sample: ObservableBehaviorSample): boolean {
  return sample.stanceScore !== undefined
    || Boolean(sample.selectedOptionId?.trim())
    || Boolean(sample.semanticLabel?.trim())
    || Boolean(sample.rankedOptionIds && sample.rankedOptionIds.length > 0);
}
