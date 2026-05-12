import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type GstreamerPlatform = 'darwin' | 'linux' | 'win32' | 'unknown';

export interface GstreamerInstallStatus {
  installed: boolean;
  version?: string;
  binaryPath?: string;
  platform: GstreamerPlatform;
  downloadUrl: string;
  installCommands: Array<{ label: string; command: string }>;
  diagnostic?: string;
}

const PROBE_PATHS_BY_PLATFORM: Record<GstreamerPlatform, string[]> = {
  darwin: [
    'gst-inspect-1.0',
    '/opt/homebrew/bin/gst-inspect-1.0',
    '/usr/local/bin/gst-inspect-1.0',
    '/Library/Frameworks/GStreamer.framework/Commands/gst-inspect-1.0',
  ],
  linux: ['gst-inspect-1.0', '/usr/bin/gst-inspect-1.0', '/usr/local/bin/gst-inspect-1.0'],
  win32: [
    'gst-inspect-1.0.exe',
    'C:\\gstreamer\\1.0\\msvc_x86_64\\bin\\gst-inspect-1.0.exe',
    'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\bin\\gst-inspect-1.0.exe',
  ],
  unknown: ['gst-inspect-1.0'],
};

function detectPlatform(): GstreamerPlatform {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'win32') return 'win32';
  return 'unknown';
}

function guidanceFor(platform: GstreamerPlatform): {
  downloadUrl: string;
  installCommands: Array<{ label: string; command: string }>;
} {
  switch (platform) {
    case 'darwin':
      return {
        downloadUrl: 'https://gstreamer.freedesktop.org/download/#macos',
        installCommands: [
          { label: 'Homebrew (recommended)', command: 'brew install gstreamer' },
          {
            label: 'MacPorts',
            command: 'sudo port install gstreamer1 gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly',
          },
        ],
      };
    case 'linux':
      return {
        downloadUrl: 'https://gstreamer.freedesktop.org/documentation/installing/on-linux.html',
        installCommands: [
          {
            label: 'Debian / Ubuntu',
            command:
              'sudo apt update && sudo apt install -y gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav',
          },
          {
            label: 'Fedora',
            command:
              'sudo dnf install -y gstreamer1 gstreamer1-plugins-base gstreamer1-plugins-good gstreamer1-plugins-bad-free gstreamer1-plugins-ugly gstreamer1-libav',
          },
          {
            label: 'Arch Linux',
            command:
              'sudo pacman -S --needed gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav',
          },
        ],
      };
    case 'win32':
      return {
        downloadUrl: 'https://gstreamer.freedesktop.org/download/#windows',
        installCommands: [
          {
            label: 'Chocolatey',
            command: 'choco install gstreamer gstreamer-devel',
          },
          {
            label: 'Installer (recommended)',
            command:
              'Download the "Runtime installer" from the URL above and install with "Complete" feature set.',
          },
        ],
      };
    default:
      return {
        downloadUrl: 'https://gstreamer.freedesktop.org/download/',
        installCommands: [],
      };
  }
}

export async function checkGstreamerInstall(): Promise<GstreamerInstallStatus> {
  const platform = detectPlatform();
  const guidance = guidanceFor(platform);
  let lastError: string | undefined;

  for (const candidate of PROBE_PATHS_BY_PLATFORM[platform]) {
    try {
      const { stdout } = await exec(candidate, ['--gst-version'], {
        timeout: 4000,
        env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      });
      const version = stdout.trim();
      if (version) {
        return {
          installed: true,
          version,
          binaryPath: candidate,
          platform,
          ...guidance,
        };
      }
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  return {
    installed: false,
    platform,
    diagnostic: lastError,
    ...guidance,
  };
}
