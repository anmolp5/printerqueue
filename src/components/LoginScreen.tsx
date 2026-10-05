"use client";

import React, { useState } from "react";
import {
  Printer,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Lock,
} from "lucide-react";
import { UserProfile } from "@/lib/types";

interface LoginScreenProps {
  onSuccessLogin: (profile: UserProfile) => void;
  onMicrosoftRedirect?: (
    clientIdOverride?: string,
    tenantIdOverride?: string
  ) => Promise<void>;
  domainError?: string | null;
  onClearError?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onMicrosoftRedirect,
  domainError,
  onClearError,
}) => {
  const [isRedirecting, setIsRedirecting] = useState<boolean>(false);

  const handleRealMicrosoftLogin = async () => {
    if (onClearError) onClearError();
    setIsRedirecting(true);
    if (onMicrosoftRedirect) {
      await onMicrosoftRedirect();
    }
    setIsRedirecting(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#13294B] via-slate-900 to-slate-950 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Top University Banner */}
        <div className="bg-[#13294B] text-white px-6 py-6 border-b-4 border-[#FF5F05]">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#FF5F05] flex items-center justify-center shadow-md shrink-0">
              <Printer className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-orange-400">
                University of Illinois Urbana-Champaign
              </div>
              <h1 className="text-lg font-bold tracking-tight">
                Bambu Lab X1C Booking Portal
              </h1>
              <p className="text-xs text-slate-300">
                Shared 3D Printer Queue &amp; Reservation System
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Primary Real Microsoft SSO Redirect Button */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-900">
                Sign In with Illinois NetID
              </h2>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">
                @illinois.edu Required
              </span>
            </div>

            <p className="text-xs text-zinc-600 leading-relaxed">
              Sign in with your University of Illinois{" "}
              <strong>@illinois.edu</strong> Microsoft account to view the
              printer queue, reserve 15-minute print slots, and receive
              automated email notifications.
            </p>

            <button
              type="button"
              disabled={isRedirecting}
              onClick={handleRealMicrosoftLogin}
              className="w-full py-3.5 px-4 rounded-xl bg-[#13294B] hover:bg-slate-800 text-white font-bold text-sm flex items-center justify-center gap-3 shadow-md transition-all cursor-pointer"
            >
              {/* Official Microsoft 4-color square icon */}
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 21 21">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              <span>
                {isRedirecting
                  ? "Redirecting to Microsoft Sign-In..."
                  : "Sign in with Microsoft (@illinois.edu)"}
              </span>
              <ArrowRight className="w-4 h-4 ml-auto" />
            </button>
          </div>

          {/* Domain / MSAL Error Alert */}
          {domainError && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 flex items-start gap-2.5 text-xs text-red-800">
              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Authentication Notice</div>
                <p className="mt-0.5">{domainError}</p>
              </div>
            </div>
          )}

          {/* Security Footer */}
          <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-400">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Microsoft Entra ID SSO
            </span>
            <span className="flex items-center gap-1">
              <Lock className="w-3 h-3" />
              UIUC @illinois.edu Only
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
