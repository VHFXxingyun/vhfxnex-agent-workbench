export interface FeasibilityBlock {
  date: string;
  time: string;
  activity: string;
  venue?: string;
  attendeeCount?: number;
  unlistedOnsiteCount?: number;
  venueCapacity?: number;
  staff?: { name: string; role: string }[];
  resources?: { name: string; required: number; available: number }[];
}

export interface FeasibilityIssue {
  type:
    | "invalid_block"
    | "venue_capacity"
    | "duplicate_role"
    | "staff_overlap"
    | "venue_overlap"
    | "resource_capacity";
  blocks: number[];
  message: string;
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
  issues: FeasibilityIssue[];
};
