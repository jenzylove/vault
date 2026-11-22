// Web build entry (npm run web): the same game as the desktop renderer, plus a short note on the title screen
// that this is the sample run in a browser and live play needs the Windows app.
import '../renderer/main';
import { mountWebNote } from './WebNote';

mountWebNote();
