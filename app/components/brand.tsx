'use client';

import { useState } from 'react';

/*
 * Institutional lockup for the NACOS UNIZIK chapter.
 *
 * The official NACOS logo lives at /public/brand/nacos-logo.png and is the
 * single authoritative brand asset. It is never recolored, filtered, or
 * recreated. In dark mode it sits on a light plate so the artwork stays intact
 * and legible (see .logo-plate in globals.css).
 */

export function Brand({
  title = 'NacosVote',
  subtitle,
  motto = false,
  logoSize = 44,
}: {
  title?: string;
  subtitle?: string;
  motto?: boolean;
  logoSize?: number;
}) {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <header className="mb-6">
      <div className="mb-3 flex items-center gap-3">
        {logoOk && (
          <span className="logo-plate">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/nacos-logo-160.png"
              alt="NACOS"
              width={logoSize}
              height={logoSize}
              className="block h-auto w-auto"
              style={{ width: logoSize, height: logoSize }}
              onError={() => setLogoOk(false)}
            />
          </span>
        )}
        <p className="kicker">NACOS · UNIZIK</p>
      </div>
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="mt-0.5 font-serif text-lg text-ink/80">{subtitle}</p>}
      {motto && <p className="meta mt-1 italic">Towards Advanced Computing</p>}
    </header>
  );
}
