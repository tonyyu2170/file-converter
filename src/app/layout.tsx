import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "file-converter",
  description: "Local, private file conversion. Files never leave your device.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
