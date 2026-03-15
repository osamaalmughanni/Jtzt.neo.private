import { useEffect } from "react";
import { ArrowLeft } from "phosphor-react";
import { useAppHeaderState } from "@/components/app-header-state";

export function PageBackAction({ to, label = "Go back" }: { to: string; label?: string }) {
  const { setActions } = useAppHeaderState();

  useEffect(() => {
    setActions([{ to, label, icon: ArrowLeft }]);
    return () => setActions(null);
  }, [label, setActions, to]);

  return null;
}
