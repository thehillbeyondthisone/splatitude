// Depths are fractions of each effect's slider range; deliberately restrained
// for room-sized captures. All sound comes from the user's chosen source.
export const LOOKS = [
  { id: 'pulse', name: 'Pulse', note: 'Bass you can feel', color: '#c7f582',
    params: { dFrq: 3.2, dSpd: 0.24, sat: 1.08, vigAmt: 0.13 },
    routes: { dAmt: ['low', 0.045], bright: ['mid', 0.055], scale: ['high', 0.025] } },
  { id: 'liquid', name: 'Liquid', note: 'Slow, rolling waves', color: '#80d9d2',
    params: { dFrq: 2, dSpd: 0.18, wFreq: 2.6, wSpd: 0.17, sat: 1.12 },
    selects: { dField: 'curl', wMode: 'y' },
    routes: { dAmt: ['low', 0.025], wAmt: ['mid', 0.045], scale: ['high', 0.035] } },
  { id: 'prism', name: 'Prism', note: 'Colour in motion', color: '#b8b8ff',
    params: { sat: 1.25, tR: 0.92, tB: 1.08, dFrq: 6, dSpd: 0.35 },
    routes: { dAmt: ['low', 0.022], tR: ['low', 0.16], tB: ['high', 0.2], bright: ['mid', 0.08] } },
  { id: 'drift', name: 'Drift', note: 'Airy and weightless', color: '#9ac7ed',
    params: { wFreq: 1.3, wSpd: 0.11, dFrq: 1.4, dSpd: 0.12, sat: 0.85, vigAmt: 0.2 },
    selects: { wMode: 'z', dField: 'curl' },
    routes: { dAmt: ['low', 0.018], wAmt: ['mid', 0.05], scale: ['high', 0.05] } },
  { id: 'echo', name: 'Echo', note: 'Soft trails, warm light', color: '#f2b291',
    params: { smearAngle: 35, sat: 0.94, tR: 1.06, tB: 0.94, grainAmt: 0.015, dFrq: 4 },
    routes: { dAmt: ['low', 0.03], smearAmt: ['mid', 0.018], bright: ['high', 0.07] } },
  { id: 'raw', name: 'Original', note: 'Your space, untouched', color: '#d8dfd8', params: {}, routes: {} },
];
export const CONTROLLED_IDS = [...new Set(LOOKS.flatMap(look => [...Object.keys(look.params), ...Object.keys(look.routes)]))];
export const FEELS = { tight: { attack: 0, release: 70 }, balanced: { attack: 20, release: 180 }, float: { attack: 100, release: 650 } };
