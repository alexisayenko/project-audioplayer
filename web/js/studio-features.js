export const STATUSES = ['in-progress', 'planned', 'released'];
export const STATUS_LABELS = { 'in-progress': 'In progress', planned: 'Planned', released: 'Released' };
export const AREAS = ['Site', 'Primitive', 'Clicks to tone', 'Chordophones', 'Aerophones', 'Membranophones', 'Idiophones', 'Listen', 'Rhythm', 'Glossary', 'Modify', 'Tools', 'iOS', 'Theory'];
export const TASK_URL = 'https://github.com/alexisayenko/project-audioplayer/blob/main/docs/tasks/';

const done = (date, area, title, task, text) => ({ status: 'released', date, area, title, ...(text ? { text } : {}), ...(task ? { task } : {}) });
const open = (status, area, title, task, text) => ({ status, area, title, text, task });

export const FEATURES = [
  open('in-progress', 'Listen', 'Microphone note detector', 'task-0107', 'Shows the note you play or sing. First slice built: the pitch estimate and a Mark harmonics switch on the Listen Spectrum. A held note with a Clear button and an inharmonicity estimate are still to do.'),
  open('in-progress', 'Listen', 'Analysis sources for the views', 'task-0108', 'The microphone source is built and lives on the Listen page. The Player source is deferred.'),
  open('in-progress', 'Chordophones', 'Harmonics lab extras', 'task-0109', 'The piano-like decay, detuned strings, piano realism and the Beating view are built. Odd and even toggles, an A4 reference, presets, register-dependent inharmonicity and the string count remain.'),
  open('in-progress', 'Listen', 'Sound level meter', 'task-0111', 'The dBFS meter is built on the Listen page. Approximate dB(A) with a calibration offset, and min, average and max values, remain.'),
  open('in-progress', 'iOS', 'Studio Tools on iOS', 'task-0113', 'The iOS Tools screen has the microphone Live BPM meter and a metronome. Not run on a device yet.'),
  open('in-progress', 'Site', 'The Studio as a separate site', 'task-0114', 'Live at studio.electrophone.cc, with Synthesize, Analyze and the Glossary. Its Analyze and Synthesize pages moved here from the main app.'),
  open('in-progress', 'Chordophones', 'Harmonics lab', 'task-0106', 'Synthesize a fundamental and its harmonics and see the waveform, spectrum and spectrogram. Step 1 is live on the Chordophones page; the follow-up tickets carry the rest.'),
  open('planned', 'Rhythm', 'Metronome', 'task-0110', 'Tempo 20 to 400 BPM with tap tempo, beats per bar with accents, and sample-accurate clicks. Nothing is built yet.'),
  open('planned', 'Listen', 'Spectrum analyzer tool', 'task-0112', 'A measuring view: 32 logarithmic bands from 20 Hz to 20 kHz in dBFS, peak caps and a Freeze button.'),
  open('planned', 'Aerophones', 'Aerophones (wind instruments)', 'task-0115', 'Sound from a vibrating column of air in a pipe. The page is a placeholder today.'),
  open('planned', 'Membranophones', 'Membranophones (drums)', 'task-0116', 'Sound from a stretched skin. The page is a placeholder today.'),
  open('planned', 'Idiophones', 'Idiophones (bars, bells, cymbals)', 'task-0117', 'Sound from the solid body of the instrument. The page is a placeholder today.'),
  open('planned', 'Tools', 'Waveforms page', 'task-0118', 'Hear and see sine, triangle, square, sawtooth, pulse and noise. The Glossary has the terms; the page is not built.'),
  open('planned', 'Theory', 'Music theory page', 'task-0119', 'Scales, modes, chords and tuning with playable examples. The Glossary has the Music theory domain; the page is not built.'),

  done('2026-10-25', 'Primitive', 'Harmonics stack on Primitive and Chordophones', 'task-0114', 'Each harmonic is its own sine wave and the sound is their sum: one row per harmonic, with the sum in the bottom row. On Chordophones the rows follow the synth settings.'),
  done('2026-10-25', 'Primitive', 'Primitive: custom waveform from harmonics', 'task-0114', 'A fifth waveform, Custom: drag up to 32 harmonic bars (or use the arrow keys) to build your own shape, with presets, a build-up slider that shows how a square wave sharpens, and the real frequency of every harmonic.'),
  done('2026-10-25', 'Clicks to tone', 'Clicks to tone: a beat becomes a pitch', 'task-0114', 'A repeating click from 1 to 1000 per second. Slow it is a rhythm; around 20 per second it flutters; fast it is a tone whose pitch is the click rate (100 per second is 100 Hz, 440 is A4).'),
  done('2026-10-25', 'Glossary', 'Sound wave animation: realistic cone motion (parabolic arcs for a square wave)', 'task-0114', 'The speaker cone now moves the way a real speaker cone does: the pressure follows how hard the cone is pushed, so a square wave comes from smooth parabolic arcs, not straight lines.'),
  done('2026-10-25', 'Site', 'Learn menu with a Sound wave page', 'task-0114', 'The speaker cone animation has its own page, Sound wave, with a short guide to reading it. The Glossary links to it from the wave terms. The menu group Reference is now called Learn.'),
  done('2026-10-25', 'Glossary', 'Choose a waveform in the cone animation and see its harmonics', 'task-0114', 'The Sound wave animation can show a sine, triangle, square or sawtooth wave, with a bar chart of its harmonics.'),
  done('2026-10-25', 'Site', 'Help menu with Features, Help and About', 'task-0114', 'Features lists what the Studio can do and what is on the way; Help says what each page does.'),
  done('2026-10-25', 'Site', 'Collapsible menu and full-width content', 'task-0114', 'A button next to the title folds the menu away, and the pages use the whole width.'),
  done('2026-10-25', 'Listen', 'Octave-error correction for Mark harmonics', 'task-0107', 'When the loudest peak is a harmonic, the Spectrum reads the lower fundamental instead.'),
  done('2026-10-25', 'Rhythm', 'Lane BPM window switch', 'task-0108', 'Each Beat bands lane reads its tempo from the gaps between its hits, over a window you choose.'),
  done('2026-10-25', 'Listen', 'Level meter on the Listen page', 'task-0111', 'RMS and peak in dBFS with a Peak hold button. dBFS is not dB SPL.'),
  done('2026-10-25', 'Rhythm', 'Add a legend under the tempo-per-window row'),
  done('2026-10-25', 'Primitive', 'Colour the air density curve like the dots and explain it'),
  done('2026-10-25', 'Primitive', 'Whole-percent amplitude, Continuous by default, popup hints on Primitive'),
  done('2026-10-25', 'Listen', 'Name waveform views by role', 'task-0108'),
  done('2026-10-25', 'Primitive', 'Make the Primitive page compact', 'task-0114'),
  done('2026-10-25', 'Glossary', 'Move the speaker cone animation from Primitive to the Glossary and group the list by category', 'task-0114'),
  done('2026-10-25', 'Primitive', 'Draw dense air red on Primitive and enlarge the density curve'),
  done('2026-10-25', 'Primitive', 'Mark the densest air with a moving compression band on Primitive'),
  done('2026-10-25', 'Rhythm', "Show each lane's BPM on the left of the Beat bands"),
  done('2026-10-25', 'Rhythm', 'Show a BPM for each Beat bands lane', 'task-0108'),
  done('2026-10-25', 'Glossary', 'Add the Analysis window glossary term', 'task-0114'),
  done('2026-10-25', 'Rhythm', 'Tempo per analysis window and a BPM-over-time graph on Rhythm', 'task-0108'),
  done('2026-10-25', 'Glossary', 'Music theory domain on the glossary map', 'task-0119'),
  done('2026-10-25', 'Glossary', 'Glossary terms for waveforms, noise, analysis and rhythm', 'task-0118'),
  done('2026-10-25', 'Glossary', 'Semantic zoom on the glossary map'),
  done('2026-10-25', 'Rhythm', 'Make the Beat bands canvas three times taller'),
  done('2026-10-25', 'Glossary', 'Balanced multi-column domain boxes on the glossary map', 'task-0114'),
  done('2026-10-25', 'Glossary', 'Add glossary synonyms and the Harmony, Octave and Interval terms', 'task-0114'),
  done('2026-10-25', 'Glossary', 'Add a Map view to the Glossary', 'task-0114'),
  done('2026-10-25', 'Rhythm', 'Choose 4, 6, 8 or 12 beat bands on Rhythm and the Chordophones lab', 'task-0108'),
  done('2026-10-25', 'Primitive', 'Add a time window oscilloscope to Primitive'),
  done('2026-10-25', 'Primitive', 'Make the Primitive air dots follow the pressure, not the cone position'),
  done('2026-10-25', 'Primitive', 'Add a slow motion factor switch to Primitive, default 2000x'),
  done('2026-10-25', 'Rhythm', 'Add the Rhythm page with a tempo grid over the beat bands', 'task-0114'),
  done('2026-10-25', 'Primitive', 'Label the Primitive oscilloscope cycle with period, frequency and wavelength'),
  done('2026-10-25', 'Primitive', 'Show one wave cycle in the Primitive air dots', 'task-0114'),
  done('2026-10-25', 'Listen', 'Explain H1 on the Listen Spectrum, harmonics on and Log axis by default', 'task-0107'),
  done('2026-10-25', 'Listen', 'Turn Spectrum trails on by default with a 10 s length up to 60 s'),
  done('2026-10-25', 'Listen', 'Make the studio Spectrum twice as tall'),
  done('2026-10-25', 'Listen', 'Set the Spectrum trail length on Listen and Chordophones'),
  done('2026-10-25', 'Listen', 'Add a Mark harmonics switch to the Spectrum', 'task-0107'),
  done('2026-10-25', 'Listen', 'Add a Trails switch to the Spectrum'),
  done('2026-10-25', 'iOS', 'Add a metronome to the Tools screen', 'task-0113'),
  done('2026-10-25', 'Primitive', 'Animate a slowed speaker cone on Primitive'),
  done('2026-10-25', 'Listen', 'Show a hover readout on the Spectrum'),
  done('2026-10-25', 'Glossary', 'Add a Glossary page and move the term definitions there', 'task-0114'),
  done('2026-10-25', 'Listen', 'Add the Listen page and take the microphone out of the Chordophones lab', 'task-0114'),
  done('2026-10-24', 'Primitive', 'Rename the Simple tone page to Primitive'),
  done('2026-10-24', 'Chordophones', 'Use counters for the harmonic count and decay'),
  done('2026-10-24', 'Site', 'Move the Analyze and Synthesize tabs to the studio site', 'task-0114'),
  done('2026-10-24', 'Chordophones', 'Explain the strike position in the harmonics lab'),
  done('2026-10-24', 'Site', 'Add the standalone Electrophone Studio site with Analyze and Synthesize', 'task-0114'),
  done('2026-10-24', 'Chordophones', 'Add a Cycles shown switch to the waveform views'),
  done('2026-10-24', 'Site', 'Rename the Studio tabs to Modify, Analyze and Synthesize'),
  done('2026-10-24', 'Chordophones', 'Add a Mute H1 switch to the harmonics lab', 'task-0106'),
  done('2026-10-24', 'Glossary', 'Add the origin of the word oscillation to the glossary'),
  done('2026-10-24', 'Primitive', 'Add a sound, tone and note glossary to the Simple tab'),
  done('2026-10-24', 'Primitive', 'Add a Simple tab to the Studio with a frequency, amplitude, power and length tone', 'task-0072'),
  done('2026-10-24', 'Chordophones', 'Add a Beating view, per-string waveform lines and view names to the harmonics lab', 'task-0109'),
  done('2026-10-24', 'Chordophones', 'Allow 1 to 8 strings in the harmonics lab', 'task-0109'),
  done('2026-10-24', 'Chordophones', 'Disable decay and strike controls at one harmonic'),
  done('2026-10-24', 'Chordophones', 'Add a beat bands view to the harmonics lab', 'task-0106'),
  done('2026-10-24', 'iOS', 'Add a Tools screen with a microphone Live BPM meter', 'task-0113'),
  done('2026-10-24', 'Chordophones', 'Add a microphone source to the harmonics lab', 'task-0108'),
  done('2026-10-24', 'Chordophones', 'Add piano realism to the harmonics lab', 'task-0109'),
  done('2026-10-24', 'Chordophones', 'Add a linear frequency axis to the harmonics lab', 'task-0106'),
  done('2026-10-24', 'Chordophones', 'Add detuned piano strings to the harmonics lab', 'task-0109'),
  done('2026-10-24', 'Chordophones', 'Add a piano-like decay mode to the harmonics lab', 'task-0109'),
  done('2026-10-24', 'Chordophones', 'Add the Pitch and harmonics card to the Studio Tools tab', 'task-0106'),
  done('2026-10-24', 'Rhythm', 'Add a Tools tab to the Studio with a microphone BPM meter', 'task-0072'),
  done('2026-10-21', 'Modify', 'Studio: compact loop controls', 'task-0072'),
  done('2026-10-20', 'Modify', 'Studio: waveform, A-B loop and saved loops, on the full page width', 'task-0072'),
  done('2026-10-20', 'Modify', 'Gapless A-B loops', 'task-0077'),
];

