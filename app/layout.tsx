import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Block Coding Puzzles',
  description: 'Animated block-based programming adventures with telemetry-backed learning insights.'
};

export default function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden' }}>
          <div className="hero-mist" aria-hidden />
          {children}
        </div>
      </body>
    </html>
  );
}
