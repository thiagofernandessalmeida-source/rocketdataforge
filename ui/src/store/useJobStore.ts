// Hook para sincronizar com o jobStore reativo
import { useState, useEffect } from "react";
import { jobStore } from "./jobStore";

export function useJobStore() {
  const [state, setState] = useState(() => jobStore.getState());

  useEffect(() => {
    const unsub = jobStore.subscribe(() => {
      setState(jobStore.getState());
    });
    return unsub;
  }, []);

  return state;
}
