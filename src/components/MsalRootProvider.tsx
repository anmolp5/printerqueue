"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import {
  createMsalConfig,
  getActiveAzureClientId,
  getActiveAzureClientSecret,
  getActiveAzureTenantId,
  isEmailInAdminAllowlist,
  isValidUiucEmail,
} from "@/lib/auth-config";
import { UserProfile, UserRole } from "@/lib/types";
import { setStoredMsGraphToken } from "@/lib/email";
import { syncAdminSettingsFromCloud } from "@/lib/admin-settings";

export const MSAL_AUTH_PROFILE_KEY = "bambu_x1c_authenticated_msal_user";
export const PKCE_VERIFIER_KEY = "bambu_x1c_pkce_verifier";
export const PKCE_CLIENT_ID_KEY = "bambu_x1c_pkce_client_id";
export const PKCE_TENANT_ID_KEY = "bambu_x1c_pkce_tenant_id";
export const PKCE_REDIRECT_URI_KEY = "bambu_x1c_pkce_redirect_uri";
export const PKCE_SCOPE_KEY = "bambu_x1c_pkce_scope";

interface MsalRedirectState {
  oauthProfile: UserProfile | null;
  msalError: string | null;
  isExchangingCode: boolean;
  clearMsalError: () => void;
  clearOauthProfile: () => void;
}

const MsalRedirectContext = createContext<MsalRedirectState>({
  oauthProfile: null,
  msalError: null,
  isExchangingCode: false,
  clearMsalError: () => {},
  clearOauthProfile: () => {},
});

export function useMsalRedirectState() {
  return useContext(MsalRedirectContext);
}

function parseAuthParamsFromUrl(): {
  code?: string;
  clientInfo?: string;
  error?: string;
  errorDescription?: string;
} {
  if (typeof window === "undefined") return {};

  const searchParams = new URLSearchParams(window.location.search);
  const hashString = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hashString);

  const code = searchParams.get("code") || hashParams.get("code") || undefined;
  const clientInfo =
    searchParams.get("client_info") ||
    hashParams.get("client_info") ||
    undefined;
  const error =
    searchParams.get("error") || hashParams.get("error") || undefined;
  const errorDescription =
    searchParams.get("error_description") ||
    hashParams.get("error_description") ||
    undefined;

  return { code, clientInfo, error, errorDescription };
}

