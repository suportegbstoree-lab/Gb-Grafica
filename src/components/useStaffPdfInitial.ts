import React from "react";
import { firstInitial, type DecorativeInitial } from "../lib/decorativeInitial";
import type { StaffPdfApi } from "../services/staffPdfService";
export function useStaffPdfInitial(
  api: StaffPdfApi,
  baseId: string,
  text: string,
  sizePercent?: number,
  baseRevision?: string,
) {
  const [initial, setInitial] = React.useState<DecorativeInitial | undefined>(),
    [error, setError] = React.useState("");
  const letter = firstInitial(text) || "";
  React.useEffect(() => {
    let active = true;
    setInitial(undefined);
    setError("");
    if (baseId && letter)
      void api
        .initial(baseId, letter)
        .then((value) => {
          if (active) setInitial(value);
        })
        .catch((e) => {
          if (active) setError((e as Error).message);
        });
    return () => {
      active = false;
    };
  }, [api, baseId, letter, baseRevision]);
  const sized = React.useMemo(
    () =>
      initial &&
      sizePercent !== undefined &&
      sizePercent >= 5 &&
      sizePercent <= 100
        ? { ...initial, sizePercent }
        : initial,
    [initial, sizePercent],
  );
  return { initial: sized, initialError: error };
}
