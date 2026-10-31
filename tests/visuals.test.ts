import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getManifest, hasManifest, manifestEntries, manifestEntry, manifestRevision, onManifestChange, onVisualsEvent, overlayKind, resetManifest, setManifest
} from '../src/client/visuals';
import { emptyManifest } from '../src/shared';

// R8.5: the client's copy of the manifest. It is always safe to read (empty before the event, and if it never comes), a late arrival asks for exactly one
// re-render, a resend of the same manifest asks for none, and junk never throws. `main.ts` only wires `socket.on('visuals', ...)` to `onVisualsEvent`.

const NET = {
  id: 'net', kind: 'piece', slot: 'vertex',
  button: { label: 'Net', icon: 'net', order: 20 },
  hints: { noSupply: 'No nets left.', cannotAfford: 'Cannot pay.', noSpots: 'No spot.' },
  shape: '<path d="M-8,8 L0,-10 L8,8 Z" fill="{color}"/>'
};
const FEED = {
  id: 'feed_sea', kind: 'action', slot: 'hex', spotKey: 'hexId',
  button: { label: 'Feed', icon: 'fish', order: 30 },
  hints: { cannotAfford: 'Cannot pay.', noSpots: 'No sea tile.' }
};
const FLOOD = {
  id: 'flood', label: 'Flooded',
  tint: { light: 'rgba(0,0,255,0.3)', dark: 'rgba(100,100,255,0.3)' },
  line: { light: '#235', dark: '#9be' },
  pattern: '<path d="M0,5 Q2.5,2 5,5 T10,5" fill="none" stroke="currentColor"/>'
};
/** What arrives over the wire: JSON, so a fresh object each time. */
const wire = (pieces: unknown[] = [NET, FEED], overlays: unknown[] = [FLOOD]) =>
  JSON.parse(JSON.stringify({ key: 'tidebound.fishing', manifest: { version: 1, pieces, overlays } }));

// Listeners live as long as the module, so every test removes the ones it added.
const offs: (() => void)[] = [];
const listen = (fn: () => void) => {
  const off = onManifestChange(fn);
  offs.push(off);
  return off;
};

beforeEach(() => {
  resetManifest();
});

afterEach(() => {
  for (const off of offs.splice(0)) off();
});

describe('client manifest (R8.5)', () => {
  it('is empty before anything arrives, and every reader is safe', () => {
    expect(getManifest()).toEqual(emptyManifest());
    expect(manifestEntries()).toEqual([]);
    expect(manifestEntry('net')).toBeUndefined();
    expect(overlayKind('flood')).toBeUndefined();
    expect(hasManifest()).toBe(false);
  });

  it('never arrives: a state with no manifest draws with the empty one, nothing throws and no re-render is asked for', () => {
    let renders = 0;
    listen(() => { renders++; });
    for (let i = 0; i < 3; i++) {
      expect(manifestEntries()).toHaveLength(0);
      expect(hasManifest()).toBe(false);
    }
    expect(renders).toBe(0);
  });

  it('arrives before the first state: the readers have it, and the re-render it asks for is harmless', () => {
    let renders = 0;
    onVisualsEvent(wire(), () => { renders++; });
    expect(manifestEntries().map(e => e.id)).toEqual(['net', 'feed_sea']);
    expect(manifestEntry('feed_sea')).toMatchObject({ kind: 'action', slot: 'hex', spotKey: 'hexId' });
    expect(overlayKind('flood')?.label).toBe('Flooded');
    expect(hasManifest()).toBe(true);
    // main.ts's callback is `if (state) renderAll()`, so with no state yet this does nothing.
    expect(renders).toBe(1);
  });

  it('arrives after the first state: readers were empty, then have it, and one re-render is asked for', () => {
    let renders = 0;
    const seenAtRender: string[][] = [];
    const rerender = () => { renders++; seenAtRender.push(manifestEntries().map(e => e.id)); };
    // The first gameState has been drawn already: nothing in the manifest yet.
    expect(manifestEntries()).toHaveLength(0);
    onVisualsEvent(wire(), rerender);
    expect(renders).toBe(1);
    // The re-render sees the new manifest, so the generated controls appear in it.
    expect(seenAtRender).toEqual([['net', 'feed_sea']]);
  });

  it('a resend of the same manifest costs no re-render; a different one does', () => {
    let renders = 0;
    const rerender = () => { renders++; };
    onVisualsEvent(wire(), rerender);
    const rev = manifestRevision();
    onVisualsEvent(wire(), rerender);
    expect(renders).toBe(1);
    expect(manifestRevision()).toBe(rev);
    onVisualsEvent(wire([NET]), rerender);
    expect(renders).toBe(2);
    expect(manifestRevision()).toBe(rev + 1);
    expect(manifestEntries().map(e => e.id)).toEqual(['net']);
  });

  it('listeners hear every change once, can be removed, and one that throws does not stop the others', () => {
    const calls: string[] = [];
    const off = listen(() => { calls.push('a'); });
    listen(() => { throw new Error('boom'); });
    listen(() => { calls.push('c'); });
    const quiet = console.error;
    console.error = () => undefined;
    try {
      setManifest(wire().manifest);
      expect(calls).toEqual(['a', 'c']);
      off();
      setManifest(wire([NET]).manifest);
      expect(calls).toEqual(['a', 'c', 'c']);
    } finally {
      console.error = quiet;
    }
  });

  it('reset (a disconnect) goes back to the empty manifest and tells the listeners', () => {
    setManifest(wire().manifest);
    let n = 0;
    listen(() => { n++; });
    resetManifest();
    expect(getManifest()).toEqual(emptyManifest());
    expect(hasManifest()).toBe(false);
    expect(n).toBe(1);
    resetManifest();
    expect(n).toBe(1);
  });

  it('junk never throws and gives the empty manifest', () => {
    setManifest(wire().manifest);
    for (const junk of [undefined, null, 'text', 7, true, [], {}, { version: 2, pieces: [NET], overlays: [] }, { version: 1, pieces: 'no', overlays: 5 }]) {
      expect(() => setManifest(junk)).not.toThrow();
      expect(getManifest()).toEqual(emptyManifest());
      setManifest(wire().manifest);
    }
    expect(() => onVisualsEvent(undefined, () => undefined)).not.toThrow();
    expect(() => onVisualsEvent({ manifest: null }, () => undefined)).not.toThrow();
    expect(() => onVisualsEvent('x', () => undefined)).not.toThrow();
  });

  it('drops a malformed entry and keeps the good ones', () => {
    const bad = [
      null,
      { ...NET, id: '' },
      { ...NET, id: 'x1', kind: 'gadget' },
      { ...NET, id: 'x2', slot: 'sky' },
      { ...NET, id: 'x3', button: { label: 'Net' } },
      { ...NET, id: 'x4', hints: { noSpots: 'x' } }
    ];
    setManifest(wire([...bad, NET], [{ ...FLOOD, pattern: undefined }, { ...FLOOD, id: 'f2', tint: { light: 'x' } }, FLOOD]).manifest);
    expect(manifestEntries().map(e => e.id)).toEqual(['net']);
    expect(getManifest().overlays.map(o => o.id)).toEqual(['flood']);
  });

  it('keeps its own copy: changing the object that was sent changes nothing here', () => {
    const payload = wire();
    setManifest(payload.manifest);
    payload.manifest.pieces[0].button.label = 'changed';
    expect(manifestEntry('net')?.button.label).toBe('Net');
  });
});
