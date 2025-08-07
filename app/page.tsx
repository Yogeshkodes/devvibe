import UserButton from "@/features/auth/components/user-button";
import { User } from "lucide-react";
import Image from "next/image";

export default function Home() {
  return (
    <div>
      <h1>
        <UserButton />
      </h1>
    </div>
  );
}
