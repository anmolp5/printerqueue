import { Configuration, LogLevel } from "@azure/msal-browser";

// Verified via https://login.microsoftonline.com/illinois.edu/v2.0/.well-known/openid-configuration
export const UIUC_TENANT_ID = "44467e6f-462c-4ea2-823f-7800de5434e3";
export const UIUC_CLIENT_ID = "0ffcf932-2712-4180-8599-2fa712117d8d";
export const CUSTOM_CLIENT_ID_STORAGE_KEY = "bambu_x1c_azure_client_id";
export const CUSTOM_CLIENT_SECRET_STORAGE_KEY = "bambu_x1c_azure_client_secret";
export const CUSTOM_TENANT_ID_STORAGE_KEY = "bambu_x1c_azure_tenant_id";

export function getAppBaseUrl(): string {
  if (typeof window !== "undefined") {
    if (window.location.pathname.startsWith("/printerqueue")) {
      return `${window.location.origin}/printerqueue`;
    }
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
}

export function getActiveAzureClientId(): string {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(CUSTOM_CLIENT_ID_STORAGE_KEY);
    if (
      saved &&
      saved.trim().length > 0 &&
      saved.trim() !== "00000000-0000-0000-0000-000000000000"
    ) {
      return saved.trim();
    }
  }
  const envClient = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID;
  if (
    envClient &&
    envClient !== "00000000-0000-0000-0000-000000000000"
  ) {
    return envClient;
  }
  return UIUC_CLIENT_ID;
}

export function getActiveAzureClientSecret(): string {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(CUSTOM_CLIENT_SECRET_STORAGE_KEY);
    if (saved && saved.trim().length > 0) {
      return saved.trim();
    }
  }
  return "";
}

export function getActiveAzureTenantId(): string {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(CUSTOM_TENANT_ID_STORAGE_KEY);
    if (saved && saved.trim().length > 0) {
      if (saved.trim() === "44467e6f-462c-4ea2-823f-78007322e5aa") {
        window.localStorage.setItem(CUSTOM_TENANT_ID_STORAGE_KEY, UIUC_TENANT_ID);
        return UIUC_TENANT_ID;
      }
      return saved.trim();
    }
  }
  const envTenant = process.env.NEXT_PUBLIC_AZURE_TENANT_ID;
  if (
    !envTenant ||
    envTenant === "44467e6f-462c-4ea2-823f-78007322e5aa"
  ) {
    return UIUC_TENANT_ID;
  }
  return envTenant;
}

export function isPlaceholderClientId(clientId: string): boolean {
  return (
    !clientId ||
    clientId === "00000000-0000-0000-0000-000000000000" ||
    clientId.includes("your-client-id")
  );
}

export function createMsalConfig(
  clientIdOverride?: string,
  tenantIdOverride?: string
): Configuration {
  const clientId = clientIdOverride || getActiveAzureClientId();
  const tenantId = tenantIdOverride || getActiveAzureTenantId();
  const baseUrl = getAppBaseUrl();

  return {
    auth: {
      clientId,
      // Verified UIUC Tenant ID: 44467e6f-462c-4ea2-823f-7800de5434e3
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: baseUrl,
      postLogoutRedirectUri: `${baseUrl}/login`,
      // Set false so returning from Microsoft login lands on "/" (the dashboard) instead of "/login"
      navigateToLoginRequestUrl: false,
    },
    cache: {
      cacheLocation: "localStorage",
      storeAuthStateInCookie: false,
    },
    system: {
      loggerOptions: {
        loggerCallback: (level, message, containsPii) => {
          if (!containsPii && level === LogLevel.Error) {
            console.error(message);
          }
        },
      },
    },
  };
}

export const msalConfig: Configuration = createMsalConfig();

export const loginRequest = {
  scopes: ["User.Read", "openid", "profile", "email"],
  prompt: "select_account",
};

import { getAdminSettings } from "./admin-settings";

export function isValidUiucEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const cleaned = email.trim().toLowerCase();
  const atIndex = cleaned.lastIndexOf("@");
  if (atIndex === -1) return false;
  const domain = cleaned.slice(atIndex + 1);
  const settings = getAdminSettings();
  const allowedDomains = settings.permissions.allowedDomains || ["illinois.edu"];
  return allowedDomains.some((d) => d.trim().toLowerCase() === domain);
}

export function isUserBanned(email: string | null | undefined): boolean {
  if (!email) return false;
  const cleaned = email.trim().toLowerCase();
  const settings = getAdminSettings();
  return settings.permissions.bannedEmails.some(
    (b) => b.trim().toLowerCase() === cleaned
  );
}

export function isEmailInAdminAllowlist(email: string): boolean {
  if (!email) return false;
  const cleaned = email.trim().toLowerCase();
  const netId = cleaned.split("@")[0];

  const settings = getAdminSettings();
  const dynamicList = (settings.permissions.adminEmails || []).map((s) =>
    s.trim().toLowerCase()
  );

  return dynamicList.some(
    (entry) =>
      entry === cleaned ||
      (cleaned.endsWith("@illinois.edu") &&
        (entry === netId ||
          (entry.endsWith("@illinois.edu") && entry.split("@")[0] === netId)))
  );
}
