import './globals.css';

export const metadata = {
  title: 'LampWorks • Midnight Moths Bridge',
  description: 'Bridge your Midnight Moths between Sonic and Base using LayerZero ONFT.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
