"use client";

import { useState, useEffect, useCallback } from "react";
import { UserProfile, UserRole } from "@/lib/types";
import { DEV_PERSONAS } from "@/lib/store";
import {
  getActiveAzureClientId,
  getActiveAzureTenantId,
  getAppBaseUrl,
  isEmailInAdminAllowlist,
  isValidUiucEmail,
} from "@/lib/auth-config";
import { subscribeToAdminSettings } from "@/lib/admin-settings";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  MSAL_AUTH_PROFILE_KEY,
  PKCE_CLIENT_ID_KEY,
  PKCE_REDIRECT_URI_KEY,
  PKCE_SCOPE_KEY,
  PKCE_TENANT_ID_KEY,
  PKCE_VERIFIER_KEY,
  useMsalRedirectState,
} from "@/components/MsalRootProvider";

const DEV_PERSONA_STORAGE_KEY = "bambu_x1c_dev_persona_id";
const ROLE_OVERRIDE_STORAGE_KEY = "bambu_x1c_role_override";

type SessionListener = (
  user: UserProfile | null,
  domainError: string | null
) => void;
const sessionListeners = new Set<SessionListener>();

let currentCachedUser: UserProfile | null = null;
let currentDomainError: string | null = null;

function notifySessionListeners() {
  sessionListeners.forEach((fn) => fn(currentCachedUser, currentDomainError));
}

