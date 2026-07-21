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
import "./simple-flow.css";
import "./guests.css";
import "./guests-hierarchy.css";
import "./monthly.css";
import "./events.css";
import "./brand.css";

export const metadata: Metadata = {
  title: "Vereinskasse · SV Barver Darts",
  description: "Die einfache, tabletfreundliche Kasse für den SV Barver Darts.",
  openGraph: {
    title: "Vereinskasse · SV Barver Darts",
    description: "Vereinsabend, Veranstaltungen und Monatsabrechnungen für den SV Barver Darts.",
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
