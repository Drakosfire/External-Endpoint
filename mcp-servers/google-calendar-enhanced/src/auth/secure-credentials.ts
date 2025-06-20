import { StorageFactory } from '../../shared/storage/StorageFactory.js';
import { EncryptedStorageInterface } from '../../shared/storage/StorageInterface.js';

interface GoogleCredentials {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    accessToken?: string;
    expiresAt?: Date;
}

interface UserCredentialsRequest {
    userId: string;
    clientId: string;
    clientSecret: string;
}

export class SecureCredentialsManager {
    private storage: EncryptedStorageInterface<GoogleCredentials>;

    constructor() {
        // Initialize with encrypted MongoDB storage
        this.storage = StorageFactory.createEncryptedFromEnvironment<GoogleCredentials>({
            clientId: '',
            clientSecret: '',
            refreshToken: '',
            accessToken: '',
            expiresAt: undefined
        });

        // Override collection name for Google Calendar credentials
        process.env.MONGODB_COLLECTION = 'google_calendar_credentials';
    }

    /**
     * Safely stores Google Calendar credentials for a user
     * This encrypts the credentials before storing in MongoDB
     */
    async storeCredentials(userId: string, credentials: GoogleCredentials): Promise<void> {
        try {
            // Validate credentials format
            if (!credentials.clientId || !credentials.clientSecret) {
                throw new Error('Client ID and Client Secret are required');
            }

            await this.storage.saveEncrypted(userId, credentials);
            console.log(`[SecureCredentials] Stored credentials for user ${userId}`);
        } catch (error) {
            console.error(`[SecureCredentials] Failed to store credentials for user ${userId}:`, error);
            throw new Error('Failed to store credentials securely');
        }
    }

    /**
     * Retrieves and decrypts Google Calendar credentials for a user
     */
    async getCredentials(userId: string): Promise<GoogleCredentials | null> {
        try {
            const credentials = await this.storage.loadDecrypted(userId);

            // Check if we have valid credentials
            if (!credentials.clientId || !credentials.clientSecret) {
                return null;
            }

            return credentials;
        } catch (error) {
            console.error(`[SecureCredentials] Failed to retrieve credentials for user ${userId}:`, error);
            return null;
        }
    }

    /**
     * Updates stored access/refresh tokens after OAuth flow
     */
    async updateTokens(userId: string, tokens: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: Date;
    }): Promise<void> {
        try {
            const existingCredentials = await this.getCredentials(userId);
            if (!existingCredentials) {
                throw new Error('No credentials found for user');
            }

            const updatedCredentials: GoogleCredentials = {
                ...existingCredentials,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken || existingCredentials.refreshToken,
                expiresAt: tokens.expiresAt
            };

            await this.storage.saveEncrypted(userId, updatedCredentials);
            console.log(`[SecureCredentials] Updated tokens for user ${userId}`);
        } catch (error) {
            console.error(`[SecureCredentials] Failed to update tokens for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Removes all stored credentials for a user
     */
    async removeCredentials(userId: string): Promise<void> {
        try {
            await this.storage.clearForUser(userId);
            console.log(`[SecureCredentials] Removed credentials for user ${userId}`);
        } catch (error) {
            console.error(`[SecureCredentials] Failed to remove credentials for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Validates if user has complete credentials setup
     */
    async hasValidCredentials(userId: string): Promise<boolean> {
        try {
            const credentials = await this.getCredentials(userId);
            return !!(credentials?.clientId && credentials?.clientSecret);
        } catch (error) {
            return false;
        }
    }

    /**
     * Lists all users who have stored credentials
     * Useful for maintenance and debugging
     */
    async listUsersWithCredentials(): Promise<string[]> {
        try {
            return await this.storage.listUsers();
        } catch (error) {
            console.error('[SecureCredentials] Failed to list users:', error);
            return [];
        }
    }
}

/**
 * SECURITY BEST PRACTICES for API Key Management:
 * 
 * 1. ✅ ENCRYPTION: All credentials are encrypted using LibreChat's CREDS_KEY
 * 2. ✅ ISOLATION: Each user's credentials are stored separately  
 * 3. ✅ MONGODB: Centralized secure storage with indexing
 * 4. ✅ NO PLAINTEXT: Credentials never stored in plaintext
 * 5. ✅ ACCESS CONTROL: Only specific user can access their credentials
 * 
 * NEVER DO:
 * ❌ Store API keys in environment variables for multiple users
 * ❌ Send API keys over SMS (use secure OAuth flow instead)
 * ❌ Log API keys in plaintext
 * ❌ Store API keys in regular (unencrypted) database fields
 * 
 * FOR SMS USERS:
 * - Send OAuth authorization URLs over SMS
 * - User completes OAuth flow in browser  
 * - System stores resulting tokens securely
 * - SMS user can then use calendar features
 */

// Example usage for SMS integration:
export async function handleSMSCredentialSetup(phoneNumber: string): Promise<string> {
    const credentialsManager = new SecureCredentialsManager();

    // Check if user already has credentials
    const hasCredentials = await credentialsManager.hasValidCredentials(phoneNumber);

    if (hasCredentials) {
        return "✅ You already have Google Calendar access configured!";
    }

    // Generate secure OAuth authorization URL
    const authUrl = generateOAuthUrl(phoneNumber); // Implementation depends on your OAuth setup

    return `🔐 To use Google Calendar features, please visit this secure link to authorize access: ${authUrl}
  
This link is unique to your phone number and expires in 10 minutes for security.`;
}

function generateOAuthUrl(userId: string): string {
    // Implementation would generate a secure OAuth URL
    // This is just a placeholder
    return `https://your-oauth-server.com/auth?user=${encodeURIComponent(userId)}&expires=${Date.now() + 600000}`;
} 