import { api } from './api/index.js';
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
} from '../utils/credentials.js';
import { clearConfig, loadConfig } from '../utils/config.js';
import type { StoredCredentials, AuthResponse } from '../types/index.js';
import { AuthError } from '../types/index.js';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

class AuthService {
  private cachedCredentials: StoredCredentials | null = null;

  async login(email: string, password: string): Promise<void> {
    const response = await api.auth.login(email, password);
    await this.storeAuthResponse(response);
  }

  async logout(): Promise<void> {
    const credentials = await this.getCredentials();
    
    if (credentials) {
      try {
        await api.auth.logout(credentials.accessToken);
      } catch {
        // Ignore logout errors
      }
    }

    await clearCredentials();
    await clearConfig();
    this.cachedCredentials = null;
  }

  async isAuthenticated(): Promise<boolean> {
    const credentials = await this.getCredentials();
    if (credentials !== null) return true;

    const config = await loadConfig();
    return !!config?.teamKey;
  }

  async getCredentials(): Promise<StoredCredentials | null> {
    if (this.cachedCredentials) {
      return this.cachedCredentials;
    }

    this.cachedCredentials = await loadCredentials();
    return this.cachedCredentials;
  }

  async getValidToken(): Promise<string> {
    const credentials = await this.getCredentials();

    if (!credentials) {
      const config = await loadConfig();
      if (config?.teamKey) {
        return config.teamKey;
      }
      throw new AuthError('Not authenticated. Run: kodus auth login or kodus auth team-key --key <your-key>');
    }

    const isExpired = Date.now() > credentials.expiresAt - TOKEN_REFRESH_BUFFER_MS;

    if (isExpired) {
      try {
        const response = await api.auth.refresh(credentials.refreshToken);
        await this.storeAuthResponse(response);
        return response.accessToken;
      } catch (error) {
        await clearCredentials();
        this.cachedCredentials = null;
        const config = await loadConfig();
        if (config?.teamKey) {
          return config.teamKey;
        }
        throw new AuthError('Session expired. Run: kodus auth login');
      }
    }

    return credentials.accessToken;
  }

  async generateCIToken(): Promise<string> {
    const token = await this.getValidToken();
    return api.auth.generateCIToken(token);
  }

  async verifyToken(): Promise<{ valid: boolean; user?: any }> {
    const credentials = await this.getCredentials();
    
    if (!credentials) {
      return { valid: false };
    }

    return api.auth.verify(credentials.accessToken);
  }

  private async storeAuthResponse(response: AuthResponse): Promise<void> {
    const credentials: StoredCredentials = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      user: response.user,
    };

    await saveCredentials(credentials);
    this.cachedCredentials = credentials;
  }
}

export { AuthService };
export const authService = new AuthService();
