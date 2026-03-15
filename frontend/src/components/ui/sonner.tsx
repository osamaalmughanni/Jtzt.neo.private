import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-center"
      richColors={false}
      expand={false}
      closeButton
      toastOptions={{
        classNames: {
          toast: "!rounded-2xl !border !border-border !bg-card !text-foreground !shadow-none",
          title: "!text-sm !font-semibold !text-foreground",
          description: "!text-sm !text-muted-foreground",
          closeButton: "!border !border-border !bg-card !text-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-card !text-foreground !border !border-border"
        }
      }}
      {...props}
    />
  );
}
