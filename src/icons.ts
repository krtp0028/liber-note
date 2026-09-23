const PATHS: Record<string, string[]> = {
  "add-node": [
    "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z",
    "M14 3v5h5",
    "M12 12v6",
    "M9 15h6",
  ],
  "add-child": ["M4 4v7a4 4 0 0 0 4 4h12", "M16 11l4 4-4 4"],
  "new-folder": [
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    "M12 11v6",
    "M9 14h6",
  ],
  save: [
    "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z",
    "M17 21v-8H7v8",
    "M7 3v5h8",
  ],
  search: ["M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z", "M21 21l-4.3-4.3"],
  preview: [
    "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  ],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M12 1v3",
    "M12 20v3",
    "M4.2 4.2l2.1 2.1",
    "M17.7 17.7l2.1 2.1",
    "M1 12h3",
    "M20 12h3",
    "M4.2 19.8l2.1-2.1",
    "M17.7 6.3l2.1-2.1",
  ],
  undo: ["M3 7v6h6", "M3 13a9 9 0 1 0 2.6-6.4L3 9"],
  trash: [
    "M3 6h18",
    "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
    "M10 11v6",
    "M14 11v6",
    "M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  ],
  file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5"],
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  "go-to": ["M5 3l14 9-14 9z"],
  check: ["M5 13l4 4L19 7"],
  node: ["M12 3v18", "M5 8h14"],
};

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 14): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("icon");
  for (const d of PATHS[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
