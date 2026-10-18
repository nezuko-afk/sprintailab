export type Tier = 0 | 1 | 2 | 3;

export interface TierToolEntry {
  name: string;
  kind: string;
  tier: Tier;
}

export interface TiersFile {
  generatedFrom: { project: string; version: string; commit: string; toolCount: number };
  failClosed: string;
  counts: Record<string, number>;
  tools: TierToolEntry[];
}