export const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function checkFeatures(list = FEATURES) {
  const problems = [];
  let last = '9999-99-99';
  list.forEach((f, i) => {
    const at = `#${i} ${f?.title}`;
    if (!f || typeof f.title !== 'string' || !f.title.trim()) problems.push(`${at}: title`);
    else if (!STATUSES.includes(f.status)) problems.push(`${at}: status`);
    else if (!AREAS.includes(f.area)) problems.push(`${at}: area`);
    else if (f.task !== undefined && !/^task-\d{4}$/.test(f.task)) problems.push(`${at}: task`);
    else if (f.status === 'released') {
      if (!isDay(f.date)) problems.push(`${at}: date`);
      else if (f.date > last) problems.push(`${at}: not newest first`);
      else last = f.date;
    } else if (f.date !== undefined) problems.push(`${at}: only released entries have a date`);
    else if (typeof f.text !== 'string' || !f.text.trim()) problems.push(`${at}: text`);
  });
  return problems;
}

export function groupFeatures(list = FEATURES) {
  const days = [];
  for (const f of list.filter((x) => x.status === 'released')) {
    const last = days.at(-1);
    if (last && last.date === f.date) last.items.push(f);
    else days.push({ date: f.date, items: [f] });
  }
  return {
    'in-progress': list.filter((f) => f.status === 'in-progress'),
    planned: list.filter((f) => f.status === 'planned'),
    released: days,
  };
}
