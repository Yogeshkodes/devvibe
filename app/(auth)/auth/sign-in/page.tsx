import SignInFormClient from "@/features/auth/components/sign-in-form-client";
import Image from "next/image";
import React from "react";

function SignInPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-5 space-y-6">
      <Image src={"/logo.svg"} alt="Logo-Image" height={300} width={300} />
      <SignInFormClient />
    </div>
  );
}

export default SignInPage;
