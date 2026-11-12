export function needsPasswordUpgrade(passwordHash: unknown): boolean;
export function hashPassword(password: string): Promise<string>;
export function verifyPassword(password: string, passwordHash: unknown): Promise<boolean>;
