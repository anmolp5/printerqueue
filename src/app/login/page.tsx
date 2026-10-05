"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginScreen } from "@/components/LoginScreen";
import { useUserSession } from "@/hooks/useUserSession";

export default function LoginPage() {
  const router = useRouter();
  const {
    user,
    signInWithCustomProfile,
    signInWithMicrosoft,
    domainError,
    clearDomainError,
  } = useUserSession();

  // Automatically redirect to the main calendar dashboard as soon as MSAL authenticates the user
  useEffect(() => {
    if (user) {
      router.replace("/");
    }
  }, [user, router]);

  return (
    <LoginScreen
      domainError={domainError}
      onClearError={clearDomainError}
      onMicrosoftRedirect={signInWithMicrosoft}
      onSuccessLogin={(profile) => {
        signInWithCustomProfile(profile);
        router.replace("/");
      }}
    />
  );
}
