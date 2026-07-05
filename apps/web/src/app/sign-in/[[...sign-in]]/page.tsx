import { SignIn } from "@clerk/nextjs";
import PlayfulBackground from "@/components/ui/playful-background";

export default function Page() {
  return (
    <div className="relative flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-10">
      <PlayfulBackground variant="auth" />
      <div className="relative z-10">
        <SignIn path="/sign-in" />
      </div>
    </div>
  );
}
