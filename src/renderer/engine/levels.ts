/** The banker ladder: five bankers, each reads more and learns faster. */
export type LevelNo = 1 | 2 | 3 | 4 | 5;

export interface BankerLevel {
  level: LevelNo;
  rank: string;                 // the rank you earn by beating this banker
  signals: { breath: boolean; blinks: boolean; face: boolean; pulseHeat: boolean };
  learnWeight: number;          // how much each labelled box counts against the banker's priors
  walkAt: number;               // walks when P(trap) reaches this (at zero heat)
  marginBase: number;           // its cut on every offer
  /** Beat him: bank at least target, he caught (walked away from) at most maxTrapsCaught of your traps,
   *  and he burned at most maxBurned of your treasures. */
  target: number;
  maxTrapsCaught: number;
  maxBurned: number;
}

export const LEVELS: readonly BankerLevel[] = [
  { level: 1, rank: 'Pickpocket', signals: { breath: true, blinks: false, face: false, pulseHeat: false }, learnWeight: 0.5, walkAt: 0.62, marginBase: 0.15, target: 4000, maxTrapsCaught: 2, maxBurned: 1 },
  { level: 2, rank: 'Cutpurse', signals: { breath: true, blinks: true, face: false, pulseHeat: false }, learnWeight: 0.75, walkAt: 0.6, marginBase: 0.18, target: 4200, maxTrapsCaught: 1, maxBurned: 1 },
  { level: 3, rank: 'Cracksman', signals: { breath: true, blinks: true, face: true, pulseHeat: false }, learnWeight: 1, walkAt: 0.6, marginBase: 0.2, target: 4400, maxTrapsCaught: 1, maxBurned: 1 },
  { level: 4, rank: 'Safecracker', signals: { breath: true, blinks: true, face: true, pulseHeat: true }, learnWeight: 1.5, walkAt: 0.57, marginBase: 0.22, target: 4500, maxTrapsCaught: 1, maxBurned: 1 },
  { level: 5, rank: 'Ghost', signals: { breath: true, blinks: true, face: true, pulseHeat: true }, learnWeight: 2, walkAt: 0.55, marginBase: 0.25, target: 4600, maxTrapsCaught: 0, maxBurned: 1 },
];

export const DEFAULT_LEVEL: LevelNo = 3;

export function levelConfig(level: LevelNo = DEFAULT_LEVEL): BankerLevel {
  return LEVELS[level - 1] as BankerLevel;
}
