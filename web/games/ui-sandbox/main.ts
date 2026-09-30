// UI Sandbox's boot (docs/design/ui-sandbox.md; the owner, 2026-09-28: "a standalone app that is
// merely a demo of all this sizing stuff ... display your phone's information, as well as all the
// viewport settings ... a sandbox to test stuff without having to worry about messing with real game
// code"). A plain page on the shell's frame (`<body data-frame>`, shell.css) and the shell's edge
// modules, no engine and no reducer: the frame's reading (web/shared/edge/screen.ts `applyFrame`,
// `watchFrame`), the safe-area map (web/shared/lib/safeArea.ts) written on the root as custom
// properties and drawn as an SVG, the readout (src/readout.ts) with a Copy button, the settings
// (src/settings.ts) through the shell's prefs, the shell's turn gate (web/shared/ui/shell.ts
// `wrongWay`, shellPaint.ts `paintGate` and `GATE_COPY`) and the Android lock
// (web/shared/edge/orientation.ts) in either direction, and the layout examples (src/examples.ts)
// measured after every paint. Everything the DOM is asked goes through web/shared/edge/dom.ts. The
// documented hook `window.__uiSandbox` (docs/ARCHITECTURE.md "Documented test hooks") exposes the
// reading, the map, the settings and the last example report for the emulator and the specs;
// `?type=<orientation type>` overrides `screen.orientation.type`, which no emulator can set.
// Example (j) (docs/design/ui-sandbox.md §7) is the one that leaves the page: "Roll in the Island"
// is a plain link to the Dice App Clip's URL with a roll, enabled by web/shared/lib/appClip.ts
// `clipGate` (an island iPhone, a published clip); the two mock dice tumble on the tap and show the
// roll the link carried. When the clip is configured (or `?clip=on` pretends it is), the boot puts
// Apple's Smart App Banner meta in the head; unconfigured, nothing is emitted.
import {
  addClass,
  appendHtml,
  closestFrom,
  dataOf,
  hasAttr,
  listen,
  nextFrame,
  preventDefault,
  queryAllIn,
  queryIn,
  readChecked,
  removeClass,
  readRootStyle,
  readValue,
  rectOf,
  requireId,
  setAttr,
  setChecked,
  setHidden,
  setHtml,
  setRootStyle,
  setText,
  setValue,
  targetValueOf,
  trustedHtml,
  type Element,
} from '../../shared/edge/dom.ts';
import { LANDSCAPE_PHONE, PORTRAIT_PHONE, watchMedia } from '../../shared/edge/media.ts';
import { createOrientationLock } from '../../shared/edge/orientation.ts';
import { applyFrame, notchOf, watchFrame, type FrameReading } from '../../shared/edge/screen.ts';
import { browserStore } from '../../shared/edge/storage.ts';
import {
  CLIP_IDS,
  INITIAL_ROLL,
  SMART_APP_BANNER_META,
  bannerContent,
  clipGate,
  clipUrl,
  diceClipUrl,
  rollFrom,
  type ClipGate,
  type Roll,
} from '../../shared/lib/appClip.ts';
import {
  flipMap,
  isOrientationType,
  safeAreaMap,
  safeAreaVars,
  type OrientationType,
  type SafeAreaMap,
} from '../../shared/lib/safeArea.ts';
import { pipsMarkup } from './src/dice.ts';
import {
  EXAMPLES,
  NO_ROOM,
  diceLine,
  exampleById,
  exampleReport,
  type ExampleReport,
  type MeasuredBox,
  type Room,
} from './src/examples.ts';
import { wrongWay, type PlayOrientation } from '../../shared/ui/shell.ts';
import { GATE_COPY, paintGate } from '../../shared/ui/shellPaint.ts';
import { drawMap, mapRows } from './src/mapSvg.ts';
import { MEDIA_QUERIES, matchedDevice, readoutText, type Readout } from './src/readout.ts';
import {
  BAND_MAX,
  PRETEND_CLIP_IDS,
  clipPretendedFrom,
  exampleIdOf,
  nextExampleId,
  overridesFrom,
  readSettings,
  writeSetting,
  type Settings,
} from './src/settings.ts';

