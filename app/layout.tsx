import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk } from 'next/font/google';
import './globals.css';

const hankenGrotesk = Hanken_Grotesk({
  variable: '--font-hanken-grotesk',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'GenUI for Archives',
  description: 'GenUI for Archives',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${hankenGrotesk.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
