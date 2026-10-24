// MODULE: small client helpers (HTML escaping, initials) | USED BY: render/*, icons.ts

export function esc(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Avatars are simple colored circles with the first letter of the name (no emoji in the chrome).
export function initial(name: string): string {
  const first = Array.from(String(name || '?').trim())[0] || '?';
  return esc(first.toUpperCase());
}
