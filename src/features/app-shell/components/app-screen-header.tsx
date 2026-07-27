import { ChevronLeft } from "lucide-react";

export interface AppScreenHeaderProps {
  onBack: () => void;
}

export function AppScreenHeader({ onBack }: AppScreenHeaderProps) {
  return (
    <div className="section-back-row">
      <button className="button secondary section-back-button" type="button" onClick={onBack}>
        <ChevronLeft size={17} />
        Volver
      </button>
    </div>
  );
}
