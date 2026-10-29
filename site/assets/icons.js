// Inline SVG icons: 24×24 grid, 1.75 stroke, currentColor.

const paths = {
  logo: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',

  // categories
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  arrows: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  inspect: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4M8.5 11l1.8 1.8L13.8 9.2"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/>',

  // tools
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zM20.5 14v.01M14 20.5h.01M17 20.5h3.5V17"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 9.5h4M7 12.5h10M7 15.5h6"/>',
  hash: '<path d="M5 9h14M5 15h14M10.5 3.5 8.5 20.5M15.5 3.5l-2 17"/>',
  binary: '<path d="M6 4v6M4.5 4H6M4.5 10h3M15.5 4a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0V6a2 2 0 0 1 2-2zM6.5 14a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0v-2a2 2 0 0 1 2-2zM17 14v6M15.5 14H17M15.5 20h3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  case: '<path d="M2.5 18 7 6l4.5 12M4.2 13.8h5.6"/><circle cx="17.5" cy="15" r="3"/><path d="M20.5 12v6"/>',
  swap: '<path d="M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  braces: '<path d="M8 3.5H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2.5 2 2 0 0 1 2 2.5v4a2 2 0 0 0 2 2h1M16 3.5h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2.5 2 2 0 0 0-2 2.5v4a2 2 0 0 1-2 2h-1"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M16.5 6.5l3 3M14.5 8.5l2 2"/>',
  regex: '<path d="M17 3v9M13.1 5.25l7.8 4.5M13.1 9.75l7.8-4.5"/><rect x="3" y="15" width="6" height="6" rx="1"/>',
  wallet: '<path d="M18 9V6.5A1.5 1.5 0 0 0 16.5 5H5a2 2 0 0 0 0 4"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1H5"/><circle cx="16" cy="14.5" r="1.25"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',

  // QR content types
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.2" r="1" fill="currentColor" stroke="none"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  message: '<path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l.9-4.6A8.5 8.5 0 1 1 20.5 12z"/>',
  phone: '<path d="M5 3.5h3.5l1.8 4.6-2.3 1.6a11 11 0 0 0 6.3 6.3l1.6-2.3 4.6 1.8V19a1.5 1.5 0 0 1-1.6 1.5C10.4 20 4 13.6 3.5 5.1A1.5 1.5 0 0 1 5 3.5z"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  text: '<path d="M5 6h14M5 10h14M5 14h10M5 18h7"/>',
  image: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="m20.5 16-5-5-9 9"/>',

  // ui
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16v4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10z"/><path d="M14 3.5v5h5"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.7M12 16.5v.01"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 16v.01"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.3"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5h6V7"/>',
};

export function icon(name, className = '') {
  const body = paths[name];
  if (!body) return '';
  return `<svg class="i${className ? ' ' + className : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
