// The audit's contact sheet (pure): `shots/space-audit/<page>/index.html`, one card per case in
// the layout `npm run shots` uses (tools/shell-emulate.ts `sheetHtml`: the models, the case, a
// badge, the pictures in a row, the numbers, the checks), in UI Sandbox's design language
// (web/games/ui-sandbox/theme.css: a near-black page, `#181b22` panels with `#2a2f3a` lines,
// `#e8e6e1` ink, the frame's olive accent, green for a pass, `#b3261e` where a rule fails and the
// muted grey for a column by design: `tier`, `gate`). The device line under each shot is the
// readout's first line as the sandbox spells it: the row, the models, the viewport at its pixel ratio.
import { emulationName, type Emulation } from '../../web/shared/lib/devices.ts';
import {
  SIDES,
  emptyOf,
  gapsOf,
  roomOf,
  sidesText,
  type AuditVerdict,
  type Measured,
  type PageId,
  type Screen,
} from './judge.ts';

/** One screen's result: what was measured, the verdict and the picture's path relative to the sheet. */
export type ScreenResult = Readonly<{
  screen: Screen;
  measured: Measured;
  verdict: AuditVerdict;
  picture: string;
}>;
/** One case's card: the emulation and every screen in the order the drive reached them. */
export type AuditCard = Readonly<{ e: Emulation; screens: ReadonlyArray<ScreenResult> }>;

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** Every screen passed. */
export const cardPasses = (c: AuditCard): boolean => c.screens.every((s) => s.verdict.pass);

/** The readout's device line for a case: `iphone-390x844 · iPhone 12, ... · 390x844 @3x · insets t/r/b/l 0/47/21/47`. */
export const deviceLine = (e: Emulation): string =>
  `${e.device.id} · ${e.device.models} · ${String(e.viewport.width)}x${String(e.viewport.height)} @${String(e.dpr)}x · insets t/r/b/l ${String(e.insets.top)}/${String(e.insets.right)}/${String(e.insets.bottom)}/${String(e.insets.left)}${e.device.verified ? '' : ' · UNVERIFIED row'}`;

/** A column's class: red where it fails, grey where it is by design, plain where it passes. */
const classOf = (o: AuditVerdict['checks'][number]['outcome']): string =>
  o === 'FAIL' ? 'bad' : o === 'ok' ? 'ok' : 'grey';

const checksHtml = (v: AuditVerdict): string =>
  v.checks
    .map(
      (k) =>
        `<li class="${classOf(k.outcome)}"><b>${esc(k.name)}</b> ${esc(k.detail)}${k.outcome === 'ok' || k.outcome === 'FAIL' ? '' : ` <i>${esc(k.outcome)}</i>`}</li>`,
    )
    .join('');

/** The grey badges a screen wears beside pass/FAIL: `tier`, `gate`, each once. */
const designBadges = (v: AuditVerdict): string =>
  [...new Set(v.checks.map((k) => k.outcome).filter((o) => o !== 'ok' && o !== 'FAIL'))]
    .map((o) => ` <span class="badge grey">${esc(o)}</span>`)
    .join('');

const screenHtml = (e: Emulation, s: ScreenResult): string => {
  const m = s.measured;
  const empty = emptyOf(gapsOf(m.inner, m.used), roomOf(m.pad, e.insets));
  const usedFails = s.verdict.checks.some((k) => k.name === 'used' && !k.pass);
  return `<div class="screen ${s.verdict.pass ? 'pass' : 'fail'}">
<figure><img src="${esc(s.picture)}" alt="${esc(`${emulationName(e)} ${s.screen.id}`)}" loading="lazy"><figcaption>${esc(s.screen.id)} <small>(${esc(s.screen.kind)}${s.screen.kept === true ? ', kept' : ''})</small> <span class="badge">${s.verdict.pass ? 'pass' : 'FAIL'}</span>${designBadges(s.verdict)}</figcaption></figure>
<dl>
<dt>empty per side</dt><dd class="${usedFails ? 'bad' : ''}">${esc(sidesText(m.inner, empty))}</dd>
<dt>room t/r/b/l</dt><dd>${SIDES.map((k) => String(Math.round(Math.max(m.pad[k], e.insets[k]) * 10) / 10)).join('/')} (#app pad ${SIDES.map((k) => String(Math.round(m.pad[k] * 10) / 10)).join('/')})</dd>
<dt>document</dt><dd>${String(m.scrollWidth)}x${String(m.scrollHeight)} in ${String(m.inner.w)}x${String(m.inner.h)}${m.fixedScreen ? ' · fixed-screen' : ''}${m.frame ? ' · data-frame' : ''}</dd>
</dl>
<ul class="checks">${checksHtml(s.verdict)}</ul>
</div>`;
};

