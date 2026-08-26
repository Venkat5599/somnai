/**
 * PRISM iconography — drawn for this instrument, not pulled from a pack.
 *
 * House rules, held across every mark:
 *   - 24 unit grid, 1.25 stroke, BUTT caps and MITER joins. No round caps.
 *     The instrument is machined, so every terminus is a cut edge.
 *   - One 45 degree chamfer per mark, echoing the prism facet in the logo.
 *   - No enclosing container. The glyph sits bare on the surface.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* --- navigation ------------------------------------------------- */

export const IconTrade = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 20V8l3-3h4" />
    <path d="M3 20h18" />
    <path d="M7 20v-7M11.5 20v-11M16 20v-5M20.5 20V6" />
  </Glyph>
);

export const IconMarkets = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 17.5 8.5 12l3.5 3.5L17 9l4-4" />
    <path d="M21 9V5h-4" />
    <path d="M3 21h18" />
  </Glyph>
);

export const IconStructures = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 3 21 8l-9 5-9-5 9-5Z" />
    <path d="M3 12.5 12 17.5l9-5" />
    <path d="M3 16.5 12 21.5l9-5" />
  </Glyph>
);

export const IconAnalytics = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 21V6l3-3" />
    <path d="M3 21h18" />
    <path d="M6.5 17c2-6.5 4.2-9.8 6.6-9.8 2.5 0 4.7 3.3 6.6 9.8" />
    <path d="M13.1 7.2V3.5" />
  </Glyph>
);

export const IconPositions = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 7.5 6 4.5h15V19H3V7.5Z" />
    <path d="M3 10.5h18" />
    <path d="M9 10.5V19" />
  </Glyph>
);

export const IconActivity = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2 12h4l2.5-6 4 13 3-9 2 2h4.5" />
    <path d="M20 4.5 22 6.5" />
  </Glyph>
);

export const IconSettlement = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 8.5 6.5 5H21v14H3V8.5Z" />
    <path d="M8 13.5l2.75 2.75L17 10" />
  </Glyph>
);

export const IconRoll = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 12a8 8 0 0 1 13.7-5.6L21 9" />
    <path d="M21 4v5h-5" />
    <path d="M20 12a8 8 0 0 1-13.7 5.6L3 15" />
    <path d="M3 20v-5h5" />
  </Glyph>
);

export const IconAgents = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6 8.5 8.5 6h9.5v12H6V8.5Z" />
    <path d="M9.5 11h1.5M14 11h1.5" />
    <path d="M9.5 15h5" />
    <path d="M12 6V3" />
  </Glyph>
);

export const IconDocs = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M5 3h9l5 5v13H5V3Z" />
    <path d="M14 3v5h5" />
    <path d="M8.5 12.5h7M8.5 16h4.5" />
  </Glyph>
);

export const IconSettings = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 7h6M14 7h6" />
    <path d="M4 17h3M11 17h9" />
    <path d="M10.5 4.5h3.5V9.5H10.5z" />
    <path d="M7.5 14.5h3.5V19.5H7.5z" />
  </Glyph>
);

/* --- controls --------------------------------------------------- */

export const IconArrowRight = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 12h15" />
    <path d="M14 7l5 5-5 5" />
  </Glyph>
);

/** The house arrow points up and out. Never the stock horizontal chevron. */
export const IconArrowOut = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6 18 18 6" />
    <path d="M9.5 6H18v8.5" />
  </Glyph>
);

export const IconChevronDown = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M5 9l7 6 7-6" />
  </Glyph>
);

export const IconChevronLeft = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M15 5l-6 7 6 7" />
  </Glyph>
);

export const IconChevronRight = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9 5l6 7-6 7" />
  </Glyph>
);

export const IconSearch = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" />
    <path d="M15.8 15.8 20.5 20.5" />
  </Glyph>
);

export const IconFilter = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 6h18l-7 8v6l-4-2.5V14L3 6Z" />
  </Glyph>
);

export const IconBell = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6 10a6 6 0 0 1 12 0v5l2 3H4l2-3v-5Z" />
    <path d="M10 21h4" />
  </Glyph>
);

export const IconBolt = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M13.5 2 5 13.5h6L10.5 22 19 10.5h-6L13.5 2Z" />
  </Glyph>
);

export const IconUndo = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 9h11a5 5 0 0 1 0 10h-6" />
    <path d="M8 4.5 3.5 9 8 13.5" />
  </Glyph>
);

export const IconRedo = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M20 9H9a5 5 0 0 0 0 10h6" />
    <path d="M16 4.5 20.5 9 16 13.5" />
  </Glyph>
);

export const IconCopy = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M8 4.5 10 2.5h8V15h-10V4.5Z" />
    <path d="M6 8v13.5h9" />
  </Glyph>
);

export const IconDownload = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 3v11" />
    <path d="M7.5 10 12 14.5 16.5 10" />
    <path d="M4 18.5V21h16v-2.5" />
  </Glyph>
);

export const IconCheck = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 12.5 9.5 18 20 6" />
  </Glyph>
);

export const IconCross = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" />
  </Glyph>
);

export const IconClock = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z" />
    <path d="M12 7v5.4l3.6 2.2" />
  </Glyph>
);

export const IconLock = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M5 11h14v10H5V11Z" />
    <path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11" />
  </Glyph>
);

export const IconInfo = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z" />
    <path d="M12 11v6" />
    <path d="M12 7.4v.9" />
  </Glyph>
);

export const IconLayers = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 9.5 12 5l8 4.5-8 4.5-8-4.5Z" />
    <path d="M4 14.5 12 19l8-4.5" />
  </Glyph>
);

export const IconMenu = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 6.5h18M3 12h18M3 17.5h13" />
  </Glyph>
);
