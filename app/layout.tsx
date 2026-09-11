import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'RepoPilot — Decoupled Code Generation & Audit Engine',
  description: 'Decoupled code generation and audit workflow tool with Stage 1 Jules dispatch and Stage 2 Gemini PR evaluation.',
  openGraph: {
    title: 'RepoPilot — Decoupled Code Generation & Audit Engine',
    description: 'Decoupled code generation and audit workflow tool with Stage 1 Jules dispatch and Stage 2 Gemini PR evaluation.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RepoPilot — Decoupled Code Generation & Audit Engine',
    description: 'Decoupled code generation and audit workflow tool with Stage 1 Jules dispatch and Stage 2 Gemini PR evaluation.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
