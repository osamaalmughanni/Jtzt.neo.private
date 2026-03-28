import { useEffect } from "react";
import { ArrowLeft } from "phosphor-react";
import { useAppHeaderState } from "@/components/app-header-state";

export function PageBackAction({
  to,
  onClick,
  label = "Go back",
}: {
  to?: string;
  onClick?: () => void;
  label?: string;
}) {
  const { setActions } = useAppHeaderState();

  useEffect(() => {
    setActions([
      to
        ? { to, label, icon: ArrowLeft }
        : { label, icon: ArrowLeft, onClick: onClick ?? (() => {}) },
    ]);
    return () => setActions(null);
  }, [label, onClick, setActions, to]);

  return null;
}
