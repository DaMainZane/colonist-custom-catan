export function getBoardIconSvg(type: string, x: number, y: number, scale = 1): string {
  const gOpen = `<g transform="translate(${x}, ${y}) scale(${scale})">`;
  const gClose = `</g>`;
  switch (type) {
    case 'wood':
      return `${gOpen}
        <rect x="-3" y="6" width="6" height="8" fill="#5d4037"/>
        <polygon points="0,-18 -14,-2 14,-2" fill="#0a4d0e" stroke="#fff" stroke-width="1.2"/>
        <polygon points="0,-10 -16,7 16,7" fill="#0d6312" stroke="#fff" stroke-width="1.2"/>
      ${gClose}`;
    case 'brick':
      return `${gOpen}
        <rect x="-15" y="-12" width="14" height="8" rx="1.5" fill="#8f2406" stroke="#fff" stroke-width="1.2"/>
        <rect x="1" y="-12" width="14" height="8" rx="1.5" fill="#a82b08" stroke="#fff" stroke-width="1.2"/>
        <rect x="-8" y="-2" width="16" height="8" rx="1.5" fill="#a82b08" stroke="#fff" stroke-width="1.2"/>
      ${gClose}`;
    case 'sheep':
      return `${gOpen}
        <rect x="-9" y="2" width="3" height="8" fill="#333"/>
        <rect x="6" y="2" width="3" height="8" fill="#333"/>
        <circle cx="-6" cy="-4" r="8" fill="#fff"/>
        <circle cx="4" cy="-5" r="9" fill="#fff"/>
        <circle cx="0" cy="-1" r="8" fill="#fff"/>
        <circle cx="-11" cy="-5" r="5" fill="#222"/>
      ${gClose}`;
    case 'wheat':
      return `${gOpen}
        <path d="M-6,10 L6,-12 M0,10 L0,-15 M6,10 L-6,-12" stroke="#875c00" stroke-width="2.5" stroke-linecap="round"/>
        <ellipse cx="-5" cy="-6" rx="3.5" ry="6" transform="rotate(-25 -5 -6)" fill="#ffe066" stroke="#875c00" stroke-width="1.2"/>
        <ellipse cx="0" cy="-9" rx="3.5" ry="6" fill="#ffe066" stroke="#875c00" stroke-width="1.2"/>
        <ellipse cx="5" cy="-6" rx="3.5" ry="6" transform="rotate(25 5 -6)" fill="#ffe066" stroke="#875c00" stroke-width="1.2"/>
      ${gClose}`;
    case 'ore':
      return `${gOpen}
        <polygon points="-15,8 -8,-8 2,8" fill="#546e7a" stroke="#fff" stroke-width="1.3"/>
        <polygon points="0,9 9,-10 17,9" fill="#455a64" stroke="#fff" stroke-width="1.3"/>
        <polygon points="-8,10 1,-13 10,10" fill="#78909c" stroke="#fff" stroke-width="1.3"/>
      ${gClose}`;
    case 'gold':
      return `${gOpen}
        <polygon points="-16,6 -11,-4 3,-4 8,6" fill="#ffb300" stroke="#fff" stroke-width="1.4"/>
        <polygon points="-4,8 1,-2 15,-2 20,8" fill="#ffa000" stroke="#fff" stroke-width="1.4"/>
        <circle cx="0" cy="-9" r="9" fill="#ffee58" stroke="#b26a00" stroke-width="2"/>
        <text x="0" y="-5" text-anchor="middle" font-size="11" font-weight="900" fill="#b26a00">$</text>
      ${gClose}`;
    case 'desert':
      return `${gOpen}
        <path d="M0,14 L0,-12 M0,2 L-9,2 L-9,-6 M0,-2 L9,-2 L9,-9" stroke="#2e7d32" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      ${gClose}`;
    default:
      return '';
  }
}

export function getMiniSvg(type: string): string {
  return `<svg width="24" height="24" viewBox="-20 -20 40 34">${getBoardIconSvg(type, 0, 2, 0.95)}</svg>`;
}
