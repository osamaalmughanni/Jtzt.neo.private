import { cn } from "@/lib/utils";

export interface PageLabelProps {
  title: string;
  description?: string;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}

export function PageLabel({
  title,
  description,
  className,
  titleClassName,
  descriptionClassName
}: PageLabelProps) {
  return (
    <div className={cn("min-w-0 flex flex-col gap-1", className)}>
      <p className={cn("text-[1.35rem] font-semibold leading-tight tracking-[-0.03em] text-foreground", titleClassName)}>
        {title}
      </p>
      {description ? (
        <p className={cn("text-sm leading-5 text-muted-foreground", descriptionClassName)}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
