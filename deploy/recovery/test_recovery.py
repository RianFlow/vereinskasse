"""Linux-only tests with disposable keys/config; no real club data or network."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('recovery.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='clubiq-recovery-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / 'project/deploy/docker'
        (self.project / 'secrets').mkdir(parents=True)
        self.host = self.root / 'host'
        self.host.mkdir()
        (self.project / '.env').write_text('USB_BACKUP_PATH=/mnt/test-usb\n')
        (self.project / '.backoffice-enabled').touch()
        for name in recovery.SECRETS:
            (self.project / 'secrets' / name).write_text('FAKE-CONFIG-' + name)
        # Unknown files / private identities must never enter the whitelist.
        (self.project / 'secrets/private-age-key').write_text('DO-NOT-BACKUP-PRIVATE-KEY')
        self.key = self.root / 'identity.txt'
        subprocess.run(['age-keygen', '-o', str(self.key)], check=True, capture_output=True)
        self.recipient = recovery.run(['age-keygen', '-y', str(self.key)]).decode().strip()
        self.recipient_file = self.root / 'recipient.txt'
        self.recipient_file.write_text(self.recipient + '\n')
        self.state = self.root / 'state'

    def test_real_encryption_round_trip_wrong_key_and_tampering(self):
        plain = recovery.archive(self.project, self.host, b'FAKE-CA-TAR', 'test-date', 'test-revision')
        encrypted = recovery.run(['age', '-r', self.recipient], input=plain)
        self.assertNotIn(b'FAKE-CONFIG', encrypted)
        decoded = recovery.run(['age', '-d', '-i', str(self.key)], input=encrypted)
        self.assertEqual(decoded, plain)
        with tarfile.open(fileobj=io.BytesIO(decoded)) as tar:
            self.assertEqual(tar.extractfile('installation/secrets/backoffice_secret').read(), b'FAKE-CONFIG-backoffice_secret')
            self.assertFalse(any('private-age-key' in name for name in tar.getnames()))
            self.assertFalse(json.load(tar.extractfile('manifest.json'))['databaseIncluded'])
        other = self.root / 'wrong-key.txt'
        subprocess.run(['age-keygen', '-o', str(other)], check=True, capture_output=True)
        with self.assertRaises(RuntimeError):
            recovery.run(['age', '-d', '-i', str(other)], input=encrypted)
        with self.assertRaises(RuntimeError):
            recovery.run(['age', '-d', '-i', str(self.key)], input=encrypted[:-1] + bytes([encrypted[-1] ^ 1]))

    def test_missing_required_secret_and_symlink_are_rejected(self):
        target = self.project / 'secrets/backoffice_secret'
        target.unlink()
        with self.assertRaises(ValueError):
            recovery.archive(self.project, self.host, b'fake-ca', 'now', 'test')
        target.symlink_to(self.key)
        with self.assertRaises(ValueError):
            recovery.archive(self.project, self.host, b'fake-ca', 'now', 'test')

    def test_unmounted_usb_never_writes_to_sd_card(self):
        with patch.object(recovery.os.path, 'ismount', return_value=False):
            with self.assertRaises(ValueError):
                recovery.usb_destination(self.project)

    def simulated_run(self, command, **kwargs):
        if command[0] == 'docker':
            return b'FAKE-CA-TAR' if 'exec' in command else b''
        if command[0] == 'git':
            return b'test-revision\n'
        return self.real_run(command, **kwargs)

    def test_missing_usb_does_not_block_encrypted_cloud_copy(self):
        self.real_run = recovery.run
        with patch.object(recovery, 'run', side_effect=self.simulated_run), patch.object(recovery, 'usb_destination', side_effect=ValueError('absent')), patch.object(recovery, 'upload_r2', return_value=True) as upload:
            with self.assertRaises(RuntimeError):
                recovery.backup(self.project, self.state, self.recipient_file, self.host)
        status = json.loads((self.state / 'status.json').read_text())
        self.assertFalse(status['ok'])
        self.assertFalse(status['usb'])
        self.assertTrue(status['r2'])
        upload.assert_called_once()
        self.assertEqual(list(self.state.glob('*.tar.gz')), [])

    def test_cloud_failure_does_not_block_usb_or_leave_plaintext(self):
        self.real_run = recovery.run
        usb = self.root / 'usb'
        usb.mkdir()
        with patch.object(recovery, 'run', side_effect=self.simulated_run), patch.object(recovery, 'usb_destination', return_value=usb), patch.object(recovery, 'upload_r2', side_effect=RuntimeError('offline')):
            with self.assertRaises(RuntimeError):
                recovery.backup(self.project, self.state, self.recipient_file, self.host)
        status = json.loads((self.state / 'status.json').read_text())
        self.assertTrue(status['usb'])
        self.assertFalse(status['r2'])
        self.assertEqual(len(list(usb.glob('*.age'))), 1)
        self.assertEqual(list(self.state.glob('*.tar.gz')), [])

    def test_private_r2_target_and_roundtrip_validation(self):
        (self.project / '.env').write_text('CLUBIQ_R2_ENABLED=true\nCLUBIQ_R2_ENDPOINT=https://' + 'a'*32 + '.r2.cloudflarestorage.com\nCLUBIQ_R2_BUCKET=test-private-bucket\n')
        calls = []
        def fake(command, **kwargs):
            calls.append((command, kwargs))
            self.assertNotIn('FAKE-CONFIG', ' '.join(command))
            return b'CIPHERTEXT' if command[1] == 'cat' else b''
        with patch.object(recovery, 'run', side_effect=fake):
            self.assertTrue(recovery.upload_r2(self.project, Path('/tmp/cipher.age'), 'test.age', b'CIPHERTEXT'))
        self.assertIn(':s3:test-private-bucket/clubiq-notfall/test.age', calls[0][0])
        with patch.object(recovery, 'run', return_value=b'CORRUPT'):
            with self.assertRaises(ValueError):
                recovery.upload_r2(self.project, Path('/tmp/cipher.age'), 'test.age', b'CIPHERTEXT')
        (self.project / '.env').write_text('CLUBIQ_R2_ENABLED=true\nCLUBIQ_R2_ENDPOINT=https://evil.example\nCLUBIQ_R2_BUCKET=test-private-bucket\n')
        with patch.object(recovery, 'run') as command:
            with self.assertRaises(ValueError):
                recovery.upload_r2(self.project, Path('/tmp/cipher.age'), 'test.age', b'CIPHERTEXT')
            command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
