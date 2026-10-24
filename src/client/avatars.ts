// MODULE: player avatars (flat pictogram faces keyed by the shared avatar id, falls back to the name initial) | USED BY: render/*, actions.ts
import { esc, initial } from './util';

// The ids are the avatar strings the server hands out (shared/palette.ts AVATARS). Keep the two lists in step.
export const AVATAR_CHOICES: string[] = ['🦊', '🐼', '🦁', '🐸', '🐯', '🐙', '🦄', '🦅'];

const C = '#fff7e6';   // cream glyph
const S = '#f3cf9a';   // soft shade
const I = '#2a2320';   // ink

const GLYPHS: Record<string, string> = {
  '🦊': `<path d="M4 5l8 6h8l8-6-1 14c-3 5-8 9-11 9S8 24 5 19z" fill="${C}"/>
    <path d="M10.5 21h11L16 28z" fill="${S}"/>
    <circle cx="11.5" cy="17" r="1.7" fill="${I}"/><circle cx="20.5" cy="17" r="1.7" fill="${I}"/>
    <circle cx="16" cy="27" r="1.5" fill="${I}"/>`,
  '🐼': `<circle cx="7.5" cy="8" r="4" fill="${I}"/><circle cx="24.5" cy="8" r="4" fill="${I}"/>
    <circle cx="16" cy="17" r="11" fill="${C}"/>
    <ellipse cx="11.3" cy="16" rx="3" ry="4" fill="${I}" transform="rotate(-20 11.3 16)"/>
    <ellipse cx="20.7" cy="16" rx="3" ry="4" fill="${I}" transform="rotate(20 20.7 16)"/>
    <circle cx="11.8" cy="15.6" r="1.1" fill="${C}"/><circle cx="20.2" cy="15.6" r="1.1" fill="${C}"/>
    <ellipse cx="16" cy="21.5" rx="2.2" ry="1.5" fill="${I}"/>`,
  '🦁': `<circle cx="16" cy="16" r="14" fill="${S}"/>
    <circle cx="16" cy="17" r="9" fill="${C}"/>
    <circle cx="12.5" cy="15.5" r="1.5" fill="${I}"/><circle cx="19.5" cy="15.5" r="1.5" fill="${I}"/>
    <path d="M13.5 20h5l-2.5 3z" fill="${I}"/>`,
  '🐸': `<ellipse cx="16" cy="20" rx="13" ry="8.5" fill="${C}"/>
    <circle cx="9.5" cy="11.5" r="5" fill="${C}"/><circle cx="22.5" cy="11.5" r="5" fill="${C}"/>
    <circle cx="9.5" cy="11.5" r="2.2" fill="${I}"/><circle cx="22.5" cy="11.5" r="2.2" fill="${I}"/>
    <path d="M8 22q8 5 16 0" stroke="${I}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  '🐯': `<circle cx="7.5" cy="8" r="3.8" fill="${C}"/><circle cx="24.5" cy="8" r="3.8" fill="${C}"/>
    <circle cx="16" cy="17" r="11.5" fill="${C}"/>
    <path d="M16 7v5M11 8.5l1.5 4M21 8.5l-1.5 4" stroke="${I}" stroke-width="2" stroke-linecap="round" fill="none"/>
    <circle cx="11.5" cy="17.5" r="1.6" fill="${I}"/><circle cx="20.5" cy="17.5" r="1.6" fill="${I}"/>
    <ellipse cx="16" cy="22.5" rx="4" ry="3" fill="${S}"/>
    <path d="M14.5 21.5h3l-1.5 2z" fill="${I}"/>`,
  '🐙': `<circle cx="16" cy="14" r="10" fill="${C}"/><rect x="6" y="14" width="20" height="9" fill="${C}"/>
    <circle cx="8.6" cy="24" r="2.6" fill="${C}"/><circle cx="13.5" cy="25.2" r="2.6" fill="${C}"/>
    <circle cx="18.5" cy="25.2" r="2.6" fill="${C}"/><circle cx="23.4" cy="24" r="2.6" fill="${C}"/>
    <circle cx="12" cy="14" r="1.8" fill="${I}"/><circle cx="20" cy="14" r="1.8" fill="${I}"/>`,
  '🦄': `<path d="M16 1.5l3 9h-6z" fill="${S}"/>
    <path d="M7.5 11l-3.5-5 7 2z" fill="${C}"/>
    <ellipse cx="16" cy="19" rx="9.5" ry="10" fill="${C}"/>
    <circle cx="12" cy="18" r="1.6" fill="${I}"/><circle cx="20" cy="18" r="1.6" fill="${I}"/>
    <ellipse cx="16" cy="25" rx="4.2" ry="2.6" fill="${S}"/>
    <circle cx="14.7" cy="25" r="0.8" fill="${I}"/><circle cx="17.3" cy="25" r="0.8" fill="${I}"/>`,
  '🦅': `<path d="M4 8c6 0 9 3 12 3s6-3 12-3c-1 10-5 18-12 20C9 26 5 18 4 8z" fill="${C}"/>
    <path d="M12.5 17h7L16 26z" fill="#f5b942"/>
    <circle cx="11.5" cy="14.5" r="1.7" fill="${I}"/><circle cx="20.5" cy="14.5" r="1.7" fill="${I}"/>
    <path d="M9 12l5 2M23 12l-5 2" stroke="${I}" stroke-width="1.6" stroke-linecap="round" fill="none"/>`,
  '🤖': `<rect x="6" y="9" width="20" height="16" rx="4" fill="${C}"/>
    <path d="M16 9V5" stroke="${C}" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="4" r="2" fill="${C}"/>
    <circle cx="11.5" cy="16" r="2.2" fill="${I}"/><circle cx="20.5" cy="16" r="2.2" fill="${I}"/>
    <path d="M11 21h10" stroke="${I}" stroke-width="1.8" stroke-linecap="round"/>`
};

/** Markup that goes inside a coloured `.avatar` circle: the pictogram, or the name's first letter if the id is unknown. */
export function avatarFace(avatar: string | undefined, name: string): string {
  const glyph = avatar ? GLYPHS[avatar] : undefined;
  if (!glyph) return initial(name);
  return `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" title="${esc(name)}">${glyph}</svg>`;
}