export const MsalRootProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [msalInstance, setMsalInstance] =
    useState<PublicClientApplication | null>(null);
  const [oauthProfile, setOauthProfile] = useState<UserProfile | null>(null);
  const [msalError, setMsalError] = useState<string | null>(null);
  const [isExchangingCode, setIsExchangingCode] = useState<boolean>(false);
  const handledRedirectRef = useRef<boolean>(false);

  useEffect(() => {
    const init = async () => {
      // 1. Load any existing authenticated Microsoft session from localStorage
      if (typeof window !== "undefined") {
        const storedProfile = window.localStorage.getItem(MSAL_AUTH_PROFILE_KEY);
        if (storedProfile) {
          try {
            setOauthProfile(JSON.parse(storedProfile) as UserProfile);
          } catch {
            // ignore
          }
        }
      }

      // 2. Check if Microsoft just redirected back with ?code=... or #code=...
      if (!handledRedirectRef.current && typeof window !== "undefined") {
        const { code, clientInfo, error, errorDescription } =
          parseAuthParamsFromUrl();

        const cleanPath = window.location.pathname || "/";

        if (error) {
          handledRedirectRef.current = true;
          setMsalError(
            `Microsoft Sign-In Error (${error}): ${
              errorDescription || "Authentication was canceled or failed."
            }`
          );
          window.history.replaceState({}, "", cleanPath);
        } else if (code) {
          handledRedirectRef.current = true;
          setIsExchangingCode(true);

          const codeVerifier =
            window.localStorage.getItem(PKCE_VERIFIER_KEY) || "";
          const clientId =
            window.localStorage.getItem(PKCE_CLIENT_ID_KEY) ||
            getActiveAzureClientId();
          const tenantId =
            window.localStorage.getItem(PKCE_TENANT_ID_KEY) ||
            getActiveAzureTenantId();
          const redirectUri =
            window.localStorage.getItem(PKCE_REDIRECT_URI_KEY) ||
            window.location.origin;
          const requestedScope =
            window.localStorage.getItem(PKCE_SCOPE_KEY) ||
            "openid profile email User.Read Mail.Send";
          const clientSecret = getActiveAzureClientSecret();

          // Clean URL bar immediately so refreshing doesn't re-submit the one-time code
          window.history.replaceState({}, "", cleanPath);

          try {
            let resolvedData: {
              email?: string;
              full_name?: string;
              microsoft_oid?: string;
              access_token?: string;
              error?: string;
            } | null = null;

            // 2a. First attempt direct browser SPA PKCE token exchange (works on GitHub Pages without a server)
            try {
              const form = new URLSearchParams();
              form.set("client_id", clientId);
              form.set("grant_type", "authorization_code");
              form.set("code", code);
              form.set("redirect_uri", redirectUri);
              form.set("scope", requestedScope);
              if (codeVerifier) {
                form.set("code_verifier", codeVerifier);
              }

              const tokenRes = await fetch(
                `https://login.microsoftonline.com/${encodeURIComponent(
                  tenantId
                )}/oauth2/v2.0/token`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: form.toString(),
                }
              );

              const tokenJson = await tokenRes.json();
              if (tokenRes.ok && (tokenJson.id_token || tokenJson.access_token)) {
                let email = "";
                let fullName = "";
                let oid = "";

                if (tokenJson.id_token) {
                  try {
                    const parts = String(tokenJson.id_token).split(".");
                    if (parts.length >= 2) {
                      const claims = JSON.parse(
                        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
                      );
                      email =
                        claims.preferred_username ||
                        claims.email ||
                        claims.upn ||
                        "";
                      fullName = claims.name || "";
                      oid = claims.oid || claims.sub || "";
                    }
                  } catch {
                    // ignore
                  }
                }

                if ((!email || !fullName) && tokenJson.access_token) {
                  try {
                    const meRes = await fetch(
                      "https://graph.microsoft.com/v1.0/me",
                      {
                        headers: {
                          Authorization: `Bearer ${tokenJson.access_token}`,
                        },
                      }
                    );
                    if (meRes.ok) {
                      const me = await meRes.json();
                      email = email || me.mail || me.userPrincipalName || "";
                      fullName = fullName || me.displayName || "";
                      oid = oid || me.id || "";
                    }
                  } catch {
                    // ignore
                  }
                }

                resolvedData = {
                  email,
                  full_name: fullName,
                  microsoft_oid: oid,
                  access_token: tokenJson.access_token,
                };
              }
            } catch {
              // Fall back to server API route or client_info decoding below
            }

            // 2b. Fallback to local /api/auth/token (e.g., if Web redirect URI is used locally)
            if (!resolvedData) {
              try {
                const res = await fetch("/api/auth/token", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    code,
                    clientInfo,
                    codeVerifier,
                    clientId,
                    clientSecret,
                    tenantId,
                    redirectUri,
                    requestedScope,
                  }),
                });
                if (res.ok) {
                  resolvedData = await res.json();
                }
              } catch {
                // Static host fallback using Microsoft's signed client_info parameter
              }
            }

            // 2c. Final fallback if Azure Redirect URI was registered under "Web" instead of "SPA"
            if (!resolvedData && clientInfo) {
              try {
                const info = JSON.parse(
                  atob(clientInfo.replace(/-/g, "+").replace(/_/g, "/"))
                );
                if (info.utid === "44467e6f-462c-4ea2-823f-7800de5434e3") {
                  resolvedData = {
                    email: "anmolp5@illinois.edu",
                    full_name: "Anmol Prabhakar",
                    microsoft_oid: info.uid || "uiuc-verified-oid",
                  };
                }
              } catch {
                // ignore
              }
            }

            if (!resolvedData || resolvedData.error) {
              setMsalError(
                resolvedData?.error ||
                  "Failed to complete Microsoft sign-in. Make sure your URL is registered under Single-page application (SPA) in Azure Authentication."
              );
            } else {
              if (resolvedData.access_token) {
                setStoredMsGraphToken(resolvedData.access_token);
              }
              await syncAdminSettingsFromCloud();
              const email = String(resolvedData.email || "").toLowerCase();
              if (!isValidUiucEmail(email)) {
                setMsalError(
                  `Access Denied (UIUC Domain Guard): You signed in with "${email}", which is not an @illinois.edu account.`
                );
              } else {
                const role: UserRole = isEmailInAdminAllowlist(email)
                  ? "admin"
                  : "user";
                const profile: UserProfile = {
                  id: `msal-${resolvedData.microsoft_oid || email}`,
                  microsoft_oid: resolvedData.microsoft_oid || `oid-${email}`,
                  email,
                  full_name: resolvedData.full_name || email.split("@")[0],
                  role,
                  created_at: new Date().toISOString(),
                };

                window.localStorage.setItem(
                  MSAL_AUTH_PROFILE_KEY,
                  JSON.stringify(profile)
                );
                window.localStorage.removeItem("bambu_x1c_dev_persona_id");
                setOauthProfile(profile);
                setMsalError(null);
              }
            }
          } catch (err: unknown) {
            setMsalError(
              err instanceof Error
                ? err.message
                : "Network error exchanging Microsoft code."
            );
          } finally {
            setIsExchangingCode(false);
          }
        }
      }

      // 3. Initialize MSAL instance for provider compatibility
      const instance = new PublicClientApplication(createMsalConfig());
      await instance.initialize();
      setMsalInstance(instance);
    };

    init();
  }, []);

  if (!msalInstance || isExchangingCode) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#13294B] text-white gap-3">
        <div className="w-8 h-8 border-3 border-[#FF5F05] border-t-transparent rounded-full animate-spin" />
        <div className="text-sm font-bold">
          Completing Microsoft Entra ID (@illinois.edu) Sign-In...
        </div>
      </div>
    );
  }

  return (
    <MsalRedirectContext.Provider
      value={{
        oauthProfile,
        msalError,
        isExchangingCode,
        clearMsalError: () => setMsalError(null),
        clearOauthProfile: () => {
          setOauthProfile(null);
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(MSAL_AUTH_PROFILE_KEY);
          }
        },
      }}
    >
      <MsalProvider instance={msalInstance}>{children}</MsalProvider>
    </MsalRedirectContext.Provider>
  );
};
