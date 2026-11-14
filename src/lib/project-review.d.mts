export type ProjectReviewStatus = "passed" | "unavailable";

export function parseProjectReview(text: string): {
  approved: boolean;
  issues: string[];
};

export function attachProjectReviewStatus<T extends Record<string, unknown>>(
  output: T,
  status: ProjectReviewStatus,
  detail: string,
): T & { independentReview: { status: ProjectReviewStatus; detail: string } };
