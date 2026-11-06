import type { Metadata } from 'next';
import { Be_Vietnam_Pro, Saira_Condensed } from 'next/font/google';
import './globals.css';

const body = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
});

const display = Saira_Condensed({
  subsets: ['vietnamese', 'latin'],
  weight: ['800'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Đặt áo in theo thiết kế',
  description: 'Thiết kế áo in với AI hoặc designer thật.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${body.variable} ${display.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
