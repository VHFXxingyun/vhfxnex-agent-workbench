import type { SearchSource } from "./goal";

export function parseDuckDuckGoResults(html: string, limit?: number): SearchSource[];
export function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<SearchSource[]>;
