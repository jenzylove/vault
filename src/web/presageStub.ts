// Web build only: stands in for the Presage SmartSpectra renderer SDK (@smartspectra/node-sdk/renderer and
// /messages). The browser build plays the sample run; live play needs the Windows app, so nothing here runs.
const desktopOnly = (): never => { throw new Error('live play needs the desktop app'); };

export const breathingMetrics: readonly number[] = [];
export const cardioMetrics: readonly number[] = [];
export class SmartSpectraSDK {
  constructor() { desktopOnly(); }
}
export function decodeMetrics(): never { return desktopOnly(); }
