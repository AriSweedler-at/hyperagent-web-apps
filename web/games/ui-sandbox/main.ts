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
import {
  appendHtml,
  closestFrom,
  dataOf,
  hasAttr,
  listen,
  nextFrame,
  queryAllIn,
  readChecked,
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
import { applyFrame, watchFrame, type FrameReading } from '../../shared/edge/screen.ts';
import { browserStore } from '../../shared/edge/storage.ts';
import {
  flipMap,
  isOrientationType,
  safeAreaMap,
  safeAreaVars,
  type OrientationType,
  type SafeAreaMap,
} from '../../shared/lib/safeArea.ts';
import {
  EXAMPLES,
  exampleById,
  exampleReport,
  type ExampleReport,
  type MeasuredBox,
} from './src/examples.ts';
import { wrongWay, type PlayOrientation } from '../../shared/ui/shell.ts';
import { GATE_COPY, paintGate } from '../../shared/ui/shellPaint.ts';
import { drawMap, mapRows } from './src/mapSvg.ts';
import { MEDIA_QUERIES, matchedDevice, readoutText, type Readout } from './src/readout.ts';
import {
  BAND_MAX,
  overridesFrom,
  readSettings,
  writeSetting,
  type ExampleId,
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

const paintExample = (): void => {
  const stage = requireId(doc, 'stage');
  const example = exampleById(settings.example);
  if (dataOf(stage, 'example') !== example.id) {
    setAttr(stage, 'data-example', example.id);
    setHtml(stage, example.markup);
  }
  const viewport = reading.viewport ?? { width: 0, height: 0 };
  const boxes = measureBoxes(stage);
  const scrolls = doc.documentElement.scrollHeight > win.innerHeight + 1;
  report = exampleReport(boxes, viewport, map, scrolls);
  setText(requireId(doc, 'report'), [example.label, example.blurb, ...report.lines].join('\n'));
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
  const v = targetValueOf(e);
  if (EXAMPLES.some((x) => x.id === v)) update('example', v as ExampleId);
};
listen(requireId(doc, 'exampleSel'), 'change', pickExample);
listen(requireId(doc, 'previewExampleSel'), 'change', pickExample);
listen(requireId(doc, 'previewInfoBtn'), 'click', () => {
  const rep = requireId(doc, 'report');
  const open = hasAttr(rep, 'hidden');
  setHidden(rep, !open);
  setAttr(requireId(doc, 'previewInfoBtn'), 'aria-expanded', String(open));
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
