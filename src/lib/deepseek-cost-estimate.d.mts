export const deepSeekFlashPricing: {
  cacheHit: { offPeak: number; peak: number };
  cacheMiss: { offPeak: number; peak: number };
  output: { offPeak: number; peak: number };
};

export function isDeepSeekFlashModel(model: unknown): boolean;

export function estimateDeepSeekFlashCost(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  cacheMeasuredInputTokens?: number;
  cacheMeasuredHitTokens?: number;
}): {
  lowerUsd: number;
  upperUsd: number;
  measuredInputTokens: number;
  measuredHitTokens: number;
  unmeasuredInputTokens: number;
  confirmedCacheSavingsUsd: { lower: number; upper: number };
};
