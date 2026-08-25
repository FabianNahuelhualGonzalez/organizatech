import { AppBackButton } from "@/ui/navigation/app-back-button";

export interface AppScreenHeaderProps {
  onBack: () => void;
}

export function AppScreenHeader({ onBack }: AppScreenHeaderProps) {
  return (
    <div className="section-back-row">
      <AppBackButton onBack={onBack} />
    </div>
  );
}
