'use client';

import Image from 'next/image';
import nacosLogo from '@/public/brand/nacos-logo-160.png';

/*
 * Institutional lockup for the NACOS UNIZIK chapter.
 *
 * The official NACOS logo lives at /public/brand/nacos-logo.png and is the
 * single authoritative brand asset (nacos-logo-160.png is a same-artwork
 * downscale for the header). It is never recolored, filtered, or recreated. In
 * dark mode it sits on a light plate so the artwork stays intact and legible
 * (see .logo-plate in globals.css).
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
  return (
    <header className="mb-6">
      <div className="mb-3 flex items-center gap-3">
        <span className="logo-plate">
          <Image
            src={nacosLogo}
            alt="NACOS"
            width={logoSize}
            height={logoSize}
            priority
            sizes="44px"
          />
        </span>
        <p className="kicker">NACOS · UNIZIK</p>
      </div>
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="mt-0.5 font-serif text-lg text-ink/80">{subtitle}</p>}
      {motto && <p className="meta mt-1 italic">Towards Advanced Computing</p>}
    </header>
  );
}
