const TOKENS_PER_MILLION = 1_000_000;

/** Current DeepSeek V4.1 Flash rates in USD per million tokens. */
export const deepSeekFlashPricing = Object.freeze({
  cacheHit: Object.freeze({ offPeak: 0.003, peak: 0.006 }),
  cacheMiss: Object.freeze({ offPeak: 0.15, peak: 0.3 }),
  output: Object.freeze({ offPeak: 0.6, peak: 1.2 }),
});

function count(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Estimate a current-price range from aggregate token records.
 * The low end assumes unknown input was cached and all requests used off-peak rates.
 * The high end assumes unknown input missed cache and all requests used peak rates.
 */
export function estimateDeepSeekFlashCost(usage = {}) {
  const inputTokens = count(usage.inputTokens);
  const outputTokens = count(usage.outputTokens);
  const measuredInputTokens = Math.min(inputTokens, count(usage.cacheMeasuredInputTokens));
  const measuredHitTokens = Math.min(measuredInputTokens, count(usage.cacheMeasuredHitTokens));
  const measuredMissTokens = measuredInputTokens - measuredHitTokens;
  const unmeasuredInputTokens = inputTokens - measuredInputTokens;

  const lowerUsd =
    ((measuredHitTokens + unmeasuredInputTokens) * deepSeekFlashPricing.cacheHit.offPeak +
      measuredMissTokens * deepSeekFlashPricing.cacheMiss.offPeak +
      outputTokens * deepSeekFlashPricing.output.offPeak) /
    TOKENS_PER_MILLION;
  const upperUsd =
    (measuredHitTokens * deepSeekFlashPricing.cacheHit.peak +
      (measuredMissTokens + unmeasuredInputTokens) * deepSeekFlashPricing.cacheMiss.peak +
      outputTokens * deepSeekFlashPricing.output.peak) /
    TOKENS_PER_MILLION;
  const confirmedCacheSavingsUsd = {
    lower:
      (measuredHitTokens *
        (deepSeekFlashPricing.cacheMiss.offPeak - deepSeekFlashPricing.cacheHit.offPeak)) /
      TOKENS_PER_MILLION,
    upper:
      (measuredHitTokens *
        (deepSeekFlashPricing.cacheMiss.peak - deepSeekFlashPricing.cacheHit.peak)) /
      TOKENS_PER_MILLION,
  };

  return {
    lowerUsd,
    upperUsd,
    measuredInputTokens,
    measuredHitTokens,
    unmeasuredInputTokens,
    confirmedCacheSavingsUsd,
  };
}
