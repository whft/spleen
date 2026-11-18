import React from "react";
import {
  getConfigUpdateSnapshot,
  subscribeConfigUpdate,
} from "@/lib/configUpdate";
import { SpleenLogo } from "./SpleenLogo";

export const ConfigUpdateOverlay: React.FC = () => {
  const [{ isUpdating }, setState] = React.useState(() => getConfigUpdateSnapshot());

  React.useEffect(() => {
    return subscribeConfigUpdate(setState);
  }, []);

  if (!isUpdating) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/90">
      <SpleenLogo width={80} height={80} isAnimated />
    </div>
  );
};
