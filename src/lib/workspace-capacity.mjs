export function keepWithinLimit(items, maximum) {
  return Array.isArray(items) ? items.slice(0, maximum) : [];
}

export function availableCapacity(currentCount, maximum, perCallMaximum) {
  return Math.max(0, Math.min(maximum - currentCount, perCallMaximum));
}
