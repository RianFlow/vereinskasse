#!/usr/bin/env python3
"""Encrypt installation secrets in memory; never store a plaintext archive."""
import argparse
import datetime as dt
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile
import tempfile

MAX_FILE = 16 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
SECRETS = (
    'postgres_admin_password', 'postgres_app_password', 'initial_profile_pin',
    'restic_password', 'r2_access_key_id', 'r2_secret_access_key', 'smtp_password',
    'monthly_mail_token', 'maintenance_pin', 'kiosk_wifi_password',
    'backoffice_db_password', 'backoffice_secret',
)
HOST_FILES = (
    'etc/fstab', 'etc/clubiq-maintenance.env',
    'etc/systemd/system/cloudflared.service', 'etc/default/cloudflared',
    'etc/clubiq-recovery.recipient',
)


def run(command, **kwargs):
    # Commands may encounter files containing credentials; never include stderr
    # or the command line in a user-facing exception or journal entry.
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=90, **kwargs)
    if result.returncode:
        raise RuntimeError('Ein Sicherungsschritt ist fehlgeschlagen; Dienste und Datenträger prüfen.')
    return result.stdout


def regular_bytes(path):
    if path.is_symlink():
        raise ValueError('Symbolische Verknüpfungen werden nicht gesichert.')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE:
            raise ValueError('Eine Konfigurationsdatei ist kein kleines reguläres Dokument.')
        data = handle.read(MAX_FILE + 1)
        if len(data) > MAX_FILE:
            raise ValueError('Konfigurationsdatei ist zu groß.')
        return data


def archive(project, host_root, ca_archive, created, revision):
    entries = {}
    def add(path, name, required=False):
        if not path.exists() and not path.is_symlink():
            if required:
                raise ValueError('Eine erforderliche Installationsdatei fehlt.')
            return
        # Refuse directory symlinks too: selected paths must stay in their tree.
        root = project if name.startswith('installation/') else host_root
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError('Konfigurationspfad verlässt das Sicherungsverzeichnis.')
        entries[name] = regular_bytes(path)
    add(project / '.env', 'installation/.env', True)
    enabled = (project / '.backoffice-enabled').is_file()
    add(project / '.backoffice-enabled', 'installation/.backoffice-enabled')
    for name in SECRETS:
        required = name in ('postgres_admin_password', 'postgres_app_password') or (enabled and name in ('backoffice_db_password', 'backoffice_secret'))
        add(project / 'secrets' / name, 'installation/secrets/' + name, required)
    for name in HOST_FILES:
        add(host_root / name, 'host/' + name)
    for directory, patterns in [('etc/NetworkManager/system-connections', ('*.nmconnection',)), ('etc/cloudflared', ('*.yml', '*.yaml', '*.json'))]:
        for pattern in patterns:
            for path in sorted((host_root / directory).glob(pattern)):
                add(path, 'host/' + str(path.relative_to(host_root)))
    if len(ca_archive) > MAX_FILE or not ca_archive:
        raise ValueError('Die lokale Zertifikatsicherung ist nicht vollständig.')
    entries['caddy-pki.tar'] = ca_archive
    if sum(map(len, entries.values())) > MAX_TOTAL:
        raise ValueError('Notfallpaket überschreitet die Größenbegrenzung.')
    manifest = {'format': 'clubiq-recovery-1', 'createdAt': created, 'revision': revision,
                'backoffice': enabled, 'databaseIncluded': False,
                'files': sorted(entries),
                'note': 'Ergänzung zur Datenbanksicherung. Keine automatische Rücksicherung. Cloudflare Access und Tailscale separat prüfen.'}
    entries['manifest.json'] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as tar:
        for name, data in entries.items():
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o600
            tar.addfile(info, io.BytesIO(data))
    return output.getvalue()


