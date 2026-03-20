import { useNavigate } from "react-router-dom";
import { FormPage } from "@/components/form-layout";
import { Stack } from "@/components/stack";
import { useAuth } from "@/lib/auth";

export function AdminMenuPage() {
  const navigate = useNavigate();
  const { logoutAdmin } = useAuth();

  return (
    <FormPage>
      <Stack gap="lg">
        <button
          className="appearance-none border-0 bg-transparent p-0 py-1.5 text-left text-[1.7rem] font-semibold leading-[1.02] tracking-[-0.03em] text-foreground transition-opacity hover:opacity-60 focus:outline-none"
          onClick={() => {
            logoutAdmin();
            navigate("/?mode=admin");
          }}
          type="button"
        >
          Log out
        </button>
      </Stack>
    </FormPage>
  );
}
