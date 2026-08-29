"use client";

/**
 * HERO FIELD — the atmosphere behind the fold.
 *
 * ThreeUI's `ConstellationField` (MIT, @designcodeio/threeui) in its
 * `connectivity-graph` variant: beams dispersing from a single origin into
 * many. That is PRISM's mechanism drawn as light — one stated view refracted
 * into a strip of legs — so the field restates the Refraction artifact
 * instead of decorating around it.
 *
 * WHY THIS VARIANT, after measuring the alternatives:
 *   - Predictive Arc / Data Pixel Arc accept `hue` and `saturation` but never
 *     apply them; their RGB is hardcoded violet. Unrecolourable.
 *   - Ribbon Field renders a regular halftone dot lattice in blue-violet —
 *     a dot grid behind the hero, and invisible once dimmed enough to be safe.
 *   - Stream Convergence is loud red/blue neon; red is PRISM's `--color-down`,
 *     so it would misread semantically behind a trading hero.
 *   - connectivity-graph is directional line work that recolours cleanly to
 *     the cyan accent, which is the register the rest of the terminal is in.
 *
 * The tuning is deliberate: hue is rotated NEGATIVE (-26deg), pulling the
 * library's ~215deg blue toward PRISM's ~184deg cyan. A positive rotation
 * takes it the other way, into indigo and violet.
 *
 * Guarantees this file exists to hold:
 *
 * 1. IT IS NEVER CONTENT. Mounted only on the client, after paint, inside an
 *    error boundary. Delete it and the hero still reads in full — the
 *    headline, the actions and the live ladder never depend on it.
 * 2. NO SEAM. The library paints its own dark ground; `screen` blending drops
 *    that to nothing over PRISM's #0c0b0a so no band appears at either edge,
 *    and a long, finely-stepped mask eases the field out well before the
 *    section boundary.
 * 3. IT COSTS THE COPY NOTHING. The mask is anchored low and right, holding
 *    the field clear of the headline and the paragraph column.
 * 4. IT IS NOT IN THE TAB ORDER. The library renders a sandboxed `srcdoc`
 *    iframe, which browsers make focusable by default — a keyboard user would
 *    otherwise hit a focus stop on invisible decoration. See the effect below.
 */