// Generate cryptographic PKCE code_verifier & S256 code_challenge in browser
async function generatePkcePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  const codeVerifier = btoa(String.fromCharCode(...Array.from(array)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  const codeChallenge = btoa(
    String.fromCharCode(...Array.from(new Uint8Array(digest)))
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { codeVerifier, codeChallenge };
}

export function useUserSession() {
  const {
    oauthProfile,
    msalError,
    isExchangingCode,
    clearMsalError,
    clearOauthProfile,
  } = useMsalRedirectState();

  const [user, setUser] = useState<UserProfile | null>(currentCachedUser);
  const [domainError, setDomainError] = useState<string | null>(
    currentDomainError
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (msalError) {
      currentDomainError = msalError;
      notifySessionListeners();
    }
  }, [msalError]);

  useEffect(() => {
    return subscribeToAdminSettings(() => {
      if (!currentCachedUser) return;
      const isAuthorizedAdmin = isEmailInAdminAllowlist(
        currentCachedUser.email
      );
      if (!isAuthorizedAdmin) {
        if (currentCachedUser.role !== "user") {
          currentCachedUser = { ...currentCachedUser, role: "user" };
          notifySessionListeners();
        }
        return;
      }
      const roleOverride =
        typeof window !== "undefined"
          ? (window.localStorage.getItem(
              ROLE_OVERRIDE_STORAGE_KEY
            ) as UserRole | null)
          : null;
      const nextRole: UserRole = roleOverride === "user" ? "user" : "admin";
      if (currentCachedUser.role !== nextRole) {
        currentCachedUser = { ...currentCachedUser, role: nextRole };
        notifySessionListeners();
      }
    });
  }, []);

  useEffect(() => {
    const listener: SessionListener = (newUser, err) => {
      setUser(newUser);
      setDomainError(err);
    };
    sessionListeners.add(listener);

    // 1. Check if authenticated via real Microsoft OAuth2 PKCE flow
    if (oauthProfile) {
      const isAuthorizedAdmin = isEmailInAdminAllowlist(oauthProfile.email);
      const roleOverride =
        typeof window !== "undefined"
          ? (window.localStorage.getItem(
              ROLE_OVERRIDE_STORAGE_KEY
            ) as UserRole | null)
          : null;

      const resolvedRole: UserRole = isAuthorizedAdmin
        ? roleOverride === "user"
          ? "user"
          : "admin"
        : "user";

      const resolvedProfile: UserProfile = {
        ...oauthProfile,
        role: resolvedRole,
      };

      currentCachedUser = resolvedProfile;
      currentDomainError = null;
      notifySessionListeners();

      if (isSupabaseConfigured && supabase) {
        supabase
          .from("profiles")
          .upsert(
            {
              microsoft_oid: resolvedProfile.microsoft_oid,
              email: resolvedProfile.email,
              full_name: resolvedProfile.full_name,
              role: resolvedProfile.role,
            },
            { onConflict: "email" }
          )
          .then(() => {});
      }

      setIsLoading(false);
      return () => {
        sessionListeners.delete(listener);
      };
    }

    // 2. Otherwise check if a saved session or Dev Persona was selected
    if (typeof window !== "undefined") {
      const savedMsalRaw = window.localStorage.getItem(MSAL_AUTH_PROFILE_KEY);
      if (savedMsalRaw) {
        try {
          const parsed = JSON.parse(savedMsalRaw) as UserProfile;
          const isAuthorizedAdmin = isEmailInAdminAllowlist(parsed.email);
          const roleOverride = window.localStorage.getItem(
            ROLE_OVERRIDE_STORAGE_KEY
          ) as UserRole | null;
          const resolvedRole: UserRole = isAuthorizedAdmin
            ? roleOverride === "user"
              ? "user"
              : "admin"
            : "user";
          currentCachedUser = { ...parsed, role: resolvedRole };
          notifySessionListeners();
          setIsLoading(false);
          return () => {
            sessionListeners.delete(listener);
          };
        } catch {
          // ignore
        }
      }

      const savedId = window.localStorage.getItem(DEV_PERSONA_STORAGE_KEY);
      if (savedId && savedId !== "SIGNED_OUT") {
        const found = DEV_PERSONAS.find((p) => p.id === savedId);
        if (found) {
          const isAuthorizedAdmin = isEmailInAdminAllowlist(found.email);
          const roleOverride = window.localStorage.getItem(
            ROLE_OVERRIDE_STORAGE_KEY
          ) as UserRole | null;
          const resolvedRole: UserRole = isAuthorizedAdmin
            ? roleOverride === "user"
              ? "user"
              : "admin"
            : "user";
          currentCachedUser = { ...found, role: resolvedRole };
          notifySessionListeners();
        }
      }
    }

    setIsLoading(false);

    return () => {
      sessionListeners.delete(listener);
    };
  }, [oauthProfile]);

  /**
   * Redirects the browser to Microsoft Entra ID (`login.microsoftonline.com`)
   * using OAuth 2.0 Authorization Code Flow with PKCE.
   */
  const signInWithMicrosoft = useCallback(
    async (
      clientIdOverride?: string,
      tenantIdOverride?: string,
      includeMailSend = true
    ) => {
      try {
        const clientId = (
          clientIdOverride?.trim() || getActiveAzureClientId()
        ).trim();
        const tenantId = (
          tenantIdOverride?.trim() || getActiveAzureTenantId()
        ).trim();
        const redirectUri = getAppBaseUrl();

        const scope = includeMailSend
          ? "openid profile email User.Read Mail.Send"
          : "openid profile email User.Read";

        const { codeVerifier, codeChallenge } = await generatePkcePair();

        if (typeof window !== "undefined") {
          window.localStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
          window.localStorage.setItem(PKCE_CLIENT_ID_KEY, clientId);
          window.localStorage.setItem(PKCE_TENANT_ID_KEY, tenantId);
          window.localStorage.setItem(PKCE_REDIRECT_URI_KEY, redirectUri);
          window.localStorage.setItem(PKCE_SCOPE_KEY, scope);
          window.localStorage.removeItem(DEV_PERSONA_STORAGE_KEY);
        }

        const authorizeUrl = new URL(
          `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`
        );
        authorizeUrl.searchParams.set("client_id", clientId);
        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("redirect_uri", redirectUri);
        authorizeUrl.searchParams.set("response_mode", "query");
        authorizeUrl.searchParams.set("scope", scope);
        authorizeUrl.searchParams.set("code_challenge", codeChallenge);
        authorizeUrl.searchParams.set("code_challenge_method", "S256");
        authorizeUrl.searchParams.set("client_info", "1");
        authorizeUrl.searchParams.set("prompt", "select_account");

        window.location.assign(authorizeUrl.toString());
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Microsoft Entra redirect failed.";
        currentDomainError = msg;
        notifySessionListeners();
      }
    },
    []
  );

  const connectOutlookMailSend = useCallback(async () => {
    await signInWithMicrosoft(undefined, undefined, true);
  }, [signInWithMicrosoft]);

  const switchDevPersona = useCallback((personaId: string) => {
    const found = DEV_PERSONAS.find((p) => p.id === personaId);
    if (found) {
      const isAuthorizedAdmin = isEmailInAdminAllowlist(found.email);
      currentCachedUser = {
        ...found,
        role: isAuthorizedAdmin ? "admin" : "user",
      };
      currentDomainError = null;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DEV_PERSONA_STORAGE_KEY, found.id);
        window.localStorage.removeItem(ROLE_OVERRIDE_STORAGE_KEY);
      }
      notifySessionListeners();
    }
  }, []);

  const toggleCurrentUserRole = useCallback(() => {
    // Only allow role toggling if the logged-in user's email is an authorized admin
    if (!currentCachedUser || !isEmailInAdminAllowlist(currentCachedUser.email)) {
      return;
    }
    const nextRole: UserRole =
      currentCachedUser.role === "admin" ? "user" : "admin";
    currentCachedUser = {
      ...currentCachedUser,
      role: nextRole,
    };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ROLE_OVERRIDE_STORAGE_KEY, nextRole);
      if (window.localStorage.getItem(MSAL_AUTH_PROFILE_KEY)) {
        window.localStorage.setItem(
          MSAL_AUTH_PROFILE_KEY,
          JSON.stringify(currentCachedUser)
        );
      }
    }
    notifySessionListeners();
  }, []);

  const signInWithCustomProfile = useCallback((profile: UserProfile) => {
    if (!isValidUiucEmail(profile.email)) {
      currentDomainError = `Access Denied: "${profile.email}" is not a valid @illinois.edu account.`;
      notifySessionListeners();
      return;
    }
    const isAuthorizedAdmin = isEmailInAdminAllowlist(profile.email);
    currentCachedUser = {
      ...profile,
      role: isAuthorizedAdmin ? "admin" : "user",
    };
    currentDomainError = null;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEV_PERSONA_STORAGE_KEY, profile.id);
      window.localStorage.removeItem(ROLE_OVERRIDE_STORAGE_KEY);
    }
    notifySessionListeners();
  }, []);

  const testExternalDomainRejection = useCallback((invalidEmail: string) => {
    if (!isValidUiucEmail(invalidEmail)) {
      currentDomainError = `Access Denied: "${invalidEmail}" is not a valid @illinois.edu account. Microsoft Entra ID session terminated.`;
      notifySessionListeners();
    }
  }, []);

  const clearDomainError = useCallback(() => {
    currentDomainError = null;
    clearMsalError();
    notifySessionListeners();
  }, [clearMsalError]);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    currentCachedUser = null;
    clearOauthProfile();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEV_PERSONA_STORAGE_KEY, "SIGNED_OUT");
      window.localStorage.removeItem(MSAL_AUTH_PROFILE_KEY);
      window.localStorage.removeItem(ROLE_OVERRIDE_STORAGE_KEY);
    }
    notifySessionListeners();
  }, [clearOauthProfile]);

  const canToggleAdminRole = Boolean(
    user && isEmailInAdminAllowlist(user.email)
  );

  return {
    user,
    isAdmin: user?.role === "admin" && canToggleAdminRole,
    canToggleAdminRole,
    isLoading: isLoading || isExchangingCode,
    domainError,
    clearDomainError,
    switchDevPersona,
    toggleCurrentUserRole,
    signInWithCustomProfile,
    testExternalDomainRejection,
    signInWithMicrosoft,
    connectOutlookMailSend,
    signOut,
  };
}