type Screen = 'info' | 'settings' | 'preview';
const SCREENS: ReadonlyArray<Screen> = ['info', 'settings', 'preview'];
const isScreen = (v: string | null): v is Screen =>
  (SCREENS as ReadonlyArray<string>).includes(v ?? '');

const doc = document;
const win = window;
const store = browserStore();
const query = new URLSearchParams(location.search);
const forcedType = query.get('type');
const lockOf = (which: 'landscape' | 'portrait') => createOrientationLock(doc, screen, which);
/** The clip's ids the page runs on: the constants, or the pretence under `?clip=on`. */
const clipIds = clipPretendedFrom(location.search) ? PRETEND_CLIP_IDS : CLIP_IDS;
const randomBytes = (count: number): ReadonlyArray<number> => [
  ...crypto.getRandomValues(new Uint8Array(count)),
];

let settings: Settings = { ...readSettings(store), ...overridesFrom(location.search) };
let reading: FrameReading = applyFrame(doc, win);
let map: SafeAreaMap = safeAreaMap({
  corners: reading.corners,
  cut: null,
  type: 'portrait-primary',
  insets: reading.insets,
  viewport: reading.viewport ?? { width: 0, height: 0 },
  full: reading.full,
});
let report: ExampleReport | null = null;
let gateDismissed = false;
let landscapePhone = false;
let portraitPhone = false;
let locked = false;
/** Example (j): the roll the dice show, and the one the link carries for the next tap. */
let shownRoll: Roll = INITIAL_ROLL;
let pendingRoll: Roll = rollFrom(randomBytes(2));
let screenShown: Screen = isScreen(query.get('screen')) ? (query.get('screen') as Screen) : 'info';

/** `screen.orientation` as a browser without it (Safari before 16.4) reads: optional, its members too. */
const orientationOf = (
  sc: unknown,
):
  | Readonly<{ type?: string; addEventListener?: (type: 'change', fn: () => void) => void }>
  | undefined =>
  (
    sc as Readonly<{
      orientation?: Readonly<{
        type?: string;
        addEventListener?: (type: 'change', fn: () => void) => void;
      }>;
    }>
  ).orientation;

const orientationType = (): OrientationType | null => {
  if (forcedType !== null && isOrientationType(forcedType)) return forcedType;
  const t = orientationOf(win.screen)?.type;
  return t !== undefined && isOrientationType(t) ? t : null;
};

/** The type the map reads: the browser's, or the frame's orientation as the primary. */
const typeForMap = (): OrientationType =>
  orientationType() ??
  (reading.orientation === 'landscape' ? 'landscape-primary' : 'portrait-primary');

// ---- the frame's tokens and the map ------------------------------------------------------------

const paintFrame = (): void => {
  setAttr(doc.body, 'data-frame', settings.frame ? '' : null);
  setRootStyle(doc, '--frame-band', `${String(settings.band)}px`);
  setRootStyle(doc, '--frame-color', settings.color);
  setRootStyle(doc, '--frame-hairline', settings.hairline ? '#e0b35a' : 'transparent');
  setAttr(doc.body, 'data-flip', settings.flip ? '1' : null);
};

const computeMap = (): SafeAreaMap => {
  const device = matchedDevice(reading);
  const viewport = reading.viewport ?? { width: 0, height: 0 };
  const screenMap = safeAreaMap({
    corners: reading.corners,
    cut: device?.cut ?? null,
    type: typeForMap(),
    insets: reading.insets,
    viewport,
    full: reading.full,
  });
  return hasAttr(doc.body, 'data-flip') ? flipMap(screenMap, viewport) : screenMap;
};

