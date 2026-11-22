/** Prints what the voice generator must record, as JSON: [{ key, text }]. Run by scripts/voice/gen.py. */
import { renderUnits, spokenLines } from '../../src/renderer/voice/catalog';

const units = renderUnits();
process.stdout.write(JSON.stringify({ lines: spokenLines().length, units }));
