import type { Metadata } from "next";
import "./globals.css";
import "./identity.css";
import "./allocation.css";
import "./rounds.css";
import "./controls.css";
import "./pricing.css";
import "./dark.css";
import "./trust.css";
import "./openaccounts.css";
import "./cash.css";
import "./accountdetails.css";
import "./members.css";
import "./controls-extra.css";

export const metadata: Metadata = {
  title: "Vereinskasse · SV Beispielhausen",
  description: "Die einfache, tabletfreundliche Kasse für den Verein.",
  openGraph: {
    title: "Vereinskasse",
    description: "Einfach verkaufen. Gemeinsam feiern.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
