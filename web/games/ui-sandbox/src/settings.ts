// UI Sandbox's settings (docs/design/ui-sandbox.md §4): the orientation mode (auto, or the gate
// and lock sideways as backgammon's, or the mirror upright), the frame and its three tokens, the
// layout example and the half-turn flip, each a bare-string preference under a `uiSandbox_` key
// through the shell's prefs (web/shared/edge/prefs.ts `textPref`), a bad or missing value the
// default. Pure but for the Store handed in; the query (`?example=`, `?frame=`, `?mode=`, `?flip=`)
// overrides a run without storing (the emulator's hook, docs/ARCHITECTURE.md "Documented test hooks").
import { textPref, type TextPref } from '../../../shared/edge/prefs.ts';
import type { Store } from '../../../shared/edge/storage.ts';
import { integer, literal, refine, string, type Decoder } from '../../../shared/lib/json.ts';

export const ORIENTATION_MODES = ['auto', 'landscape', 'portrait'] as const;
export type OrientationMode = (typeof ORIENTATION_MODES)[number];
export const EXAMPLE_IDS = [
  'cover',
  'side',
  'sides',
  'top',
  'strips',
  'board',
  'rail',
  'ears',
  'gutters',
] as const;
export type ExampleId = (typeof EXAMPLE_IDS)[number];
const ON_OFF = ['on', 'off'] as const;
type OnOff = (typeof ON_OFF)[number];

export type Settings = Readonly<{
  mode: OrientationMode;
  frame: boolean;
  /** The band's width in px, 0-12. */
  band: number;
  /** The band's colour, a CSS colour. */
  color: string;
  hairline: boolean;
  example: ExampleId;
  flip: boolean;
}>;
export type SettingKey = keyof Settings;
export const SETTING_KEYS: ReadonlyArray<SettingKey> = [
  'mode',
  'frame',
  'band',
  'color',
  'hairline',
  'example',
  'flip',
];

export const DEFAULT_SETTINGS: Settings = {
  mode: 'auto',
  frame: true,
  band: 6,
  color: '#7a8a3c',
  hairline: true,
  example: 'cover',
  flip: false,
};

export const BAND_MAX = 12;
/** The storage keys, one per setting, all under the sandbox's prefix. */
export const KEYS: Readonly<Record<SettingKey, string>> = {
  mode: 'uiSandbox_mode',
  frame: 'uiSandbox_frame',
  band: 'uiSandbox_band',
  color: 'uiSandbox_color',
  hairline: 'uiSandbox_hairline',
  example: 'uiSandbox_example',
  flip: 'uiSandbox_flip',
};

const decodeOnOff: Decoder<OnOff> = literal(...ON_OFF);
const decodeBand: Decoder<number> = (input) => integer(0, BAND_MAX)(Number(input));
const decodeColor: Decoder<string> = refine(
  string,
  (s) => /^#[0-9a-f]{6}$/i.test(s),
  'a #rrggbb colour',
);
const bool = (v: OnOff): boolean => v === 'on';
const onOff = (b: boolean): OnOff => (b ? 'on' : 'off');

const mode = textPref(KEYS.mode, literal(...ORIENTATION_MODES));
const frame = textPref(KEYS.frame, decodeOnOff);
const band = textPref(KEYS.band, (input: unknown) => {
  const d = decodeBand(input);
  return d.ok ? { ok: true as const, value: String(d.value) } : d;
});
const color = textPref(KEYS.color, decodeColor);
const hairline = textPref(KEYS.hairline, decodeOnOff);
const example = textPref(KEYS.example, literal(...EXAMPLE_IDS));
const flip = textPref(KEYS.flip, decodeOnOff);

const readOr = <T>(pref: TextPref<T>, store: Store, fallback: T): T => {
  const read = pref.read(store);
  return read.ok ? read.value : fallback;
};

/** Every setting off the store, the default where a key is missing or malformed. */
export const readSettings = (store: Store): Settings => ({
  mode: readOr(mode, store, DEFAULT_SETTINGS.mode),
  frame: bool(readOr(frame, store, onOff(DEFAULT_SETTINGS.frame))),
  band: Number(readOr(band, store, String(DEFAULT_SETTINGS.band))),
  color: readOr(color, store, DEFAULT_SETTINGS.color),
  hairline: bool(readOr(hairline, store, onOff(DEFAULT_SETTINGS.hairline))),
  example: readOr(example, store, DEFAULT_SETTINGS.example),
  flip: bool(readOr(flip, store, onOff(DEFAULT_SETTINGS.flip))),
});

/** One setting to the store, as its bare string. */
export const writeSetting = <K extends SettingKey>(
  store: Store,
  key: K,
  value: Settings[K],
): void => {
  const text: string =
    typeof value === 'boolean' ? onOff(value) : typeof value === 'number' ? String(value) : value;
  void store.writeText(KEYS[key], text);
};

/**
 * The query's overrides: `?example=<id>`, `?frame=on|off`, `?mode=auto|landscape|portrait`,
 * `?flip=on|off`, `?band=<0-12>`; a value the decoder refuses is ignored. Not stored.
 */
export const overridesFrom = (search: string): Partial<Settings> => {
  const q = new URLSearchParams(search);
  const pick = <T>(name: string, decoder: Decoder<T>): T | undefined => {
    const raw = q.get(name);
    if (raw === null) return undefined;
    const d = decoder(raw);
    return d.ok ? d.value : undefined;
  };
  const ex = pick('example', literal(...EXAMPLE_IDS));
  const fr = pick('frame', decodeOnOff);
  const mo = pick('mode', literal(...ORIENTATION_MODES));
  const fl = pick('flip', decodeOnOff);
  const ba = pick('band', decodeBand);
  return {
    ...(ex === undefined ? {} : { example: ex }),
    ...(fr === undefined ? {} : { frame: bool(fr) }),
    ...(mo === undefined ? {} : { mode: mo }),
    ...(fl === undefined ? {} : { flip: bool(fl) }),
    ...(ba === undefined ? {} : { band: ba }),
  };
};
