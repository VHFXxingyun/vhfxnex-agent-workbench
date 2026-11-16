export function describeIncompleteCodeProjectFailure(input?: {
  intent?: string | null;
  existingProjectTitle?: string;
  hasExistingProject?: boolean;
  draftFileCount?: number;
  toolFailure?: string;
}): string;