const writeMap = (): void => {
  const vars = safeAreaVars(map);
  Object.keys(vars).forEach((name) => {
    setRootStyle(doc, name, vars[name] ?? '');
  });
  setAttr(doc.documentElement, 'data-notch-side', map.cutEdge);
  setAttr(doc.documentElement, 'data-free-side', vars['--safe-free-side'] ?? 'none');
  setAttr(
    doc.documentElement,
    'data-ears',
    String(map.cutEdge === 'none' ? 0 : map.edges[map.cutEdge].length),
  );
  // Example (j)'s hatch and seats branch on these two: the cut on the page, and it an island.
  setAttr(doc.documentElement, 'data-cut', map.cut === null ? null : '1');
  setAttr(doc.documentElement, 'data-island', map.cut !== null && map.island ? '1' : null);
};

// ---- the readout -------------------------------------------------------------------------------

const rulerSize = (name: string): number => {
  const el = doc.querySelector<HTMLElement>(`.ruler[data-ruler="${name}"]`);
  if (el === null) return 0;
  const r = rectOf(el);
  return name === 'vw' ? r.width : r.height;
};

const readout = (): Readout => ({
  reading,
  type: orientationType(),
  typeForced: forcedType !== null,
  visual:
    win.visualViewport === null
      ? null
      : {
          width: win.visualViewport.width,
          height: win.visualViewport.height,
          scale: win.visualViewport.scale,
        },
  units: {
    svh: rulerSize('svh'),
    dvh: rulerSize('dvh'),
    lvh: rulerSize('lvh'),
    vw: rulerSize('vw'),
  },
  media: MEDIA_QUERIES.map(([name, q]) => [name, win.matchMedia(q).matches] as const),
  map,
  flipped: hasAttr(doc.body, 'data-flip'),
  frameOn: hasAttr(doc.body, 'data-frame'),
});

const paintInfo = (): void => {
  const r = readout();
  setText(requireId(doc, 'readout'), readoutText(r));
  const svg = requireId(doc, 'mapSvg');
  const viewport = reading.viewport ?? { width: 1, height: 1 };
  setAttr(svg, 'viewBox', `0 0 ${String(viewport.width)} ${String(viewport.height)}`);
  setHtml(svg, trustedHtml(drawMap(map, viewport, reading.corners)));
  const body = doc.querySelector<HTMLElement>('#mapTable tbody');
  if (body !== null) setHtml(body, trustedHtml(mapRows(safeAreaVars(map))));
};

// ---- the examples -------------------------------------------------------------------------------

const measureBoxes = (stage: Element): ReadonlyArray<MeasuredBox> =>
  queryAllIn(stage, '[data-box]').map((el) => {
    const rect = rectOf(el);
    const size = el.querySelector<HTMLElement>('[data-size]');
    if (size !== null)
      setText(size, `${String(Math.round(rect.width))}x${String(Math.round(rect.height))}`);
    return { name: dataOf(el, 'box') ?? '', rect, fixed: hasAttr(el, 'data-fixed') };
  });

/** A root custom property in px (`--frame-band`, `--frame-hairline-w`, `--frame-gap`: what the shell pads `#app` by), 0 where unreadable. */
const rootPx = (prop: string): number => notchOf(readRootStyle(doc, win, prop)) ?? 0;

/** The room the shell leaves the example: the frame's clearance and the insets it pads by (shell.css `:where(body[data-frame]) #app`); nothing with the frame off, when `#app` has no padding. */
const roomOf = (): Room =>
  settings.frame
    ? {
        clearance: rootPx('--frame-band') + rootPx('--frame-hairline-w') + rootPx('--frame-gap'),
        insets: reading.insets,
      }
    : NO_ROOM;

// ---- example (j): the dice and the clip's link -------------------------------------------------

const gateNow = (): ClipGate => clipGate(matchedDevice(reading), clipIds);

