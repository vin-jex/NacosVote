import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import ThemeToggle from './components/theme-toggle';

export const metadata: Metadata = {
  applicationName: 'NacosVote',
  title: {
    default: 'NacosVote',
    template: '%s | NacosVote',
  },
  description: 'NACOS UNIZIK digital election platform.',
  openGraph: {
    title: 'NacosVote',
    description: 'NACOS UNIZIK digital election platform.',
    siteName: 'NacosVote',
    type: 'website',
  },
  robots: { index: false, follow: false },
};

// Resolve the theme before first paint to avoid a light/dark flash.
const themeScript = `(function(){try{var t=localStorage.getItem('nacosvote-theme')||'system';var m=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',t==='dark'||(t==='system'&&m));}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
          <div className="no-print mb-4 flex justify-end">
            <ThemeToggle />
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}
