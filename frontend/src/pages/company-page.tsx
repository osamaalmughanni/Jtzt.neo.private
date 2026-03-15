import { AppFrame } from "@/components/app-frame";
import { AppHeader } from "@/components/app-header";

export function CompanyPage() {
  return (
    <AppFrame>
      <AppHeader scope="public" title="Company" description="Information about the company behind Jtzt." />
      <div className="max-w-2xl space-y-6 text-sm leading-7 text-muted-foreground">
        <p>
          Jtzt is presented as an internal working-hours platform for companies that want local control, simple
          operations, and clean architecture.
        </p>
        <div className="space-y-1">
          <p className="font-semibold text-foreground">Company details</p>
          <p>Jtzt GmbH</p>
          <p>Example Street 10</p>
          <p>1010 Vienna</p>
          <p>Austria</p>
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-foreground">Contact</p>
          <p>hello@jtzt.example</p>
          <p>+43 000 000000</p>
        </div>
      </div>
    </AppFrame>
  );
}
