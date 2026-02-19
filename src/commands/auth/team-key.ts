import chalk from 'chalk';
import { loadConfig, saveConfig } from '../../utils/config.js';
import { API_URL } from '../../constants.js';
import { getDeviceIdentity, updateDeviceToken } from '../../utils/device.js';
import { clearCredentials } from '../../utils/credentials.js';

interface TeamKeyErrorPayload {
  message?: string;
  code?: string;
  details?: {
    limit?: number;
    activeDevices?: number;
  };
}

function getTeamKeyErrorMessage(payload: TeamKeyErrorPayload): string {
  if (payload.code === 'DEVICE_LIMIT_REACHED') {
    const limit = payload.details?.limit;
    const activeDevices = payload.details?.activeDevices;
    if (typeof limit === 'number' && typeof activeDevices === 'number') {
      return `Device limit reached (${activeDevices}/${limit}). Remove an old device or contact your admin.`;
    }
    return 'Device limit reached for this organization. Remove an old device or contact your admin.';
  }

  return payload.message || 'Invalid team key';
}

export async function teamKeyAction(options: { key?: string }): Promise<void> {
  if (!options.key) {
    console.error(chalk.red('Error: --key is required'));
    console.log('\nGet your team key from: https://app.kodus.io/settings/cli');
    process.exit(1);
  }

  if (!options.key.startsWith('kodus_')) {
    console.error(chalk.red('Error: Invalid key format. Key should start with "kodus_"'));
    process.exit(1);
  }

  try {
    const device = await getDeviceIdentity().catch(() => undefined);
    const response = await fetch(`${API_URL}/cli/validate-key`, {
      headers: {
        'X-Team-Key': options.key,
        ...(device?.deviceId ? { 'X-Kodus-Device-Id': device.deviceId } : {}),
        ...(device?.deviceToken ? { 'X-Kodus-Device-Token': device.deviceToken } : {}),
      }
    });

    const responseDeviceToken = response.headers.get('x-kodus-device-token');
    if (responseDeviceToken) {
      await updateDeviceToken(responseDeviceToken).catch(() => {});
    }

    if (!response.ok) {
      const rawError = await response.json().catch(() => ({} as TeamKeyErrorPayload));
      const payload: TeamKeyErrorPayload =
        rawError && typeof rawError === 'object' && 'data' in (rawError as Record<string, unknown>)
          ? ((rawError as { data?: TeamKeyErrorPayload }).data ?? {})
          : (rawError as TeamKeyErrorPayload);
      throw new Error(getTeamKeyErrorMessage(payload));
    }

    const rawData = await response.json().catch(() => ({} as any));
    const payload = rawData && typeof rawData === 'object' && 'data' in rawData ? (rawData as any).data : rawData;

    const teamName = payload?.team?.name ?? payload?.teamName;
    const organizationName = payload?.organization?.name ?? payload?.organizationName ?? payload?.org?.name;

    if (!teamName || !organizationName) {
      throw new Error('Invalid response from server. Missing organization or team info.');
    }

    // Team-key auth should not compete with a previously stored user session.
    await clearCredentials();

    await saveConfig({
      teamKey: options.key,
      teamName,
      organizationName,
    });

    console.log(chalk.green('✓ Authenticated successfully!'));
    console.log(chalk.cyan(`  Organization: ${organizationName}`));
    console.log(chalk.cyan(`  Team: ${teamName}`));

  } catch (error) {
    console.error(chalk.red('✗ Authentication failed:'), error instanceof Error ? error.message : 'Unknown error');
    console.log('\nMake sure:');
    console.log('  1. Your key is correct');
    console.log('  2. The key has not been revoked');
    console.log('  3. You have internet connection');
    process.exit(1);
  }
}

export async function teamStatusAction(): Promise<void> {
  const config = await loadConfig();

  if (!config) {
    console.log(chalk.yellow('Not authenticated with team key'));
    console.log('\nRun: kodus auth team-key --key <your-key>');
    console.log('Get your key from: https://app.kodus.io/settings/cli');
    return;
  }

  console.log(chalk.green('✓ Authenticated'));
  console.log(chalk.cyan(`  Organization: ${config.organizationName}`));
  console.log(chalk.cyan(`  Team: ${config.teamName}`));
}