/** The two dice show `shownRoll`; the link carries `pendingRoll` where the gate opens, else no href, `aria-disabled` and the reason. */
const paintDice = (stage: Element): void => {
  const btn = queryIn(stage, '#islandRollBtn');
  if (btn === null) return;
  const gate = gateNow();
  setAttr(btn, 'aria-disabled', gate.enabled ? null : 'true');
  setAttr(btn, 'href', gate.enabled ? diceClipUrl(pendingRoll) : null);
  setAttr(btn, 'data-roll', `${String(pendingRoll[0])},${String(pendingRoll[1])}`);
  const reason = queryIn(stage, '[data-note="dice"]');
  if (reason !== null) setText(reason, gate.reason ?? '');
  queryAllIn(stage, '.die').forEach((die, i) => {
    const face = shownRoll[i === 0 ? 0 : 1];
    setAttr(die, 'data-face', String(face));
    setAttr(die, 'aria-label', `die ${i === 0 ? 'one' : 'two'} shows ${String(face)}`);
    setHtml(die, pipsMarkup(face));
  });
};

/** A tap on the live link: the link opens the roll it carried; here the dice tumble and then show it, and the next roll is minted. */
const rollDice = (): void => {
  shownRoll = pendingRoll;
  pendingRoll = rollFrom(randomBytes(2));
  const stage = requireId(doc, 'stage');
  const dice = queryAllIn(stage, '.die');
  dice.forEach((die) => {
    addClass(die, 'tumble');
  });
  setTimeout(() => {
    dice.forEach((die) => {
      removeClass(die, 'tumble');
    });
    paintDice(stage);
  }, 450);
};

const paintExample = (): void => {
  const stage = requireId(doc, 'stage');
  const example = exampleById(settings.example);
  if (dataOf(stage, 'example') !== example.id) {
    setAttr(stage, 'data-example', example.id);
    setHtml(stage, example.markup);
  }
  if (example.id === 'dice') paintDice(stage);
  const viewport = reading.viewport ?? { width: 0, height: 0 };
  const boxes = measureBoxes(stage);
  const scrolls = doc.documentElement.scrollHeight > win.innerHeight + 1;
  report = exampleReport(boxes, viewport, map, scrolls, roomOf());
  setText(
    requireId(doc, 'report'),
    [
      example.label,
      example.blurb,
      ...report.lines,
      ...(example.id === 'dice' ? [diceLine(map), gateNow().reason ?? 'the clip: ready'] : []),
    ].join('\n'),
  );
  const railNote = stage.querySelector<HTMLElement>('[data-note="rail"]');
  if (railNote !== null)
    setText(
      railNote,
      map.cutEdge === 'left' || map.cutEdge === 'right'
        ? `rail on the ${map.cutEdge === 'left' ? 'right' : 'left'} (the free side), ${String(Math.round(map.edges[map.cutEdge === 'left' ? 'right' : 'left'][0]?.to ?? 0) - Math.round(map.edges[map.cutEdge === 'left' ? 'right' : 'left'][0]?.from ?? 0))}px between the arcs`
        : 'no free side: the cut is not on a vertical edge (hold the phone sideways)',
    );
  const earNote = stage.querySelector<HTMLElement>('[data-note="ears"]');
  if (earNote !== null)
    setText(
      earNote,
      map.cutEdge === 'none'
        ? 'no cut on this device (or none known): no ears'
        : map.cut === null
          ? "the cut is under the browser bar: the edge is the browser's, no ears"
          : map.ear === 0
            ? `the ears are under 44px on this ${map.island ? 'island' : 'notch'} phone: unusable, the example hides them`
            : `two ears of ${String(Math.round(map.ear))}px on the ${map.cutEdge}, ${map.island ? 'island' : 'notch'} between them`,
    );
};

// ---- the gate: the shell's (web/shared/ui/shell.ts `wrongWay`, shellPaint.ts `paintGate`) -----

/** The orientation setting as `ShellConfig.orientation` spells it: `auto` plays either way. */
const playsAs = (): PlayOrientation | 'any' => (settings.mode === 'auto' ? 'any' : settings.mode);

/** The way the gate asks for, or null: the shell's predicate over the two watchers, unless dismissed for this run or the lock is held. */
const gateWanted = (): PlayOrientation | null => {
  const plays = playsAs();
  return plays !== 'any' &&
    !gateDismissed &&
    !locked &&
    wrongWay(plays, { portraitPhone, landscapePhone })
    ? plays
    : null;
};

