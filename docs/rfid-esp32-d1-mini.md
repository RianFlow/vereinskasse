# ESP32-D1-mini-RFID-Leser anbinden

Der ClubIQ-Leser wird einmalig per Bluetooth eingerichtet und arbeitet danach
eigenständig im festen 2,4-GHz-Kassen-WLAN des Raspberry Pi.

Die UID ist nur die Kartenkennung. Mitglied, Rechte, Rechnungen und Kontostände
liegen ausschließlich in PostgreSQL. Jeder Leser besitzt ein eigenes geheimes
Gerätetoken; TLS wird gegen das lokale ClubIQ-Root-Zertifikat geprüft.

## Sichere Zustandsfolge

`Bluetooth-Einrichtung → Einstellungen gespeichert → Neustart → WLAN → TLS → Raspberry bestätigt Leser`

Die App meldet die Einrichtung erst erfolgreich, wenn derselbe ESP32 nach dem
Neustart mit einem neueren Zeitstempel am Raspberry eingetroffen ist. Eine alte
Registrierung oder eine bloße Bluetooth-Verbindung reicht nicht als Erfolg.

Bei einer späteren WLAN-Änderung muss am Gerät einmal eine RFID-Karte aufgelegt
werden. Ist nur das Kassen-WLAN 90 Sekunden lang nicht erreichbar, öffnet der
Leser Bluetooth für fünf Minuten. Ohne neue Einstellungen startet er danach
automatisch neu und versucht wieder das gespeicherte WLAN. Ein bloßer Neustart
des Raspberry oder der Anwendung schaltet den Leser nicht in Bluetooth um.