/** `index.html` for one page: a header with the tally, then one card per case. */
export const sheetHtml = (page: PageId, cards: ReadonlyArray<AuditCard>, stamp: string): string => {
  const passed = cards.filter(cardPasses).length;
  const card = (c: AuditCard): string => {
    const name = emulationName(c.e);
    const pass = cardPasses(c);
    return `<section class="card ${pass ? 'pass' : 'fail'}" id="${esc(name.replace(/[^a-z0-9]+/gi, '-'))}">
<h2>${esc(c.e.device.models)} <small>${esc(name)}</small> <span class="badge">${pass ? 'pass' : 'FAIL'}</span></h2>
<div class="pics">${c.screens.map((s) => screenHtml(c.e, s)).join('')}</div>
<p class="device">${esc(deviceLine(c.e))}</p>
</section>`;
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Space audit · ${esc(page)} · ${esc(stamp)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--frame-color:#7a8a3c;--frame-hairline:#e0b35a;--ink:#e8e6e1;--muted:#9a9891;--panel:#181b22;--line:#2a2f3a;--green:#4f9d5a;--red:#b3261e}
body{margin:0;padding:16px;font:14px/1.4 system-ui,sans-serif;background:#0f1115;color:var(--ink)}
h1{font-size:18px;margin:0 0 6px}h1 small{font-weight:normal;color:var(--muted)}
p.lead{color:var(--muted);margin:0 0 16px;max-width:80ch}
.card{background:var(--panel);border:1px solid var(--line);border-left:6px solid var(--green);border-radius:8px;padding:12px 16px;margin:0 0 16px}
.card.fail{border-left-color:var(--red)}
.card h2{font-size:15px;margin:0 0 8px}.card h2 small{font-weight:normal;color:var(--muted)}
.badge{float:right;font-size:12px;padding:2px 8px;border-radius:10px;background:var(--green);color:#fff}.fail>.badge,.fail>h2 .badge,.fail>figure .badge,.screen.fail .badge{background:var(--red)}
.badge.grey,.screen.fail .badge.grey{background:var(--line);color:var(--muted)}
.pics{display:flex;gap:16px;overflow-x:auto;padding-bottom:6px}
.screen{flex:0 0 auto;max-width:min(60vw,520px);border:1px solid var(--line);border-radius:6px;padding:8px;background:#0f1115}
.screen.fail{border-color:var(--red)}
figure{margin:0}figure img{display:block;max-height:340px;max-width:100%;height:auto;border:1px solid var(--line);background:#000;outline:2px solid var(--frame-color);outline-offset:-2px}
figcaption{font-size:12px;color:var(--muted);margin:4px 0}figcaption .badge{float:none;margin-left:6px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:8px 0;font:12px/1.4 ui-monospace,Menlo,monospace}dt{color:var(--muted)}dd{margin:0}dd.bad{color:var(--red)}
.checks{list-style:none;padding:0;margin:0;font-size:12px}.checks li{padding:1px 0}.checks li::before{content:"✓ ";color:var(--green)}.checks li.bad{color:var(--red)}.checks li.bad::before{content:"✗ "}
.checks li.grey{color:var(--muted)}.checks li.grey::before{content:"– ";color:var(--muted)}.checks li.grey i{font-style:normal;padding:0 5px;border-radius:8px;background:var(--line)}
.device{margin:6px 0 0;font:12px/1.4 ui-monospace,Menlo,monospace;color:var(--muted)}
</style></head><body>
<h1>Space audit · ${esc(page)} <small>· ${esc(stamp)} · ${String(passed)} of ${String(cards.length)} cases pass</small></h1>
<p class="lead">Every catalogued phone (web/shared/lib/devices.ts), each orientation and display mode, a browser tab twice (bar shown, then hidden), at the device's pixel ratio. Per screen: the empty screen beyond the room on each side (px and the fraction of the viewport), the document against the viewport, and the six rules (docs/design/space-audit.md); red where one fails, grey where the page means it (a scroll tier, the turn gate). The olive line is the picture's edge, not the frame. Look, then decide.</p>
${cards.map(card).join('\n')}
</body></html>
`;
};
