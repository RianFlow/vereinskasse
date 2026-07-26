#pragma once

// Diese Datei als include/secrets.h kopieren und dort die Werte eintragen.
// secrets.h wird von Git ignoriert.

// Vereins-WLAN, mit dem auch Tablet und Kassenserver erreichbar sind.
constexpr char CLUB_WIFI_SSID[] = "";
constexpr char CLUB_WIFI_PASSWORD[] = "";

// In der Vereinskasse unter Admin > Sicherheit > RFID-Leser anlegen.
// Nur den dort einmalig angezeigten Geräte-Token hier eintragen.
constexpr char RFID_DEVICE_TOKEN[] = "";

// Ziel der Vereinskasse. Für eine andere Installation entsprechend ändern.
constexpr char VEREINSKASSE_API_URL[] =
    "https://vereinskasse-beispielhausen.floh510.chatgpt.site/api/rfid";

// Root-CA der aktuellen *.floh510.chatgpt.site-Zertifikatskette:
// GlobalSign ECC Root CA - R4, gültig bis 19.01.2038.
// Bei einem anderen Host oder einer geänderten Zertifikatskette ersetzen.
constexpr char VEREINSKASSE_ROOT_CA[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
MIIB3DCCAYOgAwIBAgINAgPlfvU/k/2lCSGypjAKBggqhkjOPQQDAjBQMSQwIgYDVQQLExtHbG9i
YWxTaWduIEVDQyBSb290IENBIC0gUjQxEzARBgNVBAoTCkdsb2JhbFNpZ24xEzARBgNVBAMTCkds
b2JhbFNpZ24wHhcNMTIxMTEzMDAwMDAwWhcNMzgwMTE5MDMxNDA3WjBQMSQwIgYDVQQLExtHbG9i
YWxTaWduIEVDQyBSb290IENBIC0gUjQxEzARBgNVBAoTCkdsb2JhbFNpZ24xEzARBgNVBAMTCkds
b2JhbFNpZ24wWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAS4xnnTj2wlDp8uORkcA6SumuU5BwkW
ymOxuYb4ilfBV85C+nOh92VC/x7BALJucw7/xyHlGKSq2XE/qNS5zowdo0IwQDAOBgNVHQ8BAf8E
BAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUVLB7rUW44kB/+wpu+74zyTyjhNUwCgYI
KoZIzj0EAwIDRwAwRAIgIk90crlgr/HmnKAWBVBfw147bmF0774BxL4YSFlhgjICICadVGNA3jdg
UM/I2O2dgq43mLyjj0xMqTQrbO/7lZsm
-----END CERTIFICATE-----
)PEM";