const canLock =
  typeof (screen.orientation as Readonly<{ lock?: unknown }>).lock === 'function' &&
  !win.matchMedia('(any-pointer: fine)').matches;

/** The shell's paint: the sheet, `inert` on `#app`, focus to the first control, "Go" where the device can lock, the words for the way asked. */
const paintTurnGate = (): void => {
  const want = gateWanted();
  paintGate(doc, want !== null, canLock, want === null ? undefined : GATE_COPY[want]);
};

const toast = (text: string): void => {
  const el = requireId(doc, 'toast');
  setText(el, text);
  setHidden(el, false);
  setTimeout(() => {
    setHidden(el, true);
  }, 3000);
};

// ---- the whole paint ---------------------------------------------------------------------------

const paintScreen = (): void => {
  setAttr(doc.body, 'data-screen', screenShown);
  SCREENS.forEach((s) => {
    const el = doc.querySelector<HTMLElement>(`.screen[data-screen="${s}"]`);
    if (el !== null) setHidden(el, s !== screenShown);
  });
  queryAllIn(requireId(doc, 'menu'), '.tab').forEach((tab) => {
    setAttr(tab, 'aria-pressed', String(dataOf(tab, 'screen') === screenShown));
  });
};

const paintSettings = (): void => {
  setValue(requireId(doc, 'modeSel'), settings.mode);
  setChecked(requireId(doc, 'frameChk'), settings.frame);
  setValue(requireId(doc, 'bandRange'), String(settings.band));
  setText(requireId(doc, 'bandOut'), `${String(settings.band)}px`);
  setValue(requireId(doc, 'colorInput'), settings.color);
  setChecked(requireId(doc, 'hairlineChk'), settings.hairline);
  setValue(requireId(doc, 'exampleSel'), settings.example);
  setValue(requireId(doc, 'previewExampleSel'), settings.example);
  setChecked(requireId(doc, 'flipChk'), settings.flip);
};

const repaint = (): void => {
  reading = applyFrame(doc, win);
  paintFrame();
  map = computeMap();
  writeMap();
  paintScreen();
  paintSettings();
  paintTurnGate();
  if (screenShown === 'preview') paintExample();
  else paintInfo();
};

const update = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
  settings = { ...settings, [key]: value };
  writeSetting(store, key, value);
  repaint();
};

// ---- wiring -------------------------------------------------------------------------------------

const options = EXAMPLES.map(
  (e) => `<option value="${e.id}">${e.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`,
).join('');
appendHtml(requireId(doc, 'exampleSel'), trustedHtml(options));
appendHtml(requireId(doc, 'previewExampleSel'), trustedHtml(options));

