export interface FeasibilityBlock {
  date: string;
  time: string;
  activity: string;
  venue?: string;
  attendeeCount?: number;
  unlistedOnsiteCount?: number;
  venueCapacity?: number;
  staff?: { name: string; role: string }[];
  resources?: { name: string; required: number; available: number; reusable?: boolean }[];
}

export interface FeasibilityIssue {
  type:
    | "invalid_block"
    | "venue_capacity"
    | "duplicate_role"
    | "staff_overlap"
    | "venue_overlap"
    | "resource_capacity"
    | "resource_mode_conflict";
  blocks: number[];
  message: string;
}

export interface FeasibilityPendingCheck {
  block: number;
  activity: string;
  checks: string[];
}

export function validateExecutionFeasibility(input: { blocks: FeasibilityBlock[] }): {
  valid: boolean;
  summary: string;
  checked: {
    timeSlots: number;
    staffAssignments: number;
    venueCapacityChecks: number;
    resourceEntries: number;
  };
  coverage: {
    complete: boolean;
    pending: FeasibilityPendingCheck[];
  };
  issues: FeasibilityIssue[];
};
