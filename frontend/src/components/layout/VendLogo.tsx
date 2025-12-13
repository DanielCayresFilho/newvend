import { cn } from "@/lib/utils";

interface VendLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
  className?: string;
}

export function VendLogo({ size = 'md', showSubtitle = true, className }: VendLogoProps) {
  const sizes = {
    sm: { box: 'w-8 h-8', text: 'text-lg', letter: 'text-xl', subtitle: 'text-xs' },
    md: { box: 'w-10 h-10', text: 'text-xl', letter: 'text-2xl', subtitle: 'text-xs' },
    lg: { box: 'w-16 h-16', text: 'text-3xl', letter: 'text-4xl', subtitle: 'text-sm' }
  };

  const s = sizes[size];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className={cn(
        s.box,
        "rounded-lg bg-gradient-to-br from-primary to-cyan flex items-center justify-center shadow-lg"
      )}>
        <span className={cn(s.letter, "font-bold text-primary-foreground")}>V</span>
      </div>
      <div className="flex flex-col">
        <span className={cn(s.text, "font-bold text-sidebar-foreground tracking-tight")}>
          vend
        </span>
        {showSubtitle && (
          <span className={cn(s.subtitle, "text-muted-foreground")}>
            SaaS de Atendimento
          </span>
        )}
      </div>
    </div>
  );
}