listen(requireId(doc, 'menu'), 'click', (e) => {
  const tab = closestFrom(e, '.tab');
  const target = tab === null ? null : dataOf(tab, 'screen');
  if (isScreen(target)) {
    screenShown = target;
    repaint();
  }
});
listen(requireId(doc, 'modeSel'), 'change', (e) => {
  const v = targetValueOf(e);
  if (v === 'auto' || v === 'landscape' || v === 'portrait') {
    gateDismissed = false;
    update('mode', v);
  }
});
listen(requireId(doc, 'frameChk'), 'change', () => {
  update('frame', readChecked(requireId(doc, 'frameChk')));
});
listen(requireId(doc, 'bandRange'), 'input', () => {
  update('band', Math.max(0, Math.min(BAND_MAX, Number(readValue(requireId(doc, 'bandRange'))))));
});
listen(requireId(doc, 'colorInput'), 'input', () => {
  update('color', readValue(requireId(doc, 'colorInput')));
});
listen(requireId(doc, 'hairlineChk'), 'change', () => {
  update('hairline', readChecked(requireId(doc, 'hairlineChk')));
});
listen(requireId(doc, 'flipChk'), 'change', () => {
  update('flip', readChecked(requireId(doc, 'flipChk')));
});
const pickExample = (e: Readonly<Event>): void => {
  const id = exampleIdOf(targetValueOf(e));
  if (id !== null) update('example', id);
};
listen(requireId(doc, 'exampleSel'), 'change', pickExample);
listen(requireId(doc, 'previewExampleSel'), 'change', pickExample);
// Next: the example after this one, the first after the last, into both dropdowns and the store.
listen(requireId(doc, 'previewNextBtn'), 'click', () => {
  update('example', nextExampleId(settings.example));
});
listen(requireId(doc, 'previewInfoBtn'), 'click', () => {
  const rep = requireId(doc, 'report');
  const open = hasAttr(rep, 'hidden');
  setHidden(rep, !open);
  setAttr(requireId(doc, 'previewInfoBtn'), 'aria-expanded', String(open));
});
// (j)'s link lives in the stage's markup, so the stage listens: a live link opens (the browser's
// own navigation, in the tap's gesture, so iOS shows the App Clip card) and the dice tumble; a
// held one does nothing.
listen(requireId(doc, 'stage'), 'click', (e) => {
  const link = closestFrom(e, '#islandRollBtn');
  if (link === null) return;
  if (hasAttr(link, 'href')) rollDice();
  else preventDefault(e);
});
listen(requireId(doc, 'turnGateKeepBtn'), 'click', () => {
  gateDismissed = true;
  repaint();
});
listen(requireId(doc, 'turnGateGoBtn'), 'click', () => {
  const which = settings.mode === 'portrait' ? 'portrait' : 'landscape';
  locked = true;
  repaint();
  void lockOf(which)
    .hold()
    .then((took) => {
      locked = took;
      if (!took)
        toast(
          "Lock the phone's rotation so the layout stays put: swipe down and make sure Auto-rotate is off.",
        );
      repaint();
    });
});
listen(requireId(doc, 'copyBtn'), 'click', () => {
  const text = readoutText(readout());
  void navigator.clipboard.writeText(text).then(
    () => {
      setText(requireId(doc, 'copyNote'), 'copied');
    },
    () => {
      setText(requireId(doc, 'copyNote'), 'copy failed: select the text');
    },
  );
});
listen(doc, 'fullscreenchange', () => {
  if (doc.fullscreenElement === null) locked = false;
});
watchMedia(win, LANDSCAPE_PHONE, (m) => {
  landscapePhone = m;
  repaint();
});
watchMedia(win, PORTRAIT_PHONE, (m) => {
  portraitPhone = m;
  repaint();
});
watchFrame(doc, win, repaint);
// `screen.orientation`'s own `change`: the half-turn between the two landscapes fires no resize.
orientationOf(win.screen)?.addEventListener?.('change', () => {
  nextFrame(repaint);
});
// The Smart App Banner (Apple, "Supporting invocations from your website"): once the clip is
// configured, and not before. Safari reads the tag off the document; that it honours one a module
// script adds is UNVERIFIED on a phone (ui-sandbox.md §7): if no card shows, the tag moves into
// index.html.
const banner = bannerContent(clipUrl('dice'), clipIds);
if (banner !== null)
  appendHtml(doc.head, trustedHtml(`<meta name="${SMART_APP_BANNER_META}" content="${banner}">`));
repaint();

// The documented hook (docs/ARCHITECTURE.md "Documented test hooks").
Object.assign(window, {
  __uiSandbox: {
    reading: (): FrameReading => reading,
    map: (): SafeAreaMap => map,
    settings: (): Settings => settings,
    report: (): ExampleReport | null => report,
    readout: (): string => readoutText(readout()),
    device: (): string | null => matchedDevice(reading)?.id ?? null,
    gate: (): ClipGate => gateNow(),
    dice: (): Readonly<{ shown: Roll; pending: Roll }> => ({
      shown: shownRoll,
      pending: pendingRoll,
    }),
    roll: (): void => {
      rollDice();
    },
    show: (s: Screen): void => {
      screenShown = s;
      repaint();
    },
    set: <K extends keyof Settings>(key: K, value: Settings[K]): void => {
      update(key, value);
    },
  },
});
export {};
