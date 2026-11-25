'use client';

import { DesktopLanding } from './landing/DesktopLanding';
import { MobileLanding } from './landing/MobileLanding';

/**
 * Dual-experience Kronner landing page:
 * - DesktopLanding (>= 960px): wide executive layout, static real dashboard hero + interactive 4-module showcase
 * - MobileLanding (< 960px): thumb-first vertical layout, compact dashboard snapshot + pill-switched live demos + sticky CTA
 */
export default function LandingExperience() {
  return (
    <div className="kl2-root">
      <DesktopLanding />
      <MobileLanding />
    </div>
  );
}
