const headers={"cache-control":"no-store","content-type":"text/plain; charset=utf-8"};

// Ausschließlich als lokale Startzeit für den RFID-Leser gedacht. Die
// anschließende TLS-Verbindung prüft weiterhin das ClubIQ-CA-Zertifikat.
export async function GET(){
  return new Response(String(Math.floor(Date.now()/1000)),{headers});
}
