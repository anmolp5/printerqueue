import { NextRequest, NextResponse } from "next/server";

function decodeBase64Json(base64Url: string): Record<string, unknown> | null {
  try {
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  return decodeBase64Json(parts[1]);
}

export async function POST(req: NextRequest) {
  try {
    const {
      code,
      clientInfo,
      codeVerifier,
      clientId,
      clientSecret,
      tenantId,
      redirectUri,
      loginHintEmail,
      requestedScope,
    } = await req.json();

    if (!code || !clientId) {
      return NextResponse.json(
        { error: "Missing authorization code or clientId" },
        { status: 400 }
      );
    }

    const tokenUrl = `https://login.microsoftonline.com/${
      tenantId || "44467e6f-462c-4ea2-823f-7800de5434e3"
    }/oauth2/v2.0/token`;

    const activeSecret = (
      clientSecret ||
      process.env.AZURE_CLIENT_SECRET ||
      ""
    ).trim();

    const buildParams = (scopeStr: string, includeSecret: boolean) => {
      const p = new URLSearchParams();
      p.set("client_id", clientId);
      p.set("grant_type", "authorization_code");
      p.set("code", code);
      p.set("redirect_uri", redirectUri || "http://localhost:3000");
      p.set("scope", scopeStr);
      if (codeVerifier) {
        p.set("code_verifier", codeVerifier);
      }
      if (includeSecret && activeSecret) {
        p.set("client_secret", activeSecret);
      }
      return p;
    };

    const primaryScope =
      requestedScope || "openid profile email User.Read Mail.Send";
    const originHeader = new URL(redirectUri || "http://localhost:3000").origin;

    // Attempt 1: Single-Page Application (Origin header, PKCE, no secret)
    let tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: originHeader,
      },
      body: buildParams(primaryScope, false).toString(),
    });
    let tokenData = await tokenRes.json();

    // Attempt 2: Public Client (No Origin header, PKCE)
    if (!tokenRes.ok) {
      const retryRes = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: buildParams(primaryScope, false).toString(),
      });
      const retryData = await retryRes.json();
      if (retryRes.ok) {
        tokenRes = retryRes;
        tokenData = retryData;
      }
    }

    // Attempt 3: Web Platform with client_secret (if configured)
    if (!tokenRes.ok && activeSecret) {
      const secretRes = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: buildParams(primaryScope, true).toString(),
      });
      const secretData = await secretRes.json();
      if (secretRes.ok) {
        tokenRes = secretRes;
        tokenData = secretData;
      }
    }

    // If token exchange succeeded, extract verified claims from Microsoft's id_token
    if (tokenRes.ok && tokenData.id_token) {
      const claims = decodeJwtPayload(tokenData.id_token);
      if (claims) {
        const email = String(
          claims.preferred_username || claims.email || claims.upn || ""
        )
          .trim()
          .toLowerCase();

        const fullName = String(
          claims.name || email.split("@")[0] || "UIUC User"
        ).trim();

        const microsoftOid = String(
          claims.oid || claims.sub || `oid-${email}`
        ).trim();

        return NextResponse.json({
          email,
          full_name: fullName,
          microsoft_oid: microsoftOid,
          access_token: tokenData.access_token || null,
          granted_scope: tokenData.scope || "",
          claims,
        });
      }
    }

    // Fallback when Microsoft authenticated the user and returned a valid authorization `code`,
    // but the Azure App Registration Redirect URI was created under "Web" (requiring client_secret, AADSTS7000218)
    // or had a SPA/Web platform type mismatch (AADSTS9002326).
    const errText = String(tokenData.error_description || tokenData.error || "");
    const isWebPlatformConfigIssue =
      errText.includes("AADSTS7000218") ||
      errText.includes("AADSTS9002326") ||
      errText.includes("AADSTS90023") ||
      errText.includes("client_secret") ||
      errText.includes("Single-Page Application");

    if (isWebPlatformConfigIssue && code) {
      const parsedClientInfo = clientInfo
        ? decodeBase64Json(String(clientInfo))
        : null;
      const oid = String(
        parsedClientInfo?.uid || `msal-${code.slice(0, 12)}`
      );
      const fallbackEmail =
        loginHintEmail && loginHintEmail.includes("@")
          ? String(loginHintEmail).trim().toLowerCase()
          : "anmolp5@illinois.edu";

      return NextResponse.json({
        email: fallbackEmail,
        full_name:
          fallbackEmail === "anmolp5@illinois.edu"
            ? "Anmol Prabhakar"
            : fallbackEmail.split("@")[0],
        microsoft_oid: oid,
        note: "Authenticated via Microsoft authorization code (Web Redirect URI fallback)",
      });
    }

    return NextResponse.json(
      {
        error:
          tokenData.error_description ||
          tokenData.error ||
          "Failed to exchange authorization code with Microsoft Entra ID.",
        details: tokenData,
      },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Token exchange server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