import {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
// The subpath export, deliberately NOT the documented barrel
// (`from "@designcodeio/threeui"`). The barrel re-exports all 299 components,
// which drags in Gallery.js, whose multi-megabyte inline base64 data URLs make
// webpack's Asset Modules plugin fail the build outright:
//   "Invalid generator object ... unknown property 'filename'"
import { ConstellationField } from "@designcodeio/threeui/components/ConstellationField";

/** Decoration must never be able to unmount the hero it sits behind. */
class FieldBoundary extends Component<{ children: ReactNode }, { dead: boolean }> {
  state = { dead: false };

  static getDerivedStateFromError() {
    return { dead: true };
  }

  render() {
    return this.state.dead ? null : this.props.children;
  }
}

/**
 * Two mask layers, intersected.
 *
 * SHAPE — a radial centred near the prism artifact on the right, so the light
 * reads as dispersing from the diagram rather than glowing from a corner, and
 * so it stays off the headline and the paragraph column on the left.
 *
 * ENVELOPE — a vertical fade at BOTH ends, because this section is bounded
 * top and bottom by hard structural lines and a lit beam meeting either one
 * is a beam cut mid-stroke.
 *   - Bottom: the live ladder strip is an opaque instrument band starting at
 *     ~90% of this section's height. The envelope reaches full transparency
 *     by 88%, so beams resolve into the page just above it rather than being
 *     guillotined by it. Keep this below the strip's start if either moves.
 *   - Top: the sticky nav's bottom border closes the section. The envelope
 *     ramps up from 0 so beams emerge out of that edge instead of being
 *     sliced flat along it.
 */
const MASK_SHAPE =
  "radial-gradient(104% 88% at 72% 56%, #000 0%, rgba(0,0,0,0.97) 13%, " +
  "rgba(0,0,0,0.9) 24%, rgba(0,0,0,0.79) 34%, rgba(0,0,0,0.65) 44%, " +
  "rgba(0,0,0,0.5) 54%, rgba(0,0,0,0.35) 64%, rgba(0,0,0,0.21) 74%, " +
  "rgba(0,0,0,0.1) 84%, rgba(0,0,0,0.03) 92%, transparent 100%)";

const MASK_ENVELOPE =
  "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.03) 2%, " +
  "rgba(0,0,0,0.12) 4.5%, rgba(0,0,0,0.32) 7.5%, rgba(0,0,0,0.6) 11%, " +
  "rgba(0,0,0,0.85) 15%, #000 20%, #000 58%, rgba(0,0,0,0.86) 68%, " +
  "rgba(0,0,0,0.66) 75%, rgba(0,0,0,0.44) 80%, rgba(0,0,0,0.25) 84%, " +
  "rgba(0,0,0,0.1) 86.5%, rgba(0,0,0,0.02) 87.5%, transparent 88%)";

const MASK = `${MASK_SHAPE}, ${MASK_ENVELOPE}`;

export function HeroField() {
  const [live, setLive] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Continuous ambient motion is precisely what reduced-motion asks us to
    // drop, and a flow field has no meaningful still frame worth showing, so
    // the honest answer is not to run it at all.
    const quiet = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Desktop only, and gated before mount rather than hidden with CSS.
    //
    // Below this width the hero collapses to a single column and the copy
    // spans the full measure, so a field anchored to the right would sit
    // underneath the text instead of beside it. It is also the wrong trade on
    // phones: this renders a sandboxed iframe running its own animation loop,
    // which is real work on the weakest devices for pure decoration. The
    // Refraction diagram still carries the signature there.
    const wide = window.matchMedia("(min-width: 768px)");

    const sync = () => setLive(!quiet.matches && wide.matches);
    sync();

    quiet.addEventListener("change", sync);
    wide.addEventListener("change", sync);
    return () => {
      quiet.removeEventListener("change", sync);
      wide.removeEventListener("change", sync);
    };
  }, []);

  // The library's iframe is focusable by default and carries a title, so it
  // lands in the tab order as a stop on decoration. aria-hidden alone does not
  // remove focusability — the attribute has to come off the element itself.
  useEffect(() => {
    if (!live) return;
    const host = hostRef.current;
    if (!host) return;

    const deny = () => {
      const frame = host.querySelector("iframe");
      if (frame) {
        frame.setAttribute("tabindex", "-1");
        frame.setAttribute("aria-hidden", "true");
        frame.removeAttribute("title");
      }
      return !!frame;
    };

    if (deny()) return;
    // The iframe is created inside the library's own effect, which may not
    // have run yet on this tick.
    const obs = new MutationObserver(() => {
      if (deny()) obs.disconnect();
    });
    obs.observe(host, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [live]);

  if (!live) return null;

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      style={{
        // Drops the library's own dark ground so PRISM's #0c0b0a carries
        // straight through and the fold gains no horizontal band.
        mixBlendMode: "screen",
        maskImage: MASK,
        WebkitMaskImage: MASK,
        // Both layers must apply, not stack: the shape decides where the field
        // lives, the floor decides where it must already be gone.
        maskComposite: "intersect",
        WebkitMaskComposite: "source-in",
      }}
    >
      <FieldBoundary>
        <ConstellationField
          variant="connectivity-graph"
          mode="dark"
          // Slow enough to read as drift rather than activity.
          speed={0.32}
          density={0.5}
          strokeWidth={1}
          // Negative rotation: the library's blue toward PRISM's cyan.
          hue={-26}
          saturation={0.62}
          brightness={0.62}
          opacity={0.52}
        />
      </FieldBoundary>
    </div>
  );
}