def atomic_write(path, content):
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError('Sicherungsziel darf keine Verknüpfung sein.')
    fd, temporary = tempfile.mkstemp(prefix='.clubiq-recovery-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def settings_for(project):
    settings = {}
    for line in regular_bytes(project / '.env').decode().splitlines():
        key, separator, value = line.partition('=')
        if separator:
            settings[key.strip()] = value.strip().strip('\"\'')
    return settings


def usb_destination(project):
    target = Path(settings_for(project).get('USB_BACKUP_PATH', '/mnt/vereinskasse-sicherung'))
    if not target.is_absolute() or target == Path('/') or target.is_symlink():
        raise ValueError('USB-Ziel ist ungültig.')
    if not os.path.ismount(target) or not (target / '.clubiq-backup-target').is_file():
        raise ValueError('Der freigegebene Backup-USB-Stick ist nicht eingehängt.')
    result = target / 'clubiq-notfall'
    if result.is_symlink():
        raise ValueError('USB-Ziel darf keine Verknüpfung sein.')
    result.mkdir(mode=0o700, exist_ok=True)
    return result


def upload_r2(project, latest, filename, encrypted):
    settings = settings_for(project)
    if settings.get('CLUBIQ_R2_ENABLED') != 'true':
        return None
    endpoint = settings.get('CLUBIQ_R2_ENDPOINT', '')
    bucket = settings.get('CLUBIQ_R2_BUCKET', '')
    # Only the existing private Cloudflare R2 endpoint, never arbitrary URLs.
    if not re.fullmatch(r'https://[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com/?', endpoint) or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket):
        raise ValueError('Private R2-Konfiguration prüfen.')
    env = {key: value for key, value in os.environ.items() if not key.startswith(('RCLONE_', 'AWS_'))}
    env.update(RCLONE_S3_PROVIDER='Cloudflare', RCLONE_S3_ENDPOINT=endpoint.rstrip('/'), RCLONE_S3_REGION='auto',
               RCLONE_S3_ACCESS_KEY_ID=regular_bytes(project / 'secrets/r2_access_key_id').decode().strip(),
               RCLONE_S3_SECRET_ACCESS_KEY=regular_bytes(project / 'secrets/r2_secret_access_key').decode().strip(),
               RCLONE_S3_NO_CHECK_BUCKET='true')
    target = ':s3:' + bucket + '/clubiq-notfall/' + filename
    options = ['--config', '/dev/null', '--log-level', 'ERROR', '--retries', '1', '--low-level-retries', '1']
    # Older distro rclone/R2 combinations can fail upload HEAD checks with 501.
    # Upload directly; integrity is verified by a full subsequent download.
    # Keep the download metadata lookup: old rclone cat otherwise reads 0 bytes.
    run(['rclone', 'copyto', str(latest), target, '--no-check-dest', '--s3-no-head'] + options, env=env)
    restored = run(['rclone', 'cat', target] + options, env=env)
    if hashlib.sha256(restored).digest() != hashlib.sha256(encrypted).digest():
        raise ValueError('Die R2-Rückleseprüfung ist fehlgeschlagen.')
    return True


def backup(project, state, recipient_file, host_root=Path('/')):
    os.umask(0o077)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state.is_symlink():
        raise ValueError('Statusverzeichnis darf keine Verknüpfung sein.')
    with (state / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        created = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')
        status = {'ok': False, 'createdAt': created, 'local': False, 'usb': False, 'cloudStaged': False, 'r2': None}
        try:
            recipient = regular_bytes(recipient_file).decode().strip()
            if not re.fullmatch(r'age1[0-9a-z]{58}', recipient):
                raise ValueError('Es fehlt ein gültiger öffentlicher age-Empfängerschlüssel.')
            compose = ['docker', 'compose', '--project-directory', str(project), '--env-file', str(project / '.env'), '-f', str(project / 'compose.yaml')]
            ca = run(compose + ['exec', '-T', 'proxy', 'tar', '-cf', '-', '-C', '/data', 'caddy/pki'])
            revision = run(['git', '-C', str(project.parent.parent), 'rev-parse', 'HEAD']).decode().strip()
            plain = archive(project, host_root, ca, created, revision)
            encrypted = run(['age', '--encrypt', '--recipient', recipient], input=plain)
            del plain
            filename = 'clubiq-notfall-' + created + '.tar.gz.age'
            latest = state / 'clubiq-notfall-latest.tar.gz.age'
            atomic_write(latest, encrypted)
            status.update(local=True, file=filename)
            try:
                destination = usb_destination(project)
                atomic_write(destination / filename, encrypted)
                checksum = hashlib.sha256(encrypted).hexdigest() + '  ' + filename + '\n'
                atomic_write(destination / (filename + '.sha256'), checksum.encode())
                status['usb'] = True
            except (ValueError, OSError):
                pass  # An absent USB must not prevent the cloud copy.
            try:
                run(compose + ['cp', str(latest), 'backup:/backups/local/clubiq-notfall-latest.tar.gz.age'])
                status['cloudStaged'] = True
            except Exception:
                pass
            try:
                # A separately retrievable ciphertext is essential: Restic's own
                # password is INSIDE this package. Storing it only in Restic would
                # create a circular dependency after total hardware loss.
                status['r2'] = upload_r2(project, latest, filename, encrypted)
            except Exception:
                status['r2'] = False
            status['ok'] = status['usb'] and status['cloudStaged'] and status['r2'] is not False
            # No implicit deletion of old recovery packages. Retention stays
            # independent of database backup cleanup; key rotations need history.
            if not status['ok']:
                raise RuntimeError('Mindestens ein Sicherungsziel ist nicht bereit.')
            print('Verschlüsseltes Notfallpaket gesichert. USB-Kopie und konfigurierte R2-Kopie geprüft.')
        finally:
            atomic_write(state / 'status.json', json.dumps(status).encode())
    return status


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', type=Path, default=Path('/opt/clubiq-ledger/deploy/docker'))
    parser.add_argument('--state', type=Path, default=Path('/var/lib/clubiq-recovery'))
    parser.add_argument('--recipient', type=Path, default=Path('/etc/clubiq-recovery.recipient'))
    args = parser.parse_args()
    try:
        if os.geteuid() != 0:
            raise ValueError('Bitte mit sudo ausführen.')
        backup(args.project, args.state, args.recipient)
    except Exception:
        # Paths, subprocess stderr and file contents can contain secrets.
        print('Notfallpaket nicht vollständig gesichert. USB, Docker-Dienste und Einrichtung prüfen; die Datenbanksicherung bleibt unverändert.', flush=True)
        raise SystemExit(1)
